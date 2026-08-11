import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { SheetsService } from '../../sheets/sheets.service';
import { RendicionesService } from '../../rendiciones/rendiciones.service';
import { WhatsAppService } from '../../whatsapp/whatsapp.service';
import { WhatsAppSessionService } from '../../whatsapp/whatsapp-session.service';
import { runWithTenant } from '../../../common/tenant/tenant-context';
import { normalizePhone } from '../../../common/utils/normalize-phone';
import { isFinalAttempt } from '../../../common/queue/is-final-attempt';
import { SAFE_MESSAGES } from '../../../common/exceptions';

// Etiquetas legibles para el usuario de terreno. El clasificador emite claves
// técnicas (factura_recibida, guia_despacho…); la confirmación de WhatsApp debe
// mostrar el tipo en español, no la clave interna.
// Descriptor de notificación WhatsApp a enviar DESPUÉS del commit de la tx del
// tenant. Los envíos salientes no deben correr con la transacción abierta.
type PostCommitNotify =
  | {
      kind: 'confirm';
      phone: string;
      tipo: string;
      proveedor: string;
      monto: string;
      proyecto: string;
      estado: string;
      // [Slice C / ADR-10] Optional NUEVO escape line appended when resolver_method='single_active_project'.
      // Passed as a non-breaking optional to confirmarProcesado so callers that do not care
      // about the offer line are unaffected (nuevoLine=undefined → message unchanged).
      nuevoLine?: string;
      // Context for setting the project_create_offer session after the confirmation is sent.
      offerContext?: {
        eventoCrudoId: string;
        autoAssignedProjectId: string;
        facturaId?: string;
      };
    }
  | { kind: 'duplicate'; phone: string }
  | null;

const TIPO_LABELS: Record<string, string> = {
  factura_recibida: 'Factura recibida',
  factura_emitida: 'Factura emitida',
  boleta: 'Boleta',
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito',
  orden_compra: 'Orden de compra',
  comprobante: 'Comprobante',
  contrato: 'Contrato',
  formulario: 'Formulario',
  liquidacion: 'Liquidación',
  guia_despacho: 'Guía de despacho',
  contrato_personal: 'Contrato de personal',
  otro: 'Otro',
};

@Processor('persist')
export class PersistProcessor extends WorkerHost {
  private readonly logger = new Logger(PersistProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sheetsService: SheetsService,
    private readonly rendicionesService: RendicionesService,
    private readonly wa: WhatsAppService,
    private readonly sessions: WhatsAppSessionService,
  ) {
    super();
  }

  async process(job: Job<{ evento_crudo_id: string; client_id: string; classification: any; processing_status: string }>): Promise<void> {
    return this.runJob(job);
  }

  private async runJob(job: Job<{ evento_crudo_id: string; client_id: string; classification: any; processing_status: string }>): Promise<void> {
    const { evento_crudo_id, client_id } = job.data;
    try {
      // Fase 2 — happy path dentro de una tx con app.current_tenant = client_id.
      // persistEvento solo COMPUTA el aviso; el envío saliente por WhatsApp se hace
      // acá, DESPUÉS de que la transacción del tenant commitea (no con la tx abierta).
      const notify = await runWithTenant(this.dataSource, client_id, () => this.persistEvento(job));

      // Best-effort: un fallo de notificación jamás debe voltear la factura ya persistida.
      if (notify?.kind === 'confirm') {
        try {
          await this.wa.confirmarProcesado({
            telefono: notify.phone,
            tipo: notify.tipo,
            proveedor: notify.proveedor,
            monto: notify.monto,
            proyecto: notify.proyecto,
            estado: notify.estado,
            nuevoLine: notify.nuevoLine,
          });
        } catch (e: any) {
          this.logger.warn(`[F1Persist] WhatsApp confirmation failed: ${e.message}`);
        }

        // [Slice C / ADR-10 / ADR-11] After sending the confirmation, set the
        // project_create_offer session if the offer context was computed.
        // Best-effort: a Redis failure here must NOT roll back the already-committed invoice.
        // HONEST LIMITATION (spec R-14(d)/SCENARIO-18): the invoice is ALREADY persisted at
        // this point. The offer allows re-pointing the evento and creating a draft; it does
        // NOT move the committed invoice/rendición to the new project (out of scope).
        if (notify.offerContext) {
          const { eventoCrudoId, autoAssignedProjectId, facturaId } = notify.offerContext;
          try {
            const existing = await this.sessions.get(notify.phone);
            const session = existing ?? {
              state: '',
              projects: [],
              base64: '',
              mimeType: '',
              caption: '',
              clientId: job.data.client_id,
              canalId: null,
              updatedAt: new Date().toISOString(),
            };
            // [ADR-11] INVARIANT: state and clarification must be set in the same write.
            session.state = 'awaiting_clarification';
            session.clarification = {
              eventoCrudoId,
              type: 'project_create_offer',
              attempts: 0,
              autoAssignedProjectId,
              ...(facturaId ? { facturaId } : {}),
            };
            await this.sessions.set(notify.phone, session as any);
            this.logger.log(`[F1Persist] project_create_offer session set for ${notify.phone} evento=${eventoCrudoId}`);
          } catch (e: any) {
            this.logger.warn(`[F1Persist] Could not set project_create_offer session: ${e.message}`);
          }
        }
      } else if (notify?.kind === 'duplicate') {
        try {
          await this.wa.avisarDuplicado(notify.phone);
        } catch (e: any) {
          this.logger.warn(`[F1Persist] WhatsApp duplicate notice failed: ${e.message}`);
        }
      }
    } catch (err: any) {
      // Raw cause is logged for debugging; the persisted error_message must stay safe
      // because that column is returned by the API and rendered in the admin UI.
      this.logger.error(`[F1Persist] Error [evento=${evento_crudo_id}]: ${err.message}`);
      // setStatus de error en tx SEPARADA: persiste pese al rollback del happy path.
      await runWithTenant(this.dataSource, client_id, () =>
        this.dataSource.query(
          `UPDATE eventos_crudos SET processing_status_new='failed_classification', status='failed', error_message=$1 WHERE id=$2`,
          [SAFE_MESSAGES.INTEGRATION_FAILURE, evento_crudo_id],
        ),
      ).catch(() => {});
      // Solo en el último intento: si BullMQ va a reintentar, no notificamos aún
      // para no mandarle un mensaje de error por cada reintento.
      if (isFinalAttempt(job)) {
        // La resolución del teléfono corre bajo RLS (runWithTenant); el envío saliente
        // se hace FUERA de la tx del tenant.
        const phone = await runWithTenant(this.dataSource, client_id, () =>
          this.notifyFailureByEvento(evento_crudo_id),
        ).catch(() => null);
        if (phone) await this.wa.avisarFalloProcesamiento(phone).catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Resuelve el teléfono del remitente desde el evento crudo para el aviso de fallo
   * por WhatsApp. Corre bajo runWithTenant (RLS) desde el catch, pero ya NO envía:
   * devuelve el phone (o null) y el envío saliente se hace fuera de la tx del tenant.
   * Silenciosa: cualquier error no debe alterar el flujo de fallo ya persistido.
   */
  private async notifyFailureByEvento(eventoCrudoId: string): Promise<string | null> {
    const rows = await this.dataSource
      .query(`SELECT payload, canal, source FROM eventos_crudos WHERE id=$1`, [eventoCrudoId])
      .catch(() => []);
    if (!rows.length) return null;
    const { payload, canal, source } = rows[0];
    const channel = canal ?? source ?? 'unknown';
    if (channel !== 'whatsapp') return null;
    const phone = typeof payload === 'object' ? (payload?.from ?? payload?.phone ?? null) : null;
    return phone ?? null;
  }

  private async persistEvento(
    job: Job<{ evento_crudo_id: string; client_id: string; classification: any; processing_status: string }>,
  ): Promise<PostCommitNotify> {
    const { evento_crudo_id, client_id, classification } = job.data;
    this.logger.log(`[F1Persist] Persisting evento: ${evento_crudo_id}`);

    const datos     = classification.datos_extraidos ?? {};
    const tipo      = classification.tipo;
    const destino   = classification.destino;
    const confidence = classification.confidence_score ?? 0;

    const eventoRows = await this.dataSource.query(
      `SELECT payload, canal, source, email_from, parsed_data FROM eventos_crudos WHERE id=$1`, [evento_crudo_id],
    );
    if (!eventoRows.length) throw new Error('Evento not found');
    const { canal, source: eventoSource, payload, email_from, parsed_data } = eventoRows[0];

    // B06/B07 — ADR-12: honor resolved_project_id from parsed_data at both derivation sites.
    // Precedence: resolved_project_id > proyecto_id_sugerido > payload.project_id > null.
    // JBB-002 — jsonb may arrive as an object OR a JSON string depending on the driver/path;
    // parse the string form the same way approve()/reject() do so it is honored consistently.
    const parsedData: Record<string, unknown> | null =
      typeof parsed_data === 'string'
        ? ((): Record<string, unknown> | null => {
            try { return JSON.parse(parsed_data); } catch { return null; }
          })()
        : (typeof parsed_data === 'object' ? parsed_data : null);
    const resolvedProjectId: string | null =
      parsedData !== null
        ? ((parsedData.resolved_project_id as string | null) ?? null)
        : null;
    // WhatsApp guarda el canal en la columna `source` (no `canal`). `invoices.source`
    // es NOT NULL → fallback para no romper el INSERT con un canal null.
    const channel = canal ?? eventoSource ?? 'unknown';

    const category    = destino === 'gastos' ? 'expense' : destino === 'ventas' ? 'sale' : 'cost';
    const amount      = datos.monto_total ?? 0;
    const vendorName  = datos.razon_social_emisor ?? 'Unknown';
    const invoiceDate = datos.fecha_emision ?? new Date().toISOString().split('T')[0];
    const description = `${tipo} - ${classification.categoria ?? 'Sin categoría'} | Confidence: ${confidence}`;

    // Natural key duplicate check
    if (datos.numero_documento && datos.rut_emisor) {
      const dupInvoice = await this.dataSource.query(
        `SELECT id FROM invoices WHERE client_id=$1 AND numero_documento=$2 AND rut_emisor=$3 LIMIT 1`,
        [client_id, datos.numero_documento, datos.rut_emisor],
      );
      if (dupInvoice.length) {
        await this.dataSource.query(
          `UPDATE eventos_crudos SET processing_status_new='duplicate', status='duplicate' WHERE id=$1`,
          [evento_crudo_id],
        );
        this.logger.warn(`[F1Persist] Duplicate invoice: ${evento_crudo_id}`);
        // No dejar colgado al remitente tras el ack inicial: avisar que ya estaba
        // registrado. El envío se hace tras el commit (fuera de la tx del tenant).
        if (channel === 'whatsapp') {
          const phone = typeof payload === 'object' ? (payload?.from ?? payload?.phone ?? null) : null;
          if (phone) return { kind: 'duplicate', phone };
        }
        return null;
      }
    }

    const invoiceResult = await this.dataSource.query(
      `INSERT INTO invoices (
        client_id, source, vendor_name, amount, currency,
        invoice_date, category, description, status,
        raw_payload, ai_extracted
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id`,
      [
        client_id, channel, vendorName, amount, datos.moneda ?? 'CLP',
        invoiceDate, category, description, 'pending',
        JSON.stringify(classification), JSON.stringify(classification),
      ],
    );

    const invoiceId = invoiceResult[0].id;

    await this.dataSource.query(
      `UPDATE eventos_crudos SET factura_id=$1, processing_status_new='processed', status='processed', processed_at=NOW() WHERE id=$2`,
      [invoiceId, evento_crudo_id],
    );

    this.logger.log(`[F1Persist] Invoice created: ${invoiceId} from evento: ${evento_crudo_id}`);

    // ─── f2-rendicion: agrupar gasto en rendición semanal ─────────────────
    if (category === 'expense') {
      try {
        // B06 — ADR-12: resolved_project_id takes precedence over all other sources.
        const projectId = resolvedProjectId
          ?? classification.proyecto_id_sugerido
          ?? (typeof payload === 'object' ? payload?.project_id : null)
          ?? null;
        const personaId = await this.resolvePersonaId(client_id, payload, channel);
        if (personaId) {
          await this.rendicionesService.asignarFacturaARendicion(
            client_id, invoiceId, personaId, projectId, amount, invoiceDate,
          );
        }
      } catch (err: any) {
        this.logger.warn(`[F1Persist] F2 rendición assignment failed: ${err.message}`);
      }
    }

    // ─── f1-sheets-export ─────────────────────────────────────────────────
    await this.sheetsService.exportInvoice(client_id, {
      id: invoiceId,
      vendor_name: vendorName,
      amount,
      currency: datos.moneda ?? 'CLP',
      invoice_date: invoiceDate,
      category,
      description,
      source: channel,
      confidence_score: confidence,
      ai_classification: classification,
    });

    // ─── f1-notify: email reply to sender ────────────────────────────────
    await this.sendNotification({
      canal,
      emailFrom: email_from ?? (typeof payload === 'object' ? payload?.from : null),
      amount,
      currency: datos.moneda ?? 'CLP',
      destino,
      categoria: classification.categoria ?? 'Sin categoría',
      vendorName,
    });

    // ─── f1-notify: WhatsApp confirmation to sender ──────────────────────
    // El de terreno solo recibía el ack inicial ("Procesando con IA…") y quedaba
    // colgado. Acá, con la factura ya registrada, COMPUTAMOS lo que REALMENTE
    // se procesó (tipo, monto, proyecto, estado). El envío saliente se hace tras
    // el commit de la tx del tenant, no acá dentro.
    return this.sendWhatsAppConfirmation({
      channel,
      phone: typeof payload === 'object' ? (payload?.from ?? payload?.phone ?? null) : null,
      tipo,
      amount,
      currency: datos.moneda ?? 'CLP',
      vendorName,
      // B07 — ADR-12: resolved_project_id takes precedence at confirmation site too.
      proyectoId: resolvedProjectId ?? classification.proyecto_id_sugerido ?? null,
      // [Slice C] Pass resolver_method and invoiceId so sendWhatsAppConfirmation
      // can compute the ADR-10 NUEVO offer for single_active_project events.
      resolverMethod: classification.resolver_method ?? null,
      eventoCrudoId: evento_crudo_id,
      clientId: client_id,
      invoiceId,
    });
  }

  /**
   * COMPUTA el descriptor de confirmación por WhatsApp del documento ya procesado.
   * La lectura del nombre del proyecto y el formato de monto/tipo son lecturas de DB /
   * formateo puro que corren dentro de runWithTenant (RLS). El envío saliente NO se
   * hace acá: se devuelve el descriptor y `process` lo envía tras el commit.
   *
   * [Slice C / ADR-10] When resolverMethod='single_active_project' and the sender is a
   * MANAGER, the returned descriptor includes:
   *   - nuevoLine: the NUEVO escape line to append to the confirmation message
   *   - offerContext: { eventoCrudoId, autoAssignedProjectId, facturaId } so runJob can
   *     set the project_create_offer session AFTER sending the confirmation.
   *
   * HONEST LIMITATION (spec R-14(d)/SCENARIO-18): the invoice is ALREADY committed by
   * the time this method runs (it is called at the end of persistEvento, inside the
   * runWithTenant block). The NUEVO offer can re-point the evento and create a draft;
   * it does NOT move the committed invoice/rendición. The nuevoLine and confirmation
   * text reflect this (they do not claim to move the invoice).
   */
  private async sendWhatsAppConfirmation(opts: {
    channel: string;
    phone: string | null;
    tipo: string;
    amount: number;
    currency: string;
    vendorName: string;
    proyectoId: string | null;
    // [Slice C] Additional fields for ADR-10 NUEVO offer computation
    resolverMethod?: string | null;
    eventoCrudoId?: string;
    clientId?: string;
    invoiceId?: string;
  }): Promise<PostCommitNotify> {
    if (opts.channel !== 'whatsapp' || !opts.phone) return null;

    let proyecto = 'sin asignar';
    if (opts.proyectoId) {
      const rows = await this.dataSource
        .query(`SELECT name FROM projects WHERE id=$1 LIMIT 1`, [opts.proyectoId])
        .catch(() => []);
      if (rows[0]?.name) proyecto = rows[0].name;
    }

    const monto = Number(opts.amount) > 0
      ? new Intl.NumberFormat('es-CL', {
          style: 'currency', currency: opts.currency, maximumFractionDigits: 0,
        }).format(Number(opts.amount))
      : 'no detectado';

    // [Slice C / ADR-10 / R-14(a)(b)] Compute NUEVO offer for single_active_project.
    // Non-breaking: only appended when resolver_method='single_active_project' AND sender is MANAGER.
    // Language: getUserLanguageForCreate is in ClarificationService (not available here without
    // circular injection). We use a minimal inline DB lookup mirroring getUserLanguageForCreate.
    // Deviation noted: inline MANAGER + lang query instead of injecting ClarificationService
    // (avoids circular dependency: ClarificationService → ProjectInboxService → QueueModule → PersistProcessor).
    let nuevoLine: string | undefined;
    let offerContext: PostCommitNotify extends { kind: 'confirm' } ? any : never;

    if (opts.resolverMethod === 'single_active_project' && opts.phone && opts.eventoCrudoId && opts.clientId) {
      const digitPhone = opts.phone.replace(/\D/g, '');
      const managerRows = await this.dataSource
        .query(
          `SELECT language FROM users
           WHERE regexp_replace(phone, '\\D', '', 'g') = $1
             AND client_id = $2
             AND role = 'MANAGER'
             AND is_active = true
           LIMIT 1`,
          [digitPhone, opts.clientId],
        )
        .catch(() => []);

      if (managerRows.length > 0) {
        const lang = managerRows[0]?.language === 'en' ? 'en' : 'es';
        nuevoLine = lang === 'en'
          ? 'If this is for a different project, reply NEW.'
          : 'Si es para otro proyecto, respondé NUEVO.';

        (offerContext as any) = {
          eventoCrudoId: opts.eventoCrudoId,
          autoAssignedProjectId: opts.proyectoId ?? '',
          ...(opts.invoiceId ? { facturaId: opts.invoiceId } : {}),
        };
      }
    }

    const result: PostCommitNotify = {
      kind: 'confirm',
      phone: opts.phone,
      tipo: TIPO_LABELS[opts.tipo] ?? 'Documento',
      proveedor: opts.vendorName || 'no detectado',
      monto,
      proyecto,
      estado: 'Registrado ✓',
      ...(nuevoLine !== undefined ? { nuevoLine } : {}),
      ...(offerContext !== undefined ? { offerContext } : {}),
    };

    return result;
  }

  private async resolvePersonaId(
    clientId: string,
    payload: any,
    canal: string,
  ): Promise<string | null> {
    const phone = typeof payload === 'object' ? (payload?.from ?? payload?.phone) : null;
    const email = typeof payload === 'object' ? payload?.email_from : null;
    // Mismo criterio que el bot: comparar por DÍGITOS del teléfono, no exacto.
    // El `from` de Meta llega como dígitos (549...) pero el phone guardado tiene '+',
    // espacios, etc. Con match exacto no encontraba al promotor → la factura quedaba
    // sin persona (no entraba a rendición).
    const digits = normalizePhone(phone);

    if (digits) {
      const rows = await this.dataSource.query(
        `SELECT id FROM promoters WHERE client_id = $1 AND regexp_replace(phone, '\\D', '', 'g') = $2 LIMIT 1`,
        [clientId, digits],
      ).catch(() => []);
      if (rows.length) return rows[0].id;
    }

    if (email) {
      const rows = await this.dataSource.query(
        `SELECT id FROM users WHERE client_id = $1 AND email = $2 LIMIT 1`,
        [clientId, email],
      ).catch(() => []);
      if (rows.length) return rows[0].id;
    }

    if (canal === 'whatsapp' && digits) {
      const rows = await this.dataSource.query(
        `SELECT id FROM collaborators WHERE client_id = $1 AND regexp_replace(phone, '\\D', '', 'g') = $2 LIMIT 1`,
        [clientId, digits],
      ).catch(() => []);
      if (rows.length) return rows[0].id;
    }

    this.logger.warn(`[F1Persist] Could not resolve persona_id for canal=${canal}`);
    return null;
  }

  private async sendNotification(opts: {
    canal: string;
    emailFrom: string | null;
    amount: number;
    currency: string;
    destino: string;
    categoria: string;
    vendorName: string;
  }): Promise<void> {
    try {
      if (opts.canal !== 'email' || !opts.emailFrom) return;

      const amountFormatted = new Intl.NumberFormat('es-CL', {
        style: 'currency', currency: opts.currency, maximumFractionDigits: 0,
      }).format(Number(opts.amount));

      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        this.logger.log(`[F1Notify] No RESEND_API_KEY — skipping email reply to ${opts.emailFrom}`);
        return;
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: 'Control Suite <noreply@controlsuite.cl>',
          to: [opts.emailFrom],
          subject: 'Documento recibido y registrado · Control Suite',
          text: `Hola,\n\nTu documento fue procesado exitosamente.\n\nProveedor: ${opts.vendorName}\nMonto: ${amountFormatted}\nDestino: ${opts.destino} · ${opts.categoria}\n\n---\nControl Suite · Operations Platform`,
        }),
      });

      if (res.ok) {
        this.logger.log(`[F1Notify] Email reply sent to: ${opts.emailFrom}`);
      } else {
        const err = await res.json();
        this.logger.warn(`[F1Notify] Resend error: ${JSON.stringify(err)}`);
      }
    } catch (err: any) {
      this.logger.warn(`[F1Notify] Failed: ${err.message}`);
    }
  }
}

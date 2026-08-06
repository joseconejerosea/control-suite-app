import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppSessionService, WhatsAppSession } from './whatsapp-session.service';
import { normalizePhone } from '../../common/utils/normalize-phone';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { UserRole } from '../../common/enums/user-role.enum';

const MAX_ATTEMPTS = 2;
const STATE = 'awaiting_evidence';

/**
 * F5 · Intake de evidencia de actividad por foto de WhatsApp.
 *
 * Cuando el triage de visión (OcrProcessor) detecta que una imagen es EVIDENCE
 * (personas/anfitrionas/staff en el evento) y no un documento ni material POP,
 * este servicio conduce la conversación y registra la foto como un checkin
 * (prueba de presencia) de la activación activa del remitente:
 *
 *   [activación] → observación → registrar (checkin con foto_key + persona_id)
 *
 * El evento crudo ya está persistido en eventos_crudos antes de llegar acá.
 *
 * El webhook es @Public (sin contexto de tenant), así que toda lectura/escritura
 * de DB va envuelta en runWithTenant para que las policies RLS vean el tenant.
 */
@Injectable()
export class EvidenceIntakeService {
  private readonly logger = new Logger(EvidenceIntakeService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly wa: WhatsAppService,
    private readonly sessions: WhatsAppSessionService,
  ) {}

  /**
   * Arranca el intake de evidencia: resuelve el promotor por teléfono, busca sus
   * activaciones activas y decide auto-seleccionar (1) o preguntar (≥2).
   */
  async start(opts: {
    eventoCrudoId: string;
    phoneNumber: string;
    clientId: string;
    storagePath: string;
    suggestedLabel?: string | null;
  }): Promise<void> {
    const digits = normalizePhone(opts.phoneNumber);

    // Resolver la persona por dígitos del teléfono. El `from` de Meta llega 549...
    // y el phone guardado tiene '+', espacios, etc. Todo dentro de runWithTenant (RLS).
    // Resolvemos al remitente contra las MISMAS tablas que autoriza el gate del bot
    // (isAuthorizedSender): promotores, colaboradores y usuarios (Manager/Operador/
    // Supervisor). Así cualquier staff autorizado que mande su foto de la activación
    // queda asociado. checkins.persona_id NO tiene FK, así que el id de cualquiera de
    // las tres tablas sirve como persona del check-in. Todo dentro de runWithTenant (RLS).
    const personaId: string | null = await runWithTenant(this.ds, opts.clientId, async () => {
      const prom = await this.ds.query(
        `SELECT id FROM promoters WHERE client_id=$1 AND regexp_replace(phone,'\\D','','g')=$2 LIMIT 1`,
        [opts.clientId, digits],
      );
      if (prom.length) return prom[0].id;

      const colab = await this.ds.query(
        `SELECT id FROM collaborators WHERE client_id=$1 AND is_active=true AND regexp_replace(phone,'\\D','','g')=$2 LIMIT 1`,
        [opts.clientId, digits],
      );
      if (colab.length) return colab[0].id;

      const usr = await this.ds.query(
        `SELECT id FROM users
          WHERE client_id=$1 AND is_active=true AND phone IS NOT NULL
            AND role IN ($3, $4, $5)
            AND regexp_replace(phone,'\\D','','g')=$2
          LIMIT 1`,
        [opts.clientId, digits, UserRole.MANAGER, UserRole.OPERATOR, UserRole.SUPERVISOR],
      );
      return usr.length ? usr[0].id : null;
    }).catch(() => null);

    if (!personaId) {
      await this.escalate(
        opts.eventoCrudoId, opts.phoneNumber, opts.clientId,
        'No te encuentro registrado para asociar esta evidencia. Lo derivo a un operador.',
        'evidence_unknown_persona',
      );
      return;
    }

    // Resolución de activación en dos niveles:
    //   Nivel 1 — activaciones activas asignadas al promotor (promoter_id).
    //   Nivel 2 — fallback por CLIENTE cuando el promotor no tiene ninguna asignada.
    // Hoy las activaciones se cargan con promoter_id en null, así que el nivel 1
    // matchea 0 filas; el fallback por cliente es el que resuelve (mismo criterio
    // que el check-in por GPS en handleLocation, que también ignora promoter_id).
    let activaciones = await runWithTenant(this.ds, opts.clientId, () =>
      this.ds.query(
        `SELECT id, activation_date FROM activations
          WHERE client_id=$1 AND promoter_id=$2
            AND status IN ('scheduled','in_progress')
            AND estado_f5 IS DISTINCT FROM 'cerrada'
          ORDER BY activation_date DESC LIMIT 10`,
        [opts.clientId, personaId],
      ),
    ).catch(() => []);

    if (!activaciones.length) {
      activaciones = await runWithTenant(this.ds, opts.clientId, () =>
        this.ds.query(
          `SELECT id, activation_date FROM activations
            WHERE client_id=$1
              AND status IN ('scheduled','in_progress')
              AND estado_f5 IS DISTINCT FROM 'cerrada'
            ORDER BY activation_date DESC LIMIT 10`,
          [opts.clientId],
        ),
      ).catch(() => []);
    }

    if (!activaciones.length) {
      await this.escalate(
        opts.eventoCrudoId, opts.phoneNumber, opts.clientId,
        'No encontré una activación activa a tu nombre para esta evidencia. Lo derivo a un operador.',
        'evidence_no_active_activation',
      );
      return;
    }

    const opciones = activaciones.map((a: any) => ({
      id: a.id,
      label: `Activación ${a.activation_date ?? ''}`.trim(),
    }));

    const session = (await this.sessions.get(opts.phoneNumber)) ?? this.emptySession(opts.clientId);
    session.clientId = opts.clientId;
    session.state = STATE;
    session.evidenceIntake = {
      eventoCrudoId: opts.eventoCrudoId,
      storagePath: opts.storagePath,
      step: 'observacion',
      attempts: 0,
      personaId,
    };

    // Una sola activación → auto-seleccionar y saltar la pregunta.
    if (opciones.length === 1) {
      session.evidenceIntake.activacionId = opciones[0].id;
      await this.sessions.set(opts.phoneNumber, session);
      await this.askObservacion(opts.phoneNumber);
      this.logger.log(`[Evidence] Intake iniciado (auto-activación) para evento ${opts.eventoCrudoId}`);
      return;
    }

    // ≥2 activaciones → preguntar con lista numerada.
    session.evidenceIntake.step = 'activacion';
    session.evidenceIntake.activaciones = opciones;
    await this.sessions.set(opts.phoneNumber, session);
    const list = opciones.map((o: { label: string }, i: number) => `${i + 1}. ${o.label}`).join('\n');
    await this.wa.sendText(
      opts.phoneNumber,
      `¿A qué activación corresponde esta evidencia?\n\n${list}\n\nRespondé con el número.`,
    );
    this.logger.log(`[Evidence] Intake iniciado (${opciones.length} activaciones) para evento ${opts.eventoCrudoId}`);
  }

  /**
   * Intercepta las respuestas de texto del intake. Devuelve true si consumió el
   * mensaje (el webhook debe frenar ahí), false si no había intake en curso.
   */
  async handleResponse(phoneNumber: string, text: string): Promise<boolean> {
    const session = await this.sessions.get(phoneNumber);
    if (!session?.evidenceIntake || session.state !== STATE) return false;

    const ei = session.evidenceIntake;
    switch (ei.step) {
      case 'activacion':  return this.handleActivacion(phoneNumber, text, session);
      case 'observacion': return this.handleObservacion(phoneNumber, text, session);
      default:            return false;
    }
  }

  // ── Pasos ───────────────────────────────────────────────────────────────

  private async handleActivacion(phone: string, text: string, session: WhatsAppSession): Promise<boolean> {
    const ei = session.evidenceIntake!;
    const opts = ei.activaciones ?? [];
    const num = parseInt(text.trim(), 10);
    if (isNaN(num) || num < 1 || num > opts.length) {
      return this.retryOrEscalate(phone, session, `Respondé con un número entre 1 y ${opts.length}.`);
    }
    ei.activacionId = opts[num - 1].id;
    ei.step = 'observacion';
    ei.attempts = 0;
    await this.sessions.set(phone, session);
    await this.askObservacion(phone);
    return true;
  }

  private async handleObservacion(phone: string, text: string, session: WhatsAppSession): Promise<boolean> {
    const ei = session.evidenceIntake!;
    const raw = (text ?? '').trim();
    const skip = ['listo', 'no', 'omitir', 'skip', '-', ''].includes(raw.toLowerCase());
    const observacion = skip ? null : raw.slice(0, 500);
    return this.register(phone, session, observacion);
  }

  private async askObservacion(phone: string): Promise<void> {
    await this.wa.sendText(
      phone,
      '📸 Evidencia recibida. ¿Quiénes aparecen o alguna nota? (opcional — respondé *listo* para omitir)',
    );
  }

  // ── Registro ──────────────────────────────────────────────────────────────

  private async register(phone: string, session: WhatsAppSession, observacion: string | null): Promise<boolean> {
    const ei = session.evidenceIntake!;
    const clientId = session.clientId!;

    try {
      // Alta CRÍTICA: el checkin (la prueba de presencia que DEBE persistir).
      const rows = await runWithTenant(this.ds, clientId, () =>
        this.ds.query(
          `INSERT INTO checkins (client_id, activacion_id, persona_id, foto_key, observacion)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [clientId, ei.activacionId, ei.personaId, ei.storagePath, observacion],
        ),
      );
      const checkinId = rows[0]?.id;

      // Bookkeeping en tx SEPARADA (cierre del evento). Best-effort: corre DESPUÉS
      // del commit del alta, así un fallo acá NUNCA voltea el checkin ya persistido —
      // solo se loguea. flow='F5_EVID' (7 chars) entra en eventos_crudos.flow VARCHAR(10).
      await runWithTenant(this.ds, clientId, () =>
        this.ds.query(
          `UPDATE eventos_crudos SET
             flow='F5_EVID', status='processed', processed_at=NOW(),
             parsed_data = COALESCE(parsed_data,'{}'::jsonb) || $2::jsonb
           WHERE id=$1`,
          [
            ei.eventoCrudoId,
            JSON.stringify({ checkin_id: checkinId, evidence_registered_at: new Date().toISOString() }),
          ],
        ),
      ).catch((e: any) => this.logger.warn(`[Evidence] Bookkeeping post-alta falló (evento ${ei.eventoCrudoId}): ${e.message}`));

      await this.sessions.delete(phone);
      await this.wa.sendText(phone, '✅ Evidencia guardada en la activación. ¡Gracias!');
      this.logger.log(`[Evidence] Registrado checkin ${checkinId} (evento ${ei.eventoCrudoId})`);
      return true;
    } catch (err: any) {
      this.logger.error(`[Evidence] Error registrando evidencia (evento ${ei.eventoCrudoId}): ${err.message}`);
      await this.sessions.delete(phone);
      await this.wa.sendText(phone, 'No pude guardar la evidencia. Un operador lo va a revisar.');
      return true;
    }
  }

  // ── Escalado / reintento ───────────────────────────────────────────────────

  /**
   * Deriva a un operador: avisa al remitente y marca el evento como escalated.
   * NO deja sesión (no hay conversación que continuar).
   */
  private async escalate(
    eventoCrudoId: string, phone: string, clientId: string, message: string, reason: string,
  ): Promise<void> {
    // eventos_crudos tiene RLS y el rol de la app es NOBYPASSRLS: sin
    // app.current_tenant el UPDATE matchea 0 filas. Va envuelto en runWithTenant.
    await runWithTenant(this.ds, clientId, () =>
      this.ds.query(
        `UPDATE eventos_crudos SET status='escalated',
           parsed_data = COALESCE(parsed_data,'{}'::jsonb) || $2::jsonb WHERE id=$1`,
        [eventoCrudoId, JSON.stringify({ escalated_at: new Date().toISOString(), escalation_reason: reason })],
      ),
    ).catch(() => {});
    await this.wa.sendText(phone, message);
    this.logger.log(`[Evidence] Escalado evento ${eventoCrudoId} (${reason})`);
  }

  private async retryOrEscalate(phone: string, session: WhatsAppSession, retryMsg: string): Promise<boolean> {
    const ei = session.evidenceIntake!;
    ei.attempts = (ei.attempts ?? 0) + 1;

    if (ei.attempts >= MAX_ATTEMPTS) {
      await runWithTenant(this.ds, session.clientId!, () =>
        this.ds.query(
          `UPDATE eventos_crudos SET status='escalated',
             parsed_data = COALESCE(parsed_data,'{}'::jsonb) || $2::jsonb WHERE id=$1`,
          [ei.eventoCrudoId, JSON.stringify({ escalated_at: new Date().toISOString(), escalation_reason: 'evidence_intake_max_attempts' })],
        ),
      ).catch(() => {});
      await this.sessions.delete(phone);
      await this.wa.sendText(phone, 'Voy a derivar esto a un operador para que lo cargue manualmente. Gracias.');
      return true;
    }

    await this.sessions.set(phone, session);
    await this.wa.sendText(phone, `${retryMsg} Último intento.`);
    return true;
  }

  private emptySession(clientId: string): WhatsAppSession {
    return {
      state: '',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      clientId,
      canalId: null,
      updatedAt: new Date().toISOString(),
      clarification: null,
      materialIntake: null,
      evidenceIntake: null,
    };
  }
}

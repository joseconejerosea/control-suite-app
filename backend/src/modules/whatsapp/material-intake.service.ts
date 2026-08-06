import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppSessionService, WhatsAppSession } from './whatsapp-session.service';
import { EvidenceIntakeService } from './evidence-intake.service';
import { SkusService } from '../skus/skus.service';
import { MovimientosPopService } from '../movimientos-pop/movimientos-pop.service';
import { runWithTenant } from '../../common/tenant/tenant-context';

const MAX_ATTEMPTS = 2;
const STATE = 'awaiting_material';

/**
 * F3 · Intake de material POP por foto de WhatsApp.
 *
 * Cuando el triage de visión (OcrProcessor) detecta que una imagen es MATERIAL y
 * no un documento, este servicio conduce la conversación multi-paso y, al final,
 * crea el ítem y su movimiento de inventario reusando los servicios de dominio:
 *
 *   nombre → proyecto → bodega → cantidad → registrar (SKU 'entrada' + inventario)
 *
 * Invariante del cliente: ante ambigüedad el bot PREGUNTA (askKind), nunca asume.
 * El evento crudo ya está persistido en eventos_crudos antes de llegar acá.
 *
 * El webhook es @Public (sin contexto de tenant), así que toda lectura/escritura
 * de DB va envuelta en runWithTenant para que las policies RLS vean el tenant.
 */
@Injectable()
export class MaterialIntakeService {
  private readonly logger = new Logger(MaterialIntakeService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectQueue('classify') private readonly classifyQueue: Queue,
    private readonly wa: WhatsAppService,
    private readonly sessions: WhatsAppSessionService,
    private readonly skus: SkusService,
    private readonly movimientos: MovimientosPopService,
    // EvidenceIntakeService lo provee el mismo @Global MaterialIntakeModule y NO
    // depende de MaterialIntakeService, así que no hay ciclo al inyectarlo acá.
    private readonly evidenceIntake: EvidenceIntakeService,
  ) {}

  /** Arranca el intake de material: primer paso, preguntar el nombre del ítem. */
  async start(opts: {
    eventoCrudoId: string;
    phoneNumber: string;
    clientId: string;
    storagePath: string;
    suggestedLabel?: string | null;
  }): Promise<void> {
    const session = (await this.sessions.get(opts.phoneNumber)) ?? this.emptySession(opts.clientId);
    session.clientId = opts.clientId;
    session.state = STATE;
    session.materialIntake = {
      eventoCrudoId: opts.eventoCrudoId,
      storagePath: opts.storagePath,
      step: 'nombre',
      attempts: 0,
      suggestedLabel: opts.suggestedLabel ?? null,
    };
    await this.sessions.set(opts.phoneNumber, session);

    const hint = opts.suggestedLabel ? ` (parece: ${opts.suggestedLabel})` : '';
    await this.wa.sendText(
      opts.phoneNumber,
      `📦 Detecté que esto es *material POP*, no un documento.\n\n¿Qué material es?${hint}\nEscribí el nombre.`,
    );
    this.logger.log(`[Material] Intake iniciado para evento ${opts.eventoCrudoId}`);
  }

  /**
   * Ambigüedad documento/material: el triage no está seguro. Preguntamos en vez
   * de asumir. El OCR ya guardó el texto, así que si responde "documento" se
   * reanuda la clasificación F1.
   */
  async askKind(opts: {
    eventoCrudoId: string;
    phoneNumber: string;
    clientId: string;
    storagePath: string;
    suggestedLabel?: string | null;
  }): Promise<void> {
    const session = (await this.sessions.get(opts.phoneNumber)) ?? this.emptySession(opts.clientId);
    session.clientId = opts.clientId;
    session.state = STATE;
    session.materialIntake = {
      eventoCrudoId: opts.eventoCrudoId,
      storagePath: opts.storagePath,
      step: 'kind',
      attempts: 0,
      suggestedLabel: opts.suggestedLabel ?? null,
    };
    await this.sessions.set(opts.phoneNumber, session);

    await this.wa.sendText(
      opts.phoneNumber,
      `No estoy seguro de qué me enviaste. ¿Es un documento, un material POP o evidencia de actividad?\n\n1. Documento (factura, boleta, etc.)\n2. Material POP (para inventario)\n3. Evidencia de actividad (personas en el evento)\n\nRespondé con el número.`,
    );
  }

  /**
   * Intercepta las respuestas de texto del intake. Devuelve true si consumió el
   * mensaje (el webhook debe frenar ahí), false si no había intake en curso.
   */
  async handleResponse(phoneNumber: string, text: string): Promise<boolean> {
    const session = await this.sessions.get(phoneNumber);
    if (!session?.materialIntake || session.state !== STATE) return false;

    const mi = session.materialIntake;
    switch (mi.step) {
      case 'kind':     return this.handleKind(phoneNumber, text, session);
      case 'nombre':   return this.handleNombre(phoneNumber, text, session);
      case 'proyecto': return this.handleProyecto(phoneNumber, text, session);
      case 'bodega':   return this.handleBodega(phoneNumber, text, session);
      case 'cantidad': return this.handleCantidad(phoneNumber, text, session);
      default:         return false;
    }
  }

  // ── Pasos ───────────────────────────────────────────────────────────────

  private async handleKind(phone: string, text: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const num = parseInt(text.trim(), 10);

    if (num === 1) {
      // Es un documento → reanudar F1 (el OCR ya dejó el texto en el evento).
      await this.sessions.delete(phone);
      await this.classifyQueue.add(
        'classify',
        { evento_crudo_id: mi.eventoCrudoId, client_id: session.clientId, canal: 'whatsapp' },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
      await this.wa.sendText(phone, 'Ok, lo trato como documento. Procesando con IA...');
      return true;
    }

    if (num === 2) {
      mi.step = 'nombre';
      mi.attempts = 0;
      await this.sessions.set(phone, session);
      const hint = mi.suggestedLabel ? ` (parece: ${mi.suggestedLabel})` : '';
      await this.wa.sendText(phone, `📦 Perfecto, material POP.\n\n¿Qué material es?${hint}\nEscribí el nombre.`);
      return true;
    }

    if (num === 3) {
      // Es evidencia de actividad → arrancar el intake de evidencia (checkin por
      // foto). Se borra la sesión de material primero para no dejar estado colgado;
      // EvidenceIntakeService.start crea su propia sesión (state='awaiting_evidence').
      await this.sessions.delete(phone);
      await this.evidenceIntake.start({
        eventoCrudoId: mi.eventoCrudoId,
        phoneNumber: phone,
        clientId: session.clientId!,
        storagePath: mi.storagePath,
        suggestedLabel: mi.suggestedLabel,
      });
      return true;
    }

    return this.retryOrEscalate(phone, session, 'Respondé 1 (documento), 2 (material) o 3 (evidencia).');
  }

  private async handleNombre(phone: string, text: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const items = this.parseItems(text).filter((i) => i.nombre.length >= 2);
    if (!items.length) {
      return this.retryOrEscalate(phone, session, '¿Cuál es el nombre del material? (mínimo 2 caracteres)');
    }

    // Multi-ítem ("1 Volumétrico / 2 muebles / 6 canastos"): un ítem por línea con su
    // cantidad inline; un ítem sin número se asume 1. Single-ítem sin número → cantidad
    // queda null y se pregunta en el paso 'cantidad' (flujo clásico, un solo material).
    const multi = items.length > 1;
    mi.items = items.map((i) => ({ nombre: i.nombre, cantidad: multi ? (i.cantidad ?? 1) : i.cantidad }));
    mi.nombre = mi.items[0].nombre; // compat con logs / confirmación single-ítem
    mi.attempts = 0;

    const projects = await runWithTenant(this.ds, session.clientId!, () =>
      this.ds.query(
        `SELECT id, name FROM projects WHERE client_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 10`,
        [session.clientId],
      ),
    ).catch(() => []);

    if (!projects.length) {
      await this.sessions.delete(phone);
      await this.wa.sendText(phone, 'No encontré proyectos activos para asociar el material. Avisá a tu coordinador.');
      return true;
    }

    // Un solo proyecto → auto-seleccionar y saltar la pregunta.
    if (projects.length === 1) {
      mi.proyectoId = projects[0].id;
      return this.askBodega(phone, session);
    }

    mi.projects = projects;
    mi.step = 'proyecto';
    await this.sessions.set(phone, session);
    const list = projects.map((p: any, i: number) => `${i + 1}. ${p.name}`).join('\n');
    await this.wa.sendText(phone, `¿A qué proyecto se asocia?\n\n${list}\n\nRespondé con el número.`);
    return true;
  }

  private async handleProyecto(phone: string, text: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const opts = mi.projects ?? [];
    const num = parseInt(text.trim(), 10);
    if (isNaN(num) || num < 1 || num > opts.length) {
      return this.retryOrEscalate(phone, session, `Respondé con un número entre 1 y ${opts.length}.`);
    }
    mi.proyectoId = opts[num - 1].id;
    mi.attempts = 0;
    return this.askBodega(phone, session);
  }

  private async askBodega(phone: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const bodegas = await runWithTenant(this.ds, session.clientId!, () =>
      this.ds.query(
        `SELECT id, nombre AS name FROM bodegas WHERE client_id=$1 AND active=true
         ORDER BY tipo='principal' DESC, nombre ASC LIMIT 10`,
        [session.clientId],
      ),
    ).catch(() => []);

    if (!bodegas.length) {
      await this.sessions.delete(phone);
      await this.wa.sendText(phone, 'No encontré bodegas activas para guardar el material. Avisá a tu coordinador.');
      return true;
    }

    // Una sola bodega → auto-seleccionar.
    if (bodegas.length === 1) {
      mi.bodegaId = bodegas[0].id;
      return this.proceedAfterBodega(phone, session);
    }

    mi.bodegas = bodegas;
    mi.step = 'bodega';
    await this.sessions.set(phone, session);
    const list = bodegas.map((b: any, i: number) => `${i + 1}. ${b.name}`).join('\n');
    await this.wa.sendText(phone, `¿En qué bodega queda?\n\n${list}\n\nRespondé con el número.`);
    return true;
  }

  private async handleBodega(phone: string, text: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const opts = mi.bodegas ?? [];
    const num = parseInt(text.trim(), 10);
    if (isNaN(num) || num < 1 || num > opts.length) {
      return this.retryOrEscalate(phone, session, `Respondé con un número entre 1 y ${opts.length}.`);
    }
    mi.bodegaId = opts[num - 1].id;
    mi.attempts = 0;
    return this.proceedAfterBodega(phone, session);
  }

  /**
   * Tras elegir la bodega: si es un único ítem SIN cantidad inline, pregunta la
   * cantidad (flujo clásico). En multi-ítem (o single con cantidad) ya la tenemos
   * → registra directo, sin preguntar de nuevo.
   */
  private async proceedAfterBodega(phone: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const items = mi.items ?? [];
    const necesitaCantidad = items.length === 1 && items[0].cantidad == null;
    if (necesitaCantidad) {
      mi.step = 'cantidad';
      await this.sessions.set(phone, session);
      await this.wa.sendText(phone, '¿Cuántas unidades? Respondé con un número.');
      return true;
    }
    return this.register(phone, session);
  }

  private async handleCantidad(phone: string, text: string, session: WhatsAppSession): Promise<boolean> {
    const digits = (text ?? '').replace(/[^\d]/g, '');
    const cantidad = parseInt(digits, 10);
    if (isNaN(cantidad) || cantidad < 1) {
      return this.retryOrEscalate(phone, session, 'Respondé con un número de unidades (ej: 1, 10).');
    }
    const mi = session.materialIntake!;
    if (mi.items?.length) mi.items[0].cantidad = cantidad;
    else mi.cantidad = cantidad;
    return this.register(phone, session);
  }

  // ── Registro ──────────────────────────────────────────────────────────────

  private async register(phone: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const clientId = session.clientId!;

    // Normalizar a lista de ítems. Compat: el flujo single guarda mi.nombre + mi.cantidad;
    // si no hay mi.items lo envolvemos en un ítem. Cualquier cantidad null → 1.
    const items = (mi.items?.length ? mi.items : [{ nombre: mi.nombre!, cantidad: mi.cantidad ?? 1 }])
      .map((i) => ({ nombre: i.nombre, cantidad: i.cantidad ?? 1 }));

    try {
      // Transacción CRÍTICA: TODOS los SKUs + movimientos, atómicos (todo o nada).
      const { registrados, proyectoNombre, bodegaNombre } = await runWithTenant(this.ds, clientId, async () => {
        const registrados: { skuId: string; movId: string; nombre: string; codigo: string; cantidad: number }[] = [];
        for (const it of items) {
          const sku = await this.crearSkuUnico(clientId, it.nombre);
          const movimiento = await this.movimientos.create(clientId, {
            sku_id: sku.id,
            bodega_origen_id: mi.bodegaId!,
            proyecto_destino_id: mi.proyectoId!,
            tipo: 'entrada',
            cantidad: it.cantidad,
            foto_key: mi.storagePath,
            observacion: 'Alta de material POP vía WhatsApp',
          } as any);
          registrados.push({ skuId: sku.id, movId: movimiento.id, nombre: sku.nombre, codigo: sku.codigo, cantidad: it.cantidad });
        }

        const proyRows = await this.ds.query(`SELECT name FROM projects WHERE id=$1 LIMIT 1`, [mi.proyectoId]).catch(() => []);
        const bodRows = await this.ds.query(`SELECT nombre FROM bodegas WHERE id=$1 LIMIT 1`, [mi.bodegaId]).catch(() => []);

        return {
          registrados,
          proyectoNombre: proyRows[0]?.name ?? 'sin nombre',
          bodegaNombre: bodRows[0]?.nombre ?? 'sin nombre',
        };
      });

      // Bookkeeping en tx SEPARADA (foto de cada SKU + cierre del evento). Best-effort:
      // corre DESPUÉS del commit del alta, así un fallo acá NUNCA voltea lo persistido.
      // flow='F3_INTAKE' (9 chars) entra en eventos_crudos.flow VARCHAR(10).
      await runWithTenant(this.ds, clientId, async () => {
        if (mi.storagePath) {
          for (const r of registrados) {
            await this.ds.query(`UPDATE skus SET foto_key=$1 WHERE id=$2 AND client_id=$3`, [mi.storagePath, r.skuId, clientId]);
          }
        }
        await this.ds.query(
          `UPDATE eventos_crudos SET
             flow='F3_INTAKE', status='processed', processed_at=NOW(),
             parsed_data = COALESCE(parsed_data,'{}'::jsonb) || $2::jsonb
           WHERE id=$1`,
          [
            mi.eventoCrudoId,
            JSON.stringify({
              material_skus: registrados.map((r) => r.skuId),
              material_movimientos: registrados.map((r) => r.movId),
              material_registered_at: new Date().toISOString(),
            }),
          ],
        );
      }).catch((e: any) => this.logger.warn(`[Material] Bookkeeping post-alta falló (evento ${mi.eventoCrudoId}): ${e.message}`));

      await this.sessions.delete(phone);

      if (registrados.length === 1) {
        const r = registrados[0];
        await this.wa.confirmarMaterial({
          telefono: phone, nombre: r.nombre, codigo: r.codigo,
          proyecto: proyectoNombre, bodega: bodegaNombre, cantidad: r.cantidad,
        });
      } else {
        const lista = registrados.map((r) => `• ${r.nombre} — ID ${r.codigo} × ${r.cantidad}`).join('\n');
        await this.wa.sendText(
          phone,
          `✅ *${registrados.length} materiales registrados*\n\n${lista}\n\nProyecto: ${proyectoNombre}\nBodega: ${bodegaNombre}\n\nControl Suite BTL ⚡`,
        );
      }
      this.logger.log(`[Material] Registrados ${registrados.length} SKU(s) (evento ${mi.eventoCrudoId})`);
      return true;
    } catch (err: any) {
      this.logger.error(`[Material] Error registrando material (evento ${mi.eventoCrudoId}): ${err.message}`);
      await this.sessions.delete(phone);
      await this.wa.sendText(phone, 'No pude registrar el material. Un operador lo va a revisar. Gracias.');
      return true;
    }
  }

  /**
   * Parsea la respuesta del nombre en ítems. Multi-ítem: una línea por ítem (o
   * separadas por coma/;), con la cantidad inline al inicio ("6 canastos", "2x muebles").
   * Un ítem sin número → cantidad null (se resuelve después). Un solo texto plano → 1 ítem.
   */
  private parseItems(text: string): { nombre: string; cantidad: number | null }[] {
    const raw = (text ?? '').trim();
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let parts: string[];
    if (lines.length > 1) {
      // Multi-línea = un ítem por línea.
      parts = lines;
    } else {
      const single = lines[0] ?? '';
      const byComma = single.split(/\s*[,;]\s*/).map((s) => s.trim()).filter(Boolean);
      // La coma separa ítems SOLO si CADA parte arranca con una cantidad ("1 x, 2 y, 6 z").
      // Si no, es un nombre con coma legítimo (ej "Mesa, con logo") → un solo ítem.
      const hasQty = (s: string) => /^\d{1,4}\s*(?:x|×)?\s+/i.test(s);
      parts = byComma.length > 1 && byComma.every(hasQty) ? byComma : (single ? [single] : []);
    }
    return parts.map((p) => {
      const m = p.match(/^(\d{1,4})\s*(?:x|×)?\s+(.+)$/i);
      if (m) return { cantidad: parseInt(m[1], 10), nombre: m[2].trim().slice(0, 200) };
      return { cantidad: null, nombre: p.slice(0, 200) };
    });
  }

  /**
   * Crea el SKU con un codigo único por cliente. El codigo ES el "ID único del
   * ítem" que pide el cliente. Reintenta ante colisión de codigo (unique por cliente).
   */
  private async crearSkuUnico(clientId: string, nombre: string): Promise<any> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const codigo = this.genCodigo();
      try {
        return await this.skus.create(clientId, { codigo, nombre, tipo: 'reusable' } as any);
      } catch (err: any) {
        // Solo reintentar ante colisión de codigo duplicado (SkusService.create lanza
        // BadRequestException con 'ya existe'). Cualquier otro error (RLS, DB) NO debe
        // enmascararse: se relanza de inmediato.
        if (!(err?.message && String(err.message).includes('ya existe'))) throw err;
        // BadRequestException por codigo duplicado → reintentar con otro codigo.
        if (attempt === 2) throw err;
      }
    }
    throw new Error('No se pudo generar un codigo único para el SKU');
  }

  private genCodigo(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0');
    return `MAT-${ts}-${rand}`;
  }

  // ── Reintento / escalado ────────────────────────────────────────────────

  private async retryOrEscalate(phone: string, session: WhatsAppSession, retryMsg: string): Promise<boolean> {
    const mi = session.materialIntake!;
    mi.attempts = (mi.attempts ?? 0) + 1;

    if (mi.attempts >= MAX_ATTEMPTS) {
      // eventos_crudos tiene RLS y el rol de la app es NOBYPASSRLS: sin
      // app.current_tenant el UPDATE matchea 0 filas. Va envuelto en runWithTenant
      // igual que el resto de escrituras de este archivo.
      await runWithTenant(this.ds, session.clientId!, () =>
        this.ds.query(
          `UPDATE eventos_crudos SET status='escalated',
             parsed_data = COALESCE(parsed_data,'{}'::jsonb) || $2::jsonb WHERE id=$1`,
          [mi.eventoCrudoId, JSON.stringify({ escalated_at: new Date().toISOString(), escalation_reason: 'material_intake_max_attempts' })],
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
    };
  }
}

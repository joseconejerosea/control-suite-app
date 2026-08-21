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
 * Cuando el remitente elige "material" en el menú (T3), el webhook rutea la foto
 * a este servicio, que conduce la conversación multi-paso y, al final, crea el
 * ítem y su movimiento de inventario reusando los servicios de dominio:
 *
 *   nombre → proyecto → destino → bodega/activación → cantidad → registrar
 *
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
    if (!(await this.hasActiveActivation(opts.clientId))) {
      await this.notifyNoActivation(opts.eventoCrudoId, opts.phoneNumber, opts.clientId);
      this.logger.log(`[Material] Sin activación activa, aviso al remitente (evento ${opts.eventoCrudoId})`);
      return;
    }

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
      `📦 Dale, registremos el *material POP*.\n\n¿Qué material es?${hint}\nEscribí el nombre.`,
    );
    this.logger.log(`[Material] Intake iniciado para evento ${opts.eventoCrudoId}`);
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
      case 'nombre':   return this.handleNombre(phoneNumber, text, session);
      case 'proyecto': return this.handleProyecto(phoneNumber, text, session);
      case 'destino':    return this.handleDestino(phoneNumber, text, session);
      case 'activacion': return this.handleActivacion(phoneNumber, text, session);
      case 'bodega':   return this.handleBodega(phoneNumber, text, session);
      case 'cantidad': return this.handleCantidad(phoneNumber, text, session);
      case 'ubicacion': return this.handleUbicacionReprompt(phoneNumber, session);
      default:         return false;
    }
  }

  // ── Pasos ───────────────────────────────────────────────────────────────

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
      return this.askDestino(phone, session);
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
    return this.askDestino(phone, session);
  }

  /** Pregunta si el material va a bodega (depósito) o se usa hoy en la activación. */
  private async askDestino(phone: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    mi.step = 'destino';
    mi.attempts = 0;
    await this.sessions.set(phone, session);
    await this.wa.sendText(
      phone,
      '¿Este material va a una bodega o se usa hoy en la activación?\n\n1. Va a bodega (queda en depósito)\n2. Se usa hoy en la activación\n\nRespondé con el número.',
    );
    return true;
  }

  private async handleDestino(phone: string, text: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const num = parseInt(text.trim(), 10);
    if (num === 1) {
      mi.destino = 'bodega';
      mi.attempts = 0;
      return this.askBodega(phone, session);
    }
    if (num === 2) {
      mi.destino = 'consumo';
      mi.attempts = 0;
      return this.askActivacion(phone, session);
    }
    return this.retryOrEscalate(phone, session, 'Respondé 1 (va a bodega) o 2 (se usa hoy en la activación).');
  }

  /**
   * Rama "se usa hoy": resuelve la activación destino (mismo criterio que F5 a nivel
   * cliente). 1 activa → auto; ≥2 → lista numerada para que el remitente elija.
   */
  private async askActivacion(phone: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const activaciones = await runWithTenant(this.ds, session.clientId!, () =>
      this.ds.query(
        `SELECT a.id, a.activation_date, l.name AS location_name
           FROM activations a
           LEFT JOIN locations l ON l.id = a.location_id
          WHERE a.client_id=$1
            AND a.status IN ('scheduled','in_progress')
            AND a.estado_f5 IS DISTINCT FROM 'cerrada'
          ORDER BY a.activation_date DESC LIMIT 10`,
        [session.clientId],
      ),
    ).catch(() => []);

    if (!activaciones.length) {
      // El guard de start() garantiza ≥1; ante una carrera (se cerró en el medio) derivamos.
      await this.notifyNoActivation(mi.eventoCrudoId, phone, session.clientId!);
      return true;
    }

    // Label "ubicación · fecha" (como resolveProbableActivation de F5): sin el lugar,
    // dos activaciones del mismo día se ven idénticas y el remitente no puede elegir.
    const opciones = activaciones.map((a: any) => {
      const date = a.activation_date ? new Date(a.activation_date).toLocaleDateString('es-CL') : '';
      const label = [a.location_name, date].filter(Boolean).join(' · ') || 'Activación';
      return { id: a.id, label };
    });

    if (opciones.length === 1) {
      mi.activacionId = opciones[0].id;
      return this.proceedToCantidad(phone, session);
    }

    mi.activaciones = opciones;
    mi.step = 'activacion';
    await this.sessions.set(phone, session);
    const list = opciones.map((o: { label: string }, i: number) => `${i + 1}. ${o.label}`).join('\n');
    await this.wa.sendText(phone, `¿A qué activación corresponde? (se usa hoy)\n\n${list}\n\nRespondé con el número.`);
    return true;
  }

  private async handleActivacion(phone: string, text: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const opts = mi.activaciones ?? [];
    const num = parseInt(text.trim(), 10);
    if (isNaN(num) || num < 1 || num > opts.length) {
      return this.retryOrEscalate(phone, session, `Respondé con un número entre 1 y ${opts.length}.`);
    }
    mi.activacionId = opts[num - 1].id;
    mi.attempts = 0;
    return this.proceedToCantidad(phone, session);
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
      return this.proceedToCantidad(phone, session);
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
    return this.proceedToCantidad(phone, session);
  }

  /**
   * Tras fijar el destino (bodega o activación): si es un único ítem SIN cantidad
   * inline, pregunta la cantidad; si no, deriva al paso siguiente (ubicacion para
   * consumo, o registra de inmediato para bodega).
   */
  private async proceedToCantidad(phone: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const items = mi.items ?? [];
    const necesitaCantidad = items.length === 1 && items[0].cantidad == null;
    if (necesitaCantidad) {
      mi.step = 'cantidad';
      await this.sessions.set(phone, session);
      await this.wa.sendText(phone, '¿Cuántas unidades? Respondé con un número.');
      return true;
    }
    return this.proceedToUbicacionOrRegister(phone, session);
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
    return this.proceedToUbicacionOrRegister(phone, session);
  }

  /**
   * A4 · Para consumo, la ubicación GPS es OBLIGATORIA antes de registrar.
   * Para bodega, registra de inmediato (sin pasar por ubicación).
   */
  private async proceedToUbicacionOrRegister(phone: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    if (mi.destino === 'consumo') {
      mi.step = 'ubicacion';
      await this.sessions.set(phone, session);
      await this.wa.sendText(
        phone,
        'Para cerrar el registro, compartí tu ubicación 📍 (tocá el clip → Ubicación). Es obligatoria para registrar material en una activación.',
      );
      return true;
    }
    return this.register(phone, session);
  }

  /**
   * A4 · Cuando el remitente está en step='ubicacion' y envía texto (en lugar de un
   * pin GPS), re-pregunta la ubicación sin perder el registro pendiente. JD-001: al
   * igual que todos los otros pasos, esto NO re-pregunta infinitamente — incrementa
   * attempts y, tras MAX_ATTEMPTS, deriva al operador y limpia la sesión.
   */
  private async handleUbicacionReprompt(phone: string, session: WhatsAppSession): Promise<boolean> {
    return this.retryOrEscalate(
      phone,
      session,
      'Necesito tu ubicación para completar el registro. Tocá el clip → Ubicación y enviá el pin GPS 📍.',
    );
  }

  // ── Registro ──────────────────────────────────────────────────────────────

  private async register(phone: string, session: WhatsAppSession): Promise<boolean> {
    const mi = session.materialIntake!;
    const clientId = session.clientId!;
    const esConsumo = mi.destino === 'consumo';

    // JD-003 · Guard de idempotencia ATÓMICO. El alta crea SKUs + movimientos de
    // inventario (escrituras IRREVERSIBLES). Dos pins de ubicación concurrentes
    // (messageIds distintos, ambos pasan el dedup por-messageId) pueden leer la MISMA
    // sesión en step='ubicacion' y llamar register() los dos → inventario duplicado.
    // claimMaterialRegistration usa SET NX (mismo primitivo que claimMessage) keyed por
    // el eventoCrudoId del intake (estable durante toda la conversación). El primero que
    // reclama gana; el segundo hace no-op limpio: NO vuelve a crear movimientos.
    const claimed = await this.sessions.claimMaterialRegistration(mi.eventoCrudoId);
    if (!claimed) {
      this.logger.log(`[Material] register() duplicado ignorado (evento ${mi.eventoCrudoId} ya reclamado)`);
      await this.sessions.delete(phone);
      return true;
    }

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
            proyecto_destino_id: mi.proyectoId!,
            tipo: esConsumo ? 'consumo' : 'entrada',
            cantidad: it.cantidad,
            foto_key: mi.storagePath,
            observacion: esConsumo
              ? 'Consumo de material POP en activación vía WhatsApp'
              : 'Alta de material POP vía WhatsApp',
            ...(esConsumo
              ? { activacion_id: mi.activacionId }
              : { bodega_origen_id: mi.bodegaId }),
          } as any);
          registrados.push({ skuId: sku.id, movId: movimiento.id, nombre: sku.nombre, codigo: sku.codigo, cantidad: it.cantidad });
        }

        const proyRows = await this.ds.query(`SELECT name FROM projects WHERE id=$1 LIMIT 1`, [mi.proyectoId]).catch(() => []);
        const bodRows = esConsumo
          ? []
          : await this.ds.query(`SELECT nombre FROM bodegas WHERE id=$1 LIMIT 1`, [mi.bodegaId]).catch(() => []);

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

      if (esConsumo) {
        const lista = registrados.map((r) => `• ${r.nombre} — ID ${r.codigo} × ${r.cantidad}`).join('\n');
        const titulo = registrados.length === 1
          ? '✅ Material registrado como *usado hoy en la activación*'
          : `✅ *${registrados.length} materiales registrados* (usados hoy en la activación)`;
        // A4 · Sólo avisamos "fuera de rango" ante un MISMATCH real (la activación TENÍA
        // coords y el pin quedó fuera del radio). JD-002: con NO_GPS (activación sin GPS
        // almacenado o lookup vacío/fallido) NO hubo comparación → sin warning falso.
        // La obligatoriedad es que el pin SE ENVÍE, no que esté dentro del radio.
        const locationStatus = (mi as any)._locationStatus as string | undefined;
        const distanceM = (mi as any)._locationDistanceM as number | null | undefined;
        const mismatchLine = locationStatus === 'MISMATCH'
          ? `\n⚠️ Ubicación fuera del rango de la activación (${distanceM != null ? `${distanceM}m` : 'distancia no disponible'}).`
          : '';
        await this.wa.sendText(phone, `${titulo}\n\n${lista}\n\nProyecto: ${proyectoNombre}${mismatchLine}\n\nControl Suite BTL ⚡`);
      } else if (registrados.length === 1) {
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
      // Liberar el claim: el registro NO se completó, así que un reintento legítimo del
      // mismo evento no debe quedar bloqueado por el claim de 24h (JD-003 defensa en
      // profundidad). En el éxito el claim se conserva para evitar el doble registro.
      await this.sessions.releaseMaterialRegistration(mi.eventoCrudoId);
      await this.sessions.delete(phone);
      await this.wa.sendText(phone, 'No pude registrar el material. Un operador lo va a revisar. Gracias.');
      return true;
    }
  }

  /**
   * A4 · Punto de entrada para un mensaje de tipo 'location' desde el webhook.
   * Si este remitente tiene un intake de material en step='ubicacion', valida la
   * ubicación GPS contra la activación elegida (haversine + radio), escribe el
   * LOCATION_CHECK en activation_events, y completa el registro de material.
   *
   * Returns true → el pin fue consumido por el intake de material (el caller NO debe
   *   correr el check-in standalone). Returns false → no había material pendiente,
   *   el caller debe continuar con la lógica standalone normal.
   *
   * MISMATCH policy: la ubicación es OBLIGATORIA (el promotor debe compartir el pin),
   * pero un MISMATCH NO bloquea el registro. Se completa igual y se avisa en el mensaje.
   *
   * Nótese que eventoCrudoId acá es el id del evento 'location' recién persistido por
   * el webhook (el mismo que el standalone check-in) — se pasa para la correlación en
   * los metadatos del LOCATION_CHECK.
   */
  async handleLocationForMaterial(
    phone: string,
    lat: number,
    lng: number,
    locationEventoCrudoId: string,
  ): Promise<boolean> {
    const session = await this.sessions.get(phone);
    if (!session?.materialIntake || session.state !== STATE) return false;
    const mi = session.materialIntake;
    if (mi.step !== 'ubicacion') return false;

    const clientId = session.clientId!;
    // JD-002: NEUTRAL por defecto. Sólo pasa a VERIFIED/MISMATCH si REALMENTE hubo una
    // comparación (la activación tiene coords y el pin se comparó). Si la activación no
    // tiene GPS almacenado, o el lookup vino vacío/falló, NO hay nada que comparar → se
    // queda NO_GPS: se registra igual, sin el warning falso de "fuera de rango".
    let locationStatus: 'VERIFIED' | 'MISMATCH' | 'NO_GPS' = 'NO_GPS';
    let distanceM: number | null = null;

    // Resolve the activation location and validate the pin.
    try {
      const rows = await runWithTenant(this.ds, clientId, () =>
        this.ds.query(
          `SELECT a.id, a.location, a.status
             FROM activations a
            WHERE a.id = $1 AND a.client_id = $2`,
          [mi.activacionId, clientId],
        ),
      ).catch(() => []);

      if (rows.length > 0) {
        const act = rows[0];
        const loc = typeof act.location === 'string' ? JSON.parse(act.location) : act.location;
        // JB-003: usar checks numéricos, NO truthiness. Una coordenada legítima de
        // exactamente 0 (ecuador / meridiano de Greenwich) es falsy y se saltaba.
        if (loc != null && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))) {
          const distance = this.haversine(lat, lng, Number(loc.lat), Number(loc.lng));
          const radius = loc.radiusMeters ?? 200;
          distanceM = Math.round(distance);
          locationStatus = distance <= radius ? 'VERIFIED' : 'MISMATCH';
        }
      }

      // Write the LOCATION_CHECK linked to the activation.
      await runWithTenant(this.ds, clientId, () =>
        this.ds.query(
          `INSERT INTO activation_events
             (client_id, activation_id, event_type, location_status, lat, lng, metadata, created_at)
           VALUES ($1, $2, 'LOCATION_CHECK', $3, $4, $5, $6::jsonb, NOW())`,
          [
            clientId, mi.activacionId, locationStatus, lat, lng,
            JSON.stringify({
              distance_m: distanceM,
              from: phone,
              source: 'material_intake',
              location_evento_crudo_id: locationEventoCrudoId,
            }),
          ],
        ),
      ).catch((e: any) => this.logger.warn(`[Material] LOCATION_CHECK insert falló: ${e.message}`));
    } catch (e: any) {
      this.logger.warn(`[Material] Validación de ubicación falló: ${e.message}`);
    }

    // Complete the material registration regardless of VERIFIED/MISMATCH.
    // register() handles its own session.delete() and confirmation message.
    // We need to inject the mismatch warning into the confirmation: store it
    // in the session so register() can read it, or we add the warning after.
    // Simplest approach: store locationStatus on mi and let register() append it.
    (mi as any)._locationStatus = locationStatus;
    (mi as any)._locationDistanceM = distanceM;

    return this.register(phone, session);
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Parsea la respuesta del nombre en ítems. Multi-ítem: una línea por ítem (o
   * separadas por coma/;// "/"), con la cantidad inline al inicio ("6 canastos", "2x muebles").
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
      const byDelim = single.split(/\s*[,;/]\s*/).map((s) => s.trim()).filter(Boolean);
      // El delimitador (coma/;/ "/") separa ítems SOLO si CADA parte arranca con una
      // cantidad ("1 x, 2 y" o "1 x / 2 y / 6 z"). Si no, es un nombre legítimo con ese
      // carácter (ej "Mesa, con logo", "Banner blanco/negro") → un solo ítem.
      const hasQty = (s: string) => /^\d{1,4}\s*(?:x|×)?\s+/i.test(s);
      parts = byDelim.length > 1 && byDelim.every(hasQty) ? byDelim : (single ? [single] : []);
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

  /**
   * Guard de activación activa (espeja F5): el material POP debe asociarse a una
   * activación en curso. Sin ninguna activa, darlo de alta genera inventario
   * huérfano, así que se deriva a un operador. Criterio idéntico al fallback por
   * cliente de F5 (status scheduled/in_progress y estado_f5 ≠ 'cerrada').
   */
  private async hasActiveActivation(clientId: string): Promise<boolean> {
    const rows = await runWithTenant(this.ds, clientId, () =>
      this.ds.query(
        `SELECT id FROM activations
          WHERE client_id=$1
            AND status IN ('scheduled','in_progress')
            AND estado_f5 IS DISTINCT FROM 'cerrada'
          LIMIT 1`,
        [clientId],
      ),
    ).catch(() => []);
    return rows.length > 0;
  }

  /**
   * Sin activación activa (decisión T3): NO deriva a un operador. Envía un mensaje
   * claro y accionable al remitente y marca el evento con status='no_activation'
   * (solo auditoría, NO entra en la cola de escalados). No deja sesión: no hay
   * conversación que continuar.
   */
  private async notifyNoActivation(eventoCrudoId: string, phone: string, clientId: string): Promise<void> {
    // eventos_crudos tiene RLS y el rol de la app es NOBYPASSRLS: sin
    // app.current_tenant el UPDATE matchea 0 filas. Va envuelto en runWithTenant.
    await runWithTenant(this.ds, clientId, () =>
      this.ds.query(
        `UPDATE eventos_crudos SET status='no_activation',
           parsed_data = COALESCE(parsed_data,'{}'::jsonb) || $2::jsonb WHERE id=$1`,
        [eventoCrudoId, JSON.stringify({ escalation_reason: 'material_no_active_activation', at: new Date().toISOString() })],
      ),
    ).catch(() => {});
    await this.sessions.delete(phone);
    await this.wa.sendText(
      phone,
      'No veo una activación activa hoy para asociar este material. Pedile a tu coordinador que cargue la activación y volvé a enviármelo. 🙌',
    );
  }

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

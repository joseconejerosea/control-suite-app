import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsappOutputService } from '../whatsapp/whatsapp-output.service';
import { StockReturnsService } from '../movimientos-pop/stock-returns.service';
import { UserRole } from '../../common/enums/user-role.enum';

export interface ProjectSummary {
  project_id:       string;
  name:             string;
  status:           string;
  total_campaigns:  number;
  total_activations: number;
  active_promoters: number;
  budget_allocated: string | null;
  budget_used:      string;
}

interface ConvocatoriaItem {
  persona_id:       string;
  dia:              string;
  local_nombre?:    string;
  local_direccion?: string;
}

export interface CalendarioConvocatoria {
  proyecto_id:      string;
  proyecto_nombre:  string;
  persona_id:       string;
  persona_nombre:   string | null;
  dia:              string;
  estado:           string;
  local_nombre:     string | null;
  local_direccion:  string | null;
}

export interface CalendarioGap {
  proyecto_id:      string;
  proyecto_nombre:  string;
  dia:              string;
  local_nombre:     string;
  local_direccion:  string | null;
  tiene_pendientes: boolean;
  aprobado:         boolean;
}

/** Días ISO (YYYY-MM-DD) inclusive entre dos fechas; en UTC para no driftear por TZ. */
function eachISODayInclusive(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const cur = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  if (isNaN(cur.getTime()) || isNaN(end.getTime()) || cur > end) return out;
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// Comparar fechas ISO (YYYY-MM-DD) es seguro lexicográficamente.
const maxISODate = (a: string, b: string): string => (a >= b ? a : b);
const minISODate = (a: string, b: string): string => (a <= b ? a : b);

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly repo:   TenantRepository<Project>;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly wa: WhatsAppService,
    private readonly waOutput: WhatsappOutputService,
    private readonly stockReturns: StockReturnsService,
  ) {
    this.repo = new TenantRepository<Project>(dataSource, Project);
  }

  // ── Existing methods ──────────────────────────────────────────────────────

  async create(clientId: string, dto: CreateProjectDto): Promise<Project> {
    if (dto.start_date && dto.end_date && dto.start_date > dto.end_date) {
      throw new BadRequestException('start_date cannot be after end_date');
    }
    return this.repo.create(clientId, {
      name:        dto.name,
      description: dto.description ?? null,
      objectives:  dto.objectives ?? null,
      status:      dto.status ?? 'active',
      start_date:  dto.start_date ?? null,
      end_date:    dto.end_date ?? null,
      budget:      dto.budget ?? null,
      config:      dto.config ?? null,
    });
  }

  async findAll(clientId: string): Promise<Project[]> {
    return this.repo.findAll(clientId, { order: { created_at: 'DESC' } });
  }

  async findOne(clientId: string, id: string): Promise<Project> {
    return this.repo.findOne(clientId, id);
  }

  async update(clientId: string, id: string, dto: UpdateProjectDto): Promise<Project> {
    const existing   = await this.findOne(clientId, id);
    const nextStart  = dto.start_date ?? existing.start_date;
    const nextEnd    = dto.end_date   ?? existing.end_date;
    if (nextStart && nextEnd && nextStart > nextEnd) {
      throw new BadRequestException('start_date cannot be after end_date');
    }
    const updated = await this.repo.update(clientId, id, {
      name:        dto.name        ?? existing.name,
      description: dto.description ?? existing.description,
      objectives:  dto.objectives  ?? existing.objectives,
      status:      dto.status      ?? existing.status,
      start_date:  dto.start_date  ?? existing.start_date,
      end_date:    dto.end_date    ?? existing.end_date,
      budget:      dto.budget      ?? existing.budget,
      config:      dto.config      ?? existing.config,
    });

    if (dto.status === 'closed' && existing.status !== 'closed') {
      this.stockReturns.triggerReturnRequests(clientId, id).catch((err) =>
        this.logger.warn(`[F3Returns] trigger failed project=${id}: ${err.message}`),
      );
    }

    // F4 Fase 4: editar un proyecto cuya convocatoria YA se envió invalida la
    // aprobación → hay que re-aprobar antes de re-enviar (el gate vuelve a cerrar).
    await this.invalidarAprobacionSiEditadoPostEnvio(clientId, id, dto);

    return updated;
  }

  /**
   * Si el proyecto ya tenía convocatoria ENVIADA y se editó un campo relevante
   * (nombre/fechas/presupuesto/config/descripción), resetea la aprobación y avisa
   * al operador. Sin esto, un cambio post-envío podría re-disparar WhatsApp masivo
   * sin pasar de nuevo por el gate humano — el mismo invariante que arreglamos en Tier 1.
   */
  private async invalidarAprobacionSiEditadoPostEnvio(
    clientId: string, projectId: string, dto: UpdateProjectDto,
  ): Promise<void> {
    const sustantivo =
      dto.name !== undefined || dto.description !== undefined ||
      dto.start_date !== undefined || dto.end_date !== undefined ||
      dto.budget !== undefined || dto.config !== undefined;
    if (!sustantivo) return;

    const rows = await this.dataSource.query(
      `UPDATE projects p
          SET aprobado_por_user_id  = NULL,
              aprobado_at           = NULL,
              convocatoria_cerrada_at = NULL,
              config = jsonb_set(COALESCE(config,'{}'), '{ia_status}', '"pending_human_approval"'),
              updated_at = NOW()
        WHERE p.id = $1 AND p.client_id = $2
          AND p.aprobado_at IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM convocatorias c
             WHERE c.proyecto_id = $1 AND c.client_id = $2
               AND c.mensaje_enviado_at IS NOT NULL
          )
        RETURNING p.name`,
      [projectId, clientId],
    ).catch((err: any) => {
      this.logger.warn(`[F4] invalidarAprobacion error proyecto=${projectId}: ${err.message}`);
      return [];
    });

    if (!rows.length) return; // no estaba aprobado, o no había convocatoria enviada

    this.logger.warn(`[F4] Aprobación invalidada por edición post-envío proyecto=${projectId}`);
    const msg = `⚠️ El proyecto "${rows[0].name}" fue editado después de enviar la convocatoria. `
      + `Requiere RE-APROBACIÓN antes de volver a enviar.`;
    const admins = await this.getAdminPhones(clientId);
    for (const admin of admins) {
      await this.wa.sendText(admin.phone, msg).catch(() => {});
    }
  }

  async summary(clientId: string, id: string): Promise<ProjectSummary> {
    const project  = await this.findOne(clientId, id);
    // Activation counting mirrors ActivationsService.findByProject: an activation
    // belongs to the project when its project_id matches OR its campaign_id belongs
    // to one of the project's campaigns (UI activations set campaign_id, not project_id).
    const [counts] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM campaigns   WHERE client_id=$1 AND project_id=$2) AS total_campaigns,
         (SELECT COUNT(*)::int FROM activations a
           WHERE a.client_id=$1
             AND (a.project_id=$2
                  OR a.campaign_id IN (SELECT id FROM campaigns
                                        WHERE project_id=$2 AND client_id=$1)))       AS total_activations,
         (SELECT COUNT(DISTINCT p.id)::int
            FROM promoters p JOIN activations a ON a.promoter_id=p.id
           WHERE p.client_id=$1
             AND (a.project_id=$2
                  OR a.campaign_id IN (SELECT id FROM campaigns
                                        WHERE project_id=$2 AND client_id=$1)))       AS active_promoters,
         COALESCE((SELECT SUM(budget)::numeric FROM campaigns
                    WHERE client_id=$1 AND project_id=$2),0)::text                    AS budget_used`,
      [clientId, id],
    );
    return {
      project_id:        project.id,
      name:              project.name,
      status:            project.status,
      total_campaigns:   Number(counts.total_campaigns   ?? 0),
      total_activations: Number(counts.total_activations ?? 0),
      active_promoters:  Number(counts.active_promoters  ?? 0),
      budget_allocated:  project.budget,
      budget_used:       counts.budget_used ?? '0',
    };
  }

  // ── F5: Destinatarios del reporte al cliente (por proyecto) ───────────────
  // Guardados en projects.config.report_recipients (string[]). Sin migración:
  // config JSONB ya existe. El envío del reporte (F5Controller) los resuelve
  // automáticamente cuando no se pasan destinatarios explícitos.

  async getReportRecipients(clientId: string, projectId: string): Promise<string[]> {
    const [row] = await this.dataSource.query(
      `SELECT config->'report_recipients' AS recipients
         FROM projects WHERE id=$1 AND client_id=$2 LIMIT 1`,
      [projectId, clientId],
    );
    if (!row) throw new NotFoundException('Proyecto no encontrado');
    const recipients = row.recipients;
    return Array.isArray(recipients) ? recipients : [];
  }

  async setReportRecipients(
    clientId: string,
    projectId: string,
    emails: string[],
  ): Promise<{ report_recipients: string[] }> {
    // Merge en config existente: jsonb_set NO pisa otras claves (ia_status, etc.).
    const rows = await this.dataSource.query(
      `UPDATE projects
          SET config = jsonb_set(COALESCE(config,'{}'), '{report_recipients}', $1::jsonb),
              updated_at = NOW()
        WHERE id=$2 AND client_id=$3
        RETURNING config->'report_recipients' AS recipients`,
      [JSON.stringify(emails), projectId, clientId],
    );
    if (!rows.length) throw new NotFoundException('Proyecto no encontrado');
    this.logger.log(`[F5] report_recipients actualizados proyecto=${projectId} (${emails.length})`);
    return { report_recipients: rows[0].recipients ?? [] };
  }

  // ── F4: Aprobar proyecto (luego de revisión IA) ───────────────────────────

  async aprobarProyecto(
    clientId:   string,
    projectId:  string,
    userId:     string,
    comentario?: string,
  ): Promise<{ ok: boolean }> {
    const rows = await this.dataSource.query(
      `SELECT id, config FROM projects WHERE id=$1 AND client_id=$2 LIMIT 1`,
      [projectId, clientId],
    );
    if (!rows.length) throw new NotFoundException('Proyecto no encontrado');

    await this.dataSource.query(
      `UPDATE projects SET
         status            = 'active',
         aprobado_por_user_id = $2,
         aprobado_at       = NOW(),
         config            = jsonb_set(
           jsonb_set(COALESCE(config,'{}'), '{ia_status}', '"aprobado"'),
           '{comentario_aprobacion}', $3::jsonb
         ),
         updated_at        = NOW()
       WHERE id=$1 AND client_id=$4`,
      [projectId, userId, JSON.stringify(comentario ?? null), clientId],
    );

    this.logger.log(`[F4] Proyecto aprobado [id=${projectId}, userId=${userId}]`);
    return { ok: true };
  }

  // ── F4: Shift calendar — persona × día ───────────────────────────────────

  async getTurnoEquipo(clientId: string, projectId: string): Promise<{
    proyecto: { id: string; name: string; start_date: string | null; end_date: string | null };
    equipo:   unknown[];
    calendario: unknown[];
  }> {
    const [proyecto] = await this.dataSource.query(
      `SELECT id, name, start_date, end_date FROM projects WHERE id=$1 AND client_id=$2`,
      [projectId, clientId],
    );
    if (!proyecto) throw new NotFoundException('Proyecto no encontrado');

    // Equipo asignado al proyecto
    const equipo = await this.dataSource.query(
      `SELECT pe.id, pe.persona_id, pe.rol, pe.costo_dia, pe.dias_asignados,
              pe.fecha_inicio, pe.fecha_fin, pe.activo,
              COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.name) AS persona_nombre, p.phone AS persona_phone
         FROM proyecto_equipo pe
         LEFT JOIN promoters p ON p.id = pe.persona_id
        WHERE pe.client_id=$1 AND pe.proyecto_id=$2 AND pe.activo=true
        ORDER BY p.name`,
      [clientId, projectId],
    );

    // Convocatorias del proyecto (para mostrar estado en el calendario)
    const calendario = await this.dataSource.query(
      `SELECT c.id, c.persona_id, c.dia, c.estado,
              c.local_nombre, c.local_direccion,
              c.mensaje_enviado_at, c.respuesta_at,
              COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.name) AS persona_nombre
         FROM convocatorias c
         LEFT JOIN promoters p ON p.id = c.persona_id
        WHERE c.client_id=$1 AND c.proyecto_id=$2
        ORDER BY c.dia, p.name`,
      [clientId, projectId],
    );

    return { proyecto, equipo, calendario };
  }

  async asignarTurno(
    clientId:  string,
    projectId: string,
    body: {
      persona_id:       string;
      dias:             string[];
      local_nombre?:    string;
      local_direccion?: string;
    },
  ): Promise<{ asignados: number }> {
    if (!body.dias?.length) throw new BadRequestException('dias no puede estar vacío');

    // Upsert persona en proyecto_equipo
    await this.dataSource.query(
      `INSERT INTO proyecto_equipo (client_id, proyecto_id, persona_id, rol)
       VALUES ($1,$2,$3,'Promotor')
       ON CONFLICT (client_id, proyecto_id, persona_id) DO NOTHING`,
      [clientId, projectId, body.persona_id],
    );

    // Crear convocatorias pendientes por cada día (sin enviar WA todavía).
    // ON CONFLICT apunta al índice único uq_convocatorias_turno (migración 047):
    // re-asignar el mismo turno es idempotente en vez de duplicar la fila.
    for (const dia of body.dias) {
      await this.dataSource.query(
        `INSERT INTO convocatorias
           (client_id, proyecto_id, persona_id, dia, local_nombre, local_direccion, estado)
         VALUES ($1,$2,$3,$4,$5,$6,'pendiente')
         ON CONFLICT (client_id, proyecto_id, persona_id, dia) DO NOTHING`,
        [clientId, projectId, body.persona_id, dia, body.local_nombre ?? null, body.local_direccion ?? null],
      );
    }

    this.logger.log(`[F4] Turnos asignados persona=${body.persona_id} proyecto=${projectId} dias=${body.dias.length}`);
    return { asignados: body.dias.length };
  }

  // ── F4: Convocatoria por WhatsApp ─────────────────────────────────────────

  async enviarConvocatoria(
    clientId:  string,
    projectId: string,
    items:     ConvocatoriaItem[],
    modo:      'ai' | 'manual',
  ): Promise<{ enviados: number; errores: number; detalle: unknown[] }> {
    const [proyecto] = await this.dataSource.query(
      `SELECT name, aprobado_por_user_id, aprobado_at FROM projects WHERE id=$1 AND client_id=$2`,
      [projectId, clientId],
    );
    if (!proyecto) throw new NotFoundException('Proyecto no encontrado');

    // ── Gate humano F4: el envío masivo JAMÁS se dispara sin aprobación explícita.
    // El proyecto debe tener aprobado_por_user_id y aprobado_at seteados por
    // aprobarProyecto() antes de que cualquier WhatsApp salga. Sin esto, nada se envía.
    if (!proyecto.aprobado_por_user_id || !proyecto.aprobado_at) {
      this.logger.warn(`[F4] Intento de envío sin aprobación humana proyecto=${projectId}`);
      throw new BadRequestException({
        message: 'La convocatoria no fue aprobada. Requiere aprobación humana antes del envío.',
        code:    'CONVOCATORIA_NO_APROBADA',
      });
    }

    let enviados = 0;
    let errores  = 0;
    const detalle: { persona_id: string; dia: string; ok: boolean; error?: string }[] = [];

    for (const item of items) {
      // Obtener teléfono del promotor
      const [promotor] = await this.dataSource.query(
        `SELECT COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), name) AS name, phone FROM promoters WHERE id=$1 AND client_id=$2`,
        [item.persona_id, clientId],
      ).catch(() => []);

      if (!promotor?.phone) {
        errores++;
        detalle.push({ persona_id: item.persona_id, dia: item.dia, ok: false, error: 'Sin teléfono registrado' });
        continue;
      }

      // Lock de idempotencia (Fase 4): no re-enviar el mismo turno dentro de 5 min
      // (doble click / reintento / doble job). Clave por proyecto+persona+día.
      const dedupKey = `conv:${clientId}:${projectId}:${item.persona_id}:${item.dia}`;
      if (!(await this.waOutput.guard(dedupKey))) {
        detalle.push({ persona_id: item.persona_id, dia: item.dia, ok: false, error: 'Duplicado suprimido (lock)' });
        continue;
      }

      // El request completo corre dentro de una única tx runWithTenant (commit al
      // resolver, rollback al lanzar). El envío de WhatsApp es I/O irreversible: si
      // un throw del send (o del UPDATE siguiente) se propagara, haría rollback de la
      // aprobación + turnos ya confirmados en la tx DESPUÉS de que WhatsApps de ítems
      // previos ya se entregaron. Contenemos el throw como error por-ítem para que no
      // tumbe la transacción entera. (Desacoplar el envío a una cola es un refactor F4
      // aparte, fuera de alcance.)
      try {
        // Enviar WA
        const ok = await this.wa.enviarConvocatoria({
          telefono:       promotor.phone,
          nombrePromotor: promotor.name,
          proyecto:       proyecto.name,
          fecha:          item.dia,
          local:          item.local_nombre    ?? 'Por confirmar',
          direccion:      item.local_direccion ?? 'Por confirmar',
        });

        // El estado sólo avanza a 'enviada' cuando Meta ACEPTÓ el envío. Si el
        // send falló (rechazo de Meta o falta de plantilla), la convocatoria queda
        // 'pendiente' (reintentable) en vez de mentirle a la UI un "enviada".
        if (ok) {
          await this.dataSource.query(
            `UPDATE convocatorias
             SET mensaje_enviado_at=NOW(), estado='enviada', updated_at=NOW()
             WHERE client_id=$1 AND proyecto_id=$2 AND persona_id=$3 AND dia=$4`,
            [clientId, projectId, item.persona_id, item.dia],
          ).catch(() => {});
          enviados++;
          detalle.push({ persona_id: item.persona_id, dia: item.dia, ok: true });
        } else {
          errores++;
          detalle.push({
            persona_id: item.persona_id,
            dia: item.dia,
            ok: false,
            error: 'El envío por WhatsApp falló (Meta lo rechazó o falta la plantilla).',
          });
        }
      } catch (err: any) {
        errores++;
        detalle.push({ persona_id: item.persona_id, dia: item.dia, ok: false, error: err?.message ?? 'Error al enviar' });
      }
    }

    this.logger.log(`[F4] Convocatoria enviada proyecto=${projectId} enviados=${enviados} errores=${errores}`);
    return { enviados, errores, detalle };
  }

  // ── T9: Calendario global (read-only) ─────────────────────────────────────
  // Vista de monitoreo cross-proyecto: agrega las convocatorias de TODOS los
  // proyectos del tenant en [desde,hasta] y deriva los "puntos sin cubrir". Un
  // local (config.ia_extracted.locales) está cubierto un día si hay >=1 convocatoria
  // ese día con ese local_nombre en estado 'confirmada'; si no, es un gap.
  // tiene_pendientes marca si hay filas 'pendiente' (asignadas sin enviar) que el
  // atajo "Convocar" del calendario puede despachar en el momento.
  async getCalendarioGlobal(
    clientId: string,
    desde: string,
    hasta: string,
  ): Promise<{
    desde: string;
    hasta: string;
    convocatorias: CalendarioConvocatoria[];
    gaps: CalendarioGap[];
  }> {
    const desdeISO = String(desde).slice(0, 10);
    const hastaISO = String(hasta).slice(0, 10);

    const convocatorias: CalendarioConvocatoria[] = await this.dataSource.query(
      `SELECT c.proyecto_id,
              pr.name AS proyecto_nombre,
              c.persona_id,
              COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.name) AS persona_nombre,
              c.dia::text AS dia, c.estado, c.local_nombre, c.local_direccion
         FROM convocatorias c
         JOIN projects pr ON pr.id = c.proyecto_id AND pr.client_id = c.client_id
         LEFT JOIN promoters p ON p.id = c.persona_id AND p.client_id = c.client_id
        WHERE c.client_id = $1 AND c.dia >= $2 AND c.dia <= $3
          AND COALESCE(pr.status,'') <> 'closed'
        ORDER BY c.dia, pr.name`,
      [clientId, desdeISO, hastaISO],
    );

    const proyectos: Array<{
      id: string; name: string; start_date: string | null; end_date: string | null; config: any; aprobado: boolean;
    }> = await this.dataSource.query(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, config,
              (aprobado_por_user_id IS NOT NULL AND aprobado_at IS NOT NULL) AS aprobado
         FROM projects
        WHERE client_id = $1 AND COALESCE(status,'') <> 'closed'`,
      [clientId],
    );

    const normLocal = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

    const gaps: CalendarioGap[] = [];
    for (const pr of proyectos) {
      if (!pr.start_date || !pr.end_date) continue; // sin rango no se puede derivar cobertura
      const cfg = typeof pr.config === 'string' ? JSON.parse(pr.config) : (pr.config ?? {});
      const ia = cfg?.ia_extracted ?? cfg ?? {};
      const locales: any[] = Array.isArray(ia.locales) ? ia.locales : [];
      if (!locales.length) continue; // sin puntos cargados no hay gap derivable

      const rangoDesde = maxISODate(String(pr.start_date).slice(0, 10), desdeISO);
      const rangoHasta = minISODate(String(pr.end_date).slice(0, 10), hastaISO);

      for (const dia of eachISODayInclusive(rangoDesde, rangoHasta)) {
        for (const local of locales) {
          const localNombre: string | null = local?.nombre ?? null;
          if (!localNombre) continue;
          const celda = convocatorias.filter(
            (c) =>
              c.proyecto_id === pr.id &&
              String(c.dia).slice(0, 10) === dia &&
              normLocal(c.local_nombre) === normLocal(localNombre),
          );
          if (celda.some((c) => c.estado === 'confirmada')) continue; // cubierto
          gaps.push({
            proyecto_id:      pr.id,
            proyecto_nombre:  pr.name,
            dia,
            local_nombre:     localNombre,
            local_direccion:  local?.direccion ?? null,
            tiene_pendientes: celda.some((c) => c.estado === 'pendiente'),
            aprobado:         !!pr.aprobado,
          });
        }
      }
    }

    return { desde: desdeISO, hasta: hastaISO, convocatorias, gaps };
  }

  // ── F4: Sugerencia de anfitriones desde el perfil que extrajo la IA ────────
  // Lee config.ia_extracted.perfil_personas (rol + cantidad) y locales, y propone
  // promotores ACTIVOS con teléfono que matcheen el rol (nullable → match parcial,
  // case-insensitive). No aprueba ni envía: solo sugiere para revisión humana.
  async sugerirConvocatoria(clientId: string, projectId: string): Promise<{
    items: unknown[]; disponibles: unknown[]; dia: string | null; locales: unknown[]; perfiles: unknown[];
  }> {
    const [proj] = await this.dataSource.query(
      `SELECT config, start_date FROM projects WHERE id=$1 AND client_id=$2`,
      [projectId, clientId],
    );
    if (!proj) throw new NotFoundException('Proyecto no encontrado');

    const cfg = typeof proj.config === 'string' ? JSON.parse(proj.config) : (proj.config ?? {});
    const ia = cfg?.ia_extracted ?? cfg ?? {};
    const perfiles: any[] = Array.isArray(ia.perfil_personas) ? ia.perfil_personas : [];
    const locales: any[]  = Array.isArray(ia.locales) ? ia.locales : [];
    const dia = proj.start_date ? String(proj.start_date).slice(0, 10) : null;
    const primerLocal = locales[0] ?? null;

    const disponibles = await this.dataSource.query(
      `SELECT id, COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), name) AS name, phone, rol FROM promoters
        WHERE client_id=$1 AND status='active' AND phone IS NOT NULL
        ORDER BY name ASC`,
      [clientId],
    );

    const usados = new Set<string>();
    const items: any[] = [];
    for (const perfil of perfiles) {
      const rolPerfil = String(perfil?.rol ?? '').trim().toLowerCase();
      const cantidad  = Number(perfil?.cantidad) > 0 ? Number(perfil.cantidad) : 1;
      const matches = (disponibles as any[]).filter(
        (p) => !usados.has(p.id) && (!rolPerfil || String(p.rol ?? '').trim().toLowerCase().includes(rolPerfil)),
      );
      for (const p of matches.slice(0, cantidad)) {
        usados.add(p.id);
        items.push({
          persona_id: p.id, name: p.name, phone: p.phone, rol: p.rol ?? perfil?.rol ?? null,
          dia, local_nombre: primerLocal?.nombre ?? null, local_direccion: primerLocal?.direccion ?? null,
        });
      }
    }

    return { items, disponibles, dia, locales, perfiles };
  }

  // ── F4: Confirmar + enviar convocatoria a los anfitriones ──────────────────
  // El click de "Aprobar y enviar" ES la aprobación humana (gate F4). Reusa
  // aprobarProyecto (setea el gate) → asignarTurno (crea las convocatorias) →
  // enviarConvocatoria (manda WhatsApp). Nada nuevo en el envío.
  /**
   * T6 — Anti-choque de anfitrión. Detecta convocatorias NO terminales del MISMO
   * cliente en OTROS proyectos que colisionan en (persona, día) con los items que
   * se van a convocar. Una misma persona no puede estar en dos activaciones de
   * proyectos distintos el mismo día (físicamente imposible). Devuelve las filas
   * en conflicto (o [] si no hay ninguna) para que el front confirme.
   */
  private async detectarChoquesDia(
    clientId: string, projectId: string, items: ConvocatoriaItem[],
  ): Promise<unknown[]> {
    const personaIds: string[] = [];
    const dias: string[] = [];
    for (const it of items) {
      if (!it.dia) continue;
      personaIds.push(it.persona_id);
      dias.push(it.dia);
    }
    if (!personaIds.length) return [];

    return this.dataSource.query(
      `SELECT c.id AS convocatoria_id, c.proyecto_id, pr.name AS proyecto_nombre,
              c.persona_id, COALESCE(NULLIF(TRIM(COALESCE(prom.first_name,'') || ' ' || COALESCE(prom.last_name,'')), ''), prom.name) AS persona_nombre,
              c.dia::text AS dia, c.local_nombre, c.estado
         FROM convocatorias c
         JOIN projects pr ON pr.id = c.proyecto_id
         LEFT JOIN promoters prom ON prom.id = c.persona_id
        WHERE c.client_id = $1
          AND c.proyecto_id <> $2
          AND c.estado NOT IN ('rechazada','no_show','cancelada','reemplazada')
          AND (c.persona_id::text, c.dia::text) IN (SELECT p, d FROM unnest($3::text[], $4::text[]) AS t(p, d))`,
      [clientId, projectId, personaIds, dias],
    );
  }

  async convocarAnfitriones(
    clientId: string, projectId: string, userId: string,
    items: ConvocatoriaItem[], comentario?: string, force = false,
  ): Promise<{ enviados: number; errores: number; detalle: unknown[]; conflicts?: unknown[] }> {
    if (!items?.length) throw new BadRequestException('No hay anfitriones para convocar');

    if (!force) {
      const conflicts = await this.detectarChoquesDia(clientId, projectId, items);
      if (conflicts.length) {
        // NO aprobar, NO enviar — devuelve el choque para que el front confirme.
        return { enviados: 0, errores: 0, detalle: [], conflicts };
      }
    }

    await this.aprobarProyecto(clientId, projectId, userId, comentario);

    // Crear convocatorias (persona × día) antes de enviar. Agrupamos por
    // persona + local: agrupar sólo por persona_id perdía el local por-día
    // (tomaba el del primer item y lo aplicaba a todos sus días). Cada
    // combinación distinta (persona, local) obtiene su propio asignarTurno
    // con sus propios días y su propio local.
    const porPersonaLocal = new Map<string, { persona_id: string; dias: string[]; local_nombre?: string; local_direccion?: string }>();
    for (const it of items) {
      const key = `${it.persona_id}|${it.local_nombre ?? ''}|${it.local_direccion ?? ''}`;
      const prev = porPersonaLocal.get(key) ?? { persona_id: it.persona_id, dias: [], local_nombre: it.local_nombre, local_direccion: it.local_direccion };
      if (it.dia) prev.dias.push(it.dia);
      porPersonaLocal.set(key, prev);
    }
    for (const info of porPersonaLocal.values()) {
      if (!info.dias.length) continue;
      await this.asignarTurno(clientId, projectId, {
        persona_id: info.persona_id, dias: info.dias, local_nombre: info.local_nombre, local_direccion: info.local_direccion,
      });
    }

    return this.enviarConvocatoria(clientId, projectId, items, 'ai');
  }

  async getConvocatorias(clientId: string, projectId: string): Promise<unknown[]> {
    return this.dataSource.query(
      `SELECT c.id, c.persona_id, c.dia, c.estado,
              c.local_nombre, c.local_direccion,
              c.mensaje_enviado_at, c.respuesta_texto, c.respuesta_at,
              c.reenvio_count,
              COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.name) AS persona_nombre, p.phone AS persona_phone
         FROM convocatorias c
         LEFT JOIN promoters p ON p.id = c.persona_id
        WHERE c.client_id=$1 AND c.proyecto_id=$2
        ORDER BY c.dia, p.name`,
      [clientId, projectId],
    );
  }

  async updateConvocatoria(
    clientId:   string,
    projectId:  string,
    convId:     string,
    estado:     string,
  ): Promise<{ ok: boolean }> {
    await this.dataSource.query(
      `UPDATE convocatorias
       SET estado=$1, updated_at=NOW()
       WHERE id=$2 AND client_id=$3 AND proyecto_id=$4`,
      [estado, convId, clientId, projectId],
    );

    // C2 — El promotor confirmó pero canceló después → hay que reemplazarlo.
    //   No existe búsqueda automática de reemplazo: se notifica al OPERATOR del
    //   tenant (rol 'user'), que es quien gestiona la operación en terreno, para
    //   que consiga un reemplazo manualmente para ese turno/día.
    if (estado === 'cancelada') {
      await this.notificarReemplazoNecesario(clientId, projectId, convId).catch((err) =>
        this.logger.warn(`[F4] notificarReemplazo error conv=${convId}: ${err?.message}`),
      );
    }

    // Resolver manualmente una convocatoria puede completar la ronda → CLOSED.
    await this.cerrarConvocatoriaSiCompleta(clientId, projectId);
    return { ok: true };
  }

  /**
   * C2 — Avisa a los OPERATOR del tenant que un promotor canceló y se necesita
   * reemplazo para su turno. Idempotente por convocatoria (sendTextOnce con
   * dedupKey por convId): si la cancelación se re-procesa, no duplica el aviso.
   */
  private async notificarReemplazoNecesario(
    clientId: string, projectId: string, convId: string,
  ): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT c.dia, pr.name AS proyecto_nombre, COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.name) AS persona_nombre
         FROM convocatorias c
         LEFT JOIN projects  pr ON pr.id = c.proyecto_id
         LEFT JOIN promoters p  ON p.id  = c.persona_id
        WHERE c.id=$1 AND c.client_id=$2 AND c.proyecto_id=$3`,
      [convId, clientId, projectId],
    ).catch(() => []);
    if (!row) return;

    const fecha = row.dia ? new Date(row.dia).toLocaleDateString('es-CL') : 'la fecha asignada';
    const msg =
      `🔁 Reemplazo necesario en "${row.proyecto_nombre ?? 'proyecto'}": ` +
      `${row.persona_nombre ?? 'un promotor'} canceló su turno del ${fecha}. ` +
      `Buscá un reemplazo para ese día.`;

    const operators = await this.getOperatorPhones(clientId);
    for (const op of operators) {
      await this.waOutput.sendTextOnce(op.phone, msg, `conv-reemplazo:${convId}:${op.phone}`).catch(() => {});
    }
    this.logger.log(`[F4] Reemplazo notificado conv=${convId} (${operators.length} operador/es 'user')`);
  }

  // ── F4 Fase 3: CLOSED lifecycle ───────────────────────────────────────────

  /**
   * Cierra la ronda de convocatoria del proyecto si TODAS las convocatorias
   * quedaron resueltas (ninguna en 'enviada'/'pendiente'), y notifica al operador
   * UNA sola vez. El UPDATE es atómico e idempotente: el guard
   * convocatoria_cerrada_at IS NULL + el chequeo de pendientes evitan doble aviso
   * aunque dos respuestas lleguen casi simultáneas.
   */
  async cerrarConvocatoriaSiCompleta(clientId: string, projectId: string): Promise<void> {
    const cerradas = await this.dataSource.query(
      `UPDATE projects p
          SET convocatoria_cerrada_at = NOW(), updated_at = NOW()
        WHERE p.id = $1 AND p.client_id = $2
          AND p.convocatoria_cerrada_at IS NULL
          AND EXISTS (
            SELECT 1 FROM convocatorias c
             WHERE c.proyecto_id = $1 AND c.client_id = $2
          )
          AND NOT EXISTS (
            SELECT 1 FROM convocatorias c
             WHERE c.proyecto_id = $1 AND c.client_id = $2
               AND c.estado IN ('enviada','pendiente')
          )
        RETURNING p.name`,
      [projectId, clientId],
    ).catch((err: any) => {
      this.logger.warn(`[F4] cerrarConvocatoria error proyecto=${projectId}: ${err.message}`);
      return [];
    });

    if (!cerradas.length) return; // nada que cerrar (o ya estaba cerrada)

    const nombre = cerradas[0].name;
    // Resumen de la ronda para el operador.
    const [resumen] = await this.dataSource.query(
      `SELECT
          COUNT(*)                                        AS total,
          COUNT(*) FILTER (WHERE estado='confirmada')     AS confirmadas,
          COUNT(*) FILTER (WHERE estado='rechazada')      AS rechazadas
         FROM convocatorias
        WHERE proyecto_id=$1 AND client_id=$2`,
      [projectId, clientId],
    ).catch(() => [{ total: '?', confirmadas: '?', rechazadas: '?' }]);

    const msg = `✅ Convocatoria "${nombre}" cerrada: todos respondieron. `
      + `${resumen.confirmadas}/${resumen.total} confirmaron, ${resumen.rechazadas} rechazaron.`;
    const admins = await this.getAdminPhones(clientId);
    for (const admin of admins) {
      await this.wa.sendText(admin.phone, msg).catch(() => {});
    }
    this.logger.log(`[F4] Convocatoria cerrada proyecto=${projectId} (${admins.length} operadores notificados)`);
  }

  /** Teléfonos de los admin_cliente del tenant con phone registrado. */
  private async getAdminPhones(clientId: string): Promise<{ phone: string }[]> {
    return this.dataSource.query(
      `SELECT phone FROM users
        WHERE client_id=$1 AND role='${UserRole.MANAGER}' AND phone IS NOT NULL`,
      [clientId],
    ).catch(() => []);
  }

  /**
   * Teléfonos de los OPERATOR (rol 'user') del tenant con phone registrado.
   * Análogo a getAdminPhones pero para el operador de terreno: es el destinatario
   * de las tareas del ciclo de convocatoria (reemplazo por cancelación C2,
   * no-respuesta tras 2 recordatorios C4). Distinto del MANAGER que recibe las
   * escaladas de ambigüedad y el cierre de ronda.
   */
  private async getOperatorPhones(clientId: string): Promise<{ phone: string }[]> {
    return this.dataSource.query(
      `SELECT phone FROM users
        WHERE client_id=$1 AND role='${UserRole.OPERATOR}' AND phone IS NOT NULL`,
      [clientId],
    ).catch(() => []);
  }

}

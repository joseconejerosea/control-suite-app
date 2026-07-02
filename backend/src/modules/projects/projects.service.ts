import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { StockReturnsService } from '../movimientos-pop/stock-returns.service';

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

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly repo:   TenantRepository<Project>;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly wa: WhatsAppService,
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

    return updated;
  }

  async summary(clientId: string, id: string): Promise<ProjectSummary> {
    const project  = await this.findOne(clientId, id);
    const [counts] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*)::int FROM campaigns   WHERE client_id=$1 AND project_id=$2) AS total_campaigns,
         (SELECT COUNT(*)::int FROM activations WHERE client_id=$1 AND project_id=$2) AS total_activations,
         (SELECT COUNT(DISTINCT p.id)::int
            FROM promoters p JOIN activations a ON a.promoter_id=p.id
           WHERE p.client_id=$1 AND a.project_id=$2)                                  AS active_promoters,
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
              p.name AS persona_nombre, p.phone AS persona_phone
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
              p.name AS persona_nombre
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

    // Crear convocatorias pendientes por cada día (sin enviar WA todavía)
    for (const dia of body.dias) {
      await this.dataSource.query(
        `INSERT INTO convocatorias
           (client_id, proyecto_id, persona_id, dia, local_nombre, local_direccion, estado)
         VALUES ($1,$2,$3,$4,$5,$6,'pendiente')
         ON CONFLICT DO NOTHING`,
        [clientId, projectId, body.persona_id, dia, body.local_nombre ?? null, body.local_direccion ?? null],
      ).catch(() => {});
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
        `SELECT name, phone FROM promoters WHERE id=$1 AND client_id=$2`,
        [item.persona_id, clientId],
      ).catch(() => []);

      if (!promotor?.phone) {
        errores++;
        detalle.push({ persona_id: item.persona_id, dia: item.dia, ok: false, error: 'Sin teléfono registrado' });
        continue;
      }

      // Enviar WA
      const ok = await this.wa.enviarConvocatoria({
        telefono:       promotor.phone,
        nombrePromotor: promotor.name,
        proyecto:       proyecto.name,
        fecha:          item.dia,
        local:          item.local_nombre    ?? 'Por confirmar',
        direccion:      item.local_direccion ?? 'Por confirmar',
      });

      // Actualizar convocatoria en DB
      await this.dataSource.query(
        `UPDATE convocatorias
         SET mensaje_enviado_at=NOW(), estado='enviada', updated_at=NOW()
         WHERE client_id=$1 AND proyecto_id=$2 AND persona_id=$3 AND dia=$4`,
        [clientId, projectId, item.persona_id, item.dia],
      ).catch(() => {});

      if (ok) { enviados++; } else { errores++; }
      detalle.push({ persona_id: item.persona_id, dia: item.dia, ok });
    }

    this.logger.log(`[F4] Convocatoria enviada proyecto=${projectId} enviados=${enviados} errores=${errores}`);
    return { enviados, errores, detalle };
  }

  async getConvocatorias(clientId: string, projectId: string): Promise<unknown[]> {
    return this.dataSource.query(
      `SELECT c.id, c.persona_id, c.dia, c.estado,
              c.local_nombre, c.local_direccion,
              c.mensaje_enviado_at, c.respuesta_texto, c.respuesta_at,
              c.reenvio_count,
              p.name AS persona_nombre, p.phone AS persona_phone
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
    return { ok: true };
  }

}

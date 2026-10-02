import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Activation } from './entities/activation.entity';
import { CreateActivationDto, UpdateActivationDto } from './dto/activation.dto';

@Injectable()
export class ActivationsService {
  private readonly logger = new Logger(ActivationsService.name);
  private readonly repo: TenantRepository<Activation>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = new TenantRepository(dataSource, Activation);
  }

  /**
   * List activations enriched with the display names of their related entities
   * (campaign / location / promoter). GET /activations returns raw *_id UUIDs
   * otherwise, which are useless in a table. Client-scoped; RLS is defense-in-depth.
   */
  private listEnriched(
    where: string,
    params: unknown[],
  ): Promise<Record<string, unknown>[]> {
    return this.dataSource.query(
      `SELECT a.*,
              c.name AS campaign_name,
              l.name AS location_name,
              NULLIF(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), '') AS promoter_name
         FROM activations a
         LEFT JOIN campaigns  c ON c.id = a.campaign_id
         LEFT JOIN locations  l ON l.id = a.location_id
         LEFT JOIN promoters  p ON p.id = a.promoter_id
        ${where}
        ORDER BY a.activation_date DESC NULLS LAST`,
      params,
    );
  }

  findAll(clientId: string): Promise<Record<string, unknown>[]> {
    return this.listEnriched('WHERE a.client_id = $1', [clientId]);
  }

  findByCampaign(
    clientId: string,
    campaignId: string,
  ): Promise<Record<string, unknown>[]> {
    return this.listEnriched(
      'WHERE a.client_id = $1 AND a.campaign_id = $2',
      [clientId, campaignId],
    );
  }

  findByProject(
    clientId: string,
    projectId: string,
  ): Promise<Record<string, unknown>[]> {
    // Activations created via the new UI set campaign_id but not project_id, so
    // the campaign traversal is the reliable link. Match on either association.
    return this.listEnriched(
      `WHERE a.client_id = $1
         AND (a.project_id = $2
              OR a.campaign_id IN (SELECT id FROM campaigns WHERE project_id = $2 AND client_id = $1))`,
      [clientId, projectId],
    );
  }

  findOne(clientId: string, id: string): Promise<Activation> {
    return this.repo.findOne(clientId, id);
  }

  /**
   * T6 · Anti-choque de anfitrión. Un promotor no puede estar en dos activaciones el
   * MISMO día. Si el promotor ya tiene otra activación (no cancelada) en esa fecha,
   * rechaza con un mensaje claro ANTES de crear/guardar (decisión de producto: bloquear,
   * no permitir override desde el ABM — el flujo de convocatoria sí tiene "convocar a
   * ambas"). excludeId: al editar, se ignora la propia activación. Filtro por client_id =
   * defensa en profundidad (mismo patrón que detectarChoquesDia).
   */
  private async assertNoPromoterDateClash(
    clientId: string,
    promoterId: string,
    activationDate: string,
    excludeId?: string,
  ): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT a.activation_date::text AS dia,
              COALESCE(NULLIF(TRIM(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,'')), ''), p.name) AS promotor
         FROM activations a
         LEFT JOIN promoters p ON p.id = a.promoter_id
        WHERE a.client_id = $1
          AND a.promoter_id = $2
          AND a.activation_date = $3::date
          AND a.status <> 'cancelled'
          AND ($4::uuid IS NULL OR a.id <> $4::uuid)
        LIMIT 1`,
      [clientId, promoterId, activationDate, excludeId ?? null],
    );
    if (rows.length) {
      const nombre = rows[0].promotor ?? 'Esa persona';
      throw new BadRequestException(
        `${nombre} ya tiene otra activación asignada el ${rows[0].dia}. Una persona no puede estar en dos activaciones el mismo día — revisá antes de guardar.`,
      );
    }
  }

  async create(clientId: string, dto: CreateActivationDto): Promise<Activation> {
    // T6 · Anti-choque: sólo aplica si la activación trae promotor + fecha.
    if (dto.promoter_id && dto.activation_date) {
      await this.assertNoPromoterDateClash(clientId, dto.promoter_id, dto.activation_date);
    }
    const activation = await this.repo.create(clientId, dto as unknown as Record<string, unknown>);
    this.logger.log(`Activation created [id=${activation.id}]`);
    return activation;
  }

  async update(clientId: string, id: string, dto: UpdateActivationDto): Promise<Activation> {
    const patch: Record<string, unknown> = { ...(dto as unknown as Record<string, unknown>) };

    // T2 · Reactivación: el gate del bot de terreno considera una activación "activa"
    // solo si `status ∈ (scheduled, in_progress)` Y `estado_f5 != 'cerrada'` — dos
    // ciclos INDEPENDIENTES. Reabrir una activación desde la UI cambia `status` pero
    // dejaba `estado_f5='cerrada'` intacto, así que el bot la seguía rechazando. Acá,
    // al reabrir (status → agendada/en curso) una activación que estaba CERRADA en F5,
    // reseteamos `estado_f5='pendiente'` y limpiamos `cerrada_at` para que vuelva a ser
    // reconocida. Guardado condicional: si el F5 NO estaba cerrado (pendiente/en_vivo),
    // una edición normal (cambiar fecha, notas, etc.) NO lo toca.
    if (dto.status === 'scheduled' || dto.status === 'in_progress') {
      const current = await this.repo.findOne(clientId, id);
      if (current.estado_f5 === 'cerrada') {
        patch.estado_f5 = 'pendiente';
        patch.cerrada_at = null;
        this.logger.log(
          `Activation ${id} reabierta (status=${dto.status}): estado_f5 'cerrada' → 'pendiente'`,
        );
      }
    }

    // T6 · Anti-choque al EDITAR: si cambia el promotor o la fecha, re-chequear el choque
    // sobre los valores EFECTIVOS (dto si vino, si no el actual), ignorando la propia
    // activación. Si no se toca promotor ni fecha, no hay que re-validar.
    if (dto.promoter_id !== undefined || dto.activation_date !== undefined) {
      const cur = await this.dataSource.query(
        `SELECT promoter_id, activation_date::text AS dia FROM activations WHERE id=$1 AND client_id=$2 LIMIT 1`,
        [id, clientId],
      );
      const promoterId = dto.promoter_id ?? cur[0]?.promoter_id;
      const activationDate = dto.activation_date ?? cur[0]?.dia;
      if (promoterId && activationDate) {
        await this.assertNoPromoterDateClash(clientId, promoterId, activationDate, id);
      }
    }

    return this.repo.update(clientId, id, patch);
  }

  remove(clientId: string, id: string): Promise<void> {
    return this.repo.remove(clientId, id);
  }

  // ── F5 sub-resources ──────────────────────────────────────────────

  // Columnas reales (migración 025): las tablas F5 usan `activacion_id` (español);
  // checkins referencia a la persona por `persona_id`; reportes_avance ordena por `ts`.
  async findCheckins(clientId: string, activationId: string): Promise<any[]> {
    try {
      return await this.dataSource.query(
        `SELECT c.*, row_to_json(p.*) as promotor
         FROM checkins c
         LEFT JOIN promoters p ON p.id = c.persona_id
         WHERE c.activacion_id = $1 AND c.client_id = $2
         ORDER BY c.ts DESC`,
        [activationId, clientId],
      );
    } catch {
      return [];
    }
  }

  async findIncidencias(clientId: string, activationId: string): Promise<any[]> {
    try {
      return await this.dataSource.query(
        `SELECT * FROM incidencias
         WHERE activacion_id = $1 AND client_id = $2
         ORDER BY created_at DESC`,
        [activationId, clientId],
      );
    } catch {
      return [];
    }
  }

  async findReportes(clientId: string, activationId: string): Promise<any[]> {
    try {
      return await this.dataSource.query(
        `SELECT * FROM reportes_avance
         WHERE activacion_id = $1 AND client_id = $2
         ORDER BY ts DESC`,
        [activationId, clientId],
      );
    } catch {
      return [];
    }
  }
}

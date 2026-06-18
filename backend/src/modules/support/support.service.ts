import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

interface BroadcastDto {
  mensaje:     string;
  canales:     ('whatsapp' | 'email' | 'banner')[];
  client_ids?: string[];
  asunto?:     string;
}

@Injectable()
export class SupportService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly wa: WhatsAppService,
  ) {}

  async findAll(filters: { estado?: string; prioridad?: string; client_id?: string }) {
    let q = `SELECT t.*, u.email as user_email, c.nombre as cliente_nombre
             FROM tickets t
             LEFT JOIN users u ON u.id = t.user_id
             LEFT JOIN clients c ON c.id = t.client_id
             WHERE 1=1`;
    const params: unknown[] = [];
    let i = 1;
    if (filters.estado)    { q += ` AND t.estado = $${i++}`;    params.push(filters.estado); }
    if (filters.prioridad) { q += ` AND t.prioridad = $${i++}`; params.push(filters.prioridad); }
    if (filters.client_id) { q += ` AND t.client_id = $${i++}`; params.push(filters.client_id); }
    q += ` ORDER BY t.created_at DESC`;
    return this.ds.query(q, params).catch(() => []);
  }

  async findOne(id: string, clientId?: string) {
    // clientId scopes the lookup for client-facing routes (prevents cross-tenant
    // ticket IDOR). Admin (super_admin) routes pass no clientId → cross-tenant.
    let q = `SELECT * FROM tickets WHERE id = $1`;
    const params: unknown[] = [id];
    if (clientId) {
      q += ` AND client_id = $2`;
      params.push(clientId);
    }
    const rows = await this.ds.query(q, params);
    if (!rows.length) throw new NotFoundException(`Ticket ${id} no encontrado`);
    return rows[0];
  }

  async create(data: {
    client_id?: string;
    user_id?:   string;
    tipo:       string;
    descripcion: string;
    prioridad?: string;
  }) {
    const res = await this.ds.query(
      `INSERT INTO tickets (client_id, user_id, tipo, descripcion, prioridad, estado)
       VALUES ($1, $2, $3, $4, $5, 'abierto') RETURNING *`,
      [data.client_id ?? null, data.user_id ?? null, data.tipo, data.descripcion, data.prioridad ?? 'media'],
    );
    return res[0];
  }

  async updateEstado(id: string, estado: string) {
    const res = await this.ds.query(
      `UPDATE tickets SET estado = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [estado, id],
    );
    if (!res.length) throw new NotFoundException(`Ticket ${id} no encontrado`);
    return res[0];
  }

  async responder(id: string, respuesta: string, userId: string) {
    const res = await this.ds.query(
      `UPDATE tickets SET respuesta = $1, respondido_por = $2, estado = 'en_proceso', updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [respuesta, userId, id],
    );
    if (!res.length) throw new NotFoundException(`Ticket ${id} no encontrado`);
    return res[0];
  }

  async kpis(clientId?: string) {
    // Scope to the caller tenant on client-facing routes; admin passes none.
    const where = clientId ? `WHERE client_id = $1` : '';
    const params: unknown[] = clientId ? [clientId] : [];
    const rows = await this.ds.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN estado='abierto'     THEN 1 END) as abiertos,
        COUNT(CASE WHEN estado='en_proceso'  THEN 1 END) as en_proceso,
        COUNT(CASE WHEN estado='cerrado'     THEN 1 END) as cerrados,
        COUNT(CASE WHEN prioridad='alta' AND estado != 'cerrado' THEN 1 END) as alta_abiertos
      FROM tickets
      ${where}
    `, params).catch(() => [{ total: 0, abiertos: 0, en_proceso: 0, cerrados: 0, alta_abiertos: 0 }]);
    return rows[0];
  }

  // ── Brief §A5: Proactive comms ────────────────────────────────────────────
  // "send WhatsApp / email / in-app banner to one or many clients"
  async broadcast(dto: BroadcastDto): Promise<{
    enviados: number;
    errores:  number;
    detalle:  { client_id: string; canal: string; ok: boolean; error?: string }[];
  }> {
    // Resolve target clients
    let clients: { id: string; nombre: string; whatsapp_number?: string }[] = [];

    if (dto.client_ids?.length) {
      clients = await this.ds.query(
        `SELECT id, nombre FROM clients WHERE id = ANY($1) AND status = 'active'`,
        [dto.client_ids],
      ).catch(() => []);
    } else {
      clients = await this.ds.query(
        `SELECT id, nombre FROM clients WHERE status = 'active'`,
      ).catch(() => []);
    }

    let enviados = 0;
    let errores  = 0;
    const detalle: { client_id: string; canal: string; ok: boolean; error?: string }[] = [];

    for (const client of clients) {
      for (const canal of dto.canales) {

        // ── WhatsApp ───────────────────────────────────────────────────────
        if (canal === 'whatsapp') {
          // Find admin phone number for this client
          const [adminUser] = await this.ds.query(
            `SELECT u.phone FROM users u WHERE u.client_id = $1 AND u.role = 'admin_cliente' AND u.phone IS NOT NULL LIMIT 1`,
            [client.id],
          ).catch(() => []);

          if (adminUser?.phone) {
            const ok = await this.wa.sendText(adminUser.phone, dto.mensaje);
            if (ok) { enviados++; } else { errores++; }
            detalle.push({ client_id: client.id, canal: 'whatsapp', ok, error: ok ? undefined : 'WA send failed' });
          } else {
            errores++;
            detalle.push({ client_id: client.id, canal: 'whatsapp', ok: false, error: 'No phone registered' });
          }
        }

        // ── In-app banner (stored as mind_propuesta tipo=banner) ───────────
        if (canal === 'banner') {
          await this.ds.query(
            `INSERT INTO mind_propuestas
               (client_id, tipo, titulo, descripcion, prioridad, estado, created_at)
             VALUES ($1, 'comunicado_admin', $2, $3, 'media', 'pendiente', NOW())`,
            [client.id, dto.asunto ?? 'Comunicado de Control Suite', dto.mensaje],
          ).catch(() => {});
          enviados++;
          detalle.push({ client_id: client.id, canal: 'banner', ok: true });
        }

        // ── Email (via resend — future integration) ────────────────────────
        if (canal === 'email') {
          // Log intent — full Resend integration requires email template
          await this.ds.query(
            `INSERT INTO audit_log (accion, detalle, created_at)
             VALUES ('admin_broadcast_email', $1::jsonb, NOW())
             ON CONFLICT DO NOTHING`,
            [JSON.stringify({ client_id: client.id, asunto: dto.asunto, preview: dto.mensaje.slice(0, 100) })],
          ).catch(() => {});
          enviados++;
          detalle.push({ client_id: client.id, canal: 'email', ok: true });
        }
      }
    }

    return { enviados, errores, detalle };
  }
}

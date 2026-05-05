import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SupportService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async findAll(filters: { estado?: string; prioridad?: string; client_id?: string }) {
    let q = `SELECT t.*, u.email as user_email, c.nombre as cliente_nombre
             FROM tickets t
             LEFT JOIN users u ON u.id = t.user_id
             LEFT JOIN clients c ON c.id = t.client_id
             WHERE 1=1`;
    const params: any[] = [];
    let i = 1;
    if (filters.estado)    { q += ` AND t.estado = $${i++}`;     params.push(filters.estado); }
    if (filters.prioridad) { q += ` AND t.prioridad = $${i++}`;  params.push(filters.prioridad); }
    if (filters.client_id) { q += ` AND t.client_id = $${i++}`;  params.push(filters.client_id); }
    q += ` ORDER BY t.created_at DESC`;
    return this.ds.query(q, params).catch(() => []);
  }

  async findOne(id: string) {
    const rows = await this.ds.query(`SELECT * FROM tickets WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException(`Ticket ${id} no encontrado`);
    return rows[0];
  }

  async create(data: { client_id?: string; user_id?: string; tipo: string; descripcion: string; prioridad?: string }) {
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

  async kpis() {
    const rows = await this.ds.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN estado='abierto' THEN 1 END) as abiertos,
        COUNT(CASE WHEN estado='en_proceso' THEN 1 END) as en_proceso,
        COUNT(CASE WHEN estado='cerrado' THEN 1 END) as cerrados,
        COUNT(CASE WHEN prioridad='alta' AND estado != 'cerrado' THEN 1 END) as alta_abiertos
      FROM tickets
    `).catch(() => [{ total: 0, abiertos: 0, en_proceso: 0, cerrados: 0, alta_abiertos: 0 }]);
    return rows[0];
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateBodegaDto, UpdateBodegaDto } from './dto/bodega.dto';

@Injectable()
export class BodegasService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async findAll(clientId: string) {
    return this.ds.query(
      `SELECT b.*,
              COALESCE(SUM(inv.cantidad),0) as total_skus_en_bodega,
              COALESCE(SUM(inv.cantidad * s.valor_unitario),0) as valor_inventario
       FROM bodegas b
       LEFT JOIN inventario inv ON inv.bodega_id = b.id
       LEFT JOIN skus s ON s.id = inv.sku_id
       WHERE b.client_id=$1 AND b.active=true
       GROUP BY b.id
       ORDER BY b.tipo='principal' DESC, b.nombre ASC`,
      [clientId],
    );
  }

  async findOne(clientId: string, id: string) {
    const rows = await this.ds.query(
      `SELECT b.* FROM bodegas b WHERE b.id=$1 AND b.client_id=$2`,
      [id, clientId],
    );
    if (!rows.length) throw new NotFoundException(`Bodega ${id} no encontrada`);
    const bodega = rows[0];

    // Inventario actual de esta bodega
    bodega.inventario = await this.ds.query(
      `SELECT inv.*, s.codigo, s.nombre, s.cliente_final, s.foto_key,
              s.valor_unitario, s.tipo as sku_tipo,
              (SELECT COUNT(*) FROM movimientos_pop m WHERE m.sku_id=s.id AND m.estado='en_terreno' AND m.client_id=$2) as en_terreno
       FROM inventario inv
       JOIN skus s ON s.id = inv.sku_id
       WHERE inv.bodega_id=$1 AND inv.client_id=$2 AND inv.cantidad > 0`,
      [id, clientId],
    );

    // Movimientos recientes
    bodega.movimientos_recientes = await this.ds.query(
      `SELECT m.*, s.nombre as sku_nombre, s.codigo
       FROM movimientos_pop m
       JOIN skus s ON s.id = m.sku_id
       WHERE m.bodega_origen_id=$1 AND m.client_id=$2
       ORDER BY m.created_at DESC LIMIT 20`,
      [id, clientId],
    );

    return bodega;
  }

  /** Vista Proyectos Live — lee desde la DB VIEW vw_proyectos_live */
  async proyectosLive(clientId: string) {
    return this.ds.query(
      `SELECT *
       FROM vw_proyectos_live
       WHERE client_id = $1
       ORDER BY fecha_retorno_esperada ASC NULLS LAST`,
      [clientId],
    );
  }

  async create(clientId: string, dto: CreateBodegaDto) {
    const res = await this.ds.query(
      `INSERT INTO bodegas (client_id, nombre, direccion, encargado_persona_id, tipo)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [clientId, dto.nombre, dto.direccion ?? null, dto.encargado_persona_id ?? null, dto.tipo ?? 'principal'],
    );
    return res[0];
  }

  async update(clientId: string, id: string, dto: UpdateBodegaDto) {
    await this.findOne(clientId, id);
    const fields: string[] = [];
    const params: unknown[] = [id];
    let i = 2;
    if (dto.nombre !== undefined) { fields.push(`nombre=$${i++}`); params.push(dto.nombre); }
    if (dto.direccion !== undefined) { fields.push(`direccion=$${i++}`); params.push(dto.direccion); }
    if (dto.encargado_persona_id !== undefined) { fields.push(`encargado_persona_id=$${i++}`); params.push(dto.encargado_persona_id); }
    if (dto.active !== undefined) { fields.push(`active=$${i++}`); params.push(dto.active); }
    if (!fields.length) return this.findOne(clientId, id);
    fields.push(`updated_at=NOW()`);
    const res = await this.ds.query(
      `UPDATE bodegas SET ${fields.join(',')} WHERE id=$1 AND client_id=$${i} RETURNING *`,
      [...params, clientId],
    );
    return res[0];
  }
}

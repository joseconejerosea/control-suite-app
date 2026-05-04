import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateSkuDto, UpdateSkuDto } from './dto/sku.dto';

@Injectable()
export class SkusService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async findAll(clientId: string) {
    return this.ds.query(
      `SELECT s.*,
              COALESCE(SUM(inv.cantidad),0) as en_bodega,
              (SELECT COALESCE(SUM(m.cantidad),0) FROM movimientos_pop m
               WHERE m.sku_id=s.id AND m.estado='en_terreno' AND m.tipo='salida') as en_terreno
       FROM skus s
       LEFT JOIN inventario inv ON inv.sku_id = s.id
       WHERE s.client_id=$1 AND s.active=true
       GROUP BY s.id
       ORDER BY s.cliente_final ASC, s.nombre ASC`,
      [clientId],
    );
  }

  async findOne(clientId: string, id: string) {
    const rows = await this.ds.query(
      `SELECT s.*,
              COALESCE(SUM(inv.cantidad),0) as en_bodega
       FROM skus s
       LEFT JOIN inventario inv ON inv.sku_id = s.id
       WHERE s.id=$1 AND s.client_id=$2
       GROUP BY s.id`,
      [id, clientId],
    );
    if (!rows.length) throw new NotFoundException(`SKU ${id} no encontrado`);
    return rows[0];
  }

  async create(clientId: string, dto: CreateSkuDto) {
    // Verificar código único por cliente
    const exists = await this.ds.query(
      `SELECT id FROM skus WHERE client_id=$1 AND codigo=$2`,
      [clientId, dto.codigo],
    );
    if (exists.length) throw new BadRequestException(`Código SKU '${dto.codigo}' ya existe`);

    const res = await this.ds.query(
      `INSERT INTO skus (client_id, codigo, nombre, cliente_final, dimensiones, peso_kg,
        valor_unitario, proveedor_fabricacion, fabricado_at, tipo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        clientId, dto.codigo, dto.nombre, dto.cliente_final ?? null,
        dto.dimensiones ?? null, dto.peso_kg ?? null,
        dto.valor_unitario ?? null, dto.proveedor_fabricacion ?? null,
        dto.fabricado_at ?? null, dto.tipo ?? 'reusable',
      ],
    );
    return res[0];
  }

  async update(clientId: string, id: string, dto: UpdateSkuDto) {
    await this.findOne(clientId, id);
    const fields: string[] = [];
    const params: unknown[] = [id, clientId];
    let i = 3;
    if (dto.nombre !== undefined) { fields.push(`nombre=$${i++}`); params.push(dto.nombre); }
    if (dto.cliente_final !== undefined) { fields.push(`cliente_final=$${i++}`); params.push(dto.cliente_final); }
    if (dto.valor_unitario !== undefined) { fields.push(`valor_unitario=$${i++}`); params.push(dto.valor_unitario); }
    if (dto.tipo !== undefined) { fields.push(`tipo=$${i++}`); params.push(dto.tipo); }
    if (!fields.length) return this.findOne(clientId, id);
    fields.push('updated_at=NOW()');
    const res = await this.ds.query(
      `UPDATE skus SET ${fields.join(',')} WHERE id=$1 AND client_id=$2 RETURNING *`,
      params,
    );
    return res[0];
  }

  async deactivate(clientId: string, id: string) {
    await this.findOne(clientId, id);
    await this.ds.query(`UPDATE skus SET active=false, updated_at=NOW() WHERE id=$1 AND client_id=$2`, [id, clientId]);
  }

  /** Alertas de stock insuficiente para activaciones próximas (14 días) */
  async alertasStock(clientId: string) {
    return this.ds.query(
      `SELECT s.id as sku_id, s.nombre as sku_nombre, s.codigo,
              p.id as proyecto_id, p.name as proyecto_nombre, p.start_date,
              COALESCE(SUM(inv.cantidad),0) as disponible,
              EXTRACT(EPOCH FROM (p.start_date::timestamptz - NOW()))/86400 as dias_restantes
       FROM skus s
       JOIN inventario inv ON inv.sku_id = s.id
       JOIN projects p ON p.client_id = s.client_id
         AND p.start_date BETWEEN NOW() AND NOW() + INTERVAL '14 days'
         AND p.status = 'active'
       WHERE s.client_id=$1 AND s.active=true
       GROUP BY s.id, p.id
       HAVING COALESCE(SUM(inv.cantidad),0) < 10
       ORDER BY p.start_date ASC`,
      [clientId],
    );
  }
}

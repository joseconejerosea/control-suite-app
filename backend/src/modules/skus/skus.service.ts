import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { CreateSkuDto, UpdateSkuDto } from './dto/sku.dto';

@Injectable()
export class SkusService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ── T13: Carga masiva de SKU por Excel ──────────────────────────────────────
  // Parsea un .xlsx (base64, mismo patrón de upload que invoices: JSON, Fastify-safe),
  // mapea headers case-insensitive y crea los SKUs deduplicando por código
  // (ON CONFLICT). Devuelve un resumen para mostrarle al cliente qué entró.
  async importExcel(
    clientId: string,
    fileBase64: string,
  ): Promise<{ total: number; creados: number; omitidos: number; errores: { fila: number; motivo: string }[] }> {
    let rows: Record<string, any>[];
    try {
      const wb = XLSX.read(Buffer.from(fileBase64, 'base64'), { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('sin hojas');
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    } catch {
      throw new BadRequestException('No se pudo leer el archivo Excel. Verificá que sea un .xlsx válido.');
    }

    const pick = (row: Record<string, any>, keys: string[]): string => {
      for (const k of Object.keys(row)) {
        if (keys.includes(k.trim().toLowerCase())) return String(row[k] ?? '').trim();
      }
      return '';
    };

    let creados = 0;
    let omitidos = 0;
    const errores: { fila: number; motivo: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const fila = i + 2; // +1 por el header, +1 para base-1 (cómo lo ve el usuario en Excel)
      const codigo = pick(rows[i], ['codigo', 'código', 'sku']);
      const nombre = pick(rows[i], ['nombre', 'material']);
      if (!codigo || !nombre) {
        errores.push({ fila, motivo: 'Falta código o nombre' });
        continue;
      }

      const cliente_final = pick(rows[i], ['cliente_final', 'cliente final', 'cliente']) || null;
      const tipo = pick(rows[i], ['tipo']).toLowerCase() === 'consumible' ? 'consumible' : 'reusable';
      const minRaw = pick(rows[i], ['min_stock', 'stock minimo', 'stock mínimo', 'stock']);
      const min_stock = minRaw && !isNaN(Number(minRaw)) ? parseInt(minRaw, 10) : 5;

      const res = await this.ds.query(
        `INSERT INTO skus (client_id, codigo, nombre, cliente_final, tipo, min_stock)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (client_id, codigo) DO NOTHING
         RETURNING id`,
        [clientId, codigo, nombre, cliente_final, tipo, min_stock],
      );
      if (res.length) creados++;
      else omitidos++;
    }

    return { total: rows.length, creados, omitidos, errores };
  }

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
        valor_unitario, proveedor_fabricacion, fabricado_at, tipo, min_stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        clientId, dto.codigo, dto.nombre, dto.cliente_final ?? null,
        dto.dimensiones ?? null, dto.peso_kg ?? null,
        dto.valor_unitario ?? null, dto.proveedor_fabricacion ?? null,
        dto.fabricado_at ?? null, dto.tipo ?? 'reusable', dto.min_stock ?? 0,
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
    if (dto.min_stock !== undefined) { fields.push(`min_stock=$${i++}`); params.push(dto.min_stock); }
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

  async alertasStock(clientId: string) {
    return this.ds.query(
      `SELECT s.id as sku_id, s.nombre as sku_nombre, s.codigo, s.min_stock,
              COALESCE(SUM(inv.cantidad),0)::int as disponible
       FROM skus s
       LEFT JOIN inventario inv ON inv.sku_id = s.id
       WHERE s.client_id=$1 AND s.active=true AND s.min_stock > 0
       GROUP BY s.id
       HAVING COALESCE(SUM(inv.cantidad),0) <= s.min_stock
       ORDER BY s.nombre ASC`,
      [clientId],
    );
  }
}

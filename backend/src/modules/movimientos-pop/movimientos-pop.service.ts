import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateMovimientoDto, MovimientoFiltersDto } from './dto/movimiento-pop.dto';

@Injectable()
export class MovimientosPopService {
  private readonly logger = new Logger(MovimientosPopService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async findAll(clientId: string, filters: MovimientoFiltersDto) {
    let q = `
      SELECT m.*, s.nombre as sku_nombre, s.codigo, s.cliente_final,
             b.nombre as bodega_nombre, p.name as proyecto_nombre
      FROM movimientos_pop m
      JOIN skus s ON s.id = m.sku_id
      LEFT JOIN bodegas b ON b.id = m.bodega_origen_id
      LEFT JOIN projects p ON p.id = m.proyecto_destino_id
      WHERE m.client_id=$1
    `;
    const params: unknown[] = [clientId];
    let i = 2;
    if (filters.sku_id) { q += ` AND m.sku_id=$${i++}`; params.push(filters.sku_id); }
    if (filters.tipo)   { q += ` AND m.tipo=$${i++}`;   params.push(filters.tipo); }
    if (filters.estado) { q += ` AND m.estado=$${i++}`; params.push(filters.estado); }
    if (filters.proyecto_destino_id) { q += ` AND m.proyecto_destino_id=$${i++}`; params.push(filters.proyecto_destino_id); }
    if (filters.bodega_origen_id)    { q += ` AND m.bodega_origen_id=$${i++}`;    params.push(filters.bodega_origen_id); }
    q += ` ORDER BY m.created_at DESC LIMIT 200`;
    return this.ds.query(q, params);
  }

  async findOne(clientId: string, id: string) {
    const rows = await this.ds.query(
      `SELECT m.*, s.nombre as sku_nombre, s.codigo FROM movimientos_pop m
       JOIN skus s ON s.id = m.sku_id
       WHERE m.id=$1 AND m.client_id=$2`, [id, clientId],
    );
    if (!rows.length) throw new NotFoundException(`Movimiento ${id} no encontrado`);
    return rows[0];
  }

  async create(clientId: string, dto: CreateMovimientoDto) {
    if (dto.tipo === 'transfer') {
      return this.createTransfer(clientId, dto);
    }
    if (dto.tipo === 'adjustment') {
      return this.createAdjustment(clientId, dto);
    }

    // Verificar stock disponible para salida
    if (dto.tipo === 'salida' && dto.bodega_origen_id) {
      await this.checkStock(clientId, dto.sku_id, dto.bodega_origen_id, dto.cantidad);
    }

    const estado = ['consumo', 'merma'].includes(dto.tipo) ? dto.tipo :
                   dto.tipo === 'salida' ? 'en_terreno' : 'devuelto_completo';

    const res = await this.ds.query(
      `INSERT INTO movimientos_pop
         (client_id, sku_id, persona_id, bodega_origen_id, proyecto_destino_id,
          tipo, cantidad, foto_key, tiempo_uso_dias, fecha_retorno_esperada, estado, observacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        clientId, dto.sku_id, dto.persona_id ?? null, dto.bodega_origen_id ?? null,
        dto.proyecto_destino_id ?? null, dto.tipo, dto.cantidad,
        dto.foto_key ?? null, dto.tiempo_uso_dias ?? null,
        dto.fecha_retorno_esperada ?? null, estado, dto.observacion ?? null,
      ],
    );

    await this.actualizarInventario(clientId, dto);
    this.logger.log(`[F3] Movimiento ${dto.tipo} creado: ${res[0].id}`);

    if (dto.tipo === 'devolucion' && dto.proyecto_destino_id) {
      await this.calcularMermaProyecto(clientId, dto.sku_id, dto.proyecto_destino_id);
    }

    return res[0];
  }

  private async createTransfer(clientId: string, dto: CreateMovimientoDto) {
    if (!dto.bodega_origen_id || !dto.bodega_destino_id) {
      throw new BadRequestException('Transfer requiere bodega_origen_id y bodega_destino_id');
    }
    if (dto.bodega_origen_id === dto.bodega_destino_id) {
      throw new BadRequestException('Bodega origen y destino no pueden ser la misma');
    }
    await this.checkStock(clientId, dto.sku_id, dto.bodega_origen_id, dto.cantidad);

    const queryRunner = this.ds.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    // Fase 2 — este QueryRunner manual no pasa por el patch del ds: setear el GUC acá.
    await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [clientId]);
    try {
      // OUT from origin
      const outRes = await queryRunner.query(
        `INSERT INTO movimientos_pop
           (client_id, sku_id, persona_id, bodega_origen_id, tipo, cantidad, estado, observacion)
         VALUES ($1,$2,$3,$4,'salida',$5,'transfer_out',$6) RETURNING id`,
        [clientId, dto.sku_id, dto.persona_id ?? null, dto.bodega_origen_id, dto.cantidad,
         `Transfer a bodega ${dto.bodega_destino_id}. ${dto.observacion ?? ''}`],
      );

      // IN to destination
      const inRes = await queryRunner.query(
        `INSERT INTO movimientos_pop
           (client_id, sku_id, persona_id, bodega_origen_id, tipo, cantidad, estado, observacion)
         VALUES ($1,$2,$3,$4,'entrada',$5,'transfer_in',$6) RETURNING id`,
        [clientId, dto.sku_id, dto.persona_id ?? null, dto.bodega_destino_id, dto.cantidad,
         `Transfer desde bodega ${dto.bodega_origen_id}. ${dto.observacion ?? ''}`],
      );

      // Update inventory: subtract from origin
      await queryRunner.query(
        `INSERT INTO inventario (client_id, sku_id, bodega_id, cantidad, ultimo_movimiento_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (client_id, sku_id, bodega_id)
         DO UPDATE SET cantidad = inventario.cantidad + $4, ultimo_movimiento_at=NOW()`,
        [clientId, dto.sku_id, dto.bodega_origen_id, -dto.cantidad],
      );

      // Update inventory: add to destination
      await queryRunner.query(
        `INSERT INTO inventario (client_id, sku_id, bodega_id, cantidad, ultimo_movimiento_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (client_id, sku_id, bodega_id)
         DO UPDATE SET cantidad = inventario.cantidad + $4, ultimo_movimiento_at=NOW()`,
        [clientId, dto.sku_id, dto.bodega_destino_id, dto.cantidad],
      );

      await queryRunner.commitTransaction();
      this.logger.log(`[F3] Transfer completado: ${outRes[0].id} → ${inRes[0].id}`);
      return { out_id: outRes[0].id, in_id: inRes[0].id, type: 'transfer' };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  private async createAdjustment(clientId: string, dto: CreateMovimientoDto) {
    if (!dto.bodega_origen_id) {
      throw new BadRequestException('Adjustment requiere bodega_origen_id');
    }

    const inv = await this.ds.query(
      `SELECT cantidad FROM inventario WHERE client_id=$1 AND sku_id=$2 AND bodega_id=$3`,
      [clientId, dto.sku_id, dto.bodega_origen_id],
    );
    const currentQty = inv[0]?.cantidad ?? 0;
    const diff = dto.cantidad - currentQty;

    const res = await this.ds.query(
      `INSERT INTO movimientos_pop
         (client_id, sku_id, persona_id, bodega_origen_id, tipo, cantidad, estado, observacion)
       VALUES ($1,$2,$3,$4,'adjustment',$5,'adjustment',$6) RETURNING *`,
      [clientId, dto.sku_id, dto.persona_id ?? null, dto.bodega_origen_id, Math.abs(diff),
       `Ajuste: ${currentQty} → ${dto.cantidad}. ${dto.observacion ?? ''}`],
    );

    // Set inventory to exact quantity
    await this.ds.query(
      `INSERT INTO inventario (client_id, sku_id, bodega_id, cantidad, ultimo_movimiento_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (client_id, sku_id, bodega_id)
       DO UPDATE SET cantidad = $4, ultimo_movimiento_at=NOW()`,
      [clientId, dto.sku_id, dto.bodega_origen_id, dto.cantidad],
    );

    this.logger.log(`[F3] Adjustment: SKU ${dto.sku_id} bodega ${dto.bodega_origen_id}: ${currentQty} → ${dto.cantidad}`);
    return res[0];
  }

  private async checkStock(clientId: string, skuId: string, bodegaId: string, cantidad: number): Promise<void> {
    const inv = await this.ds.query(
      `SELECT cantidad FROM inventario WHERE client_id=$1 AND sku_id=$2 AND bodega_id=$3`,
      [clientId, skuId, bodegaId],
    );
    if (!inv.length || inv[0].cantidad < cantidad) {
      throw new BadRequestException(
        `Stock insuficiente en bodega. Disponible: ${inv[0]?.cantidad ?? 0}, requerido: ${cantidad}`,
      );
    }
  }

  private async actualizarInventario(clientId: string, dto: CreateMovimientoDto): Promise<void> {
    const delta = ['salida', 'consumo', 'merma'].includes(dto.tipo) ? -dto.cantidad : dto.cantidad;

    if (dto.bodega_origen_id) {
      await this.ds.query(
        `INSERT INTO inventario (client_id, sku_id, bodega_id, cantidad, ultimo_movimiento_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (client_id, sku_id, bodega_id)
         DO UPDATE SET cantidad = inventario.cantidad + $4, ultimo_movimiento_at=NOW()`,
        [clientId, dto.sku_id, dto.bodega_origen_id, delta],
      );
    }
  }

  /** Calcula merma para un SKU después de una devolución */
  async calcularMermaProyecto(clientId: string, skuId: string, proyectoId: string): Promise<void> {
    const salidas = await this.ds.query(
      `SELECT COALESCE(SUM(cantidad),0) as total FROM movimientos_pop
       WHERE client_id=$1 AND sku_id=$2 AND proyecto_destino_id=$3 AND tipo='salida'`,
      [clientId, skuId, proyectoId],
    );
    const devoluciones = await this.ds.query(
      `SELECT COALESCE(SUM(cantidad),0) as total FROM movimientos_pop
       WHERE client_id=$1 AND sku_id=$2 AND proyecto_destino_id=$3 AND tipo='devolucion'`,
      [clientId, skuId, proyectoId],
    );
    const consumos = await this.ds.query(
      `SELECT COALESCE(SUM(cantidad),0) as total FROM movimientos_pop
       WHERE client_id=$1 AND sku_id=$2 AND proyecto_destino_id=$3 AND tipo='consumo'`,
      [clientId, skuId, proyectoId],
    );

    const merma = parseInt(salidas[0].total) - parseInt(devoluciones[0].total) - parseInt(consumos[0].total);
    if (merma > 0) {
      await this.ds.query(
        `INSERT INTO movimientos_pop (client_id, sku_id, proyecto_destino_id, tipo, cantidad, estado, observacion)
         VALUES ($1,$2,$3,'merma',$4,'merma','Merma calculada automáticamente')`,
        [clientId, skuId, proyectoId, merma],
      );
      this.logger.warn(`[F3] Merma calculada: ${merma} unidades SKU ${skuId} proyecto ${proyectoId}`);
    }
  }

  /** Estado inventario actual (sku × bodega) */
  async inventarioActual(clientId: string) {
    return this.ds.query(
      `SELECT inv.*, s.codigo, s.nombre, s.cliente_final, s.valor_unitario, s.tipo as sku_tipo,
              b.nombre as bodega_nombre, b.tipo as bodega_tipo
       FROM inventario inv
       JOIN skus s ON s.id = inv.sku_id
       JOIN bodegas b ON b.id = inv.bodega_id
       WHERE inv.client_id=$1 AND inv.cantidad > 0
       ORDER BY b.nombre ASC, s.nombre ASC`,
      [clientId],
    );
  }

  /** Banner IA: análisis de merma últimos 30 días */
  async analisisMerma30Dias(clientId: string) {
    return this.ds.query(
      `SELECT s.nombre as sku_nombre, s.codigo,
              SUM(m.cantidad) FILTER (WHERE m.tipo='salida') as total_salidas,
              SUM(m.cantidad) FILTER (WHERE m.tipo='devolucion') as total_devoluciones,
              SUM(m.cantidad) FILTER (WHERE m.tipo='merma') as total_merma,
              ROUND(
                SUM(m.cantidad) FILTER (WHERE m.tipo='merma')::numeric /
                NULLIF(SUM(m.cantidad) FILTER (WHERE m.tipo='salida'), 0) * 100,
              2) as pct_merma,
              SUM(m.cantidad) FILTER (WHERE m.tipo='merma') * s.valor_unitario::numeric as valor_merma_clp
       FROM movimientos_pop m
       JOIN skus s ON s.id = m.sku_id
       WHERE m.client_id=$1 AND m.created_at >= NOW() - INTERVAL '30 days'
       GROUP BY s.id, s.nombre, s.codigo, s.valor_unitario
       HAVING SUM(m.cantidad) FILTER (WHERE m.tipo='merma') > 0
       ORDER BY valor_merma_clp DESC NULLS LAST`,
      [clientId],
    );
  }
}

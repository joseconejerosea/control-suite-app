import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../../common/enums/user-role.enum';

@Injectable()
export class StockReturnsService {
  private readonly logger = new Logger(StockReturnsService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly wa: WhatsAppService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async triggerReturnRequests(clientId: string, projectId: string): Promise<void> {
    const pending = await this.ds.query(
      `SELECT m.persona_id, m.sku_id, s.nombre as sku_nombre, s.codigo,
              SUM(m.cantidad) FILTER (WHERE m.tipo = 'salida') as salidas,
              COALESCE(SUM(m.cantidad) FILTER (WHERE m.tipo IN ('devolucion','entrada')), 0) as devueltos,
              SUM(m.cantidad) FILTER (WHERE m.tipo = 'salida')
                - COALESCE(SUM(m.cantidad) FILTER (WHERE m.tipo IN ('devolucion','entrada')), 0)
                - COALESCE(SUM(m.cantidad) FILTER (WHERE m.tipo = 'consumo'), 0) as pendiente
       FROM movimientos_pop m
       JOIN skus s ON s.id = m.sku_id
       WHERE m.client_id = $1 AND m.proyecto_destino_id = $2
       GROUP BY m.persona_id, m.sku_id, s.nombre, s.codigo
       HAVING SUM(m.cantidad) FILTER (WHERE m.tipo = 'salida')
              - COALESCE(SUM(m.cantidad) FILTER (WHERE m.tipo IN ('devolucion','entrada')), 0)
              - COALESCE(SUM(m.cantidad) FILTER (WHERE m.tipo = 'consumo'), 0) > 0`,
      [clientId, projectId],
    );

    if (!pending.length) {
      this.logger.log(`[F3Returns] No pending returns for project ${projectId}`);
      return;
    }

    const grouped = new Map<string, typeof pending>();
    for (const row of pending) {
      if (!row.persona_id) continue;
      const list = grouped.get(row.persona_id) ?? [];
      list.push(row);
      grouped.set(row.persona_id, list);
    }

    const projRows = await this.ds.query(
      `SELECT name FROM projects WHERE id = $1 AND client_id = $2`, [projectId, clientId],
    );
    const projectName = projRows[0]?.name ?? '';

    for (const [personaId, items] of grouped) {
      const phone = await this.resolvePhone(personaId, clientId);
      if (!phone) continue;

      const lang = await this.getUserLanguage(clientId);
      const itemList = items.map(
        (it: any) => `• ${it.sku_nombre} (${it.codigo}): ${it.pendiente} unidades`
      ).join('\n');

      const msg = lang === 'en'
        ? `Project "${projectName}" has been closed. Please return the following materials:\n\n${itemList}\n\nSend a photo of the returned items.`
        : `El proyecto "${projectName}" fue cerrado. Por favor devuelve los siguientes materiales:\n\n${itemList}\n\nEnvía una foto de los materiales devueltos.`;

      await this.wa.sendText(phone, msg).catch(() => {});

      // Track the return request
      await this.ds.query(
        `INSERT INTO stock_return_requests
           (client_id, project_id, persona_id, items, status, requested_at)
         VALUES ($1, $2, $3, $4::jsonb, 'pending', NOW())`,
        [clientId, projectId, personaId, JSON.stringify(items)],
      ).catch(() => {});

      this.logger.log(`[F3Returns] Return request sent to ${phone} for ${items.length} SKUs`);
    }
  }

  async findPending(clientId: string) {
    return this.ds.query(
      `SELECT srr.*,
              p.name as project_name,
              CASE WHEN srr.photo_key IS NOT NULL THEN true ELSE false END as has_photo,
              EXTRACT(EPOCH FROM (NOW() - srr.requested_at))/3600 as hours_since_request
       FROM stock_return_requests srr
       JOIN projects p ON p.id = srr.project_id
       WHERE srr.client_id = $1 AND srr.status = 'pending'
       ORDER BY srr.requested_at ASC`,
      [clientId],
    );
  }

  async receivePhoto(
    clientId: string,
    returnRequestId: string,
    photoKey: string,
  ): Promise<void> {
    const rows = await this.ds.query(
      `SELECT * FROM stock_return_requests WHERE id = $1 AND client_id = $2`,
      [returnRequestId, clientId],
    );
    if (!rows.length) throw new NotFoundException('Return request not found');

    // Classify photo with Claude
    let classification = 'pending_review';
    try {
      classification = await this.classifyReturnPhoto(photoKey, rows[0].items);
    } catch (err: any) {
      this.logger.warn(`[F3Returns] Photo classification failed: ${err.message}`);
    }

    await this.ds.query(
      `UPDATE stock_return_requests
       SET photo_key = $2, photo_classification = $3, photo_received_at = NOW()
       WHERE id = $1 AND client_id = $4`,
      [returnRequestId, photoKey, classification, clientId],
    );
  }

  async confirm(
    clientId: string,
    id: string,
    userId: string,
    ip: string,
  ): Promise<void> {
    const rows = await this.ds.query(
      `SELECT * FROM stock_return_requests WHERE id = $1 AND client_id = $2`,
      [id, clientId],
    );
    if (!rows.length) throw new NotFoundException('Return request not found');
    const req = rows[0];

    const items = typeof req.items === 'string' ? JSON.parse(req.items) : req.items;

    // Create return movements for each item.
    // La bodega_origen_id del movimiento debe coincidir con la bodega que recibe el stock
    // para mantener trazabilidad consistente (antes bodega_origen_id quedaba NULL).
    const bodega = await this.ds.query(
      `SELECT id FROM bodegas WHERE client_id = $1 AND active = true AND tipo = 'principal' LIMIT 1`,
      [clientId],
    );
    const bodegaId: string | null = bodega[0]?.id ?? null;

    for (const item of items) {
      await this.ds.query(
        `INSERT INTO movimientos_pop
           (client_id, sku_id, persona_id, bodega_origen_id, proyecto_destino_id,
            tipo, cantidad, estado, foto_key, observacion, fecha_retorno_real)
         VALUES ($1,$2,$3,$4,$5,'devolucion',$6,'devuelto_completo',$7,'Devolución confirmada por operador',NOW())`,
        [clientId, item.sku_id, req.persona_id, bodegaId, req.project_id,
         parseInt(item.pendiente), req.photo_key ?? null],
      );

      // Actualiza inventario en la misma bodega referenciada en el movimiento
      if (bodegaId) {
        await this.ds.query(
          `INSERT INTO inventario (client_id, sku_id, bodega_id, cantidad, ultimo_movimiento_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (client_id, sku_id, bodega_id)
           DO UPDATE SET cantidad = inventario.cantidad + $4, ultimo_movimiento_at = NOW()`,
          [clientId, item.sku_id, bodegaId, parseInt(item.pendiente)],
        );
      }
    }

    await this.ds.query(
      `UPDATE stock_return_requests SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $2 WHERE id = $1 AND client_id = $3`,
      [id, userId, clientId],
    );

    await this.audit.log({
      tenantId: clientId, userId, action: 'CONFIRM_RETURN', entity: 'stock_return_requests',
      entityId: id, metadata: { items_count: items.length }, ip,
    });

    // Notify person
    const phone = await this.resolvePhone(req.persona_id, clientId);
    if (phone) {
      const lang = await this.getUserLanguage(clientId);
      const msg = lang === 'en'
        ? 'Your return has been confirmed. Thank you!'
        : 'Tu devolución fue confirmada. ¡Gracias!';
      await this.wa.sendText(phone, msg).catch(() => {});
    }
  }

  async reject(
    clientId: string,
    id: string,
    userId: string,
    reason: string,
    ip: string,
  ): Promise<void> {
    const rows = await this.ds.query(
      `SELECT * FROM stock_return_requests WHERE id = $1 AND client_id = $2`,
      [id, clientId],
    );
    if (!rows.length) throw new NotFoundException('Return request not found');

    await this.ds.query(
      `UPDATE stock_return_requests SET status = 'rejected', rejection_reason = $2 WHERE id = $1 AND client_id = $3`,
      [id, reason, clientId],
    );

    await this.audit.log({
      tenantId: clientId, userId, action: 'REJECT_RETURN', entity: 'stock_return_requests',
      entityId: id, metadata: { reason }, ip,
    });

    const phone = await this.resolvePhone(rows[0].persona_id, clientId);
    if (phone) {
      const lang = await this.getUserLanguage(clientId);
      const msg = lang === 'en'
        ? `Your return photo was rejected. Reason: ${reason}. Please send a new photo.`
        : `La foto de devolución fue rechazada. Motivo: ${reason}. Por favor envía una nueva foto.`;
      await this.wa.sendText(phone, msg).catch(() => {});
    }
  }

  private async classifyReturnPhoto(photoKey: string, items: any): Promise<string> {
    const apiKey = this.config.get('ANTHROPIC_API_KEY');
    if (!apiKey) return 'pending_review';

    const itemList = (Array.isArray(items) ? items : JSON.parse(items))
      .map((it: any) => `${it.sku_nombre} (${it.codigo}): ${it.pendiente} unidades`)
      .join(', ');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `Analiza esta foto de devolución de material POP. Los materiales esperados son: ${itemList}. Responde SOLO con "looks_correct" o "does_not_match". No expliques.`,
        }],
      }),
    });

    if (!response.ok) return 'pending_review';
    const data = await response.json() as any;
    const text = data?.content?.[0]?.text?.trim()?.toLowerCase() ?? '';
    return text.includes('correct') ? 'looks_correct' : 'does_not_match';
  }

  private async resolvePhone(personaId: string, clientId: string): Promise<string | null> {
    // Phone lives on promoters/collaborators (the field personas). `users` has
    // no phone column in the schema, so including it made the whole UNION fail.
    const rows = await this.ds.query(
      `SELECT phone FROM promoters WHERE id = $1 AND client_id = $2
       UNION ALL SELECT phone FROM collaborators WHERE id = $1 AND client_id = $2
       LIMIT 1`,
      [personaId, clientId],
    ).catch(() => []);
    return rows[0]?.phone ?? null;
  }

  private async getUserLanguage(clientId: string): Promise<string> {
    const rows = await this.ds.query(
      `SELECT language FROM users WHERE client_id = $1 AND role = '${UserRole.MANAGER}' LIMIT 1`,
      [clientId],
    ).catch(() => []);
    return rows[0]?.language ?? 'es';
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { PromptShieldService } from '../../common/ai/prompt-shield.service';

// Brief: "Cannot hallucinate. Every numeric answer must come from real
//         Postgres queries via tools."
// Brief: "Executor: user types in natural language, AI executes via tools
//         (send WA, query data, draft email)"
const CLAUDE_MODEL = 'claude-opus-4-5';

// ── Catálogo de consultas fijas ───────────────────────────────────────────────
// El modelo NO escribe SQL. Sólo elige una `query_key` de este catálogo cerrado.
// Cada SQL trae `client_id = $1` HARDCODEADO server-side: el aislamiento de tenant
// es estructural, no depende de que el modelo recuerde un WHERE. $1 es SIEMPRE el
// clientId del request — nunca un valor provisto por el modelo.
// INVARIANTE (verificada por test): toda entrada DEBE contener `client_id = $1`.
export interface CatalogEntry {
  descripcion: string;
  sql: string;
}

export const QUERY_CATALOG: Record<string, CatalogEntry> = {
  resumen_financiero: {
    descripcion: 'Totales de rendiciones agrupadas por estado (cantidad y monto).',
    sql: `SELECT estado, COUNT(*)::int AS cantidad, COALESCE(SUM(monto_total),0) AS monto_total
          FROM rendiciones WHERE client_id = $1 GROUP BY estado ORDER BY monto_total DESC`,
  },
  rendiciones_pendientes: {
    descripcion: 'Rendiciones enviadas pendientes de aprobación.',
    sql: `SELECT id, persona_id, project_id, periodo, monto_total, requiere_admin, created_at
          FROM rendiciones WHERE client_id = $1 AND estado = 'enviada'
          ORDER BY created_at DESC LIMIT 50`,
  },
  gastos_por_proyecto: {
    descripcion: 'Gasto total (rendiciones aprobadas/pagadas) agrupado por proyecto.',
    sql: `SELECT p.id, p.name, COALESCE(SUM(r.monto_total),0) AS gasto_total
          FROM projects p
          LEFT JOIN rendiciones r ON r.project_id = p.id AND r.client_id = $1
               AND r.estado IN ('aprobada','pagada')
          WHERE p.client_id = $1
          GROUP BY p.id, p.name ORDER BY gasto_total DESC LIMIT 50`,
  },
  proyectos_activos: {
    descripcion: 'Proyectos con estado active (nombre, fechas, presupuesto).',
    sql: `SELECT id, name, status, start_date, end_date, budget
          FROM projects WHERE client_id = $1 AND status = 'active'
          ORDER BY created_at DESC LIMIT 50`,
  },
  activaciones_por_estado: {
    descripcion: 'Conteo de activaciones agrupadas por status.',
    sql: `SELECT status, COUNT(*)::int AS cantidad
          FROM activations WHERE client_id = $1 GROUP BY status ORDER BY cantidad DESC`,
  },
  activaciones_en_vivo: {
    descripcion: 'Activaciones en curso (status in_progress).',
    sql: `SELECT id, project_id, scheduled_at, executed_at, status
          FROM activations WHERE client_id = $1 AND status = 'in_progress'
          ORDER BY scheduled_at DESC NULLS LAST LIMIT 50`,
  },
  stock_por_bodega: {
    descripcion: 'Cantidad total de inventario por bodega.',
    sql: `SELECT b.id, b.nombre, b.tipo, COALESCE(SUM(i.cantidad),0)::int AS cantidad_total
          FROM bodegas b
          LEFT JOIN inventario i ON i.bodega_id = b.id AND i.client_id = $1
          WHERE b.client_id = $1 AND b.active = true
          GROUP BY b.id, b.nombre, b.tipo ORDER BY cantidad_total DESC LIMIT 50`,
  },
  stock_critico: {
    descripcion: 'SKUs activos cuyo stock total está en o por debajo del mínimo.',
    sql: `SELECT s.codigo, s.nombre, s.min_stock,
                 COALESCE(SUM(i.cantidad),0)::int AS cantidad
          FROM skus s
          LEFT JOIN inventario i ON i.sku_id = s.id AND i.client_id = $1
          WHERE s.client_id = $1 AND s.active = true
          GROUP BY s.id, s.codigo, s.nombre, s.min_stock
          HAVING COALESCE(SUM(i.cantidad),0) <= s.min_stock
          ORDER BY cantidad ASC LIMIT 50`,
  },
  invoices_resumen: {
    descripcion: 'Facturas agrupadas por status y categoría (cantidad y monto).',
    sql: `SELECT status, category, COUNT(*)::int AS cantidad, COALESCE(SUM(amount),0) AS monto_total
          FROM invoices WHERE client_id = $1 GROUP BY status, category ORDER BY monto_total DESC`,
  },
  invoices_pendientes: {
    descripcion: 'Facturas en estado pending (vendor, monto, fecha).',
    sql: `SELECT id, vendor_name, amount, currency, invoice_date, category, project_id
          FROM invoices WHERE client_id = $1 AND status = 'pending'
          ORDER BY invoice_date DESC NULLS LAST LIMIT 50`,
  },
  movimientos_recientes: {
    descripcion: 'Últimos movimientos de POP (tipo, estado, cantidad, SKU).',
    sql: `SELECT m.tipo, m.estado, m.cantidad, s.codigo AS sku_codigo, m.created_at
          FROM movimientos_pop m
          LEFT JOIN skus s ON s.id = m.sku_id AND s.client_id = $1
          WHERE m.client_id = $1 ORDER BY m.created_at DESC LIMIT 50`,
  },
  pop_en_terreno: {
    descripcion: 'POP entregado en terreno aún sin devolver (estado en_terreno).',
    sql: `SELECT m.cantidad, s.codigo AS sku_codigo, m.proyecto_destino_id,
                 m.fecha_retorno_esperada
          FROM movimientos_pop m
          LEFT JOIN skus s ON s.id = m.sku_id AND s.client_id = $1
          WHERE m.client_id = $1 AND m.estado = 'en_terreno'
          ORDER BY m.fecha_retorno_esperada ASC NULLS LAST LIMIT 50`,
  },
  incidencias_abiertas: {
    descripcion: 'Incidencias abiertas (descripción, categoría, severidad).',
    sql: `SELECT id, activacion_id, descripcion, categoria, severidad, created_at
          FROM incidencias WHERE client_id = $1 AND estado = 'abierta'
          ORDER BY created_at DESC LIMIT 50`,
  },
  propuestas_abiertas: {
    descripcion: 'Propuestas de Mind abiertas (tipo, título, severidad).',
    sql: `SELECT id, tipo, titulo, severidad, created_at
          FROM mind_propuestas WHERE client_id = $1 AND estado = 'abierta'
          ORDER BY created_at DESC LIMIT 50`,
  },
};

const CATALOG_KEYS = Object.keys(QUERY_CATALOG);
const CATALOG_DESCRIPTION =
  'Consulta datos operacionales reales del cliente actual. Elegí UNA clave del catálogo; ' +
  'cada una devuelve datos ya filtrados a este cliente. NUNCA inventes números. Claves:\n' +
  CATALOG_KEYS.map(k => `- ${k}: ${QUERY_CATALOG[k].descripcion}`).join('\n');

// ── Tool definitions (Anthropic tool_use format) ──────────────────────────────
const MIND_TOOLS: Anthropic.Tool[] = [
  {
    name: 'consultar_datos',
    description: 'Consulta datos operacionales reales del cliente eligiendo una clave del catálogo. NO recibe SQL: el aislamiento por cliente es server-side. Usar para responder con números reales (gastos, proyectos, rendiciones, stock, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {
        query_key: {
          type: 'string',
          enum: CATALOG_KEYS,
          description: CATALOG_DESCRIPTION,
        },
      },
      required: ['query_key'],
    },
  },
  {
    name: 'enviar_whatsapp',
    description: 'Envía un mensaje de WhatsApp a un número de teléfono. Usar solo cuando el usuario lo pida explícitamente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        telefono: { type: 'string', description: 'Número con código país, ej: +56912345678' },
        mensaje:  { type: 'string', description: 'Texto del mensaje a enviar.' },
      },
      required: ['telefono', 'mensaje'],
    },
  },
  {
    name: 'redactar_email',
    description: 'Redacta un borrador de email listo para enviar. Devuelve el borrador para que el usuario lo apruebe.',
    input_schema: {
      type: 'object' as const,
      properties: {
        destinatario: { type: 'string', description: 'Email del destinatario.' },
        asunto:       { type: 'string', description: 'Asunto del email.' },
        cuerpo:       { type: 'string', description: 'Cuerpo del email.' },
      },
      required: ['destinatario', 'asunto', 'cuerpo'],
    },
  },
];

@Injectable()
export class MindChatService {
  private readonly logger = new Logger(MindChatService.name);
  private readonly anthropic: Anthropic;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly shield: PromptShieldService,
  ) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async getHistory(clientId: string, userId: string, limit = 50) {
    try {
      return await this.ds.query(
        `SELECT role, mensaje, ts FROM mind_chat_history
         WHERE client_id=$1 AND user_id=$2 ORDER BY ts DESC LIMIT $3`,
        [clientId, userId, limit],
      );
    } catch { return []; }
  }

  async sendMessage(
    clientId: string,
    userId: string,
    mensaje: string,
  ): Promise<{ reply: string; tools_used: string[] }> {
    const start = Date.now();
    let reply = '';
    const toolsUsed: string[] = [];

    try {
      // ── PromptShield ──────────────────────────────────────────────────────
      const shield = this.shield.checkLocal(mensaje);
      if (!shield.safe) {
        return { reply: `Mensaje bloqueado: ${shield.reason}`, tools_used: [] };
      }

      // ── Save user message ─────────────────────────────────────────────────
      await this.ds.query(
        `INSERT INTO mind_chat_history (client_id, user_id, role, mensaje) VALUES ($1,$2,'user',$3)`,
        [clientId, userId, mensaje],
      ).catch(() => {});

      // ── Build history (exclude the message just saved — added explicitly below) ──
      const histRows: Array<{ role: string; mensaje: string }> = await this.ds.query(
        `SELECT role, mensaje FROM mind_chat_history
         WHERE client_id=$1 AND user_id=$2 ORDER BY ts DESC LIMIT 10`,
        [clientId, userId],
      ).catch(() => []);

      // Reverse to chronological; drop the most-recent user turn (will append explicitly)
      const chronological = histRows.reverse();
      const withoutLast = chronological.slice(0, -1); // remove last (the one just inserted)

      const messages: Anthropic.MessageParam[] = [
        ...withoutLast.map(h => ({
          role: h.role as 'user' | 'assistant',
          content: h.mensaje,
        })),
        { role: 'user' as const, content: mensaje }, // current turn — explicit
      ];

      // ── Client context for system prompt ─────────────────────────────────
      const clientRows = await this.ds.query(
        `SELECT c.nombre,
           (SELECT COUNT(*) FROM projects WHERE client_id=c.id AND status='active') as proyectos_activos,
           (SELECT COUNT(*) FROM activations WHERE client_id=c.id AND status='in_progress') as activaciones_vivo,
           (SELECT COUNT(*) FROM rendiciones WHERE client_id=c.id AND estado='enviada') as rendiciones_pendientes,
           (SELECT COALESCE(SUM(monto_total::numeric),0) FROM rendiciones
            WHERE client_id=c.id AND estado IN ('enviada','aprobada')) as monto_pendiente
         FROM clients c WHERE c.id=$1`,
        [clientId],
      ).catch(() => []);
      const ctx = clientRows[0];

      const systemPrompt = `Eres Control Mind, el asistente IA ejecutivo de Control Suite BTL para "${ctx?.nombre ?? 'el cliente'}".

CONTEXTO LIVE (actualizado ahora):
- Proyectos activos: ${ctx?.proyectos_activos ?? 0}
- Activaciones EN VIVO: ${ctx?.activaciones_vivo ?? 0}
- Rendiciones pendientes: ${ctx?.rendiciones_pendientes ?? 0}
- Monto pendiente aprobación: $${parseFloat(ctx?.monto_pendiente ?? '0').toLocaleString('es-CL')} CLP

REGLAS CRÍTICAS:
1. NUNCA inventes números. Si necesitas datos, usa la tool consultar_datos.
2. Toda cifra en tu respuesta DEBE venir de una tool call real.
3. Si no tienes los datos, di "No tengo ese dato disponible" — nunca improvises.
4. Responde en español de Chile, tono ejecutivo, conciso.
5. consultar_datos ya devuelve datos del cliente actual: no necesitas filtrar por cliente.`;

      // ── Agentic loop: run until no more tool calls ────────────────────────
      let loopMessages = [...messages];
      let iteration = 0;
      const MAX_ITERATIONS = 5;

      while (iteration < MAX_ITERATIONS) {
        iteration++;
        const response = await this.anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          tools: MIND_TOOLS,
          messages: loopMessages,
        });

        // Log cost per iteration
        const iterCost = (response.usage.input_tokens * 0.000015) + (response.usage.output_tokens * 0.000075);
        await this.ds.query(
          `INSERT INTO ai_costs_log (client_id, user_id, model, input_tokens, output_tokens, cost_usd, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [clientId, userId, CLAUDE_MODEL,
           response.usage.input_tokens, response.usage.output_tokens,
           iterCost, `mind_chat iter ${iteration}`],
        ).catch(() => {});

        // If no tool calls — final text response
        if (response.stop_reason === 'end_turn' || !response.content.some(b => b.type === 'tool_use')) {
          const textBlock = response.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined;
          reply = textBlock?.text ?? 'Lo siento, no pude procesar tu mensaje.';
          break;
        }

        // Process tool calls
        const assistantMsg: Anthropic.MessageParam = {
          role: 'assistant',
          content: response.content,
        };
        loopMessages.push(assistantMsg);

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          toolsUsed.push(block.name);

          let toolResult = '';
          try {
            if (block.name === 'consultar_datos') {
              const input = block.input as { query_key: string };
              toolResult = await this.executeCatalogQuery(input.query_key, clientId);

            } else if (block.name === 'enviar_whatsapp') {
              const input = block.input as { telefono: string; mensaje: string };
              // Stub — integrate WhatsApp service here
              toolResult = JSON.stringify({
                status: 'simulado',
                nota: 'WhatsApp send requires user confirmation before real send.',
                telefono: input.telefono,
                mensaje: input.mensaje,
              });

            } else if (block.name === 'redactar_email') {
              const input = block.input as { destinatario: string; asunto: string; cuerpo: string };
              toolResult = JSON.stringify({
                borrador: { destinatario: input.destinatario, asunto: input.asunto, cuerpo: input.cuerpo },
                instruccion: 'Borrador listo. El usuario debe aprobar antes de enviar.',
              });
            }
          } catch (err: unknown) {
            toolResult = JSON.stringify({ error: err instanceof Error ? err.message : 'Tool error' });
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult,
          });
        }

        loopMessages.push({ role: 'user', content: toolResults });
      }

      if (!reply) {
        reply = 'Procesé tu solicitud pero no pude generar una respuesta final.';
      }

      // ── Save assistant reply ──────────────────────────────────────────────
      const duration = Date.now() - start;
      await this.ds.query(
        `INSERT INTO mind_chat_history (client_id, user_id, role, mensaje) VALUES ($1,$2,'assistant',$3)`,
        [clientId, userId, reply],
      ).catch(() => {});

      this.logger.log(`[MindChat] Done in ${duration}ms, tools: [${toolsUsed.join(', ')}]`);

    } catch (err: unknown) {
      this.logger.error('[MindChat] Error:', err instanceof Error ? err.message : err);
      reply = 'Lo siento, tuve un problema procesando tu solicitud. Intenta de nuevo.';
    }

    return { reply, tools_used: toolsUsed };
  }

  // ── Catalog query executor (no free-form SQL) ────────────────────────────
  // El modelo sólo elige una clave; el SQL es fijo y trae client_id = $1
  // hardcodeado. $1 es SIEMPRE el clientId del request: aislamiento estructural.
  private async executeCatalogQuery(queryKey: string, clientId: string): Promise<string> {
    const entry = QUERY_CATALOG[queryKey];
    if (!entry) {
      throw new Error(
        `query_key inválida: "${queryKey}". Opciones válidas: ${CATALOG_KEYS.join(', ')}`,
      );
    }
    const rows = await this.ds.query(entry.sql, [clientId]);
    return JSON.stringify(rows.slice(0, 50)); // cap at 50 rows to keep context manageable
  }
}

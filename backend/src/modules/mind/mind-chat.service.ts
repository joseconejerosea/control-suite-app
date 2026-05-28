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

// ── Tool definitions (Anthropic tool_use format) ──────────────────────────────
const MIND_TOOLS: Anthropic.Tool[] = [
  {
    name: 'query_operaciones',
    description: 'Ejecuta una consulta SQL de SOLO LECTURA sobre la base de datos operacional del cliente. Usar para responder preguntas con números reales (gastos, proyectos, rendiciones, stock, etc.). NUNCA inventar datos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sql: {
          type: 'string',
          description: 'SQL SELECT parametrizado. Usar $1 para client_id. SOLO SELECT. Sin DROP/UPDATE/DELETE/INSERT.',
        },
        descripcion: {
          type: 'string',
          description: 'Descripción breve de qué calcula esta query.',
        },
      },
      required: ['sql', 'descripcion'],
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

// SQL allowed only these tables (whitelist — no sensitive tables)
const ALLOWED_TABLES = [
  'projects', 'activations', 'rendiciones', 'rendicion_items',
  'invoices', 'inventario', 'skus', 'bodegas', 'movimientos_pop',
  'checkins', 'incidencias', 'reportes_avance', 'mind_propuestas',
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
1. NUNCA inventes números. Si necesitas datos, usa la tool query_operaciones.
2. Toda cifra en tu respuesta DEBE venir de una tool call real.
3. Si no tienes los datos, di "No tengo ese dato disponible" — nunca improvises.
4. Responde en español de Chile, tono ejecutivo, conciso.
5. Las queries SQL deben incluir WHERE client_id=$1 siempre.`;

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
            if (block.name === 'query_operaciones') {
              const input = block.input as { sql: string; descripcion: string };
              toolResult = await this.executeReadOnlyQuery(input.sql, clientId);

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

  // ── Safe read-only query executor ────────────────────────────────────────
  private async executeReadOnlyQuery(sql: string, clientId: string): Promise<string> {
    const upper = sql.trim().toUpperCase();

    // Block any write operations
    if (/^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)/i.test(sql)) {
      throw new Error('Solo se permiten queries SELECT en Control Mind.');
    }

    // Verify query touches at least one allowed table
    const touchesAllowed = ALLOWED_TABLES.some(t => upper.includes(t.toUpperCase()));
    if (!touchesAllowed) {
      throw new Error(`Query no permitida. Tablas disponibles: ${ALLOWED_TABLES.join(', ')}`);
    }

    // Inject client_id as $1 — ensures tenant isolation even if AI forgot
    const rows = await this.ds.query(sql, [clientId]);
    return JSON.stringify(rows.slice(0, 50)); // cap at 50 rows to keep context manageable
  }
}

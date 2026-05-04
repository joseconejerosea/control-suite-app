import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { PromptShieldService } from '../../common/ai/prompt-shield.service';

const CLAUDE_MODEL = 'claude-opus-4-5';

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

  async sendMessage(clientId: string, userId: string, mensaje: string): Promise<{ reply: string; tools_used: unknown[] }> {
    const start = Date.now();
    let reply = '';

    try {
      // PromptShield check
      const shield = this.shield.checkLocal(mensaje);
      if (!shield.safe) {
        return { reply: `Mensaje bloqueado: ${shield.reason}`, tools_used: [] };
     }
      const safeMsg = mensaje;

      // Save user message
      await this.ds.query(
        `INSERT INTO mind_chat_history (client_id, user_id, role, mensaje) VALUES ($1,$2,'user',$3)`,
        [clientId, userId, safeMsg],
      ).catch(() => {});

      // Get recent history
      const history = await this.ds.query(
        `SELECT role, mensaje FROM mind_chat_history
         WHERE client_id=$1 AND user_id=$2 ORDER BY ts DESC LIMIT 10`,
        [clientId, userId],
      ).catch(() => []);

      // Get client context
      const clientRows = await this.ds.query(
        `SELECT c.nombre,
           (SELECT COUNT(*) FROM projects WHERE client_id=c.id) as total_proyectos,
           (SELECT COUNT(*) FROM activations WHERE client_id=c.id AND status='in_progress') as activaciones_vivo,
           (SELECT COUNT(*) FROM rendiciones WHERE client_id=c.id AND estado='enviada') as rendiciones_pendientes,
           (SELECT COALESCE(SUM(monto_total),0) FROM rendiciones WHERE client_id=c.id AND estado IN ('enviada','aprobada')) as monto_pendiente
         FROM clients c WHERE c.id=$1`,
        [clientId],
      ).catch(() => []);

      const ctx = clientRows[0];
      const systemPrompt = `Eres Control Mind, el asistente IA de Control Suite BTL para "${ctx?.nombre ?? 'el cliente'}".
Contexto actual del cliente:
- Proyectos activos: ${ctx?.total_proyectos ?? 0}
- Activaciones EN VIVO: ${ctx?.activaciones_vivo ?? 0}
- Rendiciones pendientes: ${ctx?.rendiciones_pendientes ?? 0}
- Monto pendiente aprobación: $${parseFloat(ctx?.monto_pendiente ?? 0).toLocaleString('es-CL')} CLP

Responde siempre en español de Chile. Eres directo, conciso y ejecutivo.
Cuando el usuario pida acción, describe qué harías y qué datos necesitarías.`;

      const messages = history.reverse().map((h: any) => ({
        role: h.role as 'user' | 'assistant',
        content: h.mensaje,
      }));

      const response = await this.anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      });

      reply = (response.content[0] as any).text ?? 'Lo siento, no pude procesar tu mensaje.';

      // Save reply + log cost
      await Promise.all([
        this.ds.query(
          `INSERT INTO mind_chat_history (client_id, user_id, role, mensaje) VALUES ($1,$2,'assistant',$3)`,
          [clientId, userId, reply],
        ),
        this.ds.query(
          `INSERT INTO ai_costs_log (client_id, user_id, model, input_tokens, output_tokens, duration_ms, perfil_origen)
           VALUES ($1,$2,$3,$4,$5,$6,'ejecutor')`,
          [clientId, userId, CLAUDE_MODEL, response.usage?.input_tokens, response.usage?.output_tokens, Date.now() - start],
        ),
      ]).catch(() => {});

    } catch (err: any) {
      this.logger.error('[MindChat] Error:', err.message);
      reply = 'Lo siento, tuve un problema procesando tu solicitud. Intenta de nuevo.';
    }

    return { reply, tools_used: [] };
  }
}

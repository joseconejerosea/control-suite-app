import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WhatsappOutputService } from './whatsapp-output.service';

/**
 * Broadcast de notificaciones a los operadores (admin_cliente) de un tenant.
 *
 * Centraliza el patrón que estaba duplicado en rendiciones, projects, la
 * convocatoria-classify y el webhook: buscar teléfonos de admin_cliente y mandar
 * WhatsApp. Va a través de WhatsappOutputService, así cada aviso es idempotente
 * (lock por evento+destinatario) — si un job reintenta, el operador no recibe el
 * mismo aviso dos veces.
 */
@Injectable()
export class OperatorNotifierService {
  private readonly logger = new Logger(OperatorNotifierService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly waOutput: WhatsappOutputService,
  ) {}

  /**
   * Notifica a todos los operadores del tenant. `dedupKey` identifica el evento
   * lógico (p.ej. `f5-borrador:<reporteId>`) para que el aviso salga una sola vez.
   */
  async notificar(clientId: string, message: string, dedupKey: string): Promise<number> {
    const admins = await this.getAdminPhones(clientId);
    for (const admin of admins) {
      await this.waOutput.sendTextOnce(admin.phone, message, `notif:${dedupKey}:${admin.phone}`);
    }
    if (!admins.length) {
      this.logger.warn(`[Notify] Sin operadores con teléfono para tenant=${clientId} (${dedupKey})`);
    }
    return admins.length;
  }

  /** Teléfonos de los admin_cliente del tenant con phone registrado. */
  private async getAdminPhones(clientId: string): Promise<{ phone: string }[]> {
    return this.ds.query(
      `SELECT phone FROM users
        WHERE client_id=$1 AND role='admin_cliente' AND phone IS NOT NULL`,
      [clientId],
    ).catch(() => []);
  }
}

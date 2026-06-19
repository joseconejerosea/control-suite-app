import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AddItemDto,
  RechazarRendicionDto,
  MarcarPagadaDto,
  RendicionFiltersDto,
} from './dto/rendicion.dto';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { runWithTenant, runAsSystem } from '../../common/tenant/tenant-context';
import PDFDocument from 'pdfkit';

@Injectable()
export class RendicionesService {
  private readonly logger = new Logger(RendicionesService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly wa: WhatsAppService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Agrupación automática: llamado desde F1 persist processor
  // ─────────────────────────────────────────────────────────────────────────
  async asignarFacturaARendicion(
    clientId: string,
    invoiceId: string,
    personaId: string,
    projectId: string | null,
    monto: number,
    fechaFactura: string,
  ): Promise<void> {
    if (!projectId) {
      this.logger.warn(`[F2] Invoice ${invoiceId} sin proyecto — quedará sin agrupar`);
      return;
    }

    // Calcular semana ISO (e.g. 2026-W43)
    const periodo = this.isoWeek(new Date(fechaFactura));

    // findOrCreate rendicion para (client, persona, project, semana)
    let rendicion = await this.ds.query(
      `SELECT id, monto_total FROM rendiciones
       WHERE client_id=$1 AND persona_id=$2 AND project_id=$3 AND periodo=$4 AND estado='borrador'
       LIMIT 1`,
      [clientId, personaId, projectId, periodo],
    );

    let rendicionId: string;
    if (rendicion.length === 0) {
      const res = await this.ds.query(
        `INSERT INTO rendiciones (client_id, persona_id, project_id, periodo, estado)
         VALUES ($1,$2,$3,$4,'borrador') RETURNING id`,
        [clientId, personaId, projectId, periodo],
      );
      rendicionId = res[0].id;
      this.logger.log(`[F2] Nueva rendición creada: ${rendicionId}`);
    } else {
      rendicionId = rendicion[0].id;
    }

    // Agregar item
    await this.ds.query(
      `INSERT INTO rendicion_items (client_id, rendicion_id, invoice_id, monto)
       VALUES ($1,$2,$3,$4)`,
      [clientId, rendicionId, invoiceId, monto],
    );

    // Recalcular total
    await this.recalcTotal(rendicionId, clientId);
    this.logger.log(`[F2] Invoice ${invoiceId} asignada a rendición ${rendicionId}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cierre semanal automático (dom 23:59 — llamar desde cron)
  // ─────────────────────────────────────────────────────────────────────────
  async cerrarRendicionesSemana(): Promise<void> {
    const periodoActual = this.isoWeek(new Date());
    // Fase 2: la lista de borradores es cross-tenant (pool de sistema, solo lectura).
    const borradores = await runAsSystem(() =>
      this.ds.query(
        `SELECT id, client_id, project_id, monto_total
         FROM rendiciones
         WHERE estado='borrador' AND periodo < $1`,
        [periodoActual],
      ),
    );

    for (const r of borradores) {
      // Cada cierre corre en la tx del tenant dueño.
      await runWithTenant(this.ds, r.client_id, async () => {
        await this.ds.query(
          `UPDATE rendiciones SET estado='enviada', updated_at=NOW() WHERE id=$1`,
          [r.id],
        );
        await this.decidirAprobacion(r.id, r.client_id, r.project_id, parseFloat(r.monto_total));
      });
    }
    this.logger.log(`[F2] Cerradas ${borradores.length} rendiciones de semanas pasadas`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Aprobación auto vs manual
  // ─────────────────────────────────────────────────────────────────────────
  private async decidirAprobacion(
    rendicionId: string,
    clientId: string,
    projectId: string | null,
    montoRendicion: number,
  ): Promise<void> {
    if (!projectId) {
      // sin proyecto → queda en enviada esperando admin
      return;
    }

    // Obtener presupuesto del proyecto
    const proj = await this.ds.query(
      `SELECT budget FROM projects WHERE id=$1 AND client_id=$2`,
      [projectId, clientId],
    );
    if (!proj.length || !proj[0].budget) return;

    const presupuesto = parseFloat(proj[0].budget);

    // Sumar gasto acumulado en ese proyecto (rendiciones aprobadas + pagadas)
    const acum = await this.ds.query(
      `SELECT COALESCE(SUM(monto_total),0) as total
       FROM rendiciones
       WHERE project_id=$1 AND client_id=$2 AND estado IN ('aprobada','pagada')`,
      [projectId, clientId],
    );
    const gastoAcumulado = parseFloat(acum[0].total);
    const gastoSiAprueba = gastoAcumulado + montoRendicion;
    const pct = presupuesto > 0 ? (gastoSiAprueba / presupuesto) * 100 : null;

    if (gastoSiAprueba <= presupuesto) {
      await this.ds.query(
        `UPDATE rendiciones
         SET estado='aprobada', aprobada_auto=true, aprobada_at=NOW(),
             porcentaje_presupuesto=$2, updated_at=NOW()
         WHERE id=$1`,
        [rendicionId, pct],
      );
      this.logger.log(`[F2] Auto-aprobada rendición ${rendicionId} (${pct?.toFixed(1)}% presupuesto)`);
    } else {
      const excede = gastoSiAprueba - presupuesto;
      await this.ds.query(
        `UPDATE rendiciones
         SET requiere_admin=true, excede_por_clp=$2, porcentaje_presupuesto=$3, updated_at=NOW()
         WHERE id=$1`,
        [rendicionId, excede, pct],
      );
      this.logger.warn(`[F2] Rendición ${rendicionId} excede presupuesto en $${excede.toLocaleString('es-CL')}`);

      await this.notifyBudgetExceeded(clientId, projectId, rendicionId, pct ?? 0, excede);
    }
  }

  private async notifyBudgetExceeded(
    clientId: string,
    projectId: string,
    rendicionId: string,
    pct: number,
    excedeClp: number,
  ): Promise<void> {
    try {
      const proj = await this.ds.query(
        `SELECT name FROM projects WHERE id = $1 AND client_id = $2`, [projectId, clientId],
      );
      const projectName = proj[0]?.name ?? 'Sin nombre';

      // Dashboard alert via mind_propuestas
      await this.ds.query(
        `INSERT INTO mind_propuestas
           (client_id, tipo, titulo, descripcion, datos_soporte, prioridad, estado, created_at)
         VALUES ($1, 'alerta_presupuesto', $2, $3, $4::jsonb, 'alta', 'pendiente', NOW())
         ON CONFLICT DO NOTHING`,
        [
          clientId,
          `Presupuesto excedido: ${projectName}`,
          `La rendición supera el presupuesto del proyecto en $${Math.round(excedeClp).toLocaleString('es-CL')} CLP (${pct.toFixed(1)}% del budget). Requiere aprobación manual.`,
          JSON.stringify({
            project_id: projectId,
            rendicion_id: rendicionId,
            porcentaje: pct,
            excede_clp: excedeClp,
          }),
        ],
      ).catch(() => {});

      // WhatsApp notification to admin
      const admins = await this.ds.query(
        `SELECT u.phone, u.language FROM users u
         WHERE u.client_id = $1 AND u.role = 'admin_cliente' AND u.phone IS NOT NULL`,
        [clientId],
      ).catch(() => []);

      for (const admin of admins) {
        if (!admin.phone) continue;
        const msg = admin.language === 'en'
          ? `Budget alert: Project "${projectName}" exceeded budget by $${Math.round(excedeClp).toLocaleString('es-CL')} CLP (${pct.toFixed(1)}%). Manual approval required.`
          : `Alerta presupuesto: Proyecto "${projectName}" excede el budget en $${Math.round(excedeClp).toLocaleString('es-CL')} CLP (${pct.toFixed(1)}%). Requiere aprobación manual.`;
        await this.wa.sendText(admin.phone, msg).catch(() => {});
      }
    } catch (err: any) {
      this.logger.warn(`[F2] Budget notification failed: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────────────────────────────────
  async findAll(clientId: string, filters: RendicionFiltersDto) {
    let q = `
      SELECT r.*,
             p.name as project_name,
             COUNT(ri.id) as num_items
      FROM rendiciones r
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN rendicion_items ri ON ri.rendicion_id = r.id
      WHERE r.client_id = $1
    `;
    const params: unknown[] = [clientId];
    let i = 2;

    if (filters.persona_id) { q += ` AND r.persona_id = $${i++}`; params.push(filters.persona_id); }
    if (filters.project_id) { q += ` AND r.project_id = $${i++}`; params.push(filters.project_id); }
    if (filters.estado)     { q += ` AND r.estado = $${i++}`;     params.push(filters.estado); }
    if (filters.periodo)    { q += ` AND r.periodo = $${i++}`;    params.push(filters.periodo); }

    q += ` GROUP BY r.id, p.name ORDER BY r.created_at DESC`;
    return this.ds.query(q, params);
  }

  async findOne(clientId: string, id: string) {
    const rows = await this.ds.query(
      `SELECT r.*, p.name as project_name
       FROM rendiciones r
       LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.id = $1 AND r.client_id = $2`,
      [id, clientId],
    );
    if (!rows.length) throw new NotFoundException(`Rendición ${id} no encontrada`);
    const rendicion = rows[0];
    rendicion.items = await this.ds.query(
      `SELECT ri.*, i.vendor_name, i.invoice_date, i.category
       FROM rendicion_items ri
       LEFT JOIN invoices i ON i.id = ri.invoice_id
       WHERE ri.rendicion_id = $1 AND ri.client_id = $2`,
      [id, clientId],
    );
    return rendicion;
  }

  async cerrarManual(clientId: string, id: string): Promise<void> {
    const r = await this.findOne(clientId, id);
    if (r.estado !== 'borrador') throw new BadRequestException('Solo borradores se pueden cerrar');
    await this.ds.query(
      `UPDATE rendiciones SET estado='enviada', updated_at=NOW() WHERE id=$1 AND client_id=$2`,
      [id, clientId],
    );
    await this.decidirAprobacion(id, clientId, r.project_id, parseFloat(r.monto_total));
  }

  async aprobar(clientId: string, id: string, userId: string): Promise<void> {
    const r = await this.findOne(clientId, id);
    if (!['enviada'].includes(r.estado)) throw new BadRequestException('Solo rendiciones enviadas se pueden aprobar');
    await this.ds.query(
      `UPDATE rendiciones
       SET estado='aprobada', aprobada_at=NOW(), aprobada_por_user_id=$2, aprobada_auto=false, updated_at=NOW()
       WHERE id=$1 AND client_id=$3`,
      [id, userId, clientId],
    );
  }

  async rechazar(clientId: string, id: string, dto: RechazarRendicionDto): Promise<void> {
    await this.findOne(clientId, id);
    await this.ds.query(
      `UPDATE rendiciones
       SET estado='rechazada', rechazada_at=NOW(), rechazada_motivo=$2, updated_at=NOW()
       WHERE id=$1 AND client_id=$3`,
      [id, dto.motivo, clientId],
    );
  }

  async marcarPagada(clientId: string, id: string, dto: MarcarPagadaDto): Promise<void> {
    const r = await this.findOne(clientId, id);
    if (r.estado !== 'aprobada') throw new BadRequestException('Solo rendiciones aprobadas se pueden marcar pagadas');
    await this.ds.query(
      `UPDATE rendiciones
       SET estado='pagada', pagada_at=NOW(), comprobante_pago_key=$2, updated_at=NOW()
       WHERE id=$1 AND client_id=$3`,
      [id, dto.comprobante_pago_key ?? null, clientId],
    );
  }

  async kpis(clientId: string) {
    const res = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE estado='borrador')  as borrador,
         COUNT(*) FILTER (WHERE estado='enviada')   as enviada,
         COUNT(*) FILTER (WHERE estado='aprobada')  as aprobada,
         COUNT(*) FILTER (WHERE estado='pagada')    as pagada,
         COUNT(*) FILTER (WHERE estado='rechazada') as rechazada,
         COALESCE(SUM(monto_total) FILTER (WHERE estado='aprobada'),0) as monto_aprobado_total
       FROM rendiciones WHERE client_id=$1`,
      [clientId],
    );
    return res[0];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Export PDF
  // ─────────────────────────────────────────────────────────────────────────
  async exportPdf(clientId: string, id: string): Promise<Buffer> {
    const rendicion = await this.findOne(clientId, id);
    const items = rendicion.items ?? [];

    const clientRows = await this.ds.query(
      `SELECT nombre FROM clients WHERE id = $1`, [clientId],
    ).catch(() => []);
    const clientName = clientRows[0]?.nombre ?? 'Cliente';

    const personaRows = await this.ds.query(
      `SELECT full_name AS persona_name FROM users WHERE id = $1 AND client_id = $2
       UNION ALL SELECT name AS persona_name FROM promoters WHERE id = $1 AND client_id = $2
       LIMIT 1`,
      [rendicion.persona_id, clientId],
    ).catch(() => []);
    const personaName = personaRows[0]?.persona_name ?? rendicion.persona_id?.slice(0, 8) ?? '—';

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(18).text('Rendición de Gastos', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#666')
        .text(`Control Suite · ${clientName}`, { align: 'center' });
      doc.moveDown(1.5);

      // Info
      doc.fillColor('#000').fontSize(11);
      doc.text(`Período: ${rendicion.periodo}`);
      doc.text(`Proyecto: ${rendicion.project_name ?? '—'}`);
      doc.text(`Persona: ${personaName}`);
      doc.text(`Estado: ${rendicion.estado.toUpperCase()}`);
      doc.text(`Total: $${Number(rendicion.monto_total).toLocaleString('es-CL')} CLP`);
      if (rendicion.porcentaje_presupuesto) {
        doc.text(`% Presupuesto: ${Number(rendicion.porcentaje_presupuesto).toFixed(1)}%`);
      }
      doc.moveDown(1);

      // Table header
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ccc');
      doc.moveDown(0.3);
      const headerY = doc.y;
      doc.fontSize(9).fillColor('#666');
      doc.text('Fecha', 50, headerY, { width: 80 });
      doc.text('Proveedor', 130, headerY, { width: 180 });
      doc.text('Categoría', 310, headerY, { width: 100 });
      doc.text('Monto', 420, headerY, { width: 120, align: 'right' });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ccc');
      doc.moveDown(0.3);

      // Rows
      doc.fillColor('#000').fontSize(9);
      for (const item of items) {
        if (doc.y > 720) {
          doc.addPage();
        }
        const rowY = doc.y;
        doc.text(item.invoice_date ?? '—', 50, rowY, { width: 80 });
        doc.text(item.vendor_name ?? item.descripcion ?? '—', 130, rowY, { width: 180 });
        doc.text(item.category ?? '—', 310, rowY, { width: 100 });
        doc.text(`$${Number(item.monto).toLocaleString('es-CL')}`, 420, rowY, { width: 120, align: 'right' });
        doc.moveDown(0.6);
      }

      // Footer line
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#ccc');
      doc.moveDown(0.5);
      doc.fontSize(11).text(
        `TOTAL: $${Number(rendicion.monto_total).toLocaleString('es-CL')} CLP`,
        { align: 'right' },
      );

      doc.moveDown(2);
      doc.fontSize(8).fillColor('#999')
        .text(`Generado por Control Suite · ${new Date().toLocaleDateString('es-CL')}`, { align: 'center' });

      doc.end();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  private async recalcTotal(rendicionId: string, clientId: string): Promise<void> {
    await this.ds.query(
      `UPDATE rendiciones
       SET monto_total = (
         SELECT COALESCE(SUM(monto),0) FROM rendicion_items WHERE rendicion_id=$1 AND client_id=$2
       ), updated_at=NOW()
       WHERE id=$1 AND client_id=$2`,
      [rendicionId, clientId],
    );
  }

  private isoWeek(date: Date): string {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
}

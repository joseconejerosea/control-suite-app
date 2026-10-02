/// <reference types="jest" />
import { DataSource } from 'typeorm';
import { DashboardService } from './dashboard.service';

/**
 * KPI "Staff activo" (Matriz v1.4): antes contaba promotores CON activación asignada
 * (JOIN activations) → subcontaba (decía 2 cuando había 6 activos). Debe contar los
 * promotores ACTIVOS de la agencia (status='active'), sin JOIN y sin filtro por proyecto.
 */
describe('DashboardService — KPI Staff activo (active_promoters)', () => {
  function build() {
    const queryMock = jest.fn((sql: string, _params?: any[]) => {
      // La query de KPIs devuelve una fila con todos los contadores.
      if (sql.includes('active_promoters')) {
        return Promise.resolve([{ active_promoters: 6 }]);
      }
      // eventsByDay / activationsByWeek → arrays vacíos.
      return Promise.resolve([]);
    });
    const ds = { query: (sql: string, params?: any[]) => queryMock(sql, params) } as unknown as DataSource;
    return { svc: new DashboardService(ds), queryMock };
  }

  it('cuenta promotores con status=\'active\' (no el JOIN a activations)', async () => {
    const { svc, queryMock } = build();

    const res = await svc.overview('client-1', {} as any);

    // El valor sale de la query corregida.
    expect(res.kpis.active_promoters).toBe(6);

    // Regresión: la subquery de active_promoters usa promoters.status='active' y NO el
    // JOIN a activations por promoter_id (que subcontaba).
    const kpiCall = queryMock.mock.calls.find(([sql]: [string]) => String(sql).includes('active_promoters'));
    expect(kpiCall).toBeDefined();
    const sql = String(kpiCall![0]);
    const promoterBlock = sql.slice(sql.indexOf('FROM promoters'), sql.indexOf('AS active_promoters'));
    expect(promoterBlock).toContain("status = 'active'");
    expect(promoterBlock).not.toContain('JOIN activations');
    expect(promoterBlock).not.toContain('promoter_id');
  });
});

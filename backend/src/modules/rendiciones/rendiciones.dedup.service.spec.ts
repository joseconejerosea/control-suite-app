/// <reference types="jest" />
import { RendicionesService } from './rendiciones.service';

/**
 * T10 — Dedup de boletas al agrupar. asignarFacturaARendicion NO debe meter la
 * misma invoice_id dos veces (reproceso del persist / doble evento). El insert
 * lleva un guard WHERE NOT EXISTS; si no inserta (dup), se omite el recálculo.
 */
describe('RendicionesService.asignarFacturaARendicion — dedup por invoice_id', () => {
  function make(dup: boolean) {
    const query = jest.fn((sql: string) => {
      if (/FROM rendiciones/i.test(sql) && /borrador/i.test(sql)) {
        return Promise.resolve([{ id: 'r1', monto_total: '0' }]); // rendición existente
      }
      if (/INSERT INTO rendicion_items/i.test(sql)) {
        return Promise.resolve(dup ? [] : [{ id: 'it1' }]); // guard NOT EXISTS
      }
      return Promise.resolve([]);
    });
    const svc = new RendicionesService({ query } as any, {} as any, {} as any);
    return { svc, query };
  }

  const call = (svc: RendicionesService) =>
    svc.asignarFacturaARendicion('c1', 'inv-1', 'persona-1', 'proj-1', 15000, '2026-08-15');

  it('inserta con guard NOT EXISTS y recalcula cuando la invoice es nueva', async () => {
    const { svc, query } = make(false);
    await call(svc);
    const insertSql = query.mock.calls.map((c) => String(c[0])).find((s) => /INSERT INTO rendicion_items/i.test(s));
    expect(insertSql).toMatch(/NOT EXISTS/i);
    expect(insertSql).toMatch(/invoice_id/i);
  });

  it('cuando la invoice ya estaba (dup), NO recalcula ni corre queries extra', async () => {
    const nonDup = make(false);
    await call(nonDup.svc);
    const dup = make(true);
    await call(dup.svc);
    // El camino dup corta antes del recálculo → hace menos queries que el normal.
    expect(dup.query.mock.calls.length).toBeLessThan(nonDup.query.mock.calls.length);
  });
});

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

// ─── C2 (v1.9) — reasignación manual de la activación de un gasto ──────────────
describe('RendicionesService.reasignarActivacion', () => {
  function make(itemEstado: string | null) {
    const query = jest.fn((sql: string) => {
      if (/UPDATE invoices SET activation_id/i.test(sql)) return Promise.resolve([]);
      if (/FROM invoices WHERE id/i.test(sql)) return Promise.resolve([{ id: 'inv-1', project_id: 'proj-1' }]);
      if (/FROM activations WHERE id/i.test(sql)) return Promise.resolve([{ id: 'act-9' }]);
      if (/FROM rendicion_items ri/i.test(sql)) {
        return Promise.resolve(
          itemEstado
            ? [{ item_id: 'it-1', rendicion_id: 'r-old', persona_id: 'p-1', project_id: 'proj-1', periodo: '2026-W37', estado: itemEstado }]
            : [],
        );
      }
      // target find: rendiciones con IS NOT DISTINCT FROM → no existe, se crea
      if (/FROM rendiciones/i.test(sql) && /IS NOT DISTINCT FROM/i.test(sql)) return Promise.resolve([]);
      if (/INSERT INTO rendiciones/i.test(sql)) return Promise.resolve([{ id: 'r-new' }]);
      return Promise.resolve([]);
    });
    const svc = new RendicionesService({ query } as any, {} as any, {} as any);
    return { svc, query };
  }

  it('rendición en borrador → actualiza la factura, mueve el ítem y recalcula (regrouped=true)', async () => {
    const { svc, query } = make('borrador');
    const res = await svc.reasignarActivacion('c1', 'inv-1', 'act-9');

    expect(res).toEqual({ invoice_id: 'inv-1', activation_id: 'act-9', regrouped: true });
    // Actualizó la factura.
    expect(query.mock.calls.some(([s]) => /UPDATE invoices SET activation_id/i.test(String(s)))).toBe(true);
    // Movió el ítem a la nueva rendición.
    expect(query.mock.calls.some(([s]) => /UPDATE rendicion_items SET rendicion_id/i.test(String(s)))).toBe(true);
    // Recalculó totales (dos veces: vieja y nueva).
    const recalcs = query.mock.calls.filter(([s]) => /UPDATE rendiciones\s+SET monto_total/i.test(String(s)));
    expect(recalcs.length).toBe(2);
  });

  it('rendición NO borrador → actualiza la factura pero NO re-agrupa (regrouped=false)', async () => {
    const { svc, query } = make('enviada');
    const res = await svc.reasignarActivacion('c1', 'inv-1', 'act-9');

    expect(res.regrouped).toBe(false);
    expect(query.mock.calls.some(([s]) => /UPDATE invoices SET activation_id/i.test(String(s)))).toBe(true);
    // No movió ningún ítem.
    expect(query.mock.calls.some(([s]) => /UPDATE rendicion_items SET rendicion_id/i.test(String(s)))).toBe(false);
  });

  it('boleta inexistente → NotFoundException', async () => {
    const query = jest.fn(() => Promise.resolve([])); // invoice no existe
    const svc = new RendicionesService({ query } as any, {} as any, {} as any);
    await expect(svc.reasignarActivacion('c1', 'inv-x', null)).rejects.toThrow();
  });
});

// ─── P17 (v1.9) — imagen de la boleta por el link correcto ────────────────────
describe('RendicionesService.getBoletaImagen (P17)', () => {
  it('resuelve por ec.factura_id + storage_path (raw_event_id y doc_key son null)', async () => {
    const query = jest.fn((_sql?: string) =>
      Promise.resolve([{ doc_key: null, doc_mime_type: null, raw_payload: { storage_path: 't/documents/x.jpg', mime_type: 'image/jpeg' } }]),
    );
    const download = jest.fn().mockResolvedValue(Buffer.from('img-bytes'));
    const svc = new RendicionesService({ query } as any, {} as any, { download } as any);

    const res = await svc.getBoletaImagen('c1', 'inv-1');

    expect(res.mimeType).toBe('image/jpeg');
    expect(res.buffer.length).toBeGreaterThan(0);
    expect(download).toHaveBeenCalledWith('t/documents/x.jpg');
    // El SELECT ahora joinea por factura_id (link poblado), no por raw_event_id.
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/ec\.factura_id\s*=\s*i\.id/);
    expect(sql).not.toMatch(/raw_event_id/);
  });

  it('sin evento ligado → NotFoundException', async () => {
    const query = jest.fn(() => Promise.resolve([]));
    const svc = new RendicionesService({ query } as any, {} as any, { download: jest.fn() } as any);
    await expect(svc.getBoletaImagen('c1', 'inv-x')).rejects.toThrow();
  });
});

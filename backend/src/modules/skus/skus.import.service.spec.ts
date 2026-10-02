/// <reference types="jest" />
import * as XLSX from 'xlsx';
import { SkusService } from './skus.service';

/**
 * T13 — Importador de SKU por Excel. importExcel parsea un .xlsx (base64), mapea
 * headers case-insensitive (Codigo/Nombre requeridos; Cliente Final/Stock Minimo/
 * Tipo opcionales), crea los SKUs con ON CONFLICT (dedup por código) y devuelve
 * un resumen { creados, omitidos, errores }.
 */
function makeXlsxBase64(rows: any[]): string {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SKUs');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return Buffer.from(buf).toString('base64');
}

describe('SkusService.importExcel — carga masiva por Excel', () => {
  function make() {
    const seen = new Set<string>();
    const query = jest.fn((sql: string, params?: any[]) => {
      if (/INSERT INTO skus/i.test(sql)) {
        const codigo = params?.[1];
        if (seen.has(codigo)) return Promise.resolve([]); // ON CONFLICT DO NOTHING
        seen.add(codigo);
        return Promise.resolve([{ id: `sku-${codigo}` }]);
      }
      return Promise.resolve([]);
    });
    return { svc: new SkusService({ query } as any), query };
  }

  it('crea las filas válidas, omite duplicados y reporta inválidas', async () => {
    const { svc } = make();
    const b64 = makeXlsxBase64([
      { Codigo: 'MAT-001', Nombre: 'Afiche A3', 'Stock Minimo': 5 },
      { Codigo: 'MAT-002', Nombre: 'Banner', Tipo: 'consumible' },
      { Codigo: 'MAT-001', Nombre: 'Afiche dup' }, // duplicado (mismo código)
      { Codigo: '', Nombre: 'Sin codigo' },          // inválida
    ]);
    const res = await svc.importExcel('c1', b64);
    expect(res.creados).toBe(2);
    expect(res.omitidos).toBe(1);
    expect(res.errores).toHaveLength(1);
    expect(res.errores[0].fila).toBe(5); // header + 3 filas de datos, base-1
  });

  it('mapea headers case-insensitive y con acentos/variantes', async () => {
    const { svc, query } = make();
    const b64 = makeXlsxBase64([{ 'código': 'X-1', material: 'Material X', 'cliente final': 'ACME' }]);
    const res = await svc.importExcel('c1', b64);
    expect(res.creados).toBe(1);
    const insert = query.mock.calls.find((c) => /INSERT INTO skus/i.test(String(c[0])));
    expect(insert?.[1]).toEqual(['c1', 'X-1', 'Material X', 'ACME', 'reusable', 5]);
  });

  it('no importa nada (sin crashear) si el archivo no tiene filas válidas', async () => {
    const { svc } = make();
    const res = await svc.importExcel('c1', Buffer.from('no soy excel').toString('base64'));
    expect(res.creados).toBe(0);
    expect(res.total).toBe(0);
  });
});

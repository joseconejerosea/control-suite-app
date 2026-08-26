/// <reference types="jest" />
/**
 * Spec del EquivalenciasController tras alinear al schema real de `equivalencias_ocr_cc`
 * (keyword, categoria, destino[enum destino_reporte], confidence_boost). Antes escribía
 * columnas inexistentes (texto_ocr, proveedor_homologado...) → todo POST daba 500.
 */
import { BadRequestException } from '@nestjs/common';
import { EquivalenciasController } from './equivalencias.controller';

const USER = { client_id: 'client-1' } as any;

function makeController(queryImpl?: (sql: string, params?: unknown[]) => Promise<unknown[]>) {
  const query = jest.fn(queryImpl ?? (async () => [{ id: 'eq-1' }]));
  const ds = { query } as any;
  return { ctrl: new EquivalenciasController(ds), query };
}

describe('EquivalenciasController · schema real (Anexo)', () => {
  describe('create()', () => {
    it('inserta con las columnas reales y castea destino al enum', async () => {
      const { ctrl, query } = makeController();

      await ctrl.create(USER, { keyword: 'flete', categoria: 'Logística', destino: 'costos', confidence_boost: 0.2 });

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO equivalencias_ocr_cc');
      expect(sql).toContain('keyword, categoria, destino, confidence_boost');
      expect(sql).toContain('$4::destino_reporte');
      // NO debe mencionar las columnas viejas inexistentes
      expect(sql).not.toContain('texto_ocr');
      expect(sql).not.toContain('proveedor_homologado');
      expect(params).toEqual(['client-1', 'flete', 'Logística', 'costos', 0.2]);
    });

    it('usa el default 0.10 de boost cuando no se envía', async () => {
      const { ctrl, query } = makeController();
      await ctrl.create(USER, { keyword: 'k', categoria: 'c', destino: 'gastos' });
      const params = (query.mock.calls[0] as [string, unknown[]])[1];
      expect(params[4]).toBe(0.1);
    });

    it('rechaza un destino fuera del enum', async () => {
      const { ctrl, query } = makeController();
      await expect(
        ctrl.create(USER, { keyword: 'k', categoria: 'c', destino: 'rrhh' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(query).not.toHaveBeenCalled();
    });

    it('rechaza keyword vacío y destino ausente', async () => {
      const { ctrl } = makeController();
      await expect(ctrl.create(USER, { categoria: 'c', destino: 'gastos' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(ctrl.create(USER, { keyword: 'k', categoria: 'c' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update()', () => {
    it('valida destino sólo si viene, y castea en el COALESCE', async () => {
      const { ctrl, query } = makeController();
      await ctrl.update(USER, 'eq-1', { keyword: 'nuevo', destino: 'ventas' });

      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('COALESCE($3::destino_reporte, destino)');
      expect(params).toEqual(['nuevo', null, 'ventas', null, 'eq-1', 'client-1']);
    });

    it('un PATCH sin destino no lo valida y pasa null (COALESCE conserva)', async () => {
      const { ctrl, query } = makeController();
      await ctrl.update(USER, 'eq-1', { categoria: 'otra' });
      const params = (query.mock.calls[0] as [string, unknown[]])[1];
      expect(params[2]).toBeNull();
    });

    it('rechaza un destino inválido en el PATCH', async () => {
      const { ctrl } = makeController();
      await expect(ctrl.update(USER, 'eq-1', { destino: 'basura' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

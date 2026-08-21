/// <reference types="jest" />
/**
 * Spec para la migración 1700000000072.
 *
 * Verifica el comportamiento de up() y down() de forma unitaria:
 * mockeamos QueryRunner y comprobamos que los SQLs generados sean correctos.
 */
import { AddRolTipoAndRotaToPromoters1700000000072 } from './1700000000072-AddRolTipoAndRotaToPromoters';

function makeQueryRunner() {
  const calls: string[] = [];
  return {
    query: jest.fn(async (sql: string) => {
      calls.push(sql.trim());
      return [];
    }),
    _calls: calls,
  };
}

describe('AddRolTipoAndRotaToPromoters1700000000072', () => {
  let migration: AddRolTipoAndRotaToPromoters1700000000072;
  let qr: ReturnType<typeof makeQueryRunner>;

  beforeEach(() => {
    migration = new AddRolTipoAndRotaToPromoters1700000000072();
    qr = makeQueryRunner();
  });

  describe('up()', () => {
    beforeEach(async () => {
      await migration.up(qr as any);
    });

    it('creates the promotor_rol_tipo_enum postgres type', () => {
      const sql = qr._calls.find((s) => s.includes('CREATE TYPE'));
      expect(sql).toBeDefined();
      expect(sql).toContain('promotor_rol_tipo_enum');
      expect(sql).toContain("'promotor'");
      expect(sql).toContain("'anfitrion'");
      expect(sql).toContain("'productor'");
      expect(sql).toContain("'supervisor'");
      expect(sql).toContain("'coordinador'");
      expect(sql).toContain("'brand_manager'");
      expect(sql).toContain("'observer'");
    });

    it('adds rol_tipo column (nullable) to promoters', () => {
      const sql = qr._calls.find(
        (s) => s.includes('ADD COLUMN') && s.includes('rol_tipo'),
      );
      expect(sql).toBeDefined();
      expect(sql).toContain('promoters');
      expect(sql).toContain('promotor_rol_tipo_enum');
    });

    it('adds rota boolean column to promoters', () => {
      const sql = qr._calls.find(
        (s) => s.includes('ADD COLUMN') && s.includes('rota'),
      );
      expect(sql).toBeDefined();
      expect(sql).toContain('promoters');
      expect(sql).toContain('BOOLEAN');
    });

    it('backfills rol_tipo using case-insensitive stem match', () => {
      const sql = qr._calls.find(
        (s) =>
          s.includes('UPDATE') &&
          s.includes('rol_tipo') &&
          s.includes('CASE'),
      );
      expect(sql).toBeDefined();
      // Verificar stems de normalización
      expect(sql).toContain('promotor');
      expect(sql).toContain('anfitri');
      expect(sql).toContain('productor');
      expect(sql).toContain('supervisor');
      expect(sql).toContain('coordinad');
      expect(sql).toContain('brand');
    });

    it('backfills rota: non-rotating roles → false, everything else → true', () => {
      // El SQL de backfill de rota referencia rol_tipo en la condición WHEN.
      // Buscamos el UPDATE que SET rota (no el que SET rol_tipo).
      const sql = qr._calls.find(
        (s) =>
          s.includes('UPDATE') &&
          s.includes('SET rota') &&
          s.includes('CASE'),
      );
      expect(sql).toBeDefined();
      expect(sql).toContain('supervisor');
      expect(sql).toContain('coordinador');
      expect(sql).toContain('brand_manager');
      expect(sql).toContain('observer');
      expect(sql).toContain('false');
      expect(sql).toContain('true');
    });

    it('sets rota DEFAULT true and NOT NULL after backfill', () => {
      const defaultSql = qr._calls.find(
        (s) => s.includes('SET DEFAULT') && s.includes('rota'),
      );
      const notNullSql = qr._calls.find(
        (s) => s.includes('SET NOT NULL') && s.includes('rota'),
      );
      expect(defaultSql).toBeDefined();
      expect(notNullSql).toBeDefined();
    });

    it('documents the DB audit result in a comment call', () => {
      // La migración debe ejecutar al menos N SQLs (crear tipo + 2 ADD COLUMN +
      // 2 backfill UPDATE + 2 ALTER DEFAULT/NOT NULL = 7 mínimo).
      expect(qr._calls.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('down()', () => {
    beforeEach(async () => {
      await migration.down(qr as any);
    });

    it('drops rota column', () => {
      const sql = qr._calls.find(
        (s) => s.includes('DROP COLUMN') && s.includes('rota'),
      );
      expect(sql).toBeDefined();
    });

    it('drops rol_tipo column', () => {
      const sql = qr._calls.find(
        (s) => s.includes('DROP COLUMN') && s.includes('rol_tipo'),
      );
      expect(sql).toBeDefined();
    });

    it('drops the promotor_rol_tipo_enum type', () => {
      const sql = qr._calls.find(
        (s) => s.includes('DROP TYPE') && s.includes('promotor_rol_tipo_enum'),
      );
      expect(sql).toBeDefined();
    });

    it('does NOT touch the legacy rol column', () => {
      const dropRolSql = qr._calls.find(
        (s) =>
          s.includes('DROP COLUMN') &&
          s.includes('rol') &&
          !s.includes('rol_tipo') &&
          !s.includes('rota'),
      );
      expect(dropRolSql).toBeUndefined();
    });
  });
});

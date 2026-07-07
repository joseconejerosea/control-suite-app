import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProyectosLiveView1700000000044 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE VIEW vw_proyectos_live AS
      SELECT
        m.client_id,
        m.sku_id,
        s.nombre          AS sku_nombre,
        s.codigo,
        s.cliente_final,
        m.proyecto_destino_id,
        p.name            AS proyecto_nombre,
        m.persona_id,
        m.cantidad,
        m.fecha_retorno_esperada,
        m.bodega_origen_id,
        b.nombre          AS bodega_origen_nombre,
        m.created_at      AS salida_at
      FROM movimientos_pop m
      JOIN skus s     ON s.id = m.sku_id
      JOIN projects p ON p.id = m.proyecto_destino_id
      LEFT JOIN bodegas b ON b.id = m.bodega_origen_id
      WHERE m.estado = 'en_terreno'
        AND m.tipo   = 'salida'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS vw_proyectos_live`);
  }
}

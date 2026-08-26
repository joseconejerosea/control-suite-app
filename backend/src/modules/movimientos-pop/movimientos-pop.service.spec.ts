/// <reference types="jest" />
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { MovimientosPopService } from './movimientos-pop.service';

const CLIENT = 'client-1';

function makeService() {
  const queryMock = jest.fn(async (sql: string) => {
    if (String(sql).includes('INSERT INTO movimientos_pop')) return [{ id: 'mov-1' }];
    if (String(sql).includes('next_correlativo')) return [{ next_correlativo: 1 }];
    return [];
  });
  const ds = { query: queryMock } as unknown as DataSource;
  return { svc: new MovimientosPopService(ds), queryMock };
}

const inserted = (queryMock: jest.Mock) =>
  queryMock.mock.calls.some(([s]: [string]) => String(s).includes('INSERT INTO movimientos_pop'));

describe('MovimientosPopService.create — T12 bodega obligatoria', () => {
  const base = { sku_id: 'sku-1', cantidad: 5 };

  it.each(['entrada', 'salida', 'devolucion'])(
    'rechaza "%s" SIN bodega y NO inserta',
    async (tipo) => {
      const { svc, queryMock } = makeService();
      await expect(
        svc.create(CLIENT, { ...base, tipo } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(inserted(queryMock)).toBe(false);
    },
  );

  it('permite "consumo" SIN bodega (no la requiere)', async () => {
    const { svc, queryMock } = makeService();
    await svc.create(CLIENT, { ...base, tipo: 'consumo' } as any);
    expect(inserted(queryMock)).toBe(true);
  });

  it('permite "entrada" CON bodega', async () => {
    const { svc, queryMock } = makeService();
    await svc.create(CLIENT, { ...base, tipo: 'entrada', bodega_origen_id: 'bod-1' } as any);
    expect(inserted(queryMock)).toBe(true);
  });
});

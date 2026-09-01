/// <reference types="jest" />
import { MovimientosPopController } from './movimientos-pop.controller';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

/**
 * F3 (Matriz v1.4): los movimientos del panel no registraban quién los hizo. La AUDITORÍA
 * va en created_by_user_id = usuario autenticado (H5: nunca del body), SEPARADO de persona_id
 * (el field-person que alimenta las devoluciones de stock) — así una salida de bodega del
 * manager NO le dispara a él un pedido de devolución.
 */
describe('MovimientosPopController — F3 responsable (manual)', () => {
  it('setea created_by_user_id = user.sub (auditoría), sin tocar persona_id', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'mov-1' });
    const controller = new MovimientosPopController({ create } as any);

    const user = { sub: 'user-42', client_id: 'client-1' } as unknown as JwtPayload;
    // persona_id (field-person) pasa tal cual; created_by lo fija el server.
    const dto = { sku_id: 'sku-1', tipo: 'salida', cantidad: 5, persona_id: 'promotor-9' } as any;

    await controller.create(user, dto);

    expect(create).toHaveBeenCalledTimes(1);
    const [clientId, passedDto] = create.mock.calls[0];
    expect(clientId).toBe('client-1');
    // Auditoría = usuario autenticado.
    expect(passedDto.created_by_user_id).toBe('user-42');
    // persona_id (field-person) NO se pisa → las devoluciones siguen apuntando al promotor.
    expect(passedDto.persona_id).toBe('promotor-9');
  });

  it('created_by_user_id lo fija el server aunque el body intente colar otro (H5)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'mov-2' });
    const controller = new MovimientosPopController({ create } as any);
    const user = { sub: 'user-42', client_id: 'client-1' } as unknown as JwtPayload;
    const dto = { sku_id: 'sku-1', tipo: 'entrada', cantidad: 1, created_by_user_id: 'ATACANTE' } as any;

    await controller.create(user, dto);

    const [, passedDto] = create.mock.calls[0];
    expect(passedDto.created_by_user_id).toBe('user-42');
    expect(passedDto.created_by_user_id).not.toBe('ATACANTE');
  });
});

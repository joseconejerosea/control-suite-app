/// <reference types="jest" />
import { MovimientosPopController } from './movimientos-pop.controller';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';

/**
 * F3 (Matriz v1.4): los movimientos creados desde el panel guardaban persona_id=null
 * ("responsable" no capturado). El endpoint manual debe setear persona_id = usuario
 * autenticado (convención H5: NUNCA aceptar persona_id del body).
 */
describe('MovimientosPopController — F3 responsable (manual)', () => {
  it('setea persona_id = user.sub en el movimiento manual (ignora el body)', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'mov-1' });
    const controller = new MovimientosPopController({ create } as any);

    const user = { sub: 'user-42', client_id: 'client-1' } as unknown as JwtPayload;
    // El body intenta colar otro persona_id — debe ser ignorado.
    const dto = { sku_id: 'sku-1', tipo: 'entrada', cantidad: 5, persona_id: 'ATACANTE' } as any;

    await controller.create(user, dto);

    expect(create).toHaveBeenCalledTimes(1);
    const [clientId, passedDto] = create.mock.calls[0];
    expect(clientId).toBe('client-1');
    expect(passedDto.persona_id).toBe('user-42');
    expect(passedDto.persona_id).not.toBe('ATACANTE');
  });
});

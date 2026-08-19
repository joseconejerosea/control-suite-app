/// <reference types="jest" />
import { RendicionesService } from './rendiciones.service';

/**
 * T11 — Recordatorio de pendientes de pago. notificarPendientesDePagoCliente avisa
 * al manager cuántas rendiciones aprobadas siguen sin pagar (digest semanal por
 * WhatsApp). No manda nada si no hay ninguna.
 */
describe('RendicionesService.notificarPendientesDePagoCliente — digest de pendientes de pago', () => {
  function make(num: number, total: string) {
    const sendText = jest.fn().mockResolvedValue(true);
    const query = jest.fn((sql: string) => {
      if (/estado = 'aprobada'/i.test(sql) && /COUNT/i.test(sql)) return Promise.resolve([{ num, total }]);
      if (/FROM users/i.test(sql)) return Promise.resolve([{ phone: '56999', language: 'es' }]);
      return Promise.resolve([]);
    });
    const svc = new RendicionesService({ query } as any, { sendText } as any, {} as any);
    return { svc, sendText };
  }

  it('avisa al manager con num + total cuando hay aprobadas sin pagar', async () => {
    const { svc, sendText } = make(2, '35000');
    const res = await svc.notificarPendientesDePagoCliente('c1');
    expect(res).toEqual({ num: 2, total: 35000 });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][1]).toMatch(/pendiente.*pago/i);
    expect(sendText.mock.calls[0][1]).toMatch(/35\.000/);
  });

  it('no notifica cuando no hay aprobadas pendientes', async () => {
    const { svc, sendText } = make(0, '0');
    const res = await svc.notificarPendientesDePagoCliente('c1');
    expect(res.num).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
  });
});

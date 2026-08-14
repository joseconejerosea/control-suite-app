/// <reference types="jest" />
import { ProjectsService } from './projects.service';

/**
 * T5 — F4 convocatoria send. The convocatoria state must reflect DELIVERY, not
 * intent: it only becomes 'enviada' when the WhatsApp send returned true. A
 * failed send (Meta rejection / missing template) leaves the row untouched
 * (stays 'pendiente', retryable) and is reported as an error.
 */
describe('ProjectsService.enviarConvocatoria — status reflects delivery', () => {
  const clientId = 'client-1';
  const projectId = 'proj-1';
  const item = { persona_id: 'promo-1', dia: '2026-08-20', local_nombre: 'L', local_direccion: 'D' };

  let query: jest.Mock;
  let waEnviar: jest.Mock;
  let service: ProjectsService;

  /**
   * dataSource.query is polymorphic here. Route by SQL text:
   *  - projects SELECT → an approved project (passes the human gate)
   *  - promoters SELECT → a promoter with a phone
   *  - everything else (the convocatorias UPDATE) → resolves []
   * The UPDATE spy is what we assert on.
   */
  function makeService(sendOk: boolean): void {
    query = jest.fn((sql: string) => {
      if (/FROM projects/i.test(sql)) {
        return Promise.resolve([{ name: 'Proyecto', aprobado_por_user_id: 'u1', aprobado_at: new Date() }]);
      }
      if (/FROM promoters/i.test(sql)) {
        return Promise.resolve([{ name: 'Ana', phone: '5491100000000' }]);
      }
      return Promise.resolve([]); // UPDATE convocatorias
    });

    waEnviar = jest.fn().mockResolvedValue(sendOk);

    const dataSource = { query, getRepository: jest.fn().mockReturnValue({}) } as any;
    const wa = { enviarConvocatoria: waEnviar } as any;
    const waOutput = { guard: jest.fn().mockResolvedValue(true) } as any;
    const stockReturns = {} as any;

    service = new ProjectsService(dataSource, wa, waOutput, stockReturns);
  }

  const updateCalls = () =>
    query.mock.calls.filter(([sql]) => /UPDATE convocatorias[\s\S]*estado='enviada'/i.test(sql));

  it('marks estado=enviada and counts it as sent when the WhatsApp send succeeds', async () => {
    makeService(true);

    const res = await service.enviarConvocatoria(clientId, projectId, [item], 'ai');

    expect(waEnviar).toHaveBeenCalledTimes(1);
    expect(updateCalls()).toHaveLength(1);
    expect(res.enviados).toBe(1);
    expect(res.errores).toBe(0);
    expect(res.detalle[0]).toMatchObject({ persona_id: 'promo-1', ok: true });
  });

  it('does NOT mark enviada and counts an error when the WhatsApp send fails', async () => {
    makeService(false);

    const res = await service.enviarConvocatoria(clientId, projectId, [item], 'ai');

    expect(waEnviar).toHaveBeenCalledTimes(1);
    expect(updateCalls()).toHaveLength(0); // row stays 'pendiente', retryable
    expect(res.enviados).toBe(0);
    expect(res.errores).toBe(1);
    expect(res.detalle[0]).toMatchObject({ persona_id: 'promo-1', ok: false });
    expect((res.detalle[0] as any).error).toMatch(/whatsapp/i);
  });
});

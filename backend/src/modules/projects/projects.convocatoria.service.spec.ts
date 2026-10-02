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

/**
 * T6 — Anti-choque de anfitrión. A promoter cannot be convoked to two activations
 * in DIFFERENT projects on the SAME date. Before approving + sending, convocarAnfitriones
 * detects such clashes (non-terminal convocatorias of the SAME client in OTHER projects
 * that share persona+dia) and short-circuits with { conflicts:[...] } WITHOUT approving
 * or sending — unless force=true, which proceeds anyway (the operator confirmed).
 */
describe('ProjectsService.convocarAnfitriones — anti-choque de anfitrión', () => {
  const clientId = 'client-1';
  const projectId = 'proj-1';
  const userId = 'user-1';
  const items = [{ persona_id: 'promo-1', dia: '2026-08-20', local_nombre: 'L', local_direccion: 'D' }];

  let query: jest.Mock;
  let waEnviar: jest.Mock;
  let service: ProjectsService;

  const conflictRow = {
    convocatoria_id: 'conv-9',
    proyecto_id: 'proj-2',
    proyecto_nombre: 'Otro Proyecto',
    persona_id: 'promo-1',
    persona_nombre: 'Ana',
    dia: '2026-08-20',
    local_nombre: 'Otro Local',
    estado: 'confirmada',
  };

  /**
   * Route dataSource.query by SQL text:
   *  - the choque SELECT (convocatorias c JOIN projects pr … unnest) → hasConflict ? [row] : []
   *  - projects SELECT (aprobarProyecto / enviarConvocatoria gate) → approved project
   *  - promoters SELECT (enviarConvocatoria) → a promoter with phone
   *  - everything else (approval UPDATE, asignarTurno INSERTs, convocatorias UPDATE) → []
   */
  function makeService(hasConflict: boolean): void {
    query = jest.fn((sql: string) => {
      if (/FROM convocatorias c[\s\S]*unnest/i.test(sql)) {
        return Promise.resolve(hasConflict ? [conflictRow] : []);
      }
      if (/FROM projects/i.test(sql)) {
        return Promise.resolve([{ id: projectId, config: {}, name: 'Proyecto', aprobado_por_user_id: 'u1', aprobado_at: new Date() }]);
      }
      if (/FROM promoters/i.test(sql)) {
        return Promise.resolve([{ name: 'Ana', phone: '5491100000000' }]);
      }
      return Promise.resolve([]);
    });

    waEnviar = jest.fn().mockResolvedValue(true);

    const dataSource = { query, getRepository: jest.fn().mockReturnValue({}) } as any;
    const wa = { enviarConvocatoria: waEnviar } as any;
    const waOutput = { guard: jest.fn().mockResolvedValue(true) } as any;
    const stockReturns = {} as any;

    service = new ProjectsService(dataSource, wa, waOutput, stockReturns);
  }

  const approvalUpdates = () =>
    query.mock.calls.filter(([sql]) => /UPDATE projects[\s\S]*ia_status/i.test(sql));

  it('returns conflicts and does NOT approve or send when a clash exists and force is false', async () => {
    makeService(true);

    const res = await service.convocarAnfitriones(clientId, projectId, userId, items, 'c');

    expect(res.conflicts).toEqual([conflictRow]);
    expect(res.enviados).toBe(0);
    // Short-circuited: no approval UPDATE ran, and no WhatsApp went out.
    expect(approvalUpdates()).toHaveLength(0);
    expect(waEnviar).not.toHaveBeenCalled();
  });

  it('proceeds (approves + sends) when a clash exists but force is true', async () => {
    makeService(true);

    const res = await service.convocarAnfitriones(clientId, projectId, userId, items, 'c', true);

    expect(res.conflicts).toBeUndefined();
    expect(approvalUpdates().length).toBeGreaterThan(0);
    expect(waEnviar).toHaveBeenCalledTimes(1);
    expect(res.enviados).toBe(1);
  });

  it('proceeds normally when there is no clash', async () => {
    makeService(false);

    const res = await service.convocarAnfitriones(clientId, projectId, userId, items, 'c');

    expect(res.conflicts).toBeUndefined();
    expect(approvalUpdates().length).toBeGreaterThan(0);
    expect(waEnviar).toHaveBeenCalledTimes(1);
    expect(res.enviados).toBe(1);
  });
});

/// <reference types="jest" />
import { DataSource, QueryRunner } from 'typeorm';
import { EvidenceIntakeService } from './evidence-intake.service';
import { WhatsAppSession } from './whatsapp-session.service';

const PHONE = '5492216205665';
const CLIENT = 'client-1';

describe('EvidenceIntakeService', () => {
  let svc: EvidenceIntakeService;
  let store: Record<string, WhatsAppSession>;
  let queryMock: jest.Mock;
  let sessions: any;
  let wa: any;

  const promoterRow = [{ id: 'prom-1' }];

  beforeEach(() => {
    store = {};
    sessions = {
      get: jest.fn(async (p: string) => store[p] ?? null),
      set: jest.fn(async (p: string, s: WhatsAppSession) => { store[p] = s; }),
      delete: jest.fn(async (p: string) => { delete store[p]; }),
    };

    // Por defecto: promotor encontrado + 1 activación activa.
    queryMock = jest.fn((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM promoters')) return Promise.resolve(promoterRow);
      if (sql.includes('FROM activations')) {
        return Promise.resolve([{ id: 'act-1', activation_date: '2026-07-29' }]);
      }
      if (sql.includes('INSERT INTO checkins')) return Promise.resolve([{ id: 'chk-1' }]);
      return Promise.resolve([]);
    });

    const makeQueryRunner = (): QueryRunner =>
      ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        isTransactionActive: true,
        query: (sql: string, params?: any[]) => queryMock(sql, params),
      }) as unknown as QueryRunner;

    const ds = {
      createQueryRunner: jest.fn(() => makeQueryRunner()),
      query: (sql: string, params?: any[]) => queryMock(sql, params),
    } as unknown as DataSource;

    wa = { sendText: jest.fn().mockResolvedValue(true) };

    svc = new EvidenceIntakeService(ds, wa, sessions);
  });

  it('with a known promoter + exactly 1 activación auto-selects and asks for observacion', async () => {
    await svc.start({ eventoCrudoId: 'evt-1', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'evidence/x.jpg', suggestedLabel: 'anfitrionas' });

    expect(store[PHONE].evidenceIntake?.step).toBe('observacion');
    expect(store[PHONE].evidenceIntake?.activacionId).toBe('act-1');
    expect(store[PHONE].evidenceIntake?.personaId).toBe('prom-1');
    // Pregunta la observación (opcional).
    const asked = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(asked).toContain('Evidencia recibida');
  });

  it('with ≥2 activaciones sends a numbered list and waits on the activacion step', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM promoters')) return Promise.resolve(promoterRow);
      if (sql.includes('FROM activations')) {
        return Promise.resolve([
          { id: 'act-1', activation_date: '2026-07-29' },
          { id: 'act-2', activation_date: '2026-07-28' },
        ]);
      }
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-2', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'evidence/y.jpg' });

    expect(store[PHONE].evidenceIntake?.step).toBe('activacion');
    expect(store[PHONE].evidenceIntake?.activaciones?.length).toBe(2);
    const list = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(list).toContain('1.');
    expect(list).toContain('2.');
  });

  it('falls back to the client active activación when the promoter has none directly assigned', async () => {
    // La data real trae activaciones con promoter_id en null: nivel 1 (por promotor)
    // no matchea, nivel 2 (por cliente) sí. Mismo criterio que el check-in por GPS.
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM promoters')) return Promise.resolve(promoterRow);
      if (sql.includes('FROM activations') && sql.includes('promoter_id')) return Promise.resolve([]);
      if (sql.includes('FROM activations')) return Promise.resolve([{ id: 'act-cli', activation_date: '2026-07-29' }]);
      if (sql.includes('INSERT INTO checkins')) return Promise.resolve([{ id: 'chk-1' }]);
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-8', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'evidence/f.jpg' });

    expect(store[PHONE]?.evidenceIntake?.step).toBe('observacion');
    expect(store[PHONE]?.evidenceIntake?.activacionId).toBe('act-cli');
    expect(store[PHONE]?.evidenceIntake?.personaId).toBe('prom-1');
  });

  it('with 0 activaciones escalates and does NOT set a session', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM promoters')) return Promise.resolve(promoterRow);
      if (sql.includes('FROM activations')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-3', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'evidence/z.jpg' });

    expect(store[PHONE]).toBeUndefined();
    const escalated = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='escalated'"),
    );
    expect(escalated).toBeDefined();
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toContain('operador');
  });

  it('with an unknown promoter escalates and does NOT set a session', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM promoters')) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-4', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'evidence/w.jpg' });

    expect(store[PHONE]).toBeUndefined();
    const escalated = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes("status='escalated'"),
    );
    expect(escalated).toBeDefined();
    const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
    expect(msg).toContain('registrado');
  });

  it('falls back to a collaborator (coordinador) when the sender is NOT a promoter', async () => {
    // El remitente es colaborador (ej. role_label='coordinator'), no promotor: el
    // gate del bot lo autoriza y la evidencia debe atribuirse a su id (checkins.persona_id
    // no tiene FK). Sin promotor → se busca en collaborators → se encuentra colab-1.
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM promoters')) return Promise.resolve([]);
      if (sql.includes('FROM collaborators')) return Promise.resolve([{ id: 'colab-1' }]);
      if (sql.includes('FROM activations')) return Promise.resolve([{ id: 'act-1', activation_date: '2026-07-29' }]);
      if (sql.includes('INSERT INTO checkins')) return Promise.resolve([{ id: 'chk-1' }]);
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-colab', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'evidence/c.jpg' });

    expect(store[PHONE]?.evidenceIntake?.personaId).toBe('colab-1');
    expect(store[PHONE]?.evidenceIntake?.step).toBe('observacion');
    expect(store[PHONE]?.evidenceIntake?.activacionId).toBe('act-1');
  });

  it('falls back to a user (Manager/Operador/Supervisor) when neither promoter nor collaborator', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM promoters')) return Promise.resolve([]);
      if (sql.includes('FROM collaborators')) return Promise.resolve([]);
      if (sql.includes('FROM users')) return Promise.resolve([{ id: 'user-1' }]);
      if (sql.includes('FROM activations')) return Promise.resolve([{ id: 'act-1', activation_date: '2026-07-29' }]);
      if (sql.includes('INSERT INTO checkins')) return Promise.resolve([{ id: 'chk-1' }]);
      return Promise.resolve([]);
    });

    await svc.start({ eventoCrudoId: 'evt-user', phoneNumber: PHONE, clientId: CLIENT, storagePath: 'evidence/u.jpg' });

    expect(store[PHONE]?.evidenceIntake?.personaId).toBe('user-1');
    expect(store[PHONE]?.evidenceIntake?.step).toBe('observacion');
  });

  it('the observacion step inserts a checkin with foto_key + persona_id + observacion and flow F5_EVID', async () => {
    store[PHONE] = {
      state: 'awaiting_evidence', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null, materialIntake: null,
      evidenceIntake: {
        eventoCrudoId: 'evt-5', storagePath: 'evidence/x.jpg', step: 'observacion',
        attempts: 0, personaId: 'prom-1', activacionId: 'act-1',
      },
    };

    expect(await svc.handleResponse(PHONE, 'Dos anfitrionas en el stand')).toBe(true);

    const insert = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO checkins'),
    );
    expect(insert).toBeDefined();
    expect(insert[1]).toEqual([CLIENT, 'act-1', 'prom-1', 'evidence/x.jpg', 'Dos anfitrionas en el stand']);

    // Bookkeeping: flow='F5_EVID' (7 chars) entra en eventos_crudos.flow VARCHAR(10).
    const eventUpdate = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('UPDATE eventos_crudos') && sql.includes('flow='),
    );
    expect(eventUpdate).toBeDefined();
    expect(eventUpdate[0]).toContain("flow='F5_EVID'");
    const flowValue = eventUpdate[0].match(/flow='([^']+)'/)![1];
    expect(flowValue.length).toBeLessThanOrEqual(10);

    expect(store[PHONE]).toBeUndefined();
  });

  it('replying "listo" on the observacion step stores a null observacion', async () => {
    store[PHONE] = {
      state: 'awaiting_evidence', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null, materialIntake: null,
      evidenceIntake: {
        eventoCrudoId: 'evt-6', storagePath: 'evidence/x.jpg', step: 'observacion',
        attempts: 0, personaId: 'prom-1', activacionId: 'act-1',
      },
    };

    expect(await svc.handleResponse(PHONE, 'listo')).toBe(true);

    const insert = queryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO checkins'),
    );
    expect(insert).toBeDefined();
    expect(insert[1]).toEqual([CLIENT, 'act-1', 'prom-1', 'evidence/x.jpg', null]);
    expect(store[PHONE]).toBeUndefined();
  });

  it('parses the number on the activacion step, then asks for observacion', async () => {
    store[PHONE] = {
      state: 'awaiting_evidence', projects: [], base64: '', mimeType: '', caption: '',
      clientId: CLIENT, canalId: null, updatedAt: '', clarification: null, materialIntake: null,
      evidenceIntake: {
        eventoCrudoId: 'evt-7', storagePath: 'evidence/x.jpg', step: 'activacion',
        attempts: 0, personaId: 'prom-1',
        activaciones: [
          { id: 'act-1', label: 'Activación 2026-07-29' },
          { id: 'act-2', label: 'Activación 2026-07-28' },
        ],
      },
    };

    expect(await svc.handleResponse(PHONE, '2')).toBe(true);
    expect(store[PHONE].evidenceIntake?.step).toBe('observacion');
    expect(store[PHONE].evidenceIntake?.activacionId).toBe('act-2');
  });

  it('returns false when there is no evidence intake in session', async () => {
    expect(await svc.handleResponse(PHONE, 'hola')).toBe(false);
  });
});

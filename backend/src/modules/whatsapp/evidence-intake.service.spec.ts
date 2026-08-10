/// <reference types="jest" />
import { DataSource, QueryRunner } from 'typeorm';
import { EvidenceIntakeService } from './evidence-intake.service';
import { WhatsAppSession } from './whatsapp-session.service';

const PHONE = '5492216205665';
const CLIENT = 'client-1';

/**
 * Helper: builds the standard query mock used by most tests.
 * Override individual sql matchers by providing an overrides map.
 */
function makeQueryMock(overrides?: {
  promoters?: any[];
  collaborators?: any[];
  users?: any[];
  activations?: any[];
  checkins?: any[];
}): jest.Mock {
  const promoterRow = overrides?.promoters ?? [{ id: 'prom-1' }];
  const colab = overrides?.collaborators ?? [];
  const usersRow = overrides?.users ?? [];
  const actRow = overrides?.activations ?? [
    { id: 'act-1', activation_date: '2026-07-29' },
  ];
  const checkinRow = overrides?.checkins ?? [{ id: 'chk-1' }];

  return jest.fn((sql: string) => {
    if (sql.includes('set_config')) return Promise.resolve([]);
    if (sql.includes('FROM promoters')) return Promise.resolve(promoterRow);
    if (sql.includes('FROM collaborators')) return Promise.resolve(colab);
    if (
      sql.includes('FROM users') &&
      sql.includes('SELECT id FROM users') &&
      sql.includes('role')
    ) {
      return Promise.resolve(usersRow);
    }
    if (sql.includes('FROM activations')) return Promise.resolve(actRow);
    if (sql.includes('INSERT INTO checkins'))
      return Promise.resolve(checkinRow);
    return Promise.resolve([]);
  });
}

describe('EvidenceIntakeService', () => {
  let svc: EvidenceIntakeService;
  let store: Record<string, WhatsAppSession>;
  let queryMock: jest.Mock;
  let sessions: any;
  let wa: any;
  let notifier: any;
  let notifications: any;
  let pendingStaff: any;

  const promoterRow = [{ id: 'prom-1' }];

  beforeEach(() => {
    store = {};
    sessions = {
      get: jest.fn(async (p: string) => store[p] ?? null),
      set: jest.fn(async (p: string, s: WhatsAppSession) => {
        store[p] = s;
      }),
      delete: jest.fn(async (p: string) => {
        delete store[p];
      }),
    };

    // Por defecto: promotor encontrado + 1 activación activa.
    queryMock = jest.fn((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM promoters')) return Promise.resolve(promoterRow);
      if (sql.includes('FROM activations')) {
        return Promise.resolve([
          { id: 'act-1', activation_date: '2026-07-29' },
        ]);
      }
      if (sql.includes('INSERT INTO checkins'))
        return Promise.resolve([{ id: 'chk-1' }]);
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

    // Slice C mocks for operator alerting services.
    notifier = { notificar: jest.fn().mockResolvedValue(1) };
    notifications = {
      resolveManagerIds: jest.fn().mockResolvedValue(['mgr-1', 'mgr-2']),
      notifyUsers: jest.fn().mockResolvedValue(undefined),
    };
    pendingStaff = { upsert: jest.fn().mockResolvedValue(undefined) };

    svc = new EvidenceIntakeService(
      ds,
      wa,
      sessions,
      notifier,
      notifications,
      pendingStaff,
    );
  });

  // ─── Existing tests (unchanged behavior) ────────────────────────────────────

  it('with a known promoter + exactly 1 activación auto-selects and asks for observacion', async () => {
    await svc.start({
      eventoCrudoId: 'evt-1',
      phoneNumber: PHONE,
      clientId: CLIENT,
      storagePath: 'evidence/x.jpg',
      suggestedLabel: 'anfitrionas',
    });

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

    await svc.start({
      eventoCrudoId: 'evt-2',
      phoneNumber: PHONE,
      clientId: CLIENT,
      storagePath: 'evidence/y.jpg',
    });

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
      if (sql.includes('FROM activations') && sql.includes('promoter_id'))
        return Promise.resolve([]);
      if (sql.includes('FROM activations'))
        return Promise.resolve([
          { id: 'act-cli', activation_date: '2026-07-29' },
        ]);
      if (sql.includes('INSERT INTO checkins'))
        return Promise.resolve([{ id: 'chk-1' }]);
      return Promise.resolve([]);
    });

    await svc.start({
      eventoCrudoId: 'evt-8',
      phoneNumber: PHONE,
      clientId: CLIENT,
      storagePath: 'evidence/f.jpg',
    });

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

    await svc.start({
      eventoCrudoId: 'evt-3',
      phoneNumber: PHONE,
      clientId: CLIENT,
      storagePath: 'evidence/z.jpg',
    });

    expect(store[PHONE]).toBeUndefined();
    const escalated = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE eventos_crudos') &&
        sql.includes("status='escalated'"),
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

    await svc.start({
      eventoCrudoId: 'evt-4',
      phoneNumber: PHONE,
      clientId: CLIENT,
      storagePath: 'evidence/w.jpg',
    });

    expect(store[PHONE]).toBeUndefined();
    const escalated = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE eventos_crudos') &&
        sql.includes("status='escalated'"),
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
      if (sql.includes('FROM collaborators'))
        return Promise.resolve([{ id: 'colab-1' }]);
      if (sql.includes('FROM activations'))
        return Promise.resolve([
          { id: 'act-1', activation_date: '2026-07-29' },
        ]);
      if (sql.includes('INSERT INTO checkins'))
        return Promise.resolve([{ id: 'chk-1' }]);
      return Promise.resolve([]);
    });

    await svc.start({
      eventoCrudoId: 'evt-colab',
      phoneNumber: PHONE,
      clientId: CLIENT,
      storagePath: 'evidence/c.jpg',
    });

    expect(store[PHONE]?.evidenceIntake?.personaId).toBe('colab-1');
    expect(store[PHONE]?.evidenceIntake?.step).toBe('observacion');
    expect(store[PHONE]?.evidenceIntake?.activacionId).toBe('act-1');
  });

  it('falls back to a user (Manager/Operador/Supervisor) when neither promoter nor collaborator', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      if (sql.includes('FROM promoters')) return Promise.resolve([]);
      if (sql.includes('FROM collaborators')) return Promise.resolve([]);
      if (sql.includes('FROM users'))
        return Promise.resolve([{ id: 'user-1' }]);
      if (sql.includes('FROM activations'))
        return Promise.resolve([
          { id: 'act-1', activation_date: '2026-07-29' },
        ]);
      if (sql.includes('INSERT INTO checkins'))
        return Promise.resolve([{ id: 'chk-1' }]);
      return Promise.resolve([]);
    });

    await svc.start({
      eventoCrudoId: 'evt-user',
      phoneNumber: PHONE,
      clientId: CLIENT,
      storagePath: 'evidence/u.jpg',
    });

    expect(store[PHONE]?.evidenceIntake?.personaId).toBe('user-1');
    expect(store[PHONE]?.evidenceIntake?.step).toBe('observacion');
  });

  it('the observacion step inserts a checkin with foto_key + persona_id + observacion and flow F5_EVID', async () => {
    store[PHONE] = {
      state: 'awaiting_evidence',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      clientId: CLIENT,
      canalId: null,
      updatedAt: '',
      clarification: null,
      materialIntake: null,
      evidenceIntake: {
        eventoCrudoId: 'evt-5',
        storagePath: 'evidence/x.jpg',
        step: 'observacion',
        attempts: 0,
        personaId: 'prom-1',
        activacionId: 'act-1',
      },
    };

    expect(await svc.handleResponse(PHONE, 'Dos anfitrionas en el stand')).toBe(
      true,
    );

    const insert = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO checkins'),
    );
    expect(insert).toBeDefined();
    expect(insert[1]).toEqual([
      CLIENT,
      'act-1',
      'prom-1',
      'evidence/x.jpg',
      'Dos anfitrionas en el stand',
    ]);

    // Bookkeeping: flow='F5_EVID' (7 chars) entra en eventos_crudos.flow VARCHAR(10).
    const eventUpdate = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE eventos_crudos') &&
        sql.includes('flow='),
    );
    expect(eventUpdate).toBeDefined();
    expect(eventUpdate[0]).toContain("flow='F5_EVID'");
    const flowValue = eventUpdate[0].match(/flow='([^']+)'/)![1];
    expect(flowValue.length).toBeLessThanOrEqual(10);

    expect(store[PHONE]).toBeUndefined();
  });

  it('replying "listo" on the observacion step stores a null observacion', async () => {
    store[PHONE] = {
      state: 'awaiting_evidence',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      clientId: CLIENT,
      canalId: null,
      updatedAt: '',
      clarification: null,
      materialIntake: null,
      evidenceIntake: {
        eventoCrudoId: 'evt-6',
        storagePath: 'evidence/x.jpg',
        step: 'observacion',
        attempts: 0,
        personaId: 'prom-1',
        activacionId: 'act-1',
      },
    };

    expect(await svc.handleResponse(PHONE, 'listo')).toBe(true);

    const insert = queryMock.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO checkins'),
    );
    expect(insert).toBeDefined();
    expect(insert[1]).toEqual([
      CLIENT,
      'act-1',
      'prom-1',
      'evidence/x.jpg',
      null,
    ]);
    expect(store[PHONE]).toBeUndefined();
  });

  it('parses the number on the activacion step, then asks for observacion', async () => {
    store[PHONE] = {
      state: 'awaiting_evidence',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      clientId: CLIENT,
      canalId: null,
      updatedAt: '',
      clarification: null,
      materialIntake: null,
      evidenceIntake: {
        eventoCrudoId: 'evt-7',
        storagePath: 'evidence/x.jpg',
        step: 'activacion',
        attempts: 0,
        personaId: 'prom-1',
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

  // ─── Slice C — escalate() operator-alert branching ─────────────────────────

  describe('escalate() — reason: evidence_unknown_persona', () => {
    beforeEach(() => {
      // Drive the unknown_persona branch: no promoter, no collaborator, no user found.
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('set_config')) return Promise.resolve([]);
        if (sql.includes('FROM promoters')) return Promise.resolve([]);
        if (sql.includes('FROM collaborators')) return Promise.resolve([]);
        if (sql.includes('FROM users')) return Promise.resolve([]);
        return Promise.resolve([]);
      });
    });

    it('calls notifier.notificar with clientId, a message containing the phone, and a dedup key', async () => {
      await svc.start({
        eventoCrudoId: 'esc-1',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/a.jpg',
      });

      expect(notifier.notificar).toHaveBeenCalledTimes(1);
      const [callClientId, callMsg, callKey] = notifier.notificar.mock.calls[0];
      expect(callClientId).toBe(CLIENT);
      expect(callMsg).toContain(PHONE);
      expect(callKey).toContain('evidence-evidence_unknown_persona');
      expect(callKey).toContain('esc-1');
    });

    it('calls notifications.resolveManagerIds with clientId', async () => {
      await svc.start({
        eventoCrudoId: 'esc-2',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/a.jpg',
      });

      expect(notifications.resolveManagerIds).toHaveBeenCalledWith(CLIENT);
    });

    it('calls notifications.notifyUsers with clientId, manager ids, and type=evidence_unknown_persona', async () => {
      await svc.start({
        eventoCrudoId: 'esc-3',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/a.jpg',
      });

      expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
      const [callClientId, callUserIds, callPayload] =
        notifications.notifyUsers.mock.calls[0];
      expect(callClientId).toBe(CLIENT);
      expect(callUserIds).toEqual(['mgr-1', 'mgr-2']);
      expect(callPayload.type).toBe('evidence_unknown_persona');
      expect(callPayload.metadata).toMatchObject({
        eventoCrudoId: 'esc-3',
        phone: PHONE,
        link: '/client/promoters',
      });
    });

    it('calls pendingStaff.upsert with the sender phone and reason evidence_unknown', async () => {
      // The raw phone is passed through; PendingStaffService owns normalization
      // (covered by its own unit + the evidence-escalate e2e that asserts the
      // stored digits-only value).
      const rawPhone = '+549 2216 205665';

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('set_config')) return Promise.resolve([]);
        if (sql.includes('FROM promoters')) return Promise.resolve([]);
        if (sql.includes('FROM collaborators')) return Promise.resolve([]);
        if (sql.includes('FROM users')) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      await svc.start({
        eventoCrudoId: 'esc-4',
        phoneNumber: rawPhone,
        clientId: CLIENT,
        storagePath: 'evidence/b.jpg',
      });

      expect(pendingStaff.upsert).toHaveBeenCalledTimes(1);
      const [callClientId, callPhone, callMotivo, callContexto] =
        pendingStaff.upsert.mock.calls[0];
      expect(callClientId).toBe(CLIENT);
      expect(callPhone).toBe(rawPhone);
      expect(callMotivo).toBe('evidence_unknown');
      expect(callContexto).toMatchObject({ eventoCrudoId: 'esc-4' });
    });

    it('isolates the three operator channels: a failure in one does NOT suppress the others', async () => {
      // In-app resolution (channel 3) fails; the WhatsApp alert (channel 2) and the
      // pending_staff roster entry (channel 1) MUST still run — they are independent.
      notifications.resolveManagerIds.mockRejectedValueOnce(
        new Error('users table hiccup'),
      );

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('set_config')) return Promise.resolve([]);
        if (sql.includes('FROM promoters')) return Promise.resolve([]);
        if (sql.includes('FROM collaborators')) return Promise.resolve([]);
        if (sql.includes('FROM users')) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      await svc.start({
        eventoCrudoId: 'esc-iso',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/iso.jpg',
      });

      // Channel 1 (durable roster record) still fired.
      expect(pendingStaff.upsert).toHaveBeenCalledTimes(1);
      // Channel 2 (WhatsApp operator alert) still fired despite channel 3 failing.
      expect(notifier.notificar).toHaveBeenCalledTimes(1);
      // Channel 3 (in-app) failed but was swallowed-with-log; notifyUsers never reached.
      expect(notifications.notifyUsers).not.toHaveBeenCalled();
      // Sender still replied.
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.any(String));
    });

    it('still calls wa.sendText to the sender even when the operator-alert block throws', async () => {
      notifier.notificar.mockRejectedValueOnce(new Error('WA outage'));

      await svc.start({
        eventoCrudoId: 'esc-5',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/c.jpg',
      });

      // Sender must always get the reply message regardless of operator-alert failures.
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.any(String));
      // escalate() must not propagate the error.
    });

    it('does NOT throw when operator-alert block throws', async () => {
      notifications.resolveManagerIds.mockRejectedValueOnce(
        new Error('DB error'),
      );

      await expect(
        svc.start({
          eventoCrudoId: 'esc-6',
          phoneNumber: PHONE,
          clientId: CLIENT,
          storagePath: 'evidence/d.jpg',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('escalate() — reason: evidence_no_active_activation', () => {
    beforeEach(() => {
      // Drive the no_active_activation branch: promoter found, no activations.
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('set_config')) return Promise.resolve([]);
        if (sql.includes('FROM promoters'))
          return Promise.resolve([{ id: 'prom-1' }]);
        if (sql.includes('FROM collaborators')) return Promise.resolve([]);
        if (sql.includes('FROM activations')) return Promise.resolve([]);
        return Promise.resolve([]);
      });
    });

    it('calls notifier.notificar with the sender phone in the message', async () => {
      await svc.start({
        eventoCrudoId: 'esc-10',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/e.jpg',
      });

      expect(notifier.notificar).toHaveBeenCalledTimes(1);
      const [, callMsg] = notifier.notificar.mock.calls[0];
      expect(callMsg).toContain(PHONE);
    });

    it('calls notifications.notifyUsers with type=evidence_no_active_activation', async () => {
      await svc.start({
        eventoCrudoId: 'esc-11',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/e.jpg',
      });

      expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
      const [, , callPayload] = notifications.notifyUsers.mock.calls[0];
      expect(callPayload.type).toBe('evidence_no_active_activation');
      expect(callPayload.metadata).toMatchObject({ link: '/client/terreno' });
    });

    it('does NOT call pendingStaff.upsert', async () => {
      await svc.start({
        eventoCrudoId: 'esc-12',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/f.jpg',
      });

      expect(pendingStaff.upsert).not.toHaveBeenCalled();
    });

    it('still calls wa.sendText to the sender', async () => {
      await svc.start({
        eventoCrudoId: 'esc-13',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/g.jpg',
      });

      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.any(String));
    });

    it('does NOT throw when operator-alert block throws', async () => {
      notifier.notificar.mockRejectedValueOnce(new Error('network error'));

      await expect(
        svc.start({
          eventoCrudoId: 'esc-14',
          phoneNumber: PHONE,
          clientId: CLIENT,
          storagePath: 'evidence/h.jpg',
        }),
      ).resolves.not.toThrow();
    });

    it('still calls wa.sendText when operator-alert block throws', async () => {
      notifications.notifyUsers.mockRejectedValueOnce(new Error('insert fail'));

      await svc.start({
        eventoCrudoId: 'esc-15',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/i.jpg',
      });

      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.any(String));
    });
  });

  describe('escalate() — zero managers in tenant', () => {
    it('resolveManagerIds returns [] → notifyUsers called with [] and no exception', async () => {
      notifications.resolveManagerIds.mockResolvedValueOnce([]);

      // unknown_persona branch (no promoter found)
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('set_config')) return Promise.resolve([]);
        if (sql.includes('FROM promoters')) return Promise.resolve([]);
        if (sql.includes('FROM collaborators')) return Promise.resolve([]);
        if (sql.includes('FROM users')) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      await svc.start({
        eventoCrudoId: 'esc-20',
        phoneNumber: PHONE,
        clientId: CLIENT,
        storagePath: 'evidence/j.jpg',
      });

      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        CLIENT,
        [],
        expect.objectContaining({ type: 'evidence_unknown_persona' }),
      );
      expect(wa.sendText).toHaveBeenCalledWith(PHONE, expect.any(String));
    });
  });
});

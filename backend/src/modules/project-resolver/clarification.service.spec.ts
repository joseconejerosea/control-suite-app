/// <reference types="jest" />
/**
 * clarification.service.spec.ts
 *
 * Strict TDD spec for ClarificationService additions.
 * Tests are added in task order: A02, A05, A09, and later slices.
 *
 * All external dependencies (DataSource, WhatsAppService, WhatsAppSessionService,
 * Queue) are mocked. Tests run with `npx jest clarification.service.spec`.
 */
import { DataSource } from 'typeorm';
import { ClarificationService } from './clarification.service';

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildDs(queryImpl: (sql: string, params?: any[]) => Promise<any[]>): DataSource {
  // A QueryRunner stub so runWithTenant (used by handleProjectCreateResponse for the
  // park+create atomic tenant-scoped write) can open/commit its transaction in unit tests.
  // Its own .query (set_config etc.) is a no-op; the service's this.ds.query still routes
  // to queryImpl because installTenantQueryRouting is NOT installed in unit tests.
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    isTransactionActive: true,
    query: jest.fn().mockResolvedValue([]),
  };
  return {
    query: queryImpl,
    createQueryRunner: jest.fn(() => queryRunner),
  } as unknown as DataSource;
}

function buildSessions(overrides: Partial<{
  get: jest.Mock;
  set: jest.Mock;
  delete: jest.Mock;
  updateLastProject: jest.Mock;
}> = {}) {
  return {
    get: overrides.get ?? jest.fn().mockResolvedValue(null),
    set: overrides.set ?? jest.fn().mockResolvedValue(undefined),
    delete: overrides.delete ?? jest.fn().mockResolvedValue(undefined),
    updateLastProject: overrides.updateLastProject ?? jest.fn().mockResolvedValue(undefined),
  };
}

function buildService(opts: {
  dsQuery?: (sql: string, params?: any[]) => Promise<any[]>;
  sessions?: ReturnType<typeof buildSessions>;
  wa?: any;
  ocrQueue?: any;
  persistQueue?: any;
  projectInboxService?: any;
}): ClarificationService {
  const ds = buildDs(opts.dsQuery ?? jest.fn().mockResolvedValue([]));
  const sessions = opts.sessions ?? buildSessions();
  const wa = opts.wa ?? { sendText: jest.fn().mockResolvedValue(true) };
  const ocrQueue = opts.ocrQueue ?? { add: jest.fn().mockResolvedValue({}) };
  const persistQueue = opts.persistQueue ?? { add: jest.fn().mockResolvedValue({}) };
  const projectInboxService = opts.projectInboxService ?? {
    createDraftFromWhatsApp: jest.fn().mockResolvedValue({ id: 'draft-1' }),
  };

  const svc = new ClarificationService(
    ds,
    ocrQueue as any,
    persistQueue as any,
    wa as any,
    sessions as any,
    projectInboxService as any,
  );
  return svc;
}

// ─── TASK-A02 — canCreateProject (role gate) ─────────────────────────────────

describe('ClarificationService · canCreateProject (A02)', () => {
  it('returns true for MANAGER + is_active', async () => {
    const svc = buildService({
      dsQuery: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
    });
    const result = await (svc as any).canCreateProject('5491155550000', 'client-1');
    expect(result).toBe(true);
  });

  it('returns false for MANAGER with is_active=false (not returned by query)', async () => {
    const svc = buildService({
      dsQuery: jest.fn().mockResolvedValue([]), // no rows because is_active=false filtered
    });
    const result = await (svc as any).canCreateProject('5491155550001', 'client-1');
    expect(result).toBe(false);
  });

  it('returns false for non-MANAGER role', async () => {
    const svc = buildService({
      dsQuery: jest.fn().mockResolvedValue([]), // no rows because role != MANAGER
    });
    const result = await (svc as any).canCreateProject('5491155550002', 'client-1');
    expect(result).toBe(false);
  });

  it('returns false when phone not in users (unmapped)', async () => {
    const svc = buildService({
      dsQuery: jest.fn().mockResolvedValue([]),
    });
    const result = await (svc as any).canCreateProject('5491155559999', 'client-1');
    expect(result).toBe(false);
  });

  it('returns false (fail-closed) on DB error', async () => {
    const svc = buildService({
      dsQuery: jest.fn().mockRejectedValue(new Error('DB connection lost')),
    });
    const result = await (svc as any).canCreateProject('5491155550000', 'client-1');
    expect(result).toBe(false);
  });

  it('normalizes phone to digits via regexp_replace equivalent (JB2-013)', async () => {
    const querySpy = jest.fn().mockResolvedValue([{ id: 'user-1' }]);
    const svc = buildService({ dsQuery: querySpy });

    await (svc as any).canCreateProject('+549 11 5555-0000', 'client-1');

    // The query must use digit-normalization consistent with regexp_replace(phone, '\D', '', 'g')
    const callArgs = querySpy.mock.calls[0];
    const sql: string = callArgs[0];
    const params: any[] = callArgs[1];

    // SQL must apply regexp_replace to the DB phone column
    expect(sql).toMatch(/regexp_replace/i);
    // The parameter passed must be digits-only (no +, space, or -)
    const phoneParam = params.find((p: any) => typeof p === 'string' && /^\d+$/.test(p));
    expect(phoneParam).toBeDefined();
    expect(phoneParam).toBe('5491155550000');
  });
});

// ─── TASK-A05 — getUserLanguageForCreate ─────────────────────────────────────

describe('ClarificationService · getUserLanguageForCreate (A05)', () => {
  it('returns language from users.phone match (MANAGER path)', async () => {
    const svc = buildService({
      dsQuery: jest.fn()
        .mockResolvedValueOnce([{ language: 'en' }]), // users.phone first check
    });
    const lang = await (svc as any).getUserLanguageForCreate('5491155550000', 'client-1');
    expect(lang).toBe('en');
  });

  it('falls back to promoters join if phone not in users', async () => {
    const svc = buildService({
      dsQuery: jest.fn()
        .mockResolvedValueOnce([])         // users.phone: no match
        .mockResolvedValueOnce([{ language: 'en' }]),  // promoters fallback
    });
    const lang = await (svc as any).getUserLanguageForCreate('5491155550000', 'client-1');
    expect(lang).toBe('en');
  });

  it('defaults to es when neither path resolves', async () => {
    const svc = buildService({
      dsQuery: jest.fn().mockResolvedValue([]),
    });
    const lang = await (svc as any).getUserLanguageForCreate('5491155550000', 'client-1');
    expect(lang).toBe('es');
  });
});

// ─── TASK-A09 — requestProjectClarification sentinel ─────────────────────────

describe('ClarificationService · requestProjectClarification sentinel (A09)', () => {
  it('appends __create__ sentinel when allowCreate=true', async () => {
    const waSpy = jest.fn().mockResolvedValue(true);
    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    });

    const svc = buildService({
      dsQuery: jest.fn().mockResolvedValue([]),
      wa: { sendText: waSpy },
      sessions,
    });

    await svc.requestProjectClarification({
      eventoCrudoId: 'ec-1',
      clientId: 'client-1',
      phoneNumber: '5491155550000',
      projects: [
        { id: 'p1', name: 'Proyecto A' },
        { id: 'p2', name: 'Proyecto B' },
      ],
      language: 'es',
      allowCreate: true,
    });

    // Session must contain __create__ sentinel option
    const setCall = (sessions.set as jest.Mock).mock.calls[0];
    const savedSession = setCall[1];
    const options = savedSession.clarification.options;
    const createOption = options.find((o: any) => o.id === '__create__');
    expect(createOption).toBeDefined();
    // Sentinel label should be item #3 (count + 1)
    expect(createOption.label).toMatch(/3\./);
  });

  it('does NOT append sentinel when allowCreate=false', async () => {
    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    });

    const svc = buildService({
      dsQuery: jest.fn().mockResolvedValue([]),
      sessions,
    });

    await svc.requestProjectClarification({
      eventoCrudoId: 'ec-1',
      clientId: 'client-1',
      phoneNumber: '5491155550000',
      projects: [
        { id: 'p1', name: 'Proyecto A' },
        { id: 'p2', name: 'Proyecto B' },
      ],
      language: 'es',
      allowCreate: false,
    });

    const setCall = (sessions.set as jest.Mock).mock.calls[0];
    const savedSession = setCall[1];
    const options = savedSession.clarification.options;
    const createOption = options.find((o: any) => o.id === '__create__');
    expect(createOption).toBeUndefined();
  });
});

// ─── TASK-A09 — beginProjectCreate (ADR-11 state invariant) ──────────────────

describe('ClarificationService · beginProjectCreate (A09)', () => {
  it('sets state=awaiting_clarification atomically with clarification (ADR-11)', async () => {
    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    });
    const waSpy = jest.fn().mockResolvedValue(true);

    const svc = buildService({
      sessions,
      wa: { sendText: waSpy },
    });

    await (svc as any).beginProjectCreate({
      eventoCrudoId: 'ec-1',
      clientId: 'client-1',
      from: '5491155550000',
      lang: 'es',
    });

    const setCall = (sessions.set as jest.Mock).mock.calls[0];
    const savedSession = setCall[1];
    // ADR-11: state MUST be set in the same write as clarification
    expect(savedSession.state).toBe('awaiting_clarification');
    expect(savedSession.clarification).not.toBeNull();
    expect(savedSession.clarification.type).toBe('project_create');
  });

  it('sends a name-request message to the sender', async () => {
    const waSpy = jest.fn().mockResolvedValue(true);
    const svc = buildService({ wa: { sendText: waSpy } });

    await (svc as any).beginProjectCreate({
      eventoCrudoId: 'ec-2',
      clientId: 'client-1',
      from: '5491155550000',
      lang: 'es',
    });

    expect(waSpy).toHaveBeenCalledTimes(1);
    expect(waSpy.mock.calls[0][0]).toBe('5491155550000');
  });

  it('English branch emits an English name-request (JAA-002/JBA-002 EN/ES swap)', async () => {
    const waSpy = jest.fn().mockResolvedValue(true);
    const svc = buildService({ wa: { sendText: waSpy } });

    await (svc as any).beginProjectCreate({
      eventoCrudoId: 'ec-en',
      clientId: 'client-1',
      from: '5491155550000',
      lang: 'en',
    });

    const sentMsg = waSpy.mock.calls[0][1] as string;
    // Must be actual English, not the Spanish-leading text the bug emitted.
    expect(sentMsg).toMatch(/project name/i);
    expect(sentMsg).not.toMatch(/¿Cuál es el nombre/i);
    expect(sentMsg).not.toMatch(/Escribilo a continuación/i);
  });

  it('Spanish branch emits a clean Spanish name-request', async () => {
    const waSpy = jest.fn().mockResolvedValue(true);
    const svc = buildService({ wa: { sendText: waSpy } });

    await (svc as any).beginProjectCreate({
      eventoCrudoId: 'ec-es',
      clientId: 'client-1',
      from: '5491155550000',
      lang: 'es',
    });

    const sentMsg = waSpy.mock.calls[0][1] as string;
    expect(sentMsg).toMatch(/nombre del nuevo proyecto/i);
    expect(sentMsg).not.toMatch(/project name/i);
  });

  it('includes eventoCrudoId in pendingEventoIds', async () => {
    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    });
    const svc = buildService({ sessions });

    await (svc as any).beginProjectCreate({
      eventoCrudoId: 'ec-unique',
      clientId: 'client-1',
      from: '5491155550000',
      lang: 'es',
    });

    const setCall = (sessions.set as jest.Mock).mock.calls[0];
    const savedSession = setCall[1];
    expect(savedSession.clarification.pendingEventoIds).toContain('ec-unique');
  });
});

// ─── TASK-A09 — handleProjectCreateResponse ──────────────────────────────────

describe('ClarificationService · handleProjectCreateResponse (A09)', () => {
  function buildSessionWithCreate(opts: { attempts?: number } = {}): any {
    return {
      state: 'awaiting_clarification',
      clientId: 'client-1',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      canalId: null,
      updatedAt: new Date().toISOString(),
      clarification: {
        eventoCrudoId: 'ec-42',
        type: 'project_create',
        attempts: opts.attempts ?? 0,
        pendingEventoIds: ['ec-42'],
      },
    };
  }

  it('valid name (>=3 chars) → parks evento, calls createDraftFromWhatsApp, clears session', async () => {
    const parkQuery = jest.fn().mockResolvedValue([]);
    const createDraftMock = jest.fn().mockResolvedValue({ id: 'draft-1' });
    const sessionDeleteMock = jest.fn().mockResolvedValue(undefined);
    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(buildSessionWithCreate()),
      set: jest.fn().mockResolvedValue(undefined),
      delete: sessionDeleteMock,
    });

    const svc = buildService({
      dsQuery: parkQuery,
      sessions,
      projectInboxService: { createDraftFromWhatsApp: createDraftMock },
    });

    const result = await (svc as any).handleProjectCreateResponse(
      '5491155550000',
      buildSessionWithCreate(),
      'Campaña Verano 2026',
      'client-1',
    );

    expect(result).toBe(true);
    // Evento should be parked
    const parkCall = parkQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'parked'"),
    );
    expect(parkCall).toBeDefined();
    // Draft creation should be called with the name
    expect(createDraftMock).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ name: 'Campaña Verano 2026' }),
    );
    // Session should be cleared
    expect(sessionDeleteMock).toHaveBeenCalled();
  });

  it('carries facturaId (not the non-existent reassignFacturaId) into the draft (JAA-001/JBA-003)', async () => {
    const createDraftMock = jest.fn().mockResolvedValue({ id: 'draft-2' });
    const sessions = buildSessions({
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });

    const svc = buildService({
      dsQuery: jest.fn().mockResolvedValue([]),
      sessions,
      projectInboxService: { createDraftFromWhatsApp: createDraftMock },
    });

    const session = buildSessionWithCreate();
    // Session union defines `facturaId`; the bug read `reassignFacturaId` (always undefined).
    session.clarification.facturaId = 'fac-77';

    await (svc as any).handleProjectCreateResponse(
      '5491155550000',
      session,
      'Reasignado Proyecto',
      'client-1',
    );

    expect(createDraftMock).toHaveBeenCalledWith(
      'client-1',
      expect.objectContaining({ reassignFacturaId: 'fac-77' }),
    );
  });

  it('wraps park+create in a tenant-scoped transaction (JBA-005/JBA-004)', async () => {
    const createDraftMock = jest.fn().mockResolvedValue({ id: 'draft-3' });
    const sessions = buildSessions({
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });

    const ds = buildDs(jest.fn().mockResolvedValue([]));
    const wa = { sendText: jest.fn().mockResolvedValue(true) };
    const svc = new ClarificationService(
      ds,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
      wa as any,
      sessions as any,
      { createDraftFromWhatsApp: createDraftMock } as any,
    );

    await (svc as any).handleProjectCreateResponse(
      '5491155550000',
      buildSessionWithCreate(),
      'Proyecto Tenant',
      'client-1',
    );

    // runWithTenant must open a transaction (createQueryRunner + startTransaction + commit).
    const qr = (ds.createQueryRunner as jest.Mock).mock.results[0].value;
    expect(ds.createQueryRunner).toHaveBeenCalled();
    expect(qr.startTransaction).toHaveBeenCalled();
    expect(qr.commitTransaction).toHaveBeenCalled();
    expect(createDraftMock).toHaveBeenCalled();
  });

  it('un-parks (rolls back) when the draft INSERT fails — no orphan parked evento (JBA-004)', async () => {
    const createDraftMock = jest.fn().mockRejectedValue(new Error('INSERT failed'));
    const sessions = buildSessions({
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });

    const ds = buildDs(jest.fn().mockResolvedValue([]));
    const wa = { sendText: jest.fn().mockResolvedValue(true) };
    const svc = new ClarificationService(
      ds,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
      wa as any,
      sessions as any,
      { createDraftFromWhatsApp: createDraftMock } as any,
    );

    await expect(
      (svc as any).handleProjectCreateResponse(
        '5491155550000',
        buildSessionWithCreate(),
        'Proyecto Rollback',
        'client-1',
      ),
    ).rejects.toThrow('INSERT failed');

    const qr = (ds.createQueryRunner as jest.Mock).mock.results[0].value;
    // The failed INSERT must roll back the park UPDATE (atomicity).
    expect(qr.rollbackTransaction).toHaveBeenCalled();
    expect(qr.commitTransaction).not.toHaveBeenCalled();
  });

  it('empty/short name on attempt 0 → retry, session unchanged (attempts incremented)', async () => {
    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(buildSessionWithCreate({ attempts: 0 })),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const waSpy = jest.fn().mockResolvedValue(true);

    const svc = buildService({ sessions, wa: { sendText: waSpy } });

    const session = buildSessionWithCreate({ attempts: 0 });
    const result = await (svc as any).handleProjectCreateResponse(
      '5491155550000',
      session,
      'AB', // less than 3 chars
      'client-1',
    );

    expect(result).toBe(true);
    const setCall = (sessions.set as jest.Mock).mock.calls[0];
    // State must remain awaiting_clarification (ADR-11)
    expect(setCall[1].state).toBe('awaiting_clarification');
    expect(setCall[1].clarification.attempts).toBe(1);
  });

  it('empty/short name on attempt 1 → escalate, no draft, evento NOT parked', async () => {
    const dsQueryMock = jest.fn().mockResolvedValue([]);
    const createDraftMock = jest.fn();
    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(buildSessionWithCreate({ attempts: 1 })),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });

    const svc = buildService({
      dsQuery: dsQueryMock,
      sessions,
      projectInboxService: { createDraftFromWhatsApp: createDraftMock },
    });

    const session = buildSessionWithCreate({ attempts: 1 });
    await (svc as any).handleProjectCreateResponse(
      '5491155550000',
      session,
      '', // empty
      'client-1',
    );

    // Draft should NOT be created
    expect(createDraftMock).not.toHaveBeenCalled();
    // Evento should NOT be parked
    const parkCall = dsQueryMock.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'parked'"),
    );
    expect(parkCall).toBeUndefined();
    // Session should be cleared (escalate + delete)
    expect((sessions.delete as jest.Mock)).toHaveBeenCalled();
  });
});

// ─── TASK-A09 — SCENARIO-26 ADR-11 regression guard ─────────────────────────

describe('ClarificationService · ADR-11 regression guard (SCENARIO-26)', () => {
  it('handleClarificationResponse returns false when state is NOT awaiting_clarification', async () => {
    const badSession = {
      state: 'idle', // NOT awaiting_clarification — writer omitted state (the bug)
      clientId: 'client-1',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      canalId: null,
      updatedAt: new Date().toISOString(),
      clarification: {
        eventoCrudoId: 'ec-1',
        type: 'project_create',
        attempts: 0,
        pendingEventoIds: ['ec-1'],
      },
    };

    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(badSession),
    });

    const svc = buildService({ sessions });

    const result = await svc.handleClarificationResponse(
      '5491155550000',
      'Proyecto Test',
      'msg-1',
      null,
    );

    // L97 gate must reject — writer omitted state → returns false
    expect(result).toBe(false);
  });

  it('handleClarificationResponse routes project_create to handleProjectCreateResponse when state is set', async () => {
    const goodSession = {
      state: 'awaiting_clarification', // properly set by writer
      clientId: 'client-1',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      canalId: null,
      updatedAt: new Date().toISOString(),
      clarification: {
        eventoCrudoId: 'ec-1',
        type: 'project_create',
        attempts: 0,
        pendingEventoIds: ['ec-1'],
      },
    };

    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(goodSession),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const createDraftMock = jest.fn().mockResolvedValue({ id: 'draft-1' });

    const svc = buildService({
      sessions,
      dsQuery: jest.fn().mockResolvedValue([]),
      projectInboxService: { createDraftFromWhatsApp: createDraftMock },
    });

    const result = await svc.handleClarificationResponse(
      '5491155550000',
      'Valid Project Name', // >=3 chars valid name
      'msg-1',
      null,
    );

    // Should be routed and handled (true)
    expect(result).toBe(true);
  });
});

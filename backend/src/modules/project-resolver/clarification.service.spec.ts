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

  it('sub-case 2 (facturaId present) → park UPDATE sets reassignment_pending=true (R-06/SCENARIO-18)', async () => {
    const parkQuery = jest.fn().mockResolvedValue([]);
    const createDraftMock = jest.fn().mockResolvedValue({ id: 'draft-rp' });
    const sessions = buildSessions({
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });

    const svc = buildService({
      dsQuery: parkQuery,
      sessions,
      projectInboxService: { createDraftFromWhatsApp: createDraftMock },
    });

    const session = buildSessionWithCreate();
    // sub-case 2: an already-persisted comprobante being re-pointed.
    session.clarification.facturaId = 'fac-99';

    await (svc as any).handleProjectCreateResponse(
      '5491155550000',
      session,
      'Reasignado Con Factura',
      'client-1',
    );

    const parkCall = parkQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'parked'"),
    );
    expect(parkCall).toBeDefined();
    const parsed = JSON.parse(parkCall[1][0]);
    expect(parsed.parked_reason).toBe('project_create');
    expect(parsed.reassignment_pending).toBe(true);
  });

  it('plain Case-3 create (no facturaId) → park UPDATE does NOT set reassignment_pending (R-06)', async () => {
    const parkQuery = jest.fn().mockResolvedValue([]);
    const createDraftMock = jest.fn().mockResolvedValue({ id: 'draft-plain' });
    const sessions = buildSessions({
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });

    const svc = buildService({
      dsQuery: parkQuery,
      sessions,
      projectInboxService: { createDraftFromWhatsApp: createDraftMock },
    });

    // No facturaId on the session (plain create sub-case).
    await (svc as any).handleProjectCreateResponse(
      '5491155550000',
      buildSessionWithCreate(),
      'Proyecto Nuevo Sin Factura',
      'client-1',
    );

    const parkCall = parkQuery.mock.calls.find((c: any[]) =>
      String(c[0]).includes("status = 'parked'"),
    );
    expect(parkCall).toBeDefined();
    const parsed = JSON.parse(parkCall[1][0]);
    expect(parsed.parked_reason).toBe('project_create');
    expect(parsed.reassignment_pending).toBeUndefined();
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

// ─── SLICE C — C04/C05: project_create_offer routing ────────────────────────

describe('ClarificationService · handleClarificationResponse — project_create_offer (C04/C05)', () => {
  /**
   * Builds a session with type='project_create_offer' and state='awaiting_clarification'.
   * autoAssignedProjectId + eventoCrudoId simulate the state set by persist.processor
   * after a single_active_project confirmation.
   */
  function buildOfferSession(opts: { facturaId?: string } = {}): any {
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
        eventoCrudoId: 'ec-55',
        type: 'project_create_offer',
        attempts: 0,
        autoAssignedProjectId: 'proj-solo',
        ...(opts.facturaId ? { facturaId: opts.facturaId } : {}),
      },
    };
  }

  it('C04 — NUEVO reply from MANAGER → transitions to project_create and asks for name', async () => {
    // MANAGER: dsQuery returns a user row for the canCreateProject check
    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("role = 'MANAGER'")) return [{ id: 'user-mgr' }];
      // getUserLanguageForCreate: users.phone check
      if (sql.includes('SELECT language FROM users')) return [{ language: 'es' }];
      return [];
    });

    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(buildOfferSession()),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const waSpy = jest.fn().mockResolvedValue(true);
    const svc = buildService({ dsQuery, sessions, wa: { sendText: waSpy } });

    const result = await svc.handleClarificationResponse('5491155550000', 'NUEVO', 'msg-c04', null);

    // Must be handled (true)
    expect(result).toBe(true);

    // Session must transition to project_create with state=awaiting_clarification (ADR-11)
    const setCall = (sessions.set as jest.Mock).mock.calls.find((args: any[]) =>
      args[1]?.clarification?.type === 'project_create',
    );
    expect(setCall).toBeDefined();
    const savedSession = setCall[1];
    expect(savedSession.state).toBe('awaiting_clarification');
    expect(savedSession.clarification.pendingEventoIds).toContain('ec-55');

    // Name-request message should have been sent
    expect(waSpy).toHaveBeenCalled();
  });

  it('C04 — regex variants (nueva, crear, new, create) all trigger create flow', async () => {
    const variants = ['nueva', 'crear', 'new', 'create', ' NUEVO ', 'Nueva'];
    for (const reply of variants) {
      const sessions = buildSessions({
        get: jest.fn().mockResolvedValue(buildOfferSession()),
        set: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      });
      const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("role = 'MANAGER'")) return [{ id: 'user-mgr' }];
        if (sql.includes('SELECT language FROM users')) return [{ language: 'es' }];
        return [];
      });
      const waSpy = jest.fn().mockResolvedValue(true);
      const svc = buildService({ dsQuery, sessions, wa: { sendText: waSpy } });

      const result = await svc.handleClarificationResponse('5491155550000', reply, 'msg-x', null);
      expect(result).toBe(true);

      const setCall = (sessions.set as jest.Mock).mock.calls.find((args: any[]) =>
        args[1]?.clarification?.type === 'project_create',
      );
      expect(setCall).toBeDefined();
    }
  });

  it('C04 — NUEVO from non-MANAGER → denial message sent, offer cleared, no create', async () => {
    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      // non-MANAGER: returns no rows
      if (sql.includes("role = 'MANAGER'")) return [];
      if (sql.includes('SELECT language FROM users')) return [];
      return [];
    });

    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(buildOfferSession()),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const waSpy = jest.fn().mockResolvedValue(true);
    const createDraftMock = jest.fn();
    const svc = buildService({
      dsQuery,
      sessions,
      wa: { sendText: waSpy },
      projectInboxService: { createDraftFromWhatsApp: createDraftMock },
    });

    const result = await svc.handleClarificationResponse('5491155550000', 'NUEVO', 'msg-c04-deny', null);

    // Must handle it (true) — offer is cleared, denial sent
    expect(result).toBe(true);
    // No draft created
    expect(createDraftMock).not.toHaveBeenCalled();
    // Denial/coordinator message sent
    expect(waSpy).toHaveBeenCalled();
    // Session cleared (delete called)
    expect((sessions.delete as jest.Mock)).toHaveBeenCalled();
    // No project_create transition set
    const createSetCall = (sessions.set as jest.Mock).mock.calls.find((args: any[]) =>
      args[1]?.clarification?.type === 'project_create',
    );
    expect(createSetCall).toBeUndefined();
  });

  it('C05 — non-matching reply returns false, offer session NOT consumed (SCENARIO-20, NFR-07)', async () => {
    // Any text that does not match /^\s*(nuevo|nueva|crear|new|create)\s*$/i
    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(buildOfferSession()),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const waSpy = jest.fn().mockResolvedValue(true);
    const svc = buildService({ sessions, wa: { sendText: waSpy } });

    const nonMatchingReplies = ['hola', 'ok', '123', 'si', 'no', 'gracias', 'nuevo proyecto extra'];
    for (const reply of nonMatchingReplies) {
      const result = await svc.handleClarificationResponse('5491155550000', reply, 'msg-nomatch', null);
      // MUST return false — message proceeds to standard handleText, no session consumed
      expect(result).toBe(false);
    }

    // Session set was NOT called (offer persists until TTL — no session mutation on non-match)
    const offerClearCall = (sessions.delete as jest.Mock).mock.calls;
    expect(offerClearCall.length).toBe(0);
  });

  it('C05 — offer session carries autoAssignedProjectId + eventoCrudoId into project_create transition', async () => {
    const dsQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("role = 'MANAGER'")) return [{ id: 'user-mgr' }];
      if (sql.includes('SELECT language FROM users')) return [{ language: 'es' }];
      return [];
    });

    const sessions = buildSessions({
      get: jest.fn().mockResolvedValue(buildOfferSession({ facturaId: 'FAC-99' })),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    });
    const waSpy = jest.fn().mockResolvedValue(true);
    const svc = buildService({ dsQuery, sessions, wa: { sendText: waSpy } });

    await svc.handleClarificationResponse('5491155550000', 'NUEVO', 'msg-c05-ctx', null);

    const setCall = (sessions.set as jest.Mock).mock.calls.find((args: any[]) =>
      args[1]?.clarification?.type === 'project_create',
    );
    expect(setCall).toBeDefined();
    const clarification = setCall[1].clarification;
    // facturaId must be threaded through to project_create (sub-case 2)
    expect(clarification.facturaId).toBe('FAC-99');
    // eventoCrudoId must be in pendingEventoIds
    expect(clarification.pendingEventoIds).toContain('ec-55');
  });

  it('C05 — ADR-11: project_create_offer state=awaiting_clarification gate (SCENARIO-25)', async () => {
    // If session exists with clarification but state != awaiting_clarification → L97 gate returns false.
    const badSession = {
      state: 'idle', // writer omitted state
      clientId: 'client-1',
      projects: [], base64: '', mimeType: '', caption: '', canalId: null, updatedAt: new Date().toISOString(),
      clarification: {
        eventoCrudoId: 'ec-55',
        type: 'project_create_offer',
        attempts: 0,
        autoAssignedProjectId: 'proj-solo',
      },
    };
    const sessions = buildSessions({ get: jest.fn().mockResolvedValue(badSession) });
    const svc = buildService({ sessions });

    const result = await svc.handleClarificationResponse('5491155550000', 'NUEVO', 'msg-bad', null);
    expect(result).toBe(false);
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

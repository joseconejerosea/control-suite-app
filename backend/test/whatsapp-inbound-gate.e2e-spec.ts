import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WhatsAppWebhookController } from '../src/modules/whatsapp/whatsapp.webhook.controller';
import { WhatsAppTenantSelectionService } from '../src/modules/whatsapp/tenant-selection.service';
import { WhatsAppActionMenuService } from '../src/modules/whatsapp/action-menu.service';
import { normalizePhone } from '../src/common/utils/normalize-phone';

/**
 * WhatsApp inbound tenant resolution — SINGLE GLOBAL NUMBER model.
 *
 * The tenant is resolved from the SENDER (not the recipient phone_number_id):
 *   0 agencies  → ask for an affiliation code
 *   1+ agencies → ask which agency (numbered) + an "otra agencia" (code) option
 *   reply       → resume the BUFFERED intake under the chosen/affiliated agency
 * An ongoing multi-step flow (material/evidence/clarification/project) bypasses
 * resolution and keeps its own tenant.
 *
 * Pattern: direct controller instantiation with mocked deps (no HTTP, no real DB).
 */

const PHONE_DIGITS       = '5491112345678';
const PHONE_MIXED_FORMAT = '+54 9 11 1234-5678';

function textMsg(from: string, body: string, id = `msg-${from}-${body}`) {
  return { id, from, type: 'text', text: { body } };
}

function metaBody(...messages: any[]) {
  return {
    entry: [{ changes: [{ value: { metadata: { phone_number_id: 'global-pnid' }, messages } }] }],
  };
}

function insertHappened(ds: DataSource): boolean {
  return (ds.query as jest.Mock).mock.calls.some(
    (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO eventos_crudos'),
  );
}

function replySent(sendText: jest.Mock, needle: string): boolean {
  return sendText.mock.calls.some(
    (call: any[]) => typeof call[1] === 'string' && call[1].includes(needle),
  );
}

function buildController(opts: {
  queryMocks?: (sql: string, params: any[]) => any[];
  sessionGet?: jest.Mock;
  candidatesFor?: jest.Mock;
  resolveClientByCode?: jest.Mock;
  affiliate?: jest.Mock;
  materialIntake?: any;
  claimMessage?: jest.Mock;
}) {
  const sendText = jest.fn(async (_to: string, _msg: string) => undefined);

  const makeQueryRunner = () => ({
    connect: jest.fn(async () => undefined),
    startTransaction: jest.fn(async () => undefined),
    commitTransaction: jest.fn(async () => undefined),
    rollbackTransaction: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
    isTransactionActive: true,
    query: jest.fn(async () => []),
  });
  const queryMocks = opts.queryMocks ?? (() => []);
  const ds = {
    query: jest.fn(async (sql: string, params: any[]) => queryMocks(sql, params)),
    createQueryRunner: jest.fn(() => makeQueryRunner()),
  } as unknown as DataSource;

  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  const sessions = {
    get: opts.sessionGet ?? jest.fn(async () => null),
    set: jest.fn(),
    delete: jest.fn(),
    updateLastProject: jest.fn(),
    setTenantSelection: jest.fn(),
    clearTenantSelection: jest.fn(),
    setActionMenu: jest.fn(),
    clearActionMenu: jest.fn(),
    claimMessage: opts.claimMessage ?? jest.fn().mockResolvedValue(true),
    releaseMessage: jest.fn().mockResolvedValue(undefined),
  } as any;

  const senderResolver = { candidatesFor: opts.candidatesFor ?? jest.fn(async () => []) } as any;
  const affiliationCode = { resolveClientByCode: opts.resolveClientByCode ?? jest.fn(async () => null) } as any;
  const affiliation = {
    affiliate: opts.affiliate ?? jest.fn(async () => ({ promoterId: 'p1', created: true })),
  } as any;

  const ctrl = new WhatsAppWebhookController(
    { sendText } as any,                                                                          // wa
    sessions,                                                                                      // sessions
    { downloadAndStore: jest.fn() } as any,                                                        // media
    opts.materialIntake ?? { handleResponse: jest.fn(async () => false) } as any,                  // materialIntake
    { handleResponse: jest.fn(async () => false) } as any,                                         // evidenceIntake
    { handleClarificationResponse: jest.fn(async () => false) } as any,                            // clarification
    { resolve: jest.fn(async () => null) } as any,                                                 // projectResolver
    ds,
    { add: jest.fn() } as any,                                                                     // ocrQueue
    { add: jest.fn() } as any,                                                                     // convocatoriaQueue
    { add: jest.fn() } as any,                                                                     // returnPhotoQueue
    { checkLocal: jest.fn(() => ({ safe: true, sanitized: 'hola', category: 'safe' })) } as any,   // shield
    senderResolver,                                                                                // senderResolver
    new WhatsAppTenantSelectionService(),                                                          // selection (real)
    new WhatsAppActionMenuService(),                                                                // actionMenu (real)
    affiliationCode,                                                                               // affiliationCode
    affiliation,                                                                                   // affiliation
    { f1EventsTotal: { inc: jest.fn() } } as any,                                                  // metrics
    { route: jest.fn(async () => undefined) } as any,                                              // photoRouter (A3)
    { add: jest.fn() } as any,                                                                     // photoTriageQueue (A3)
  );

  return { ctrl, ds, sendText, sessions, senderResolver, affiliationCode, affiliation };
}

/** queryMock that never duplicates and records the eventos_crudos insert. */
const persistQuery = (sql: string) => {
  if (sql.includes('WHERE idempotency_key')) return [];
  if (sql.includes('convocatorias')) return [];
  if (sql.includes('stock_return_requests')) return [];
  if (sql.includes('INSERT INTO eventos_crudos')) return [{ id: 'evt-1' }];
  return [];
};

describe('normalizePhone', () => {
  it('extracts digits from varied formats', () => {
    expect(normalizePhone(PHONE_MIXED_FORMAT)).toBe(PHONE_DIGITS);
    expect(normalizePhone('(549) 11-1234')).toBe('549111234');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });
});

describe('WhatsApp inbound tenant resolution (single global number)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('unknown sender (0 agencies) → asks for the affiliation code, does not persist', async () => {
    const { ctrl, sendText, ds, sessions } = buildController({
      queryMocks: persistQuery,
      candidatesFor: jest.fn(async () => []),
    });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, 'hola')));

    expect(replySent(sendText, 'código de afiliación')).toBe(true);
    expect(insertHappened(ds)).toBe(false);
    expect(sessions.setTenantSelection).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ candidates: [] }),
      'awaiting_affiliation_code',
    );
  });

  it('sender with agencies (1+) → always asks which agency and buffers, does not persist', async () => {
    const { ctrl, sendText, ds, sessions } = buildController({
      queryMocks: persistQuery,
      candidatesFor: jest.fn(async () => [{ clientId: 'c1', clientName: 'Agencia Uno' }]),
    });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, 'hola')));

    expect(replySent(sendText, '¿Para qué agencia')).toBe(true);
    expect(replySent(sendText, 'Otra agencia')).toBe(true);
    expect(insertHappened(ds)).toBe(false);
    expect(sessions.setTenantSelection).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ candidates: [{ clientId: 'c1', clientName: 'Agencia Uno' }] }),
      'awaiting_tenant',
    );
  });

  it('agency selection reply → resumes the buffered intake and persists under the chosen agency', async () => {
    const pendingMsg = textMsg(PHONE_DIGITS, 'una novedad', 'buffered-1');
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_tenant',
      tenantSelection: {
        candidates: [{ clientId: 'c1', clientName: 'Agencia Uno' }],
        pendingMsg,
        canalId: null,
        attempts: 0,
      },
    }));
    const { ctrl, ds, sessions } = buildController({ queryMocks: persistQuery, sessionGet });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, '1')));

    expect(sessions.clearTenantSelection).toHaveBeenCalled();
    expect(insertHappened(ds)).toBe(true); // buffered intake processed
  });

  it('choosing "otra agencia" → switches to affiliation-code entry', async () => {
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_tenant',
      tenantSelection: {
        candidates: [{ clientId: 'c1', clientName: 'Agencia Uno' }],
        pendingMsg: textMsg(PHONE_DIGITS, 'hola', 'buf'),
        canalId: null,
        attempts: 0,
      },
    }));
    const { ctrl, sendText, sessions } = buildController({ queryMocks: persistQuery, sessionGet });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, '2'))); // index past the 1 candidate = "otra"

    expect(sessions.setTenantSelection).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      'awaiting_affiliation_code',
    );
    expect(replySent(sendText, 'código de afiliación')).toBe(true);
  });

  it('valid affiliation code → affiliates as active promoter and resumes the buffered intake', async () => {
    const pendingMsg = textMsg(PHONE_DIGITS, 'una novedad', 'buffered-2');
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_affiliation_code',
      tenantSelection: { candidates: [], pendingMsg, canalId: null, attempts: 0 },
    }));
    const affiliate = jest.fn(async () => ({ promoterId: 'p1', created: true }));
    const { ctrl, ds, sessions } = buildController({
      queryMocks: persistQuery,
      sessionGet,
      resolveClientByCode: jest.fn(async () => 'c9'),
      affiliate,
    });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, 'ABCD1234')));

    expect(affiliate).toHaveBeenCalledWith('c9', expect.any(String));
    expect(sessions.clearTenantSelection).toHaveBeenCalled();
    expect(insertHappened(ds)).toBe(true);
  });

  it('invalid affiliation code → rejects, does not affiliate, does not persist', async () => {
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_affiliation_code',
      tenantSelection: { candidates: [], pendingMsg: textMsg(PHONE_DIGITS, 'x', 'buf'), canalId: null, attempts: 0 },
    }));
    const affiliate = jest.fn();
    const { ctrl, sendText, ds } = buildController({
      queryMocks: persistQuery,
      sessionGet,
      resolveClientByCode: jest.fn(async () => null),
      affiliate,
    });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, 'NOPE')));

    expect(affiliate).not.toHaveBeenCalled();
    expect(replySent(sendText, 'inválido')).toBe(true);
    expect(insertHappened(ds)).toBe(false);
  });

  it('repeated invalid codes reach the attempt cap → aborts and clears the selection', async () => {
    // Session already at attempts=4; the 5th invalid code hits MAX_TENANT_SELECTION_ATTEMPTS.
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_affiliation_code',
      tenantSelection: {
        candidates: [],
        pendingMsg: textMsg(PHONE_DIGITS, 'x', 'buf'),
        canalId: null,
        attempts: 4,
      },
    }));
    const { ctrl, sendText, sessions } = buildController({
      queryMocks: persistQuery,
      sessionGet,
      resolveClientByCode: jest.fn(async () => null),
    });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, 'NOPE')));

    expect(replySent(sendText, 'Demasiados intentos')).toBe(true);
    expect(sessions.clearTenantSelection).toHaveBeenCalled();
  });

  it('invalid code below the cap → increments attempts and re-prompts, keeps the intake', async () => {
    const pendingMsg = textMsg(PHONE_DIGITS, 'una novedad', 'buf');
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_affiliation_code',
      tenantSelection: { candidates: [], pendingMsg, canalId: null, attempts: 1 },
    }));
    const { ctrl, sendText, sessions } = buildController({
      queryMocks: persistQuery,
      sessionGet,
      resolveClientByCode: jest.fn(async () => null),
    });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, 'NOPE')));

    expect(replySent(sendText, 'inválido')).toBe(true);
    expect(sessions.clearTenantSelection).not.toHaveBeenCalled();
    expect(sessions.setTenantSelection).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ attempts: 2, pendingMsg }),
      'awaiting_affiliation_code',
    );
  });

  it('repeated invalid agency selections reach the cap → aborts and clears the selection', async () => {
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_tenant',
      tenantSelection: {
        candidates: [{ clientId: 'c1', clientName: 'Agencia Uno' }],
        pendingMsg: textMsg(PHONE_DIGITS, 'x', 'buf'),
        canalId: null,
        attempts: 4,
      },
    }));
    const { ctrl, sendText, sessions } = buildController({ queryMocks: persistQuery, sessionGet });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, '99'))); // out of range = invalid

    expect(replySent(sendText, 'Demasiados intentos')).toBe(true);
    expect(sessions.clearTenantSelection).toHaveBeenCalled();
  });

  it('non-text reply mid-selection → re-prompts with a hint, keeps the buffered intake', async () => {
    const pendingMsg = textMsg(PHONE_DIGITS, 'una novedad', 'buf');
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_tenant',
      tenantSelection: {
        candidates: [{ clientId: 'c1', clientName: 'Agencia Uno' }],
        pendingMsg,
        canalId: null,
        attempts: 0,
      },
    }));
    const { ctrl, sendText, sessions, ds } = buildController({ queryMocks: persistQuery, sessionGet });

    // An image arrives while we asked "which agency?" — not a usable reply.
    await ctrl.handleIncoming(
      metaBody({ id: 'img-mid', from: PHONE_DIGITS, type: 'image', image: { id: 'meta-media-1' } }),
    );

    expect(replySent(sendText, 'número de la agencia')).toBe(true);
    expect(insertHappened(ds)).toBe(false);
    expect(sessions.setTenantSelection).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ attempts: 1, pendingMsg }),
      'awaiting_tenant',
    );
  });

  it('candidatesFor DB error → tells the sender to retry, does NOT prompt for a code', async () => {
    const candidatesFor = jest.fn(async () => {
      throw new Error('connection reset');
    });
    const { ctrl, sendText, sessions } = buildController({
      queryMocks: persistQuery,
      candidatesFor,
    });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, 'hola')));

    expect(replySent(sendText, 'probá de nuevo')).toBe(true);
    expect(replySent(sendText, 'código de afiliación')).toBe(false);
    expect(sessions.setTenantSelection).not.toHaveBeenCalled();
  });

  it('ongoing multi-step flow (awaiting_material) → bypasses resolution, keeps its tenant', async () => {
    const materialIntake = { handleResponse: jest.fn(async () => true) };
    const sessionGet = jest.fn(async () => ({ state: 'awaiting_material', clientId: 'c1' }));
    const { ctrl, senderResolver } = buildController({
      queryMocks: persistQuery,
      sessionGet,
      candidatesFor: jest.fn(async () => [{ clientId: 'zzz', clientName: 'Otra' }]),
      materialIntake,
    });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, '3 cajas')));

    // The ongoing flow handled it; the tenant was NOT re-resolved.
    expect(materialIntake.handleResponse).toHaveBeenCalled();
    expect(senderResolver.candidatesFor).not.toHaveBeenCalled();
  });
});

describe('WhatsApp action menu (text-only after agency)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('plain text with a resolved tenant (no active flow) → shows the menu and arms awaiting_action', async () => {
    // Resume path: the sender picked their agency; the buffered free-text now reaches
    // handleText with no matching intake, so we offer the action menu instead of a
    // generic "message received".
    const pendingMsg = textMsg(PHONE_DIGITS, 'buenas', 'buffered-menu');
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_tenant',
      tenantSelection: {
        candidates: [{ clientId: 'c1', clientName: 'Agencia Uno' }],
        pendingMsg,
        canalId: null,
        attempts: 0,
      },
    }));
    const { ctrl, sendText, sessions } = buildController({ queryMocks: persistQuery, sessionGet });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, '1')));

    expect(replySent(sendText, '¿Qué querés hacer')).toBe(true);
    expect(sessions.setActionMenu).toHaveBeenCalledWith(expect.any(String), 'c1');
  });

  it('awaiting_action + valid number → guides the sender to send that content, no new menu', async () => {
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_action',
      clientId: 'c1',
      canalId: null,
    }));
    const { ctrl, sendText, sessions, ds } = buildController({ queryMocks: persistQuery, sessionGet });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, '1')));

    expect(replySent(sendText, 'foto de la factura')).toBe(true);
    expect(replySent(sendText, '¿Qué querés hacer')).toBe(false);
    expect(sessions.setActionMenu).not.toHaveBeenCalled();
    expect(insertHappened(ds)).toBe(false);
  });

  it('awaiting_action + unrecognized reply → re-shows the menu, does not persist', async () => {
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_action',
      clientId: 'c1',
      canalId: null,
    }));
    const { ctrl, sendText, ds } = buildController({ queryMocks: persistQuery, sessionGet });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, 'no sé')));

    expect(replySent(sendText, 'No entendí')).toBe(true);
    expect(replySent(sendText, '¿Qué querés hacer')).toBe(true);
    expect(insertHappened(ds)).toBe(false);
  });

  it('awaiting_action + open convocatoria + free-text reply → routes to F4, not the menu', async () => {
    // A sender parked in awaiting_action who then gets convoked and replies "si" must
    // reach the F4 classifier — the soft menu state must NOT swallow the convocatoria reply.
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_action',
      clientId: 'c1',
      canalId: null,
    }));
    const withConvocatoria = (sql: string) => {
      if (sql.includes('FROM convocatorias')) return [{ ok: 1 }];
      return persistQuery(sql);
    };
    const { ctrl, sendText, ds } = buildController({ queryMocks: withConvocatoria, sessionGet });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, 'si')));

    expect(insertHappened(ds)).toBe(true);          // persisted as an F4 reply
    expect(replySent(sendText, 'No entendí')).toBe(false);
    expect(replySent(sendText, '¿Qué querés hacer')).toBe(false);
  });

  it('media while awaiting_action → clears the menu state so the follow-up is not parsed as a choice', async () => {
    const sessionGet = jest.fn(async () => ({
      state: 'awaiting_action',
      clientId: 'c1',
      canalId: null,
    }));
    const { ctrl, sessions } = buildController({ queryMocks: persistQuery, sessionGet });

    await ctrl.handleIncoming(
      metaBody({ id: 'img-act', from: PHONE_DIGITS, type: 'image', image: { id: 'meta-media-2' } }),
    );

    expect(sessions.clearActionMenu).toHaveBeenCalledWith(expect.any(String));
  });
});

describe('WhatsApp inbound atomic dedup', () => {
  beforeEach(() => jest.clearAllMocks());

  it('claimMessage=false (duplicate) → not processed, tenant not resolved', async () => {
    const candidatesFor = jest.fn(async () => []);
    const { ctrl, ds, sessions, senderResolver } = buildController({
      queryMocks: persistQuery,
      candidatesFor,
      claimMessage: jest.fn().mockResolvedValue(false),
    });

    await ctrl.handleIncoming(metaBody(textMsg(PHONE_DIGITS, 'hola')));

    expect(sessions.claimMessage).toHaveBeenCalledTimes(1);
    expect(senderResolver.candidatesFor).not.toHaveBeenCalled();
    expect(insertHappened(ds)).toBe(false);
  });
});

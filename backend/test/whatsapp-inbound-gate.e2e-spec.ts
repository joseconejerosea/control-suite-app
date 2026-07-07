import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WhatsAppWebhookController } from '../src/modules/whatsapp/whatsapp.webhook.controller';
import { normalizePhone } from '../src/common/utils/normalize-phone';

/**
 * Gate de sender entrante de WhatsApp.
 *
 * Patrón: instanciación directa del controller con dependencias mockeadas,
 * igual que prompt-shield.e2e-spec.ts y webhook-signature.e2e-spec.ts.
 * NO se levanta HTTP ni se toca la DB real.
 *
 * IMPORTANTE — diseño anti-tautología:
 *   El mock del gate (query UNION promoters/collaborators) autoriza SOLO si
 *   recibe los `params` esperados: [clientId, digitosNormalizados]. Así, si se
 *   rompiera `normalizePhone` o se dejara de pasar `clientId`, los tests de
 *   "autorizado" pasarían a FALLAR (el mock devolvería [] → no autorizado).
 *   Sin esto, el mock aprobaría siempre y el test no probaría nada.
 *
 * Caso (e) aislamiento de tenant a nivel SQL/RLS real: documentado al pie.
 */

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLIENT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** Número tal como lo manda Meta: solo dígitos, sin '+' */
const PHONE_DIGITS         = '5491112345678';
/** Mismo número con formato "humano" (como podría estar en la DB / o llegar) */
const PHONE_MIXED_FORMAT   = '+54 9 11 1234-5678';
const UNKNOWN_PHONE        = '5491199999999';

// sanity: ambos formatos normalizan al mismo dígito-string
expectSameDigits();
function expectSameDigits() {
  if (normalizePhone(PHONE_MIXED_FORMAT) !== PHONE_DIGITS) {
    throw new Error(
      `Fixture inválido: normalizePhone('${PHONE_MIXED_FORMAT}')='${normalizePhone(PHONE_MIXED_FORMAT)}' != '${PHONE_DIGITS}'`,
    );
  }
}

/** Construye un payload Meta mínimo con un mensaje de texto */
function metaBody(from: string, phoneNumberId = 'pnid-a') {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: phoneNumberId },
          messages: [{
            id: `msg-${from}-${Math.random()}`,
            from,
            type: 'text',
            text: { body: 'hola' },
          }],
        },
      }],
    }],
  };
}

type QueryMock = (sql: string, params: any[]) => any[];

// ─── Builder de controller con mocks ─────────────────────────────────────────

function buildController(opts: {
  queryMocks: QueryMock;
  sendTextMock?: jest.Mock;
}) {
  // Tipado explícito de args → permite destructurar [, msg] sin error TS.
  const sendText = opts.sendTextMock ?? jest.fn(async (_to: string, _msg: string) => undefined);

  // async → el mock devuelve una Promesa (el ds.query real lo es), así
  // `.catch(...)` que usa el controller en isDuplicate/resolveChannel existe.
  const ds = {
    query: jest.fn(async (sql: string, params: any[]) => opts.queryMocks(sql, params)),
  } as unknown as DataSource;

  const wa = { sendText } as any;

  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  const ctrl = new WhatsAppWebhookController(
    wa,
    { get: jest.fn(), set: jest.fn(), delete: jest.fn(), updateLastProject: jest.fn() } as any, // sessions
    { downloadAndStore: jest.fn() } as any,                                                       // media
    { handleClarificationResponse: jest.fn(async () => false) } as any,                          // clarification
    { resolve: jest.fn(async () => null) } as any,                                                // projectResolver
    ds,
    { add: jest.fn() } as any,                                                                    // ocrQueue
    { checkLocal: jest.fn(() => ({ safe: true, sanitized: 'hola', category: 'safe' })) } as any, // shield
  );

  return { ctrl, ds, sendText };
}

/** ¿Se envió el aviso de "no registrado"? cuántas veces */
function notifyCount(sendText: jest.Mock): number {
  return sendText.mock.calls.filter(
    (call: any[]) => typeof call[1] === 'string' && call[1].includes('No estás registrado'),
  ).length;
}

/** ¿Se ejecutó un INSERT a eventos_crudos? (= el mensaje se procesó/persistió) */
function insertHappened(ds: DataSource): boolean {
  return (ds.query as jest.Mock).mock.calls.some(
    (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO eventos_crudos'),
  );
}

// ─── queryMock que AUTORIZA solo con los params correctos (anti-tautología) ───

/**
 * Autoriza únicamente si la query del gate recibe params === [clientId, digits].
 * Si normalizePhone se rompe o no se pasa clientId, devuelve [] → no autoriza.
 * `insertSpy` registra si se intentó persistir el evento (procesamiento real).
 */
function authorizeWhen(opts: {
  channelClientId: string;
  expectClientId: string;
  expectDigits: string;
  insertSpy?: jest.Mock;
}): QueryMock {
  return (sql, params) => {
    if (sql.includes('canal_entrada')) {
      return [{ client_id: opts.channelClientId, id: 'canal-1' }];
    }
    if (sql.includes('eventos_crudos') && sql.includes('WHERE idempotency_key')) {
      return []; // no duplicado
    }
    if (sql.includes('promoters') && sql.includes('collaborators')) {
      const [cid, digits] = params;
      const ok = cid === opts.expectClientId && digits === opts.expectDigits;
      return ok ? [{ ok: 1 }] : [];
    }
    if (sql.includes('INSERT INTO eventos_crudos')) {
      opts.insertSpy?.();
      return [{ id: 'evt-1' }];
    }
    return [];
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('normalizePhone', () => {
  it('extrae solo dígitos de formatos variados', () => {
    expect(normalizePhone('+54 9 11 1234-5678')).toBe('5491112345678');
    expect(normalizePhone('5491112345678')).toBe('5491112345678');
    expect(normalizePhone('(549) 11-1234')).toBe('549111234');
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
    expect(normalizePhone('')).toBe('');
  });
});

describe('WhatsApp inbound sender gate', () => {
  const origGate = process.env.WHATSAPP_SENDER_GATE;

  beforeEach(() => {
    delete process.env.WHATSAPP_SENDER_GATE; // gate activo por default
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (origGate !== undefined) process.env.WHATSAPP_SENDER_GATE = origGate;
    else delete process.env.WHATSAPP_SENDER_GATE;
  });

  // (a) Autorizado → procesa (NO aviso) Y persiste el evento (procesamiento real)
  it('(a) sender autorizado → procesa el mensaje (sin aviso, con persistencia)', async () => {
    const { ctrl, sendText, ds } = buildController({
      queryMocks: authorizeWhen({
        channelClientId: CLIENT_A, expectClientId: CLIENT_A, expectDigits: PHONE_DIGITS,
      }),
    });

    await ctrl.handleIncoming(metaBody(PHONE_DIGITS));

    expect(notifyCount(sendText)).toBe(0);
    expect(insertHappened(ds)).toBe(true); // el mensaje SÍ se procesó (INSERT eventos_crudos)
  });

  // (c) No registrado → aviso exactamente una vez, NO persiste, NO encola
  it('(c) sender no registrado → aviso (1) y NO persiste', async () => {
    const { ctrl, sendText, ds } = buildController({
      queryMocks: authorizeWhen({
        channelClientId: CLIENT_A, expectClientId: CLIENT_A, expectDigits: PHONE_DIGITS,
      }),
    });

    await ctrl.handleIncoming(metaBody(UNKNOWN_PHONE)); // distinto a PHONE_DIGITS → no matchea

    expect(notifyCount(sendText)).toBe(1);
    expect(insertHappened(ds)).toBe(false); // no se procesó nada
  });

  // (d) Formato mixto → normaliza ANTES de la query y autoriza.
  //     ESTE test FALLA si normalizePhone deja de aplicarse: el mock exige
  //     digits === PHONE_DIGITS, pero `from` llega como PHONE_MIXED_FORMAT.
  it('(d) formato mixto → normaliza y autoriza (no-tautológico)', async () => {
    const { ctrl, sendText, ds } = buildController({
      queryMocks: authorizeWhen({
        channelClientId: CLIENT_A, expectClientId: CLIENT_A, expectDigits: PHONE_DIGITS,
      }),
    });

    await ctrl.handleIncoming(metaBody(PHONE_MIXED_FORMAT));

    expect(notifyCount(sendText)).toBe(0);

    // Aserción dura: la query del gate recibió los dígitos normalizados, no el crudo.
    const gateCall = (ds.query as jest.Mock).mock.calls.find(
      ([sql]: any[]) => typeof sql === 'string' && sql.includes('promoters') && sql.includes('collaborators'),
    );
    expect(gateCall).toBeDefined();
    expect(gateCall![1]).toEqual([CLIENT_A, PHONE_DIGITS]);
  });

  // (e-unit) Aislamiento de tenant a nivel de parámetro: el clientId del canal
  //          se pasa al gate. Un número que solo autorizaría en CLIENT_B no
  //          pasa cuando el canal resuelve CLIENT_A.
  it('(e-unit) número de otro tenant → no autoriza (clientId se pasa al gate)', async () => {
    const { ctrl, sendText } = buildController({
      // El canal resuelve CLIENT_A, pero el gate solo autorizaría a CLIENT_B.
      queryMocks: authorizeWhen({
        channelClientId: CLIENT_A, expectClientId: CLIENT_B, expectDigits: PHONE_DIGITS,
      }),
    });

    await ctrl.handleIncoming(metaBody(PHONE_DIGITS));

    expect(notifyCount(sendText)).toBe(1); // bloqueado por scoping de tenant
  });

  // (f) Inactivo → la query UNION (status='active'/is_active=true) devuelve []
  it('(f) promoter inactivo / collaborator inactivo → bloquea y avisa', async () => {
    const { ctrl, sendText } = buildController({
      // Aunque el número y el tenant coincidan, simulamos que la UNION no matchea
      // (porque status != 'active'): devolvemos [] siempre para el gate.
      queryMocks: (sql, params) => {
        if (sql.includes('canal_entrada')) return [{ client_id: CLIENT_A, id: 'canal-1' }];
        if (sql.includes('WHERE idempotency_key')) return [];
        if (sql.includes('promoters') && sql.includes('collaborators')) return []; // inactivo
        return [];
      },
    });

    await ctrl.handleIncoming(metaBody(PHONE_DIGITS));

    expect(notifyCount(sendText)).toBe(1);
  });

  // Toggle off → no se consulta el gate, cualquier sender pasa
  it('WHATSAPP_SENDER_GATE=off → bypassa el gate sin consultar la UNION', async () => {
    process.env.WHATSAPP_SENDER_GATE = 'off';
    const gateSpy = jest.fn();
    const { ctrl, sendText } = buildController({
      queryMocks: (sql, params) => {
        if (sql.includes('canal_entrada')) return [{ client_id: CLIENT_A, id: 'canal-1' }];
        if (sql.includes('WHERE idempotency_key')) return [];
        if (sql.includes('promoters') && sql.includes('collaborators')) { gateSpy(); return []; }
        if (sql.includes('INSERT INTO eventos_crudos')) return [{ id: 'evt-1' }];
        return [];
      },
    });

    await ctrl.handleIncoming(metaBody(UNKNOWN_PHONE));

    expect(gateSpy).not.toHaveBeenCalled();
    expect(notifyCount(sendText)).toBe(0);
  });

  // Batch: 2 mensajes del mismo sender no-registrado → UN solo aviso (cache)
  it('batch del mismo sender no-registrado → aviso una sola vez', async () => {
    const { ctrl, sendText } = buildController({
      queryMocks: (sql, params) => {
        if (sql.includes('canal_entrada')) return [{ client_id: CLIENT_A, id: 'canal-1' }];
        if (sql.includes('WHERE idempotency_key')) return [];
        if (sql.includes('promoters') && sql.includes('collaborators')) return [];
        return [];
      },
    });

    const batch = {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'pnid-a' },
        messages: [
          { id: 'msg-1', from: UNKNOWN_PHONE, type: 'text', text: { body: 'hola' } },
          { id: 'msg-2', from: UNKNOWN_PHONE, type: 'text', text: { body: 'mundo' } },
        ],
      } }] }],
    };

    await ctrl.handleIncoming(batch);

    expect(notifyCount(sendText)).toBe(1);
  });

  // Fail-closed: error de DB en el gate → bloquea, no propaga la excepción
  it('error de DB en el gate → fail-closed (bloquea, no propaga)', async () => {
    const { ctrl, sendText } = buildController({
      queryMocks: (sql, params) => {
        if (sql.includes('canal_entrada')) return [{ client_id: CLIENT_A, id: 'canal-1' }];
        if (sql.includes('WHERE idempotency_key')) return [];
        if (sql.includes('promoters') && sql.includes('collaborators')) {
          throw new Error('DB connection lost');
        }
        return [];
      },
    });

    await expect(ctrl.handleIncoming(metaBody(PHONE_DIGITS))).resolves.toBe('ok');
    expect(notifyCount(sendText)).toBe(1);
  });
});

/*
 * ── Caso pendiente y razón ────────────────────────────────────────────────────
 *
 * (e) Aislamiento de tenant a nivel SQL/RLS REAL (no solo de parámetro).
 *     (e-unit) ya prueba que `clientId` se pasa al gate. Para verificar el
 *     aislamiento end-to-end (RLS de Postgres + filas reales en promoters/
 *     collaborators de tenants distintos) hace falta el cluster PG de test, como
 *     en rls-e2e-integral.e2e-spec.ts (requiere DB_HOST al PG de test y bootstrap
 *     del módulo con BullMQ). Recomendado agregar esa suite cuando el cluster
 *     esté disponible en CI.
 */

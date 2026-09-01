/// <reference types="jest" />
/**
 * photo-triage.processor.spec.ts — A3 síntoma 1
 *
 * La visión IA clasifica una foto entrante SIN tipo elegido y, si está MUY confiada
 * (confidence >= 0.85), auto-rutea salteando el menú "¿Qué es esta foto?". Si duda,
 * cae al menú (red de seguridad reintroducida de forma segura tras T3).
 *
 * Casos:
 *  (a) material alta confianza  → photoRouter.route('material', …, suggestedLabel) + NO menú.
 *  (b) confianza baja           → buildTypeMenu(), NO rutea.
 *  (c) no_clasificable          → buildTypeMenu(), NO rutea.
 *  (d) factura alta confianza   → photoRouter.route('factura', …), NO menú.
 *  (e) error de IA              → buildTypeMenu() (fallback), NO rutea.
 *  (f) mime PDF                 → buildTypeMenu() sin llamar a la visión.
 *  (g) evidencia alta confianza → photoRouter.route('evidencia', …), NO menú.
 *  (h) borde del umbral         → 0.85 auto-rutea (>= inclusivo); 0.84 cae al menú.
 *  (i) parseo de classifyPhoto  → fetch mockeado: fences ```json parsea OK; JSON basura → menú.
 *
 * El seam que gobierna el ruteo es el RESULTADO de la clasificación, así que stubbeamos
 * `classifyPhoto` (como classify.spec stubbea `callClaude`) en vez de `fetch`. El caso (e)
 * simula una excepción de la visión rechazando ese stub.
 */
import { Job } from 'bullmq';
import { PhotoTriageProcessor } from './photo-triage.processor';

// ─── helpers ─────────────────────────────────────────────────────────────────

interface BuildOpts {
  classifyResult?: any;
  classifyThrows?: boolean;
  routeMock?: jest.Mock;
  sendText?: jest.Mock;
  clearMediaFlow?: jest.Mock;
  storageDownload?: jest.Mock;
}

const MENU =
  '¿Qué es esta foto? Respondé con el número:\n' +
  '1) Factura o boleta\n' +
  '2) Material POP\n' +
  '3) Evidencia de actividad';

function buildProcessor(opts: BuildOpts = {}) {
  const route = opts.routeMock ?? jest.fn().mockResolvedValue(undefined);
  const sendText = opts.sendText ?? jest.fn().mockResolvedValue(true);
  const clearMediaFlow = opts.clearMediaFlow ?? jest.fn().mockResolvedValue(undefined);

  const queryFn = jest.fn().mockResolvedValue([]);
  const dataSource = { query: queryFn } as any;

  const storageDownload =
    opts.storageDownload ?? jest.fn().mockResolvedValue(Buffer.from('fake-bytes'));
  const storage = { download: storageDownload } as any;

  const wa = { sendText } as any;
  const sessions = { clearMediaFlow } as any;
  const photoRouter = { route } as any;
  const actionMenu = {
    buildTypeMenu: () => MENU,
  } as any;
  const config = { get: jest.fn().mockReturnValue('test-key') } as any;
  const metricsInc = jest.fn();
  const metrics = { f1EventsTotal: { inc: metricsInc } } as any;

  const processor = new PhotoTriageProcessor(
    dataSource,
    config,
    storage,
    wa,
    sessions,
    actionMenu,
    photoRouter,
    metrics,
  );

  // Stub del seam de visión: controla el resultado de la clasificación sin HTTP real.
  if (opts.classifyThrows) {
    (processor as any).classifyPhoto = jest.fn().mockRejectedValue(new Error('AI down'));
  } else {
    const result =
      opts.classifyResult ??
      { tipo: 'material', confidence: 0.95, sugerencia: 'Volumétrico', usage: null };
    (processor as any).classifyPhoto = jest.fn().mockResolvedValue(result);
  }

  return { processor, route, sendText, clearMediaFlow, queryFn, storageDownload, metricsInc };
}

function buildJob(overrides: Partial<any> = {}): Job<any> {
  return {
    id: 'job-1',
    attemptsMade: 0,
    opts: { attempts: 3 },
    data: {
      evento_crudo_id: 'ec-1',
      client_id: 'client-1',
      canal: 'whatsapp',
      from: '5491155550000',
      storage_path: 'documents/photo.jpg',
      mime_type: 'image/jpeg',
      canal_id: 'canal-1',
      ...overrides,
    },
  } as any;
}

// ─── (a) material alta confianza ──────────────────────────────────────────────

describe('PhotoTriageProcessor · (a) material alta confianza → auto-rutea', () => {
  it('llama photoRouter.route con material + suggestedLabel y NO manda el menú', async () => {
    const { processor, route, sendText, clearMediaFlow, metricsInc } = buildProcessor({
      classifyResult: { tipo: 'material', confidence: 0.9, sugerencia: 'Volumétrico', usage: null },
    });

    await (processor as any).process(buildJob());

    expect(route).toHaveBeenCalledTimes(1);
    const args = route.mock.calls[0];
    // route(from, clientId, canalId, messageId, type, media, existingEventId, suggestedLabel, suppressFacturaAck)
    expect(args[4]).toBe('material');
    expect(args[6]).toBe('ec-1');       // existingEventId = evento buffereado
    expect(args[7]).toBe('Volumétrico'); // suggestedLabel
    expect(args[8]).toBe(true);          // suppressFacturaAck (evita doble ack en factura)
    // Limpia el awaiting_type antes de arrancar el intake.
    expect(clearMediaFlow).toHaveBeenCalledWith('5491155550000');
    // NO mandó el menú.
    expect(sendText).not.toHaveBeenCalledWith('5491155550000', MENU);
    // Observabilidad (FIX 5): cuenta como auto-ruteo, NO menú.
    expect(metricsInc).toHaveBeenCalledWith({ client_id: 'client-1', canal: 'whatsapp', status: 'photo_auto_material' });
  });
});

// ─── (b) confianza baja ───────────────────────────────────────────────────────

describe('PhotoTriageProcessor · (b) confianza baja → menú', () => {
  it('manda buildTypeMenu() y NO rutea', async () => {
    const { processor, route, sendText, clearMediaFlow, metricsInc } = buildProcessor({
      classifyResult: { tipo: 'material', confidence: 0.5, sugerencia: null, usage: null },
    });

    await (processor as any).process(buildJob());

    expect(route).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith('5491155550000', MENU);
    // Deja la sesión en awaiting_type (NO la limpia).
    expect(clearMediaFlow).not.toHaveBeenCalled();
    // Observabilidad (FIX 5): cuenta como fallback al menú, NO auto-ruteo.
    expect(metricsInc).toHaveBeenCalledWith({ client_id: 'client-1', canal: 'whatsapp', status: 'photo_menu' });
  });
});

// ─── (c) no_clasificable ──────────────────────────────────────────────────────

describe('PhotoTriageProcessor · (c) no_clasificable → menú', () => {
  it('manda el menú aunque la confianza sea alta', async () => {
    const { processor, route, sendText } = buildProcessor({
      classifyResult: { tipo: 'no_clasificable', confidence: 0.99, sugerencia: null, usage: null },
    });

    await (processor as any).process(buildJob());

    expect(route).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith('5491155550000', MENU);
  });
});

// ─── (d) factura alta confianza ───────────────────────────────────────────────

describe('PhotoTriageProcessor · (d) factura alta confianza → auto-rutea a OCR', () => {
  it('llama photoRouter.route con factura y NO manda el menú', async () => {
    const { processor, route, sendText } = buildProcessor({
      classifyResult: { tipo: 'factura', confidence: 0.97, sugerencia: null, usage: null },
    });

    await (processor as any).process(buildJob());

    expect(route).toHaveBeenCalledTimes(1);
    expect(route.mock.calls[0][4]).toBe('factura');
    expect(route.mock.calls[0][6]).toBe('ec-1');
    expect(sendText).not.toHaveBeenCalledWith('5491155550000', MENU);
  });
});

// ─── (e) error de IA → fallback al menú ───────────────────────────────────────

describe('PhotoTriageProcessor · (e) error de IA → menú (fallback)', () => {
  it('nunca deja al usuario colgado: manda el menú y NO rutea', async () => {
    const { processor, route, sendText } = buildProcessor({ classifyThrows: true });

    await (processor as any).process(buildJob());

    expect(route).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith('5491155550000', MENU);
  });
});

// ─── (f) mime PDF → menú sin visión ───────────────────────────────────────────

describe('PhotoTriageProcessor · (f) mime PDF → menú sin clasificar', () => {
  it('no clasifica por visión y cae al menú', async () => {
    const { processor, route, sendText, storageDownload } = buildProcessor();
    const classifySpy = (processor as any).classifyPhoto as jest.Mock;

    await (processor as any).process(buildJob({ mime_type: 'application/pdf' }));

    expect(classifySpy).not.toHaveBeenCalled();
    expect(storageDownload).not.toHaveBeenCalled();
    expect(route).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith('5491155550000', MENU);
  });
});

// ─── (g) evidencia alta confianza ─────────────────────────────────────────────

describe('PhotoTriageProcessor · (g) evidencia alta confianza → auto-rutea', () => {
  it('llama photoRouter.route con evidencia y NO manda el menú', async () => {
    const { processor, route, sendText } = buildProcessor({
      classifyResult: { tipo: 'evidencia', confidence: 0.9, sugerencia: null, usage: null },
    });

    await (processor as any).process(buildJob());

    expect(route).toHaveBeenCalledTimes(1);
    expect(route.mock.calls[0][4]).toBe('evidencia');
    expect(route.mock.calls[0][6]).toBe('ec-1');
    expect(sendText).not.toHaveBeenCalledWith('5491155550000', MENU);
  });
});

// ─── (h) umbral exacto 0.85 ───────────────────────────────────────────────────

describe('PhotoTriageProcessor · (h) borde del umbral (>= 0.85)', () => {
  it('confidence EXACTA 0.85 → auto-rutea (el umbral es inclusivo)', async () => {
    const { processor, route, sendText } = buildProcessor({
      classifyResult: { tipo: 'material', confidence: 0.85, sugerencia: 'Display', usage: null },
    });

    await (processor as any).process(buildJob());

    expect(route).toHaveBeenCalledTimes(1);
    expect(route.mock.calls[0][4]).toBe('material');
    expect(sendText).not.toHaveBeenCalledWith('5491155550000', MENU);
  });

  it('confidence 0.84 (justo debajo) → menú, NO rutea', async () => {
    const { processor, route, sendText } = buildProcessor({
      classifyResult: { tipo: 'material', confidence: 0.84, sugerencia: 'Display', usage: null },
    });

    await (processor as any).process(buildJob());

    expect(route).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith('5491155550000', MENU);
  });
});

// ─── (i) parseo real de classifyPhoto (fetch mockeado) ────────────────────────

describe('PhotoTriageProcessor · (i) classifyPhoto parsea el body de la visión', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Construye un processor REAL (sin stubbear classifyPhoto) para ejercitar el parseo.
  function buildRealProcessor() {
    const route = jest.fn().mockResolvedValue(undefined);
    const sendText = jest.fn().mockResolvedValue(true);
    const clearMediaFlow = jest.fn().mockResolvedValue(undefined);
    const dataSource = { query: jest.fn().mockResolvedValue([]) } as any;
    const storage = { download: jest.fn().mockResolvedValue(Buffer.from('fake-bytes')) } as any;
    const wa = { sendText } as any;
    const sessions = { clearMediaFlow } as any;
    const photoRouter = { route } as any;
    const actionMenu = { buildTypeMenu: () => MENU } as any;
    const config = { get: jest.fn().mockReturnValue('test-key') } as any;
    const metrics = { f1EventsTotal: { inc: jest.fn() } } as any;
    const processor = new PhotoTriageProcessor(
      dataSource, config, storage, wa, sessions, actionMenu, photoRouter, metrics,
    );
    return { processor, route, sendText };
  }

  it('parsea un body con fences ```json y auto-rutea con el tipo/confianza correctos', async () => {
    const body =
      '```json\n{ "tipo": "material", "confidence": 0.95, "sugerencia": "Volumétrico" }\n```';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: body }], usage: { input_tokens: 10, output_tokens: 5 } }),
    }) as any;

    const { processor, route, sendText } = buildRealProcessor();
    await (processor as any).process(buildJob());

    expect(route).toHaveBeenCalledTimes(1);
    expect(route.mock.calls[0][4]).toBe('material');
    expect(route.mock.calls[0][7]).toBe('Volumétrico'); // suggestedLabel parseado
    expect(sendText).not.toHaveBeenCalledWith('5491155550000', MENU);
  });

  it('JSON basura en el body → throwea en el parseo → cae al menú', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'esto no es json {{{' }], usage: null }),
    }) as any;

    const { processor, route, sendText } = buildRealProcessor();
    await (processor as any).process(buildJob());

    expect(route).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith('5491155550000', MENU);
  });
});

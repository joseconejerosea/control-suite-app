/// <reference types="jest" />
import { OcrProcessor } from './ocr.processor';

/**
 * Phase 2 (T3): the OcrProcessor no longer triages material/evidence, and A-008
 * simplified the vision prompt to a pure OCR-read (the response is plain text, no
 * JSON classification). Those photos are routed to their intakes by the webhook
 * BEFORE the OCR queue; only facturas/documents reach this processor, which just
 * reads the text (F1).
 *
 * These tests assert the surviving behavior:
 *  - the pure vision-parse helper returns the extracted text verbatim and keeps the usage;
 *  - an image that reaches runJob runs F1 OCR (extracts text, sets status='ocr_done',
 *    enqueues classify) — it does NOT start any material/evidence intake.
 */
describe('OcrProcessor.parseVisionResult', () => {
  // The pure method ignores the constructor args; minimal stubs. Constructor now
  // takes 6 args (materialIntake/evidenceIntake injections were removed in Phase 2).
  const proc = new OcrProcessor(
    null as any, null as any, null as any, null as any, null as any, null as any,
  );
  const parse = (raw: string, usage: any = null) => (proc as any).parseVisionResult(raw, usage);

  it('returns the extracted text verbatim', () => {
    const r = parse('BOLETA $1000\nTOTAL 1000');
    expect(r.text).toContain('BOLETA');
    expect(r.text).toBe('BOLETA $1000\nTOTAL 1000');
  });

  it('keeps the token-usage accounting', () => {
    const usage = { input_tokens: 100, output_tokens: 20 };
    const r = parse('FACTURA A', usage);
    expect(r.text).toBe('FACTURA A');
    expect(r.usage).toEqual(usage);
  });

  it('normalizes a non-string response to empty text', () => {
    expect(parse(undefined).text).toBe('');
  });
});

describe('OcrProcessor.runJob (F1 OCR, no triage)', () => {
  const evento_crudo_id = 'evt-1';
  const client_id = 'client-1';

  function buildProc() {
    const queries: Array<{ sql: string; params: any[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params: any[] = []) => {
        queries.push({ sql, params });
        // The SELECT that loads payload + doc_mime_type: return a WhatsApp image event.
        if (/SELECT payload, doc_mime_type/.test(sql)) {
          return [{
            payload: { from: '5491100000000', storage_path: 'documents/x.jpg', mime_type: 'image/jpeg' },
            doc_mime_type: null,
          }];
        }
        return [];
      }),
    };

    const classifyAdd = jest.fn().mockResolvedValue({});
    const classifyQueue = { add: classifyAdd };

    const metrics = {
      f1OcrDuration: { observe: jest.fn() },
      f1EventsTotal: { inc: jest.fn() },
    };

    const storage = {
      download: jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes')),
    };

    const wa = { avisarFalloProcesamiento: jest.fn().mockResolvedValue(undefined) };

    const config = { get: jest.fn().mockReturnValue('test-key') };

    const proc = new OcrProcessor(
      dataSource as any,
      classifyQueue as any,
      config as any,
      metrics as any,
      storage as any,
      wa as any,
    );

    return { proc, dataSource, classifyAdd, metrics };
  }

  const job: any = {
    data: { evento_crudo_id, client_id, canal: 'whatsapp' },
    attemptsMade: 0,
    opts: { attempts: 3 },
  };

  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('runs F1 OCR on an image: extracts text, sets status=ocr_done, enqueues classify, and never touches an intake', async () => {
    // Claude vision returns the plain OCR text of a factura (no JSON triage).
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: 'FACTURA A Nro 0001 TOTAL $12345' }],
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    }) as any;

    const { proc, dataSource, classifyAdd } = buildProc();
    await (proc as any).runJob(job);

    const sqls = (dataSource.query as jest.Mock).mock.calls.map((c) => c[0] as string);

    // F1 wrote the OCR text and marked the evento ocr_done.
    const ocrDone = sqls.find((s) => /status='ocr_done'/.test(s) && /ocr_text=\$1/.test(s));
    expect(ocrDone).toBeDefined();

    // The evento was NOT parked as awaiting_material (that was the old ambiguous-triage path).
    expect(sqls.some((s) => /awaiting_material/.test(s))).toBe(false);

    // F1 handed off to the classify queue.
    expect(classifyAdd).toHaveBeenCalledWith(
      'classify',
      expect.objectContaining({ evento_crudo_id, client_id, canal: 'whatsapp' }),
      expect.any(Object),
    );
  });

  it('marks failed_ocr (does not start any intake) when the image has no readable text', async () => {
    // There is no triage: an empty/too-short OCR read falls through to the
    // empty-text guard → failed_ocr.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: '' }],
        usage: null,
      }),
    }) as any;

    const { proc, dataSource } = buildProc();
    await (proc as any).runJob(job);

    const sqls = (dataSource.query as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /awaiting_material/.test(s))).toBe(false);
    // Short text → failed_ocr via setStatus.
    expect(sqls.some((s) => /error_message=\$2/.test(s))).toBe(true);
  });
});

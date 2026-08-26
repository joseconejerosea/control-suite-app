/// <reference types="jest" />
import { DataSource, QueryRunner } from 'typeorm';
import { WhatsAppWebhookController } from './whatsapp.webhook.controller';
import { WhatsAppActionMenuService } from './action-menu.service';
import { WhatsAppSession } from './whatsapp-session.service';

/**
 * Focused unit spec for the T3 state machine wired into the webhook controller.
 *
 * The methods under test (handleImage / handleText / routeByType) are private, so we
 * instantiate the controller with mocked deps and reach the methods via a typed
 * `any` cast (ctrl). Assertions are behavioral — which mock was called with what —
 * so they don't couple to line numbers or exact SQL. The action-menu service is the
 * REAL one (pure, dependency-free) so menu/guide/type-parse copy stays authoritative.
 *
 * Out of scope (pre-existing, not T3): tenant selection, affiliation code, project
 * disambiguation, location/audio/video/document handlers.
 */

const FROM = '5492216205665';
const CLIENT = 'client-1';
const CANAL = 'canal-1';
const MSG_ID = 'wamid.TEST';

const STORAGE = 'documents/photo.jpg';
const MIME = 'image/jpeg';

describe('WhatsAppWebhookController · T3 state machine', () => {
  let controller: WhatsAppWebhookController;
  let ctrl: any; // typed escape hatch for the private handlers

  let sessionStore: Record<string, WhatsAppSession | null>;
  let sessions: any;
  let wa: any;
  let media: any;
  let materialIntake: any;
  let evidenceIntake: any;
  let clarification: any;
  let projectResolver: any;
  let ocrQueue: any;
  let convocatoriaQueue: any;
  let returnPhotoQueue: any;
  let shield: any;
  let senderResolver: any;
  let selection: any;
  let affiliationCode: any;
  let affiliation: any;
  let metrics: any;

  // ds.query router. persistEvent INSERT → fake id; convocatoria SELECT → open-flag;
  // everything else (UPDATE flow, devolucion check, set_config) → [].
  let queryMock: jest.Mock;
  let hasOpenConvocatoria: boolean;
  let nextEventId: number;

  const menu = new WhatsAppActionMenuService();

  beforeEach(() => {
    sessionStore = {};
    hasOpenConvocatoria = false;
    nextEventId = 1;

    queryMock = jest.fn((sql: string) => {
      if (sql.includes('set_config')) return Promise.resolve([]);
      // persistEvent → returns the new row id
      if (sql.includes('INSERT INTO eventos_crudos')) {
        return Promise.resolve([{ id: `evt-${nextEventId++}` }]);
      }
      // isDuplicate guard
      if (sql.includes('SELECT id FROM eventos_crudos')) return Promise.resolve([]);
      // routeByType UPDATE flow
      if (sql.includes('UPDATE eventos_crudos SET flow')) return Promise.resolve([]);
      // tieneConvocatoriaAbierta
      if (sql.includes('FROM convocatorias')) {
        return Promise.resolve(hasOpenConvocatoria ? [{ '?column?': 1 }] : []);
      }
      // devolucionPendienteFor
      if (sql.includes('FROM stock_return_requests')) return Promise.resolve([]);
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

    sessions = {
      get: jest.fn(async (p: string) => sessionStore[p] ?? null),
      set: jest.fn(async (p: string, s: WhatsAppSession) => { sessionStore[p] = s; }),
      delete: jest.fn(async (p: string) => { delete sessionStore[p]; }),
      claimMessage: jest.fn().mockResolvedValue(true),
      releaseMessage: jest.fn().mockResolvedValue(undefined),
      clearActionMenu: jest.fn().mockResolvedValue(undefined),
      setActionMenu: jest.fn().mockResolvedValue(undefined),
      setAwaitingType: jest.fn().mockResolvedValue(undefined),
      setAwaitingMedia: jest.fn().mockResolvedValue(undefined),
      clearMediaFlow: jest.fn().mockResolvedValue(undefined),
      updateLastProject: jest.fn().mockResolvedValue(undefined),
    };

    wa = { sendText: jest.fn().mockResolvedValue(true) };

    // resolveMedia goes through this.media.downloadAndStore (fresh path, no pendingMedia).
    media = {
      downloadAndStore: jest.fn().mockResolvedValue({ storagePath: STORAGE, mimeType: MIME, buffer: Buffer.from('x') }),
      storeBuffer: jest.fn().mockResolvedValue({ storagePath: STORAGE, mimeType: MIME, buffer: Buffer.from('x') }),
      download: jest.fn().mockResolvedValue({ buffer: Buffer.from('x'), mimeType: MIME }),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    materialIntake = { start: jest.fn().mockResolvedValue(undefined), handleResponse: jest.fn().mockResolvedValue(false), handleLocationForMaterial: jest.fn().mockResolvedValue(false) };
    evidenceIntake = { start: jest.fn().mockResolvedValue(undefined), handleResponse: jest.fn().mockResolvedValue(false), handleLocationForEvidence: jest.fn().mockResolvedValue(false) };
    clarification = { handleClarificationResponse: jest.fn().mockResolvedValue(false) };
    projectResolver = { resolve: jest.fn().mockResolvedValue(null) };

    ocrQueue = { add: jest.fn().mockResolvedValue(undefined) };
    convocatoriaQueue = { add: jest.fn().mockResolvedValue(undefined) };
    returnPhotoQueue = { add: jest.fn().mockResolvedValue(undefined) };

    shield = { checkLocal: jest.fn(() => ({ safe: true })) };
    senderResolver = {
      candidatesFor: jest.fn().mockResolvedValue([]),
      clientsWithOpenConvocatoria: jest.fn().mockResolvedValue([]),
    };
    selection = {};
    affiliationCode = {};
    affiliation = {};
    metrics = { f1EventsTotal: { inc: jest.fn() } };

    controller = new WhatsAppWebhookController(
      wa,
      sessions,
      media,
      materialIntake,
      evidenceIntake,
      clarification,
      projectResolver,
      ds,
      ocrQueue,
      convocatoriaQueue,
      returnPhotoQueue,
      shield,
      senderResolver,
      selection,
      menu, // real, pure action-menu service
      affiliationCode,
      affiliation,
      metrics,
    );
    ctrl = controller as any;
  });

  const imageMsg = (caption = '') => ({ type: 'image', image: { id: 'media-1', caption } });
  const textMsg = (body: string) => ({ type: 'text', text: { body } });

  // ── 1. handleImage media-first: buffer + type menu, no OCR / no intake ───────
  describe('handleImage · media-first (no active flow)', () => {
    it('persists the photo with flow=null, buffers via setAwaitingType, and sends the type menu', async () => {
      await ctrl.handleImage(FROM, imageMsg('una foto'), CLIENT, CANAL, MSG_ID, null);

      // Persisted a fresh event with flow=null (media-first buffering, A-002).
      const insert = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO eventos_crudos'));
      expect(insert).toBeDefined();
      expect(insert![1][3]).toBeNull(); // flow param is null

      // Buffered under the returned event id.
      expect(sessions.setAwaitingType).toHaveBeenCalledTimes(1);
      const [phone, buffered, clientId] = sessions.setAwaitingType.mock.calls[0];
      expect(phone).toBe(FROM);
      expect(buffered.eventId).toBe('evt-1');
      expect(clientId).toBe(CLIENT);

      // Sent the type menu.
      expect(wa.sendText).toHaveBeenCalledWith(FROM, menu.buildTypeMenu());

      // Did NOT enqueue OCR and did NOT start any intake.
      expect(ocrQueue.add).not.toHaveBeenCalled();
      expect(materialIntake.start).not.toHaveBeenCalled();
      expect(evidenceIntake.start).not.toHaveBeenCalled();
    });
  });

  // ── T3/N08 · interrupción de un intake en curso ──────────────────────────────
  describe('T3/N08 · foto o cancelar durante un intake en curso', () => {
    it('handleImage BLOQUEA una foto durante awaiting_material (no persiste, no buffera, guía a cancelar)', async () => {
      sessionStore[FROM] = { state: 'awaiting_material', clientId: CLIENT, canalId: CANAL } as unknown as WhatsAppSession;

      await ctrl.handleImage(FROM, imageMsg('otra foto'), CLIENT, CANAL, MSG_ID, null);

      const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
      expect(msg.toLowerCase()).toContain('cancelar');
      // No persistió la foto, no la buffereó, no arrancó ningún intake.
      expect(queryMock.mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO eventos_crudos'))).toBe(false);
      expect(sessions.setAwaitingType).not.toHaveBeenCalled();
      expect(materialIntake.start).not.toHaveBeenCalled();
    });

    it('handleImage BLOQUEA una foto durante awaiting_evidence', async () => {
      sessionStore[FROM] = { state: 'awaiting_evidence', clientId: CLIENT, canalId: CANAL } as unknown as WhatsAppSession;

      await ctrl.handleImage(FROM, imageMsg(), CLIENT, CANAL, MSG_ID, null);

      expect(wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n').toLowerCase()).toContain('cancelar');
      expect(sessions.setAwaitingType).not.toHaveBeenCalled();
      expect(evidenceIntake.start).not.toHaveBeenCalled();
    });

    it('handleDocument BLOQUEA un PDF durante awaiting_material (no lo procesa como F1)', async () => {
      sessionStore[FROM] = { state: 'awaiting_material', clientId: CLIENT, canalId: CANAL } as unknown as WhatsAppSession;

      await ctrl.handleDocument(FROM, { type: 'document', document: { id: 'doc-1', filename: 'guia.pdf' } }, CLIENT, CANAL, MSG_ID, null);

      expect(wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n').toLowerCase()).toContain('cancelar');
      expect(ocrQueue.add).not.toHaveBeenCalled();
      expect(queryMock.mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO eventos_crudos'))).toBe(false);
    });

    it('handleAudio BLOQUEA un audio durante awaiting_evidence (no guarda blob suelto)', async () => {
      sessionStore[FROM] = { state: 'awaiting_evidence', clientId: CLIENT, canalId: CANAL } as unknown as WhatsAppSession;

      await ctrl.handleAudio(FROM, { type: 'audio', audio: { id: 'aud-1' } }, CLIENT, CANAL, MSG_ID, null);

      expect(wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n').toLowerCase()).toContain('cancelar');
      expect(queryMock.mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO eventos_crudos'))).toBe(false);
    });

    it('handleText "cancelar" durante awaiting_material aborta: borra sesión + menú, NO llama al intake', async () => {
      sessionStore[FROM] = { state: 'awaiting_material', clientId: CLIENT } as unknown as WhatsAppSession;

      await ctrl.handleText(FROM, textMsg('cancelar'), CLIENT, CANAL, MSG_ID);

      expect(sessions.delete).toHaveBeenCalledWith(FROM);
      expect(sessions.setActionMenu).toHaveBeenCalledWith(FROM, CLIENT);
      const msg = wa.sendText.mock.calls.map((c: any[]) => c[1]).join('\n');
      expect(msg).toContain('cancelé');
      expect(msg).toContain(menu.buildMenu());
      expect(materialIntake.handleResponse).not.toHaveBeenCalled();
    });

    it('handleText "cancelá" (con acento) durante awaiting_evidence también aborta al menú', async () => {
      sessionStore[FROM] = { state: 'awaiting_evidence', clientId: CLIENT } as unknown as WhatsAppSession;

      await ctrl.handleText(FROM, textMsg('cancelá'), CLIENT, CANAL, MSG_ID);

      expect(sessions.setActionMenu).toHaveBeenCalledWith(FROM, CLIENT);
      expect(evidenceIntake.handleResponse).not.toHaveBeenCalled();
    });

    it('handleText saludo ("hola") durante un intake NO aborta: pasa al intake (lo re-pregunta)', async () => {
      sessionStore[FROM] = { state: 'awaiting_material', clientId: CLIENT } as unknown as WhatsAppSession;
      materialIntake.handleResponse.mockResolvedValueOnce(true); // el intake re-pregunta

      await ctrl.handleText(FROM, textMsg('hola'), CLIENT, CANAL, MSG_ID);

      // Un saludo NO es cancelar → no borra el registro; el intake maneja el mensaje.
      expect(materialIntake.handleResponse).toHaveBeenCalledWith(FROM, 'hola');
      expect(sessions.delete).not.toHaveBeenCalled();
      expect(sessions.setActionMenu).not.toHaveBeenCalled();
    });

    it('handleText texto normal ("10") durante awaiting_material NO aborta: pasa al intake', async () => {
      sessionStore[FROM] = { state: 'awaiting_material', clientId: CLIENT } as unknown as WhatsAppSession;
      materialIntake.handleResponse.mockResolvedValueOnce(true); // el intake consume el paso

      await ctrl.handleText(FROM, textMsg('10'), CLIENT, CANAL, MSG_ID);

      expect(materialIntake.handleResponse).toHaveBeenCalledWith(FROM, '10');
      // No es cancelar → no aborta ni cae al menú.
      expect(sessions.setActionMenu).not.toHaveBeenCalled();
      expect(sessions.delete).not.toHaveBeenCalled();
    });
  });

  // ── 2. handleText awaiting_type + bufferedMedia + valid number → route ───────
  describe('handleText · awaiting_type with bufferedMedia', () => {
    const buffered = { storagePath: STORAGE, mimeType: MIME, caption: 'c', eventId: 'evt-buffered' };

    beforeEach(() => {
      sessionStore[FROM] = {
        state: 'awaiting_type',
        bufferedMedia: buffered,
        clientId: CLIENT,
        canalId: CANAL,
      } as unknown as WhatsAppSession;
    });

    it('routes "2" (material) to materialIntake.start with the buffered event id and clears the media flow', async () => {
      await ctrl.handleText(FROM, textMsg('2'), CLIENT, CANAL, MSG_ID);

      expect(materialIntake.start).toHaveBeenCalledTimes(1);
      expect(materialIntake.start.mock.calls[0][0].eventoCrudoId).toBe('evt-buffered');
      expect(sessions.clearMediaFlow).toHaveBeenCalledWith(FROM);
      // Reused the buffered event → no fresh INSERT.
      expect(queryMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO eventos_crudos'))).toBe(false);
      expect(ocrQueue.add).not.toHaveBeenCalled();
    });

    it('routes "1" (factura) → enqueues OCR and sends the "recibí tu foto" text', async () => {
      await ctrl.handleText(FROM, textMsg('1'), CLIENT, CANAL, MSG_ID);

      expect(ocrQueue.add).toHaveBeenCalledTimes(1);
      expect(ocrQueue.add.mock.calls[0][1].evento_crudo_id).toBe('evt-buffered');
      expect(wa.sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('Recibí tu foto'));
      expect(materialIntake.start).not.toHaveBeenCalled();
      expect(sessions.clearMediaFlow).toHaveBeenCalledWith(FROM);
    });

    it('re-sends the type menu on an invalid number ("9") and does NOT route', async () => {
      await ctrl.handleText(FROM, textMsg('9'), CLIENT, CANAL, MSG_ID);

      expect(wa.sendText).toHaveBeenCalledWith(FROM, expect.stringContaining(menu.buildTypeMenu()));
      expect(materialIntake.start).not.toHaveBeenCalled();
      expect(evidenceIntake.start).not.toHaveBeenCalled();
      expect(ocrQueue.add).not.toHaveBeenCalled();
      expect(sessions.clearMediaFlow).not.toHaveBeenCalled();
    });
  });

  // ── 3. handleText awaiting_action + valid media choice → guide + setAwaitingMedia
  describe('handleText · awaiting_action with a media action', () => {
    beforeEach(() => {
      sessionStore[FROM] = {
        state: 'awaiting_action',
        clientId: CLIENT,
        canalId: CANAL,
      } as unknown as WhatsAppSession;
    });

    it('for "2" (material) sets awaiting_media + sends the guide, and does NOT route yet', async () => {
      await ctrl.handleText(FROM, textMsg('2'), CLIENT, CANAL, MSG_ID);

      expect(sessions.setAwaitingMedia).toHaveBeenCalledWith(FROM, 'material', CLIENT);
      expect(wa.sendText).toHaveBeenCalledWith(FROM, menu.buildGuide('material'));
      expect(materialIntake.start).not.toHaveBeenCalled();
      expect(ocrQueue.add).not.toHaveBeenCalled();
    });
  });

  // ── 4. handleImage awaiting_media + pendingType='evidencia' → routeByType ────
  describe('handleImage · awaiting_media with pendingType', () => {
    beforeEach(() => {
      sessionStore[FROM] = {
        state: 'awaiting_media',
        pendingType: 'evidencia',
        clientId: CLIENT,
        canalId: CANAL,
      } as unknown as WhatsAppSession;
    });

    it('routes the incoming photo to evidenceIntake.start (fresh persist) and clears the media flow', async () => {
      await ctrl.handleImage(FROM, imageMsg(), CLIENT, CANAL, MSG_ID, null);

      // Fresh persist (no existing event id on this branch) → one INSERT.
      expect(queryMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO eventos_crudos'))).toBe(true);
      expect(evidenceIntake.start).toHaveBeenCalledTimes(1);
      expect(evidenceIntake.start.mock.calls[0][0].storagePath).toBe(STORAGE);
      expect(sessions.clearMediaFlow).toHaveBeenCalledWith(FROM);
      // Did NOT buffer / ask the type menu.
      expect(sessions.setAwaitingType).not.toHaveBeenCalled();
      expect(materialIntake.start).not.toHaveBeenCalled();
    });
  });

  // ── 5. handleText awaiting_media + text (no photo) → re-send guide, keep state
  describe('handleText · awaiting_media with a text reply (not a photo)', () => {
    beforeEach(() => {
      sessionStore[FROM] = {
        state: 'awaiting_media',
        pendingType: 'material',
        clientId: CLIENT,
        canalId: CANAL,
      } as unknown as WhatsAppSession;
    });

    it('re-sends the guide for the pending type and does NOT fall through to the general menu', async () => {
      await ctrl.handleText(FROM, textMsg('hola'), CLIENT, CANAL, MSG_ID);

      expect(wa.sendText).toHaveBeenCalledWith(FROM, menu.buildGuide('material'));
      // Did NOT drop into the generic action menu.
      expect(sessions.setActionMenu).not.toHaveBeenCalled();
      expect(wa.sendText).not.toHaveBeenCalledWith(FROM, menu.buildMenu());
    });
  });

  // ── 6. Convocatoria priority (B-003) over awaiting_type ──────────────────────
  describe('handleText · convocatoria priority over awaiting_type (B-003)', () => {
    beforeEach(() => {
      hasOpenConvocatoria = true;
      sessionStore[FROM] = {
        state: 'awaiting_type',
        bufferedMedia: { storagePath: STORAGE, mimeType: MIME, caption: 'c', eventId: 'evt-buffered' },
        clientId: CLIENT,
        canalId: CANAL,
      } as unknown as WhatsAppSession;
    });

    it('sends a numeric reply to the F4 convocatoria queue instead of routing the buffered photo', async () => {
      await ctrl.handleText(FROM, textMsg('2'), CLIENT, CANAL, MSG_ID);

      // Text went to F4.
      expect(convocatoriaQueue.add).toHaveBeenCalledTimes(1);
      // routeByType was NOT reached: no intake, no OCR.
      expect(materialIntake.start).not.toHaveBeenCalled();
      expect(evidenceIntake.start).not.toHaveBeenCalled();
      expect(ocrQueue.add).not.toHaveBeenCalled();
      expect(sessions.clearMediaFlow).not.toHaveBeenCalled();
    });
  });

  // ── 6b. A1 · Caducidad: una convocatoria vieja no debe capturar un "Hola" nuevo ─
  describe('handleText · tieneConvocatoriaAbierta caducity (A1)', () => {
    it('bounds the convocatorias lookup by the event day (dia) so stale ones stop capturing text', async () => {
      // Saludo nuevo, sin estado de sesión: consulta convocatorias, pero con el bound
      // temporal que hace caducar el estado pendiente (evento de hace semanas → no captura).
      //
      // NOTE (JD-002): this is a SQL-string assertion, not a true date-behavior test.
      // `queryMock` routes purely by SQL substring and has no `dia` value nor CURRENT_DATE
      // evaluation, so it cannot prove that a stale row is actually excluded vs a vigente
      // one included — a broken bound (e.g. `+ INTERVAL '30 day'`) would still match here.
      // Proving the runtime date behavior of BOTH convocatoria queries
      // (tieneConvocatoriaAbierta here AND clientsWithOpenConvocatoria in
      // sender-tenant-resolver.service) requires a real Postgres. This is the same
      // integration-test gap flagged for the A2 bool_or aggregation tests.
      // TODO(A1/JD-002 · integration): add a DB-backed spec that inserts a stale
      // (dia = today - N days) and a vigente convocatoria and asserts capture/no-capture,
      // covering both queries end-to-end.
      await ctrl.handleText(FROM, textMsg('Hola'), CLIENT, CANAL, MSG_ID);

      const convCalls = queryMock.mock.calls
        .map((c: any[]) => c[0] as string)
        .filter((s: string) => s.includes('FROM convocatorias'));
      expect(convCalls.length).toBeGreaterThan(0);
      // Both the caducity bound and the identical 1-day grace window must be present.
      expect(convCalls[0]).toMatch(/c\.dia\s*>=\s*CURRENT_DATE/i);
      expect(convCalls[0]).toMatch(/INTERVAL\s+'1 day'/i);
    });

    it('with no vigente convocatoria, a plain "Hola" falls through to the action menu (fresh start)', async () => {
      hasOpenConvocatoria = false; // el bound por `dia` excluyó la convocatoria vieja
      await ctrl.handleText(FROM, textMsg('Hola'), CLIENT, CANAL, MSG_ID);

      expect(convocatoriaQueue.add).not.toHaveBeenCalled();
      expect(sessions.setActionMenu).toHaveBeenCalledWith(FROM, CLIENT);
    });
  });

  // ── 7. routeByType directly: existing vs fresh, per type ─────────────────────
  describe('routeByType · existing event UPDATE vs fresh persist, per type', () => {
    const mediaArg = { storagePath: STORAGE, mimeType: MIME, caption: 'c' };

    it('with existingEventId → UPDATEs the flow (no fresh INSERT) then routes material', async () => {
      await ctrl.routeByType(FROM, CLIENT, CANAL, MSG_ID, 'material', mediaArg, 'evt-existing');

      expect(queryMock.mock.calls.some((c) => String(c[0]).includes('UPDATE eventos_crudos SET flow'))).toBe(true);
      expect(queryMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO eventos_crudos'))).toBe(false);
      expect(materialIntake.start).toHaveBeenCalledTimes(1);
      expect(materialIntake.start.mock.calls[0][0].eventoCrudoId).toBe('evt-existing');
      // Routing observability: material_intake counter.
      expect(metrics.f1EventsTotal.inc).toHaveBeenCalledWith({ client_id: CLIENT, canal: 'whatsapp', status: 'material_intake' });
    });

    it('without existingEventId → fresh persist then routes factura to OCR', async () => {
      await ctrl.routeByType(FROM, CLIENT, CANAL, MSG_ID, 'factura', mediaArg);

      expect(queryMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO eventos_crudos'))).toBe(true);
      expect(queryMock.mock.calls.some((c) => String(c[0]).includes('UPDATE eventos_crudos SET flow'))).toBe(false);
      expect(ocrQueue.add).toHaveBeenCalledTimes(1);
      expect(ocrQueue.add.mock.calls[0][1].evento_crudo_id).toBe('evt-1');
      expect(wa.sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('Recibí tu foto'));
      // Routing observability: factura_intake counter.
      expect(metrics.f1EventsTotal.inc).toHaveBeenCalledWith({ client_id: CLIENT, canal: 'whatsapp', status: 'factura_intake' });
    });

    it('without existingEventId → fresh persist then routes evidencia to evidenceIntake', async () => {
      await ctrl.routeByType(FROM, CLIENT, CANAL, MSG_ID, 'evidencia', mediaArg);

      expect(evidenceIntake.start).toHaveBeenCalledTimes(1);
      expect(evidenceIntake.start.mock.calls[0][0].eventoCrudoId).toBe('evt-1');
      expect(materialIntake.start).not.toHaveBeenCalled();
      expect(ocrQueue.add).not.toHaveBeenCalled();
      // Routing observability: evidence_intake counter.
      expect(metrics.f1EventsTotal.inc).toHaveBeenCalledWith({ client_id: CLIENT, canal: 'whatsapp', status: 'evidence_intake' });
    });
  });

  // ── 9. resolveInboundTenant · convocatoria auto-resolve (single unambiguous agency)
  describe('resolveInboundTenant · convocatoria auto-resolve on a fresh message', () => {
    beforeEach(() => {
      // Fresh message: no session in flight.
      sessionStore[FROM] = null;
      // P1-T03: candidates now carry rota boolean. Two candidates, both rotating by default
      // so the rota-skip path does NOT fire in existing convocatoria tests.
      senderResolver.candidatesFor.mockResolvedValue([
        { clientId: 'c1', clientName: 'Agencia Uno', rota: true },
        { clientId: 'c2', clientName: 'Agencia Dos', rota: true },
      ]);
      // Tenant-selection prompt + persistence used by the ask-agency path.
      selection.buildPrompt = jest.fn(() => '¿Para qué agencia es esto?');
      selection.buildCodePrompt = jest.fn(() => 'Escribí tu código de afiliación.');
      sessions.setTenantSelection = jest.fn().mockResolvedValue(undefined);
    });

    it('auto-resolves the tenant (no "which agency?" prompt) when exactly one candidate has an open convocatoria', async () => {
      // Only ONE of the two candidate agencies has an open convocatoria for this sender
      // → the agency is unambiguous (the system itself sent that convocatoria).
      senderResolver.clientsWithOpenConvocatoria.mockResolvedValue(['c2']);

      const resolution = await ctrl.resolveInboundTenant(FROM, textMsg('sí'));

      expect(resolution).toEqual({
        status: 'proceed',
        clientId: 'c2',
        canalId: null,
        msg: expect.objectContaining({ type: 'text' }),
      });
      // Did NOT ask which agency and did NOT stage a tenant selection.
      expect(sessions.setTenantSelection).not.toHaveBeenCalled();
      expect(wa.sendText).not.toHaveBeenCalled();
    });

    it('still asks which agency when NO candidate has an open convocatoria (regression guard)', async () => {
      senderResolver.clientsWithOpenConvocatoria.mockResolvedValue([]);

      const resolution = await ctrl.resolveInboundTenant(FROM, textMsg('hola'));

      expect(resolution).toEqual({ status: 'stop' });
      // The general "always ask" behavior is preserved.
      expect(sessions.setTenantSelection).toHaveBeenCalledTimes(1);
      expect(sessions.setTenantSelection.mock.calls[0][2]).toBe('awaiting_tenant');
      expect(wa.sendText).toHaveBeenCalledWith(FROM, '¿Para qué agencia es esto?');
    });

    it('falls through to the ask-agency path when the convocatoria lookup fails (best-effort)', async () => {
      senderResolver.clientsWithOpenConvocatoria.mockRejectedValue(new Error('db down'));

      const resolution = await ctrl.resolveInboundTenant(FROM, textMsg('sí'));

      // A DB error in the optimization must NOT break inbound: general flow still runs.
      expect(resolution).toEqual({ status: 'stop' });
      expect(sessions.setTenantSelection).toHaveBeenCalledTimes(1);
      expect(wa.sendText).toHaveBeenCalledWith(FROM, '¿Para qué agencia es esto?');
    });

    it('does NOT auto-resolve when TWO candidates both have an open convocatoria (ambiguous → still asks)', async () => {
      // Both candidate agencies convoked this sender: the agency is genuinely ambiguous,
      // so we must NOT guess a tenant (cross-tenant guard) — fall through to "which agency?".
      senderResolver.clientsWithOpenConvocatoria.mockResolvedValue(['c1', 'c2']);

      const resolution = await ctrl.resolveInboundTenant(FROM, textMsg('sí'));

      expect(resolution).toEqual({ status: 'stop' });
      expect(sessions.setTenantSelection).toHaveBeenCalledTimes(1);
      expect(wa.sendText).toHaveBeenCalledWith(FROM, '¿Para qué agencia es esto?');
    });
  });

  // ── A4. handleLocation with pending material-location step ────────────────────
  describe('handleLocation · A4 pending material-location', () => {
    const locationMsg = (lat: number, lng: number) => ({
      type: 'location',
      location: { latitude: lat, longitude: lng, name: '', address: '' },
    });

    it('routes location to materialIntake.handleLocationForMaterial when it returns true (pending material)', async () => {
      materialIntake.handleLocationForMaterial = jest.fn().mockResolvedValue(true);

      await ctrl.handleLocation(FROM, locationMsg(-33.0, -70.0), CLIENT, CANAL, MSG_ID);

      expect(materialIntake.handleLocationForMaterial).toHaveBeenCalledTimes(1);
      const [phone, lat, lng] = materialIntake.handleLocationForMaterial.mock.calls[0];
      expect(phone).toBe(FROM);
      expect(lat).toBeCloseTo(-33.0);
      expect(lng).toBeCloseTo(-70.0);
      // Standalone check-in must NOT run when material intake handled it.
      // No sendText about "Ubicacion verificada" or "fuera del rango" from the standalone path.
      // (materialIntake handles the reply itself.)
      const texts = wa.sendText.mock.calls.map((c: any[]) => c[1]);
      expect(texts.every((t: string) => !t.includes('Ubicacion verificada'))).toBe(true);
    });

    it('falls through to standalone check-in when handleLocationForMaterial returns false (no pending material)', async () => {
      materialIntake.handleLocationForMaterial = jest.fn().mockResolvedValue(false);

      // Query mock for standalone: an activation with a location.
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('set_config')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO eventos_crudos')) {
          return Promise.resolve([{ id: `evt-${nextEventId++}` }]);
        }
        // The standalone SQL is multi-line; match by the column list which is on one line.
        if (sql.includes('SELECT a.id, a.location, a.status')) {
          return Promise.resolve([
            { id: 'act-1', location: JSON.stringify({ lat: -33.0, lng: -70.0, radiusMeters: 200 }), status: 'in_progress' },
          ]);
        }
        return Promise.resolve([]);
      });

      await ctrl.handleLocation(FROM, locationMsg(-33.0, -70.0), CLIENT, CANAL, MSG_ID);

      expect(materialIntake.handleLocationForMaterial).toHaveBeenCalledTimes(1);
      // Standalone path ran: a LOCATION_CHECK insert was attempted.
      const locationInsert = queryMock.mock.calls.find(
        (c) => String(c[0]).includes('INSERT INTO activation_events'),
      );
      expect(locationInsert).toBeDefined();
    });

    it('standalone check-in runs and reports "no activacion" when handleLocationForMaterial returns false and no activations found', async () => {
      materialIntake.handleLocationForMaterial = jest.fn().mockResolvedValue(false);

      // No activations returned → standalone path runs → "No hay activacion activa" message.
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('set_config')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO eventos_crudos')) return Promise.resolve([{ id: 'evt-1' }]);
        if (sql.includes('SELECT a.id, a.location, a.status')) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      await ctrl.handleLocation(FROM, locationMsg(-33.0, -70.0), CLIENT, CANAL, MSG_ID);

      expect(materialIntake.handleLocationForMaterial).toHaveBeenCalledTimes(1);
      // "No hay activacion activa" message = standalone path ran with no matches.
      const texts = wa.sendText.mock.calls.map((c: any[]) => c[1]);
      expect(texts.some((t: string) => t.includes('No hay activacion activa'))).toBe(true);
    });

    it('routes location to evidenceIntake.handleLocationForEvidence when it returns true (pending evidence); standalone does NOT run', async () => {
      materialIntake.handleLocationForMaterial = jest.fn().mockResolvedValue(false);
      evidenceIntake.handleLocationForEvidence = jest.fn().mockResolvedValue(true);

      await ctrl.handleLocation(FROM, locationMsg(-33.0, -70.0), CLIENT, CANAL, MSG_ID);

      // Material checked first, then evidence consumed it.
      expect(materialIntake.handleLocationForMaterial).toHaveBeenCalledTimes(1);
      expect(evidenceIntake.handleLocationForEvidence).toHaveBeenCalledTimes(1);
      const [phone, lat, lng] = evidenceIntake.handleLocationForEvidence.mock.calls[0];
      expect(phone).toBe(FROM);
      expect(lat).toBeCloseTo(-33.0);
      expect(lng).toBeCloseTo(-70.0);
      // Standalone check-in must NOT run when evidence intake handled it.
      const texts = wa.sendText.mock.calls.map((c: any[]) => c[1]);
      expect(texts.every((t: string) => !t.includes('Ubicacion verificada'))).toBe(true);
    });
  });

  // ── A4b. handleText during awaiting_material step='ubicacion' → re-prompt ───
  describe('handleText · A4 re-prompt for location when step=ubicacion', () => {
    beforeEach(() => {
      sessionStore[FROM] = {
        state: 'awaiting_material',
        clientId: CLIENT,
        canalId: CANAL,
      } as unknown as WhatsAppSession;
      // materialIntake.handleResponse returns true to indicate "pending material-location, re-prompted"
      materialIntake.handleResponse = jest.fn().mockResolvedValue(true);
    });

    it('re-prompts for location when text arrives during step=ubicacion (materialIntake.handleResponse returns true)', async () => {
      await ctrl.handleText(FROM, textMsg('hola'), CLIENT, CANAL, MSG_ID);

      expect(materialIntake.handleResponse).toHaveBeenCalledWith(FROM, 'hola');
      // The handler consumed the message — no other handler ran.
      expect(evidenceIntake.handleResponse).not.toHaveBeenCalled();
      expect(sessions.setActionMenu).not.toHaveBeenCalled();
    });
  });

  // ── 8. handleImage re-buffer: a SECOND photo while awaiting_type cleans up the first
  describe('handleImage · re-buffer cleanup of a superseded photo', () => {
    beforeEach(() => {
      sessionStore[FROM] = {
        state: 'awaiting_type',
        bufferedMedia: { storagePath: 'old/path', mimeType: MIME, caption: 'old', eventId: 'evt-old' },
        clientId: CLIENT,
        canalId: CANAL,
      } as unknown as WhatsAppSession;
    });

    it('removes the old blob, marks the old event superseded, then persists + buffers the NEW photo', async () => {
      await ctrl.handleImage(FROM, imageMsg('nueva foto'), CLIENT, CANAL, MSG_ID, null);

      // Old blob deleted best-effort.
      expect(media.remove).toHaveBeenCalledWith('old/path');

      // Old event marked superseded.
      const superseded = queryMock.mock.calls.find(
        (c) => String(c[0]).includes("status='superseded'"),
      );
      expect(superseded).toBeDefined();
      expect(superseded![1]).toEqual(['evt-old']);

      // NEW photo persisted (flow=null) and buffered under its fresh event id.
      const insert = queryMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO eventos_crudos'));
      expect(insert).toBeDefined();
      expect(insert![1][3]).toBeNull();
      expect(sessions.setAwaitingType).toHaveBeenCalledTimes(1);
      const [, buffered] = sessions.setAwaitingType.mock.calls[0];
      expect(buffered.eventId).toBe('evt-1');
      expect(buffered.storagePath).toBe(STORAGE);
      expect(wa.sendText).toHaveBeenCalledWith(FROM, menu.buildTypeMenu());
    });
  });

  // ── 10. resolveInboundTenant · rota-skip path (P1-T03)
  describe('resolveInboundTenant · rota-aware skip for non-rotating senders', () => {
    beforeEach(() => {
      sessionStore[FROM] = null;
      senderResolver.clientsWithOpenConvocatoria.mockResolvedValue([]);
      selection.buildPrompt = jest.fn(() => '¿Para qué agencia es esto?');
      selection.buildCodePrompt = jest.fn(() => 'Escribí tu código de afiliación.');
      sessions.setTenantSelection = jest.fn().mockResolvedValue(undefined);
    });

    it('1 candidate + rota=false → auto-proceed, no "¿qué agencia?" prompt, pendingMedia present on return', async () => {
      senderResolver.candidatesFor.mockResolvedValue([
        { clientId: 'c1', clientName: 'Agencia Uno', rota: false },
      ]);

      const resolution = await ctrl.resolveInboundTenant(FROM, textMsg('hola'));

      expect(resolution).toMatchObject({
        status: 'proceed',
        clientId: 'c1',
        canalId: null,
      });
      // msg and pendingMedia are present on the return shape (pendingMedia may be null for text)
      expect('msg' in resolution).toBe(true);
      expect('pendingMedia' in resolution).toBe(true);
      // No agency prompt sent, no tenant selection staged
      expect(wa.sendText).not.toHaveBeenCalled();
      expect(sessions.setTenantSelection).not.toHaveBeenCalled();
    });

    it('1 candidate + rota=true → still asks "¿qué agencia?" (rotating senders always ask)', async () => {
      senderResolver.candidatesFor.mockResolvedValue([
        { clientId: 'c1', clientName: 'Agencia Uno', rota: true },
      ]);

      const resolution = await ctrl.resolveInboundTenant(FROM, textMsg('hola'));

      expect(resolution).toEqual({ status: 'stop' });
      expect(sessions.setTenantSelection).toHaveBeenCalledTimes(1);
      expect(sessions.setTenantSelection.mock.calls[0][2]).toBe('awaiting_tenant');
      expect(wa.sendText).toHaveBeenCalledWith(FROM, '¿Para qué agencia es esto?');
    });

    it('2 candidates + rota=false → still asks (I-2: must have exactly 1 AND rota=false)', async () => {
      senderResolver.candidatesFor.mockResolvedValue([
        { clientId: 'c1', clientName: 'Agencia Uno', rota: false },
        { clientId: 'c2', clientName: 'Agencia Dos', rota: false },
      ]);

      const resolution = await ctrl.resolveInboundTenant(FROM, textMsg('hola'));

      expect(resolution).toEqual({ status: 'stop' });
      expect(sessions.setTenantSelection).toHaveBeenCalledTimes(1);
      expect(wa.sendText).toHaveBeenCalledWith(FROM, '¿Para qué agencia es esto?');
    });

    it('convocatoria path still wins regardless of rota (ordering preserved)', async () => {
      // One candidate non-rotating, but it ALSO has an open convocatoria →
      // convocatoria path fires FIRST; rota-skip never reached.
      senderResolver.candidatesFor.mockResolvedValue([
        { clientId: 'c1', clientName: 'Agencia Uno', rota: false },
      ]);
      senderResolver.clientsWithOpenConvocatoria.mockResolvedValue(['c1']);

      const resolution = await ctrl.resolveInboundTenant(FROM, textMsg('sí'));

      expect(resolution).toMatchObject({ status: 'proceed', clientId: 'c1' });
      // Still no agency prompt
      expect(wa.sendText).not.toHaveBeenCalled();
    });

    it('candidatesFor throws → status:stop, no tenant auto-selected (fail-closed, JD-014)', async () => {
      senderResolver.candidatesFor.mockRejectedValue(new Error('db down'));

      const resolution = await ctrl.resolveInboundTenant(FROM, textMsg('hola'));

      expect(resolution).toEqual({ status: 'stop' });
      // Error reply sent to the user
      expect(wa.sendText).toHaveBeenCalled();
    });
  });
});

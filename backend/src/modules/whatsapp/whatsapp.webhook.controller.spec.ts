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

    materialIntake = { start: jest.fn().mockResolvedValue(undefined), handleResponse: jest.fn().mockResolvedValue(false) };
    evidenceIntake = { start: jest.fn().mockResolvedValue(undefined), handleResponse: jest.fn().mockResolvedValue(false) };
    clarification = { handleClarificationResponse: jest.fn().mockResolvedValue(false) };
    projectResolver = { resolve: jest.fn().mockResolvedValue(null) };

    ocrQueue = { add: jest.fn().mockResolvedValue(undefined) };
    convocatoriaQueue = { add: jest.fn().mockResolvedValue(undefined) };
    returnPhotoQueue = { add: jest.fn().mockResolvedValue(undefined) };

    shield = { checkLocal: jest.fn(() => ({ safe: true })) };
    senderResolver = { candidatesFor: jest.fn().mockResolvedValue([]) };
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
});

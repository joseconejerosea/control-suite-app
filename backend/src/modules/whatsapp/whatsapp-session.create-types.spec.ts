/// <reference types="jest" />
/**
 * TASK-A01 — Failing type-level / stub test for session clarification union extension.
 *
 * Asserts that WhatsAppSession.clarification accepts:
 *   type: 'project_create' | 'project_create_offer'
 * with fields: pendingEventoIds?, autoAssignedProjectId?, facturaId?
 *
 * Fails until TASK-A03 extends the union.
 */
import { WhatsAppSession } from './whatsapp-session.service';

describe('WhatsAppSession — clarification union (project_create / project_create_offer)', () => {
  it('accepts type project_create with pendingEventoIds', () => {
    const session: WhatsAppSession = {
      state: 'awaiting_clarification',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      clientId: 'client-1',
      canalId: null,
      updatedAt: new Date().toISOString(),
      clarification: {
        eventoCrudoId: 'ec-1',
        type: 'project_create',
        attempts: 0,
        pendingEventoIds: ['ec-1'],
      },
    };
    expect(session.clarification?.type).toBe('project_create');
    expect(session.clarification?.pendingEventoIds).toEqual(['ec-1']);
  });

  it('accepts type project_create_offer with autoAssignedProjectId and facturaId', () => {
    const session: WhatsAppSession = {
      state: 'awaiting_clarification',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      clientId: 'client-1',
      canalId: null,
      updatedAt: new Date().toISOString(),
      clarification: {
        eventoCrudoId: 'ec-2',
        type: 'project_create_offer',
        attempts: 0,
        autoAssignedProjectId: 'project-solo',
        facturaId: 'fac-99',
      },
    };
    expect(session.clarification?.type).toBe('project_create_offer');
    expect(session.clarification?.autoAssignedProjectId).toBe('project-solo');
    expect(session.clarification?.facturaId).toBe('fac-99');
  });

  it('accepts type project_create_offer without facturaId (sub-case 1)', () => {
    const session: WhatsAppSession = {
      state: 'awaiting_clarification',
      projects: [],
      base64: '',
      mimeType: '',
      caption: '',
      clientId: 'client-1',
      canalId: null,
      updatedAt: new Date().toISOString(),
      clarification: {
        eventoCrudoId: 'ec-3',
        type: 'project_create_offer',
        attempts: 0,
        autoAssignedProjectId: 'project-solo',
      },
    };
    expect(session.clarification?.facturaId).toBeUndefined();
  });

  // NOTE: the ADR-11 invariant (state='awaiting_clarification' set atomically with the
  // clarification sub-object) is covered BEHAVIORALLY in clarification.service.spec.ts
  // (beginProjectCreate + the SCENARIO-26 regression guard on handleClarificationResponse).
  // The former type-only assertion here was tautological (it asserted the fields of an
  // object literal it just built) and added no behavioral value, so it was dropped.
});

import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { installTenantQueryRouting } from '../src/common/tenant/tenant-context';
import { EvidenceIntakeService } from '../src/modules/whatsapp/evidence-intake.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PendingStaffService } from '../src/modules/pending-staff/pending-staff.service';
import { DB } from './helpers';

/**
 * Slice C gap-closing — proves the escalate() wiring actually PERSISTS to Postgres,
 * not just that the mocked methods are invoked. Drives the real EvidenceIntakeService
 * (with real NotificationsService + PendingStaffService, stubbed WhatsApp/notifier)
 * through start() into the unknown-persona escalate branch, then asserts the
 * eventos_crudos status, the pending_staff row, and the per-manager notification row
 * all landed in the DB with the right shape.
 */

jest.setTimeout(60000);

const CLIENT_A = randomUUID();
const MANAGER_ID = randomUUID();
const EVENTO_ID = randomUUID();
const SENDER_PHONE = '+54 9 11 9999-8888';
const SENDER_DIGITS = '5491199998888';

describe('Slice C — evidence escalate wiring persists to real Postgres', () => {
  let ds: DataSource;
  let service: EvidenceIntakeService;
  const sentToSender: string[] = [];
  let notificarCalls = 0;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      ...DB,
      ssl: false,
      synchronize: false,
    });
    await ds.initialize();
    installTenantQueryRouting(ds);

    const waStub = {
      sendText: async (_phone: string, msg: string) => {
        sentToSender.push(msg);
        return true;
      },
    } as any;
    const sessionsStub = {} as any;
    const notifierStub = {
      notificar: async () => {
        notificarCalls += 1;
        return 1;
      },
    } as any;

    service = new EvidenceIntakeService(
      ds,
      waStub,
      sessionsStub,
      notifierStub,
      new NotificationsService(ds),
      new PendingStaffService(ds),
    );

    await ds.query(
      `INSERT INTO clients (id, nombre, status) VALUES ($1,'Tenant A','active')`,
      [CLIENT_A],
    );
    // A Manager (admin_cliente) so resolveManagerIds returns a recipient.
    await ds.query(
      `INSERT INTO users (id, email, password, role, is_active, client_id, language)
       VALUES ($1,$2,'x','admin_cliente',true,$3,'es')`,
      [MANAGER_ID, `mgr-${MANAGER_ID}@t.local`, CLIENT_A],
    );
    // The raw event that intake escalates.
    await ds.query(
      `INSERT INTO eventos_crudos (id, client_id, payload, processed, status, attempts)
       VALUES ($1,$2,'{}'::jsonb,false,'pending',0)`,
      [EVENTO_ID, CLIENT_A],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM notifications WHERE client_id=$1`, [
        CLIENT_A,
      ]);
      await ds.query(`DELETE FROM pending_staff WHERE client_id=$1`, [
        CLIENT_A,
      ]);
      await ds.query(`DELETE FROM eventos_crudos WHERE id=$1`, [EVENTO_ID]);
      await ds.query(`DELETE FROM users WHERE id=$1`, [MANAGER_ID]);
      await ds.query(`DELETE FROM clients WHERE id=$1`, [CLIENT_A]);
      await ds.destroy();
    }
  });

  it('unknown-persona evidence escalates: persists pending_staff + notification, replies to sender', async () => {
    // SENDER_PHONE is not registered as promoter/collaborator/user → unknown_persona branch.
    await service.start({
      eventoCrudoId: EVENTO_ID,
      phoneNumber: SENDER_PHONE,
      clientId: CLIENT_A,
      storagePath: 'evidence/foo.jpg',
    });

    // 1. eventos_crudos marked escalated.
    const [evento] = await ds.query(
      `SELECT status FROM eventos_crudos WHERE id=$1`,
      [EVENTO_ID],
    );
    expect(evento.status).toBe('escalated');

    // 2. pending_staff row created with NORMALIZED phone + contexto.
    const pending = await ds.query(
      `SELECT phone, estado, motivo, contexto FROM pending_staff WHERE client_id=$1`,
      [CLIENT_A],
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].phone).toBe(SENDER_DIGITS);
    expect(pending[0].estado).toBe('pendiente');
    expect(pending[0].contexto).toMatchObject({ eventoCrudoId: EVENTO_ID });
    // No active activation seeded for this tenant → "por confirmar" (null).
    expect(pending[0].contexto.activacion).toBeNull();

    // 3. In-app notification created for the Manager.
    const notifs = await ds.query(
      `SELECT user_id, type, metadata FROM notifications WHERE client_id=$1`,
      [CLIENT_A],
    );
    expect(notifs).toHaveLength(1);
    expect(notifs[0].user_id).toBe(MANAGER_ID);
    expect(notifs[0].type).toBe('evidence_unknown_persona');
    // Deep-link persisted so the bell can navigate the operator to the action.
    expect(notifs[0].metadata).toMatchObject({ link: '/client/promoters' });

    // 4. WhatsApp operator alert fired, and the sender still got a reply.
    expect(notificarCalls).toBe(1);
    expect(sentToSender.length).toBe(1);
  });
});

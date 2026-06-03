import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const ds = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function seed() {
  await ds.initialize();

  // Get or create client
  let clientId: string;
  const existingClient = await ds.query(`SELECT id FROM clients LIMIT 1`);

  if (existingClient.length > 0) {
    clientId = existingClient[0].id;
    console.log(`Client already exists (${clientId})`);
  } else {
    const [client] = await ds.query(
      `INSERT INTO clients (id, nombre, rut, plan, status, onboarding_step)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING id`,
      ['Control Suite Demo', '12.345.678-9', 'basic', 'active', 'completed'],
    );
    clientId = client.id;
  }

  // Get or create admin user
  const existingUser = await ds.query(
    `SELECT id FROM users WHERE email = $1`, ['admin@controlsuite.com'],
  );

  if (existingUser.length > 0) {
    console.log('Admin user already exists — skipping.');
    await ds.destroy();
    return;
  }

  const password = await bcrypt.hash('Admin1234!', 12);

  await ds.query(
    `INSERT INTO users (id, client_id, email, password, role, full_name, is_active)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
    [clientId, 'admin@controlsuite.com', password, 'super_admin', 'Admin', true],
  );

  // Get or create WhatsApp channel
  const existingCanal = await ds.query(
    `SELECT id FROM canal_entrada WHERE client_id = $1 AND tipo = 'whatsapp' LIMIT 1`,
    [clientId],
  );

  if (existingCanal.length === 0) {
    await ds.query(
      `INSERT INTO canal_entrada (id, client_id, nombre, tipo, config, is_active, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, NOW(), NOW())`,
      [
        clientId,
        'WhatsApp Principal',
        'whatsapp',
        JSON.stringify({ phone_number_id: '1582337719743680' }),
        true,
      ],
    );
    console.log('  Canal: WhatsApp Principal (phone_number_id: 1582337719743680)');
  }

  console.log('Seed completed:');
  console.log(`  Client: Control Suite Demo (${clientId})`);
  console.log('  User:   admin@controlsuite.com / Admin1234!');

  await ds.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

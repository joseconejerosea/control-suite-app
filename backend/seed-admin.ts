import { DataSource } from 'typeorm';

const ds = new DataSource({
  type: 'postgres',
  host: '95.217.135.21',
  port: 5432,
  username: 'n8n_user',
  password: 'Jose12345',
  database: 'n8n',
  ssl: false,
});

ds.initialize().then(async () => {
  await ds.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255) NULL;`);
  console.log('full_name column added!');
  await ds.destroy();
});
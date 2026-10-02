/* eslint-disable */
// Genera un SQL idempotente + transaccional para cargar la base demo (3 empresas)
// amoldada al schema real de Control Suite. Aditivo: no borra nada. Ver docs/amoldacion-demo-3empresas.md
//
//   node scripts/seed-demo-3empresas.js <ruta.xlsx> > seed-demo.sql
//
// Requiere: xlsx, bcrypt (ya presentes en backend/node_modules).

const path = require('path');
const crypto = require('crypto');
const XLSX = require(path.join(__dirname, '../backend/node_modules/xlsx'));
const bcrypt = require(path.join(__dirname, '../backend/node_modules/bcrypt'));

const XLSX_PATH = process.argv[2] || 'C:/Users/User/Downloads/ControlSuite_Demo_3empresas.xlsx';
const DEMO_PASSWORD = 'Demo1234!';
const NS = 'controlsuite-demo-3empresas-v1';

// ── helpers ────────────────────────────────────────────────────────────────
function uuid(slug) {
  const h = crypto.createHash('sha1').update(NS + ':' + String(slug)).digest('hex').slice(0, 32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
function affCode(slug) {
  return crypto.createHash('sha1').update('aff:' + slug).digest('hex').slice(0, 8).toUpperCase();
}
const q = (v) => v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const num = (v) => v == null || v === '' ? 'NULL' : Number(v);
const bool = (v) => v ? 'TRUE' : 'FALSE';
const dateOnly = (v) => v == null ? 'NULL' : `'${String(v).slice(0, 10)}'`;      // DATE
const ts = (v) => v == null ? 'NULL' : `'${String(v).replace('T', ' ').slice(0, 19)}'`; // timestamptz
const jsonb = (obj) => obj == null ? 'NULL' : `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
const rawJsonb = (s) => { try { JSON.parse(s); return `'${String(s).replace(/'/g, "''")}'::jsonb`; } catch { return jsonb({ raw: s }); } };
const splitName = (n) => { const p = String(n || '').trim().split(/\s+/); return [p[0] || '', p.slice(1).join(' ') || null]; };
const baseName = (u) => String(u || '').split('/').pop() || 'archivo';
const normPhone = (p) => String(p || '').replace(/\D/g, '');

const wb = XLSX.readFile(XLSX_PATH);
const J = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });

// ── índices de resolución ────────────────────────────────────────────────────
const users = J('User');
const owners = users.filter((u) => !u['*perfil_terreno']);   // dueños → users (login)
const staff = users.filter((u) => u['*perfil_terreno']);     // terreno → promoters
const ownerUuidBySlug = Object.fromEntries(owners.map((u) => [u.id, uuid(u.id)]));
const promoterUuidBySlug = Object.fromEntries(staff.map((u) => [u.id, uuid(u.id)]));
const ownerUuidByTenant = Object.fromEntries(owners.map((u) => [u.tenantId, uuid(u.id)]));
const promoterByPhoneTenant = {};
for (const s of staff) promoterByPhoneTenant[`${s.tenantId}|${normPhone(s.phone)}`] = uuid(s.id);

const brandById = Object.fromEntries(J('Client').map((c) => [c.id, c]));
const projById = Object.fromEntries(J('Project').map((p) => [p.id, p]));
const whTenant = Object.fromEntries(J('Warehouse').map((w) => [w.id, w.tenantId]));
const convById = Object.fromEntries(J('Convocation').map((c) => [c.id, c]));

const personaFK = (slug) => promoterUuidBySlug[slug] || 'NULL_UUID'; // promoter or null
const P = (slug) => promoterUuidBySlug[slug] ? `'${promoterUuidBySlug[slug]}'` : 'NULL';
const U = (slug, tenant) => `'${ownerUuidBySlug[slug] || ownerUuidByTenant[tenant]}'`;

const out = [];
const w = (s) => out.push(s);

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const HASH = await bcrypt.hash(DEMO_PASSWORD, 12);

  w('-- Base demo 3 empresas → schema real Control Suite (aditivo, idempotente, transaccional)');
  w('-- Generado por scripts/seed-demo-3empresas.js · ver docs/amoldacion-demo-3empresas.md');
  w('BEGIN;');

  // 1. clients (Tenant)
  w('\n-- clients (agencias)');
  for (const t of J('Tenant')) {
    const plan = t.planStatus === 'TRIAL' ? 'trial' : 'basic';
    w(`INSERT INTO clients (id, nombre, plan, status, onboarding_step, onboarding_completed_at, affiliation_code, config, created_at) VALUES ` +
      `('${uuid(t.id)}', ${q(t.name)}, '${plan}', 'active', 'completed', ${ts(t.createdAt)}, '${affCode(t.id)}', ${jsonb({ slug: t.slug, demo: true })}, ${ts(t.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 2. users (dueños → MANAGER='admin_cliente')
  w('\n-- users (dueños, rol admin_cliente, password demo)');
  for (const u of owners) {
    w(`INSERT INTO users (id, client_id, email, password, role, is_active, full_name, language, phone, created_at) VALUES ` +
      `('${uuid(u.id)}', '${uuid(u.tenantId)}', ${q(u.email)}, ${q(HASH)}, 'admin_cliente', TRUE, ${q(u.name)}, 'es', ${q(u.phone)}, ${ts(u.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 3. promoters (terreno)
  w('\n-- promoters (personal de terreno)');
  for (const s of staff) {
    const [fn, ln] = splitName(s.name);
    w(`INSERT INTO promoters (id, client_id, name, first_name, last_name, email, phone, rol, status, is_active, created_at) VALUES ` +
      `('${uuid(s.id)}', '${uuid(s.tenantId)}', ${q(s.name)}, ${q(fn)}, ${q(ln)}, ${q(s.email)}, ${q(s.phone)}, ${q(s['*perfil_terreno'])}, 'active', TRUE, ${ts(s.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 4. bodegas (Warehouse)
  w('\n-- bodegas');
  for (const wh of J('Warehouse')) {
    w(`INSERT INTO bodegas (id, client_id, nombre, direccion, tipo, active, created_at) VALUES ` +
      `('${uuid(wh.id)}', '${uuid(wh.tenantId)}', ${q(wh.name)}, ${q(wh.location)}, '${wh.isVirtual ? 'virtual' : 'principal'}', TRUE, ${ts(wh.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 5. skus (PopItem)
  w('\n-- skus');
  for (const it of J('PopItem')) {
    w(`INSERT INTO skus (id, client_id, codigo, nombre, min_stock, tipo, active, created_at) VALUES ` +
      `('${uuid(it.id)}', '${uuid(it.tenantId)}', ${q(it.sku)}, ${q(it.name)}, ${num(it.minStock)}, 'reusable', TRUE, ${ts(it.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 6. projects (+ 7. campaigns sintéticas)
  w('\n-- projects (+ campaña sintética por proyecto)');
  for (const p of J('Project')) {
    const brand = brandById[p.clientId] || {};
    // Project no trae createdAt en el Excel → omitimos created_at para que aplique el default now().
    w(`INSERT INTO projects (id, client_id, name, status, start_date, end_date, budget, presupuesto_clp, cliente_final, cliente_final_rut, config) VALUES ` +
      `('${uuid(p.id)}', '${uuid(p.tenantId)}', ${q(p.name)}, '${p.status === 'CLOSED' ? 'closed' : 'active'}', ${dateOnly(p.startDate)}, ${dateOnly(p.endDate)}, ${num(p.budget)}, ${num(p.budget)}, ${q(brand.name)}, ${q(brand.rut)}, ${jsonb({ code: p.code, demo: true })}) ON CONFLICT (id) DO NOTHING;`);
    w(`INSERT INTO campaigns (id, client_id, name, status, is_active, project_id, budget) VALUES ` +
      `('${uuid('campaign:' + p.id)}', '${uuid(p.tenantId)}', ${q(p.name + ' — Campaña')}, 'active', TRUE, '${uuid(p.id)}', ${num(p.budget)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 8. inventario (PopStock)
  w('\n-- inventario');
  for (const st of J('PopStock')) {
    const tenant = whTenant[st.warehouseId];
    w(`INSERT INTO inventario (id, client_id, sku_id, bodega_id, cantidad, ultimo_movimiento_at) VALUES ` +
      `('${uuid(st.id)}', '${uuid(tenant)}', '${uuid(st.itemId)}', '${uuid(st.warehouseId)}', ${num(st.quantity)}, ${ts(st.updatedAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 9. movimientos_pop (StockMovement)
  w('\n-- movimientos_pop');
  for (const m of J('StockMovement')) {
    const tenant = whTenant[m.warehouseId];
    w(`INSERT INTO movimientos_pop (id, client_id, sku_id, bodega_origen_id, proyecto_destino_id, persona_id, tipo, cantidad, observacion, created_at) VALUES ` +
      `('${uuid(m.id)}', '${uuid(tenant)}', '${uuid(m.itemId)}', '${uuid(m.warehouseId)}', ${m.projectId ? `'${uuid(m.projectId)}'` : 'NULL'}, ${P(m.responsibleId)}, '${m.type === 'OUT' ? 'salida' : 'entrada'}', ${num(m.quantity)}, ${q(m.notes)}, ${ts(m.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 10. eventos_crudos (EventoCrudo)
  w('\n-- eventos_crudos');
  for (const e of J('EventoCrudo')) {
    w(`INSERT INTO eventos_crudos (id, client_id, payload, source, processed, status, flow, created_at, processed_at) VALUES ` +
      `('${uuid(e.id)}', '${uuid(e.tenantId)}', ${rawJsonb(e.rawPayload)}, 'whatsapp', TRUE, 'processed', ${q(e.flow)}, ${ts(e.createdAt)}, ${ts(e.processedAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 11. document_uploads (Document)
  w('\n-- document_uploads');
  for (const d of J('Document')) {
    w(`INSERT INTO document_uploads (id, client_id, uploaded_by, project_id, original_name, mime_type, file_size, storage_path, status, created_at) VALUES ` +
      `('${uuid(d.id)}', '${uuid(d.tenantId)}', ${U(null, d.tenantId)}, ${d.projectId ? `'${uuid(d.projectId)}'` : 'NULL'}, ${q(baseName(d.fileUrl))}, 'image/jpeg', 0, ${q(d.fileUrl)}, '${d.status === 'APPROVED' ? 'populated' : 'parsed'}', ${ts(d.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 12. rendiciones (ExpenseRendition)
  w('\n-- rendiciones');
  const renEstado = { APPROVED: 'aprobada', OPEN: 'borrador', SUBMITTED: 'enviada' };
  for (const r of J('ExpenseRendition')) {
    w(`INSERT INTO rendiciones (id, client_id, persona_id, project_id, periodo, estado, monto_total, aprobada_at, aprobada_por_user_id, created_at) VALUES ` +
      `('${uuid(r.id)}', '${uuid(r.tenantId)}', ${P(r.personId)}, ${r.projectId ? `'${uuid(r.projectId)}'` : 'NULL'}, ${q(String(r.weekStart).slice(0,10))}, '${renEstado[r.status] || 'borrador'}', ${num(r.totalAmount)}, ${ts(r.approvedAt)}, ${r.approvedBy ? U(r.approvedBy, r.tenantId) : 'NULL'}, ${ts(r.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 13. invoices (Expense) + 14. rendicion_items
  w('\n-- invoices (+ rendicion_items)');
  for (const x of J('Expense')) {
    w(`INSERT INTO invoices (id, client_id, source, vendor_name, amount, currency, invoice_date, category, description, status, project_id, created_at) VALUES ` +
      `('${uuid(x.id)}', '${uuid(x.tenantId)}', 'manual', ${q(x.vendor)}, ${num(x.amount)}, 'CLP', ${dateOnly(x.docDate)}, 'cost', ${q((x.category || '') + (x.notes ? ' · ' + x.notes : ''))}, '${x.status === 'APPROVED' ? 'confirmed' : 'pending'}', ${x.projectId ? `'${uuid(x.projectId)}'` : 'NULL'}, ${ts(x.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
    if (x.renditionId) {
      w(`INSERT INTO rendicion_items (id, client_id, rendicion_id, invoice_id, monto, descripcion, created_at) VALUES ` +
        `('${uuid('ritem:' + x.id)}', '${uuid(x.tenantId)}', '${uuid(x.renditionId)}', '${uuid(x.id)}', ${num(x.amount)}, ${q(x.vendor)}, ${ts(x.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
    }
  }

  // 15. convocatorias (PersonDay) + 16. convocatoria_mensajes
  w('\n-- convocatorias (desde PersonDay)');
  const pdEstado = { CONFIRMED: 'confirmada', NO_SHOW: 'no_show' };
  for (const pd of J('PersonDay')) {
    const cnv = convById[pd.convocationId]; if (!cnv) continue;
    w(`INSERT INTO convocatorias (id, client_id, proyecto_id, persona_id, dia, estado, created_at) VALUES ` +
      `('${uuid(pd.id)}', '${uuid(cnv.tenantId)}', '${uuid(cnv.projectId)}', ${P(pd.personId)}, ${dateOnly(pd.date)}, '${pdEstado[pd.status] || 'pendiente'}', ${ts(pd.createdAt || cnv.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }
  w('\n-- convocatoria_mensajes (desde ConvocationMessage)');
  for (const cm of J('ConvocationMessage')) {
    const cnv = convById[cm.convocationId]; if (!cnv) continue;
    const persona = promoterByPhoneTenant[`${cnv.tenantId}|${normPhone(cm.phone)}`];
    if (!persona) continue; // sin promotor resoluble por teléfono → se omite (persona_id NOT NULL)
    w(`INSERT INTO convocatoria_mensajes (id, client_id, proyecto_id, persona_id, direction, body, created_at) VALUES ` +
      `('${uuid(cm.id)}', '${uuid(cnv.tenantId)}', '${uuid(cnv.projectId)}', '${persona}', '${cm.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND'}', ${q(cm.content)}, ${ts(cm.sentAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // 17. activations (con campaña sintética) + 18. activation_events
  w('\n-- activations');
  for (const a of J('Activation')) {
    const p = projById[a.projectId] || {};
    w(`INSERT INTO activations (id, client_id, campaign_id, project_id, promoter_id, status, estado_f5, activation_date, location, scheduled_at, created_at) VALUES ` +
      `('${uuid(a.id)}', '${uuid(a.tenantId)}', '${uuid('campaign:' + a.projectId)}', '${uuid(a.projectId)}', ${P(a.supervisorId)}, '${a.status === 'COMPLETED' ? 'completed' : 'scheduled'}', '${a.status === 'COMPLETED' ? 'cerrada' : 'pendiente'}', ${dateOnly(a.date)}, ${jsonb({ address: a.location })}, ${ts(a.date)}, ${ts(a.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }
  w('\n-- activation_events');
  for (const ev of J('ActivationEvent')) {
    w(`INSERT INTO activation_events (id, client_id, activation_id, event_type, content, media_url, created_at) VALUES ` +
      `('${uuid(ev.id)}', '${uuid((J('Activation').find((a) => a.id === ev.activationId) || {}).tenantId)}', '${uuid(ev.activationId)}', 'whatsapp', ${q(ev.content)}, ${q(ev.mediaUrl)}, ${ts(ev.createdAt)}) ON CONFLICT (id) DO NOTHING;`);
  }

  // ── Emitir migración TypeORM ────────────────────────────────────────────────
  // Cada elemento de `out` que sea un INSERT es UN statement completo (aunque el valor
  // tenga saltos de línea internos: siguen dentro del mismo string del array).
  const stmts = out.filter((l) => l.trim().startsWith('INSERT'));
  const demoClientIds = J('Tenant').map((t) => uuid(t.id));
  const idsSql = '(' + demoClientIds.map((i) => `'${i}'`).join(', ') + ')';
  // Orden inverso de FK para el down (hijos antes que padres).
  const delTables = [
    'activation_events', 'activations', 'convocatoria_mensajes', 'convocatorias',
    'rendicion_items', 'invoices', 'rendiciones', 'document_uploads', 'eventos_crudos',
    'movimientos_pop', 'inventario', 'campaigns', 'projects', 'skus', 'bodegas',
    'promoters', 'users',
  ];
  const CLASS = 'SeedDemo3Empresas1700000000074';
  const mig = `import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed demo · 3 empresas (Terreno Vivo, Activa Norte, Punto de Contacto).
 *
 * Generado por scripts/seed-demo-3empresas.js desde ControlSuite_Demo_3empresas.xlsx.
 * Amoldación completa: docs/amoldacion-demo-3empresas.md.
 *
 * ADITIVA e IDEMPOTENTE: cada INSERT lleva ON CONFLICT (id) DO NOTHING y los UUID son
 * determinísticos, así que correr la migración sobre una base que YA tiene la demo no
 * duplica nada. down() borra solo los 3 tenants demo (reversible).
 */
export class ${CLASS} implements MigrationInterface {
  name = '${CLASS}';

  public async up(q: QueryRunner): Promise<void> {
    // Datos DEMO: solo en entornos NO productivos. En producción la migración se registra
    // como aplicada pero no inserta nada, para no contaminar la base real con las 3
    // agencias ficticias. (Quitar este guard si se quiere la demo también en prod.)
    if (process.env.NODE_ENV === 'production') return;
    for (const s of ${CLASS}.STMTS) {
      await q.query(s);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const ids = ${JSON.stringify(idsSql)};
${delTables.map((t) => `    await q.query(\`DELETE FROM ${t} WHERE client_id IN \${ids}\`);`).join('\n')}
    await q.query(\`DELETE FROM clients WHERE id IN \${ids}\`);
  }

  private static readonly STMTS: string[] = [
${stmts.map((s) => '    ' + JSON.stringify(s)).join(',\n')},
  ];
}
`;
  const fs = require('fs');
  const dest = path.join(__dirname, '../backend/src/migrations/1700000000074-SeedDemo3Empresas.ts');
  fs.writeFileSync(dest, mig);
  process.stderr.write(`Migración escrita: ${dest} (${stmts.length} statements)\n`);
})();

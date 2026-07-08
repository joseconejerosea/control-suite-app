# Auditoría Frontend — Super Admin (dev.controlsuitte.com)

Fecha: 2026-07-08 · Usuario: admin@controlsuite.com (super admin)
Método: Playwright, Fase A (solo diagnóstico, sin fixes).

Leyenda: 🔴 roto · 🟡 usabilidad · 🟢 ok

## Vistas del super admin (nav)
1. /admin/dashboard — Dashboard Global
2. /admin/onboarding — Onboarding
3. /admin/clientes — Clientes
4. /admin/monitoring — Monitoreo
5. /admin/tickets — Tickets
6. /admin/audit — Auditoría AI
7. /admin/usuarios — Usuarios

---

## 1. /admin/dashboard — Dashboard Global

- 🔴 **KPIs vacíos**: `GET /api/dashboard/overview?period=month` → **400 Bad Request**. Todos los tiles (Eventos 24h, Activaciones live, Docs procesados, Promotores, Campañas) quedan en "—". Solo "Clientes activos: 3" carga (viene de `/api/clients`).
  - Console: `Failed to load resource: 400 @ /api/dashboard/overview?period=month`
  - **CAUSA RAÍZ (confirmada en código)**: mismatch de contrato. `DashboardFiltersDto` (backend) solo acepta `from`/`to`/`project_id` — NO `period`. El front manda `?period=month`; el ValidationPipe whitelist rechaza la prop desconocida → 400. El service ya calcula `period: {from, to}` internamente.
  - Fix Fase B (2 opciones): (a) front convierte Hoy/Semana/Mes/Año → `from`/`to` y no manda `period`; o (b) back agrega `period` al DTO + deriva el rango. Decidir con el usuario.
- 🟡 **KPI "Clientes activos" mal contado**: dashboard muestra 3, pero /admin/clientes muestra Activos=1, Onboarding=2. El tile cuenta el TOTAL, no los activos.

## 3. /admin/clientes — Clientes

- 🟢 Carga OK, sin errores de consola. Stats (Total 3 / Activos 1 / Onboarding 2 / Suspendidos 0), buscador, tabla con acciones Activar/Suspender.
- 🟡 Datos de prueba sucios: 2 clientes "AAA" con el MISMO RUT (76.123.456-7). No es bug de código, pero conviene limpiar el seed de dev.
- Pendiente Fase B: probar Activar/Suspender (no testeado en auditoría para no mutar estado en dev).

## 4. /admin/monitoring — Monitoreo

- 🟢 Carga OK. `GET /api/admin/monitoring` + `/clients` → 200. Muestra KPIs (Clientes Activos, Activaciones EN VIVO, Eventos 24h, Errores 24h, Costo AI hoy) + tabla por cliente. El "Cargando..." es transitorio (no trabado).

## 5. /admin/tickets — Tickets

- 🔴 **404 — la vista NUNCA carga tickets**: `GET /api/admin/support/tickets` → **404**. La UI muestra "Sin tickets" (engañoso: el fetch falla y cae a lista vacía, no es que no haya tickets).
  - **CAUSA RAÍZ (confirmada en código)**: `SupportModule` (`backend/src/modules/support/support.module.ts`) está DEFINIDO pero NO se importa en `app.module.ts` ni en ningún agregador (grep en todo `backend/src`: solo aparece la definición). Un módulo no importado no registra rutas → 404.
  - **IMPACTO DOMINÓ**: todas las rutas de Support están muertas: `admin/support/tickets`, `support/tickets` (cliente), `support/kpis`, `support/broadcast`. El fix del broadcast por email (hecho antes en esta sesión) es correcto en código pero el módulo ni está montado.
  - Fix Fase B: agregar `SupportModule` a los imports de `app.module.ts`. Trivial, pero verificar que no rompa nada (guards/roles).

## 6. /admin/audit — Auditoría AI

- 🟢 Carga OK, sin errores de consola. 2 tabs (Costos AI / Log de Acciones) + selector de rango (7/30/90 días). `/api/admin/audit/ai-costs` + `/actions` → 200.
- 🟡 Tab "Costos AI": "Total AI Cost" y "Avg per call" muestran $0.0000 (valor), pero "Claude calls" y "Tokens usados" muestran "—". Posible mapeo parcial de campos o simplemente data vacía en dev. Verificar Fase B.
- 🟡 Tab "Log de Acciones": "Sin acciones registradas" pese a que el AuditInterceptor global (feature de roles) debería loguear (p.ej. el login del super admin). Verificar si audit_logs se está poblando y si la vista lee la fuente correcta.

## 7. /admin/usuarios — Usuarios por Tenant

- 🟢 Funciona completo. Selector de cliente se puebla desde `/api/clients`; al elegir tenant carga `/api/v1/app/admin/users?client_id=...` → 200. Tabla con Email/Nombre/Teléfono/Rol/Estado/Creado + acciones Editar/Desactivar. Stats (Total/Activos/Admins/Inactivos) se calculan bien (2/2/1/0). Botón "+ Crear usuario" presente.
- Nota menor: el dropdown lista 2 "AAA (onboarding)" idénticos (mismo dato sucio de seed).
- Pendiente Fase B: probar Crear/Editar/Desactivar usuario (mutaciones, no testeadas en auditoría).

## 2. /admin/onboarding — Onboarding

- 🟢 Carga OK, sin errores de consola. Wizard 5 pasos (Client → Canal → Verify → Admin → Listo). Paso 1: Nombre/RUT/Plan, botón "Crear cliente" deshabilitado hasta cargar nombre.
- Pendiente Fase B: correr el flujo completo (crea cliente real → mutación, no testeado). Ver también el bug conocido del sheets_id que se setea acá.

---

# RESUMEN PRIORIZADO

## 🔴 Roto (fixes reales de código)
| # | Vista | Problema | Causa raíz | Fix |
|---|-------|----------|-----------|-----|
| 1 | Dashboard | KPIs en "—", `overview?period=month` → 400 | `DashboardFiltersDto` no acepta `period` (whitelist rechaza) | front manda `from`/`to` en vez de `period`, o back agrega `period` al DTO |
| 2 | Tickets | 404, "Sin tickets" engañoso | `SupportModule` NO importado en `app.module.ts` → rutas no registradas (dominó: tickets cliente + broadcast email también muertos) | importar `SupportModule` en app.module |

## 🟡 Usabilidad / menores
| # | Vista | Problema |
|---|-------|----------|
| 3 | Dashboard | "Clientes activos: 3" cuenta el total, no los activos (real: 1) |
| 4 | Audit | "Claude calls"/"Tokens" en "—" (mapeo parcial o data vacía) |
| 5 | Audit | "Log de Acciones" vacío pese al AuditInterceptor activo |
| 6 | Clientes/Usuarios | seed sucio: 2 clientes "AAA" con mismo RUT |

## 🟢 OK
Clientes · Monitoreo · Usuarios · Onboarding (entrada) · Audit (carga)

## No testeado (mutaciones, evitadas en auditoría)
Activar/Suspender cliente · Crear/Editar/Desactivar usuario · flujo onboarding completo · responder ticket · broadcast

---

# FASE B — FIXES APLICADOS (2026-07-08)

| # | Fix | Archivos |
|---|-----|----------|
| 🔴 1 | Dashboard 400: `period` agregado a `DashboardFiltersDto` (@IsIn day/week/month/year) + `resolvePeriod` lo traduce a from/to | `backend/.../dashboard/dto/dashboard-filters.dto.ts`, `dashboard.service.ts` |
| 🔴 2 | `SupportModule` importado en app.module (destraba tickets admin/cliente + broadcast) | `backend/src/app.module.ts` |
| 🟡 3 | Dashboard "Clientes activos" cuenta `status==='active'` (antes total); badge de tabla usa `c.status` (antes `c.activo` inexistente → siempre "Activo") | `frontend/app/admin/dashboard/page.tsx` |
| 🟡 4 | Costos AI: remap del contrato — front lee `total.{total_usd,total_input,total_output,total_calls}`, `byClient`, `byFlow` (antes `total_cost_usd`/`by_client` etc, ninguno matcheaba) | `frontend/app/admin/audit/page.tsx` |
| 🟡 5 | Log de Acciones: `getActionLog` consulta `audit_logs` (antes `eventos_crudos`, tabla equivocada) | `backend/.../audit/audit.controller.ts` |

## NO verificado en dev todavía
Dev corre el build viejo → estos fixes no se reflejan hasta merge+deploy. Verificar post-deploy con Playwright.

## Pendiente de decisión / follow-up
- **Dashboard global scope**: RESUELTO. El Dashboard Global ahora consume `/admin/monitoring` (agregado real de todos los tenants: clients.active, events_24h, activations.live, docs_24h, errores, ai_cost_hoy). Se quitó el selector de período (monitoring es tiempo real, lo ignoraba). El fix de `period` en DashboardFiltersDto igual queda porque `/dashboard/overview` lo sigue usando el dashboard del CLIENTE (tenant-scoped, correcto ahí).
- **RLS en audit_logs**: el `getActionLog` usa `ds.query` directo (mismo patrón que ai-costs). Verificar que RLS no filtre la lectura global del super admin post-deploy.
- 🟡 6 seed sucio (2x "AAA" mismo RUT): es data de dev, no código. Limpiar seed.
- Observación: tabla "Clientes (3)" muestra 2 clientes llamados "AAA" (uno enterprise, uno basic) + "Control Suite Demo". Datos de prueba.
- Selector de período (Hoy/Semana/Mes/Año) + botón Refresh presentes — falta verificar si al cambiar período reintenta bien.

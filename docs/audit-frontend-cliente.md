# Auditoría Frontend — Rol Cliente (dev.controlsuitte.com)

Fecha: 2026-07-08 · Usuario: admincliente.demo@controlsuite.com (admin_cliente / tenant Control Suite Demo)
Método: Playwright, Fase A (solo diagnóstico). Menú = CLIENT_SECTIONS (lado "Cliente" del toggle).

Leyenda: 🔴 roto · 🟡 usabilidad · 🟢 ok

## Vistas (16)
General: /client/dashboard
Operación: /client/reportes, /client/documentos-revisar, /client/inventario, /client/rendiciones, /client/terreno, /client/calendario, /client/projects, /client/campaigns, /client/locations, /client/promoters, /client/documents, /client/collaborators
Configuración: /client/config, /client/equivalencias
IA: /client/mind

---

## 1. /client/dashboard — 🟢
Carga OK. KPIs tenant-scoped (todos 0 para Demo, correcto — sin data). Gráfico "Events Received" muestra 2026-06-24: 7. Usa `/dashboard/overview` (el fix de `period` aplica acá). Selector período + Refresh + tiles clickeables ("Ver detalle").

## 2. /client/reportes — 🔴
`GET dev-api.controlsuitte.com/invoices/report` → **404**. La URL NO lleva prefijo `/api` (igual que /admin/eventos). Muestra "Sin registros" tapando el 404. PATRÓN: 2da llamada `/invoices/*` sin `/api` → posible cliente API de invoices roto.

## 3. /client/documentos-revisar — 🔴 CRASH TOTAL
Error boundary "This page couldn't load". Console: `TypeError: l.map is not a function`. Los endpoints `GET /api/projects` (200) y `GET /api/app/f1-documents?page=1&limit=20` (200) responden OK, pero el componente hace `.map` sobre una respuesta que no es array (f1-documents es paginado → `{docs,total,page,limit}`; lo trata como lista). Mismo patrón que el bug de paginación conocido. La vista entera muere.

## 4. /client/inventario — 🟢
6 endpoints (inventario, movimientos, bodegas, skus, alertas-stock, returns/pending) → 200. Tabs (Bodega/SKUs/Movimientos/Devoluciones) + acciones (Movimiento, +SKU, +Bodega). "Sin stock registrado" (vacío, no trabado — el "Cargando..." es transitorio).

## 5. /client/rendiciones — 🟢
`/api/rendiciones` + `/kpis` → 200. KPIs por estado (borrador/enviada/aprobada/pagada/rechazada, todos 0). "Sin rendiciones".

## 6. /client/terreno — 🔴
`GET /api/activations` → **500 Internal Server Error** (error del backend). Muestra "Sin activaciones registradas" tapándolo. A investigar el 500 en Fase B.

## 7. /client/calendario — 🟢
`/api/projects` → 200. Selector de proyecto (vacío, Demo sin proyectos). Empty state correcto.

## 8. /client/projects — 🟢
`/api/projects` → 200. "No projects found". Search + "AI desde doc" + "+ New Project". (i18n: en inglés)

## 9. /client/campaigns — 🔴
`GET /api/campaigns` → **500**. Muestra "No campaigns found" tapándolo. (i18n: inglés)

## 10. /client/locations — 🔴
`GET /api/locations` → **500**. Muestra "No locations found" tapándolo. (i18n: inglés)

## 11. /client/promoters — 🔴
`GET /api/promoters` → **500**. Muestra "No promoters found" tapándolo. (i18n: inglés)

## 12. /client/documents — 🟢
`/api/documents` → 200. "No documents uploaded yet". (i18n: inglés)

## 13. /client/collaborators — 🟢
`/api/collaborators` → 200. "No collaborators found". (i18n: inglés)

## 14. /client/config — 🔴 (4× 404)
4 llamadas SIN prefijo `/api`: `/workspace/context`, `/collaborators`, `/v1/app/bodegas`, `/canal-entrada` → todas 404. La página renderiza los tabs (Cuenta/Equipo/Operaciones/Integraciones) pero sin datos (form con placeholders). Ver CAUSA RAÍZ A.

## 15. /client/equivalencias — 🟢
`/api/v1/app/equivalencias` → 200. "Sin equivalencias". Usa api helper (correcto).

## 16. /client/mind — 🟢
3 endpoints (propuestas, dashboard, chat/history) → 200. KPIs + tabs (Propuestas/Chat·Ejecutor/Analista IA). "Ahorro estimado"/"Proyectos monitoreados" en "—" (menor). Empty state OK.

---

# CAUSAS RAÍZ (sistémicas)

## A) Falta prefijo `/api` — páginas con fetch crudo
`lib/api.ts`: `BASE = NEXT_PUBLIC_API_URL ?? "http://localhost:3001"` (SIN /api) y hace `fetch(\`${BASE}/api${path}\`)` → el helper agrega `/api`. Contrato: **NEXT_PUBLIC_API_URL NO lleva /api**.
Pero config/reportes/eventos hacen `const API = NEXT_PUBLIC_API_URL ?? ".../api"` y `fetch(\`${API}/...\`)` → asumen que la env SÍ trae /api. En dev/prod la env NO lo trae → 404. Solo "anda" local si corre sin la env (usa el fallback con /api).
Afectadas: /client/config (4), /client/reportes, /admin/eventos. **Y mi componente GmailConnect (mismo patrón) — hay que arreglarlo.**
Fix: usar el helper `api.*` de lib/api, o construir la URL como `${BASE}/api/...`.

## B) 4× 500 en listas core del modelo campañas/activaciones
`GET /api/activations`, `/api/campaigns`, `/api/locations`, `/api/promoters` → todos **500**. Son las entidades del modelo campaign/activation. Causa compartida muy probable (base repo / relación / tenant-context). A investigar el stacktrace del backend en Fase B.

## C) Crash por paginación
/client/documentos-revisar: `.map is not a function` sobre respuesta paginada de `/api/app/f1-documents` (`{docs,total}` tratado como array). Mata la vista entera.

# RESUMEN
🔴 (7): reportes(404), documentos-revisar(crash), terreno(500), campaigns(500), locations(500), promoters(500), config(4×404)
🟢 (9): dashboard, inventario, rendiciones, calendario, projects, documents, collaborators, equivalencias, mind
🟡: i18n mezclado (6 vistas en inglés: projects, campaigns, locations, promoters, documents, collaborators; resto español)

---

# FASE B — FIXES APLICADOS (2026-07-08)

## ✅ Causa A (falta /api) — RESUELTA
Cambiado `const API/API_BASE = NEXT_PUBLIC_API_URL ?? ".../api"` → `${NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api` en:
- frontend/app/client/config/page.tsx
- frontend/app/client/reportes/page.tsx
- frontend/app/admin/eventos/page.tsx
- (frontend/components/integrations/gmail-connect.tsx — ya corregido antes)
Ahora la URL siempre lleva /api, coincida o no la env con el fallback.

## ✅ Causa C (crash paginación) — RESUELTA
`documentos-revisar`: el interceptor global envuelve en `{data, timestamp, path}` y el endpoint paginado ya devuelve `{data, pagination}` → DOBLE nesting. El body real es `{ data: { data: [...docs], pagination }, ... }`. El código hacía `setDocs(res.data)` (=objeto paginado) → `docs.map` crash. Fix: `res.data.data` para los docs y `res.data.pagination`. (Confirmado con curl a /api/app/f1-documents: 6 docs reales.)

## ✅ Causa B (4×500) — RESUELTA (migración)
Log de Postgres (Thomas) confirmó SCHEMA DRIFT — columnas de la entidad que no existen en la tabla:
- `column Campaign.location_id does not exist`
- `column Location.region does not exist`
- `column Promoter.first_name does not exist`
- `column Activation.activation_date does not exist`
Causa: las entidades evolucionaron sin migración (`synchronize:false` → la DB nunca se actualizó). `projects` andaba porque su tabla sí matchea su entidad.
Fix: migración `1700000000056-ReconcileCrmSchemaDrift.ts` — `ADD COLUMN IF NOT EXISTS` (nullable, idempotente, no-destructiva) para todas las columnas de las 4 entidades. Se aplica en el deploy (`migration:run:prod`).
CAVEAT: si las tablas tienen columnas con nombres VIEJOS (posible rename español→inglés), la migración agrega las nuevas vacías (queries dejan de romper). Como los endpoints estaban en 500 (nunca funcionaron), no hay data escrita por la app bajo las columnas nuevas → seguro. Backfill de data vieja = follow-up si aplica. NO verificable localmente (corre en deploy).

## (histórico) Causa B — investigación previa
`/api/{activations,campaigns,locations,promoters}` → 500. Investigación exhaustiva:
- El repo `TenantRepository` y la entidad base son COMPARTIDOS con `projects`, que anda (200). Descartado.
- La policy RLS es idéntica para las 5 tablas (`client_id = current_setting('app.current_tenant', true)::uuid`). Projects tiene la misma. Descartado.
- Los GRANT al rol app son ALL TABLES (migración 041). Descartado.
- El cuerpo del 500 es genérico (filtro global lo tapa).
CONCLUSIÓN: es estado de esas 4 tablas en la DB de dev (drift de columna / migración fallida / trigger), NO código. Requiere el stacktrace de Postgres (docker logs del backend en Hetzner) para pinpoint. NO se debe adivinar/aplicar migración a ciegas.

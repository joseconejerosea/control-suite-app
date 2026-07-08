# Plan de Análisis — Frontend vs Modelo de 6 Roles

**Repo:** `frontend/` (Next.js 16.2.1, React 19, TS, Tailwind v4, shadcn/ui)
**Auth:** sin estado global — el user vive en `localStorage` (`cs_user`), el rol sale del JWT decodificado en el cliente (`parseJwt`, sin `/me`).
**Objetivo:** medir el gap entre el frontend (conoce 3 roles: `super_admin`, `admin_cliente`, `user`) y el backend migrado (6 roles + multi-tenant SERVICE_LEAD), y producir el backlog de cambios priorizado.

> Este es el plan de ANÁLISIS (qué mirar y en qué orden). NO es la implementación. Cada workstream termina en un hallazgo + gap + prioridad.

---

## Metodología

1. Analizar por **workstream** (W1-W8), de la base hacia arriba: primero el modelo de roles y auth (todo depende de eso), después navegación, pantallas y features.
2. Por cada workstream: **estado actual** (verificado) → **gap vs backend** → **preguntas abiertas** → **prioridad** (P0 bloqueante / P1 alto / P2 medio).
3. Regla de oro: **el frontend NO define permisos** — solo refleja lo que el backend ya enforcea. El backend es la fuente de verdad; el front oculta/muestra. Nunca al revés.
4. Entregable final: un backlog de tareas con archivo:línea y prioridad.

---

## W1 — Modelo de roles (fuente de verdad del front) · **P0**

**Analizar:** dónde el front define/compara roles, y si hay (o falta) un enum/constantes centralizadas.

**Estado actual (verificado):**
- NO hay enum de roles centralizado. Los strings `'super_admin'`, `'admin_cliente'`, `'user'` están **hardcodeados y esparcidos**: `sidebar.tsx:74-75`, `app-shell.tsx:25,29`, `login/page.tsx:43`, `usuarios/page.tsx:7-11`.
- El front **no conoce** `service_lead`, `supervisor`, `staff`.

**Gap:** mismo problema que tenía el backend (magic strings). Falta un `lib/roles.ts` con el enum `UserRole` (espejo del backend) + helpers (`isManager`, `canManageUsers`, labels).

**Preguntas:** ¿se usa el `value` del backend (`admin_cliente`) o se renombra a `MANAGER` en la UI? (recomendado: value del backend, label amigable).

**Prioridad: P0** — bloquea todo lo demás (igual que la Fase 0 del backend).

---

## W2 — Auth, JWT y routing · **P0**

**Analizar:** login redirect, `app-shell` (guardia de rutas), parseo del JWT, manejo de `client_id`/`activeTenantId`.

**Estado actual (verificado):**
- `login/page.tsx:43`: redirige por `super_admin` vs todo-lo-demás → `/client/dashboard`. No contempla los 6 roles.
- `app-shell.tsx:25`: **bloqueo duro** — `/admin/*` solo para `super_admin`; el resto es pateado.
- El JWT nuevo trae `activeTenantId` (Diseño B) → el front **no lo lee ni lo usa**.

**Gap:** el routing asume 2 mundos (admin / client). Con 6 roles + multi-tenant, hay que revisar: quién entra a qué, y el manejo del `activeTenantId`.

**Prioridad: P0**.

---

## W3 — Multi-tenant / Selector de agencia (SERVICE_LEAD) · **P0**

**Analizar:** ¿existe UI para `GET /auth/my-tenants` + `POST /auth/select-tenant`? ¿Cómo maneja el front el estado "sin agencia elegida"?

**Estado actual (verificado):** **NO EXISTE.** No hay selector de agencia, no se lee `activeTenantId`, el `client_id` sale directo del JWT.

**Gap (crítico):** un `SERVICE_LEAD` (o `SUPERADMIN` interviniendo) loguea y **todas sus queries devuelven vacío** hasta elegir agencia — pero no hay pantalla para elegirla. **Este es el bloqueante #1 para que la Fase 2 del backend sea usable.**

**A construir (a definir en análisis):** pantalla/modal de selección de agencia post-login para SERVICE_LEAD y SUPERADMIN; guardar el token re-emitido; badge de "agencia activa" + botón para cambiar.

**Prioridad: P0**.

---

## W4 — Sidebar / navegación por rol · **P1**

**Analizar:** `sidebar.tsx` — cómo arma los menús, el toggle "Administrador/Cliente", qué items ve cada rol.

**Estado actual (verificado):**
- `sidebar.tsx:65,74-78`: `isAdmin = role==='admin_cliente'`; toggle **"Administrador / Cliente"** (líneas 92-105) que arranca en "Cliente" → confuso.
- El item "Usuarios" solo está en `SUPER_ADMIN_ITEMS` (:59).
- No hay diferenciación para service_lead / supervisor / operator.

**Gap:** el toggle legacy sobra en el modelo nuevo; falta el menú correcto por cada uno de los 6 roles (qué módulos ve MANAGER vs OPERATOR vs SUPERVISOR, etc.).

**Preguntas:** ¿se elimina el toggle admin/cliente? ¿Qué ve exactamente cada rol en el sidebar? (mapear contra la matriz del doc).

**Prioridad: P1**.

---

## W5 — Gestión de usuarios/miembros · **P1**

**Analizar:** `app/admin/usuarios/page.tsx` — CRUD, endpoint, scoping, select de roles.

**Estado actual (verificado):**
- La pantalla existe y llama `GET/POST/PATCH /v1/app/admin/users` (correcto).
- Inaccesible para MANAGER por: bloqueo `/admin/*` (W2) + link ausente del sidebar (W4).
- El select de rol (`:261-262, :296-297`) solo ofrece `user` y `admin_cliente`. El `ROLE_STYLE` (`:7-11`) solo tiene 3 roles → los nuevos caen en badge gris genérico.

**Gap:** hay que exponer la pantalla al MANAGER/SERVICE_LEAD (scopeada a su tenant — el backend ya lo fuerza), expandir el select a los roles asignables (`operator/manager/supervisor`), y agregar estilos/labels de los 6 roles.

**Prioridad: P1** (es lo que el usuario está pidiendo hoy).

---

## W6 — Permisos por módulo/vista · **P1**

**Analizar:** cada vista de módulo (F1-F5, dashboard, mind, colaboradores, inventario, rendiciones) — qué botones/acciones muestra según el rol, y si coincide con lo que el backend permite.

**Estado actual:** el front no tiene gating granular por sub-rol dentro de "client" — todos los no-admin ven `CLIENT_SECTIONS` igual.

**Gap:** ocultar acciones que el backend va a rechazar igual (ej. OPERATOR no ve el botón "enviar reporte al cliente"; SUPERVISOR no ve botones de aprobar). Es UX, no seguridad (el backend ya bloquea), pero evita 403s confusos.

**Método:** cruzar cada vista contra la matriz de `docs/qa-roles-checklist.md`.

**Prioridad: P1**.

---

## W7 — Features nuevas del backend sin UI · **P2**

**Analizar:** features que agregamos en el backend y que quizás no tienen pantalla.

**Estado actual (a verificar en análisis):**
- **Provisioning SERVICE_LEAD** (`/v1/app/admin/service-leads` + asignar agencias) — ¿tiene UI? (probablemente no).
- **Destinatarios del reporte por proyecto** (`GET/PUT /projects/:id/report-recipients`) — ¿hay pantalla de config?
- **Feedback email → incidencia** (source EMAIL) — ¿las incidencias/novedades muestran el `source`?
- **Escalados de convocatoria** (tareas al operador en Mind) — ¿aparecen en el dashboard de Mind?

**Gap:** endpoints listos, pantallas por confirmar/construir.

**Prioridad: P2** (salvo provisioning SL, que es P1 si se quiere administrar por UI).

---

## W8 — Labels / badges / textos de roles · **P2**

**Analizar:** dónde se muestran nombres de roles al usuario (badges, dropdowns, perfiles).

**Estado actual:** `ROLE_STYLE` con 3 roles; textos "Administrador/Cliente" en el toggle.

**Gap:** labels amigables para los 6 roles (ej. `admin_cliente` → "Manager", `user` → "Operador", `service_lead` → "Líder de Servicio", `supervisor` → "Supervisor").

**Prioridad: P2**.

---

## Entregables del análisis

1. **`lib/roles.ts`** propuesto (enum + labels + helpers) — la fuente de verdad del front.
2. **Backlog priorizado** (P0→P2) con archivo:línea por tarea.
3. **Mapa sidebar objetivo**: qué ve cada uno de los 6 roles.
4. **Lista de pantallas faltantes** (selector de agencia, provisioning SL, destinatarios).
5. **Decisiones para José**: ¿se elimina el toggle admin/cliente? ¿labels de roles? ¿el operador ve F1 approve? (cruzar con el ⚠ del checklist QA).

## Riesgos

- **El front no define permisos** — si alguien "arregla" ocultando cosas sin que el backend las bloquee, es falsa seguridad. El backend manda.
- **Auth en localStorage + JWT en cliente**: el `activeTenantId` y el rol vienen del token; cuidado con estados stale tras `select-tenant` (hay que re-guardar el token nuevo).
- **Orden**: sin W1-W3 (roles + auth + selector) resueltos, W4-W8 se construyen sobre arena.

---

## Secuencia recomendada

```
W1 (roles) → W2 (auth/routing) → W3 (selector agencia)   ← P0, base
        ↓
W4 (sidebar) + W5 (usuarios)                              ← P1, lo usable
        ↓
W6 (permisos por vista) + W7 (features sin UI)            ← P1/P2
        ↓
W8 (labels)                                               ← P2, pulido
```

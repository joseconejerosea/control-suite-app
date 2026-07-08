# QA — Checklist de test por rol × módulo

**Entorno:** https://dev.controlsuitte.com/
**Objetivo:** validar los 6 roles (`UserRole`) + STAFF (Promoter) y los módulos de la plataforma tras la migración de roles.

> Leyenda: **DEBE** = tiene que poder hacerlo · **NO DEBE** = tiene que recibir 403 / no ver la opción.

---

## 0. Prerrequisitos (hacer ANTES de testear)

- [ ] **Migraciones corridas en dev**: `050` (service_lead_tenants), `051` (source en incidencias), `052` (email_message_id), `053` (users.client_id nullable), `054` (índice email platform), `055` (escalada_at).
  - Verificar: `SELECT * FROM migrations ORDER BY timestamp DESC LIMIT 8;` — deben aparecer las 6.
- [ ] **Todo buildeado/deployado** (backend). El front puede NO tener aún las pantallas nuevas → ver §Caveats.
- [ ] **Usuarios de prueba creados** (ver §1).

---

## 1. Cómo obtener un usuario de cada rol

| Rol | Cómo crearlo | Login |
|---|---|---|
| **SUPERADMIN** | Ya existe (José) | Dashboard |
| **MANAGER** | `admin_cliente` existente, o `POST /v1/app/admin/users` con `role='admin_cliente'` | Dashboard |
| **OPERATOR** | `user` existente, o `POST /v1/app/admin/users` con `role='user'` | Dashboard |
| **SERVICE_LEAD** | `POST /v1/app/admin/service-leads` (solo SUPERADMIN) → luego `POST /v1/app/admin/service-leads/:id/tenants` para asignar agencia | Dashboard + **select-tenant** |
| **SUPERVISOR** | `POST /v1/app/admin/users` con `role='supervisor'` | Dashboard (acceso muy limitado) |
| **STAFF** | Es un `Promoter` (no loguea) — se prueba por **WhatsApp** | WhatsApp |

---

## 2. Checks transversales (invariantes del sistema)

- [ ] **Aislamiento de tenant**: un MANAGER/OPERATOR del tenant A **NO DEBE** ver ni tocar datos del tenant B (probar cambiando `:clientId`/IDs en la URL → 403).
- [ ] **Gate humano F5**: el reporte al cliente pasa por `borrador → aprobado → enviado`. Intentar `enviar` sin `aprobar` **DEBE** dar 409.
- [ ] **Auditoría**: cada aprobación / rechazo / reprocess / envío queda en `audit_logs` con el `user_id` que lo hizo (`GET /v1/app/admin/audit-log` como SUPERADMIN).
- [ ] **Courtesy lock WhatsApp**: reenviar la misma convocatoria dentro de 5 min **NO DEBE** duplicar el mensaje.
- [ ] **Anti-escalación**: ni MANAGER ni SERVICE_LEAD pueden crear un SUPERADMIN u otro SERVICE_LEAD (el `@IsIn` de creación de usuarios solo permite `operator/manager/supervisor`).

---

## 3. SUPERADMIN (José)

- [ ] Login OK.
- [ ] **DEBE** ver módulos exclusivos: agentes IA, API, finanzas, prompts, `/admin`.
- [ ] **DEBE** poder `GET /auth/my-tenants` → lista **TODAS** las agencias.
- [ ] **DEBE** poder `POST /auth/select-tenant` con **cualquier** agencia → el token vuelve con `client_id` = esa agencia.
- [ ] Tras seleccionar agencia, **DEBE** operar en ella (F1-F5, dashboard, usuarios) y el `audit_log` **DEBE** registrar esas acciones con `tenant_id` = agencia elegida.
- [ ] **DEBE** crear Service Leads y asignarles agencias.

---

## 4. SERVICE_LEAD

- [ ] Login OK → **DEBE** aparecer el **selector de agencia** (o `GET /auth/my-tenants` devuelve solo las asignadas).
- [ ] `POST /auth/select-tenant` con una agencia **asignada** → OK. Con una **NO asignada** → **403**.
- [ ] Sin haber seleccionado agencia, cualquier otra ruta **DEBE** dar 403 ("Seleccioná una agencia primero").
- [ ] Con agencia activa: **DEBE** operar F1-F5, ver dashboard, gestionar usuarios de **esa** agencia.
- [ ] **NO DEBE** ver agentes IA / API / finanzas / prompts / `/admin`.
- [ ] **NO DEBE** operar en una agencia que no tiene asignada (probar IDs de otro tenant → 403).

---

## 5. MANAGER (`admin_cliente`)

- [ ] Login OK.
- [ ] **DEBE** ver el **dashboard de negocio** (facturación, rendiciones, inventario, KPIs).
- [ ] **DEBE** gestionar usuarios de SU tenant (`/v1/app/admin/users`) — crear operator/supervisor/manager.
- [ ] Al crear/editar usuario, **NO DEBE** poder setear otro `client_id` (queda forzado al suyo) ni tocar usuarios de otro tenant (403).
- [ ] **DEBE** aprobar F1-F5 y **enviar** el reporte F5 al cliente.
- [ ] **NO DEBE** ver agentes IA / API / finanzas / prompts.

---

## 6. OPERATOR (`user`)

- [ ] Login OK.
- [ ] **DEBE** ver `dashboard/overview` (su home operacional).
- [ ] **NO DEBE** ver los KPIs de negocio (`dashboard/campaigns|activations|events|documents` → 403).
- [ ] **NO DEBE** gestionar usuarios ni reglas (`/v1/app/admin/users` → 403).
- [ ] **F5**: **DEBE** generar/validar el reporte, pero **NO DEBE** aprobarlo ni enviarlo al cliente (403).
- [ ] **DEBE** operar F3 (inventario) y F2 (rendiciones incl. aprobar rendición).
- [ ] ⚠️ **VERIFICAR CONTRA NEGOCIO**: hoy el OPERATOR **NO** aprueba en algunos módulos (ej. `f1-review` approve, `project-inbox` approve están restringidos a MANAGER/SL/SUPERADMIN), pero el doc dice "Operador aprueba F1". **Confirmar con José** si el operador debe aprobar F1 → si sí, hay que sumar OPERATOR a esos `@Roles`.

---

## 7. SUPERVISOR (`supervisor`)

- [ ] Login OK.
- [ ] **NO DEBE** aprobar nada.
- [ ] **NO DEBE** ver dashboard de negocio ni gestionar usuarios.
- [ ] ⚠️ **ESTADO ACTUAL**: el SUPERVISOR **casi no tiene endpoints habilitados** (decisión de seguridad: ningún GET filtra por "lo propio" del usuario todavía). Testear = confirmar que recibe 403 en lo que no le corresponde. La lectura "de lo propio" queda pendiente (requiere filtrar por `persona_id` del caller).

---

## 8. STAFF (Promoter — sin login)

Se prueba por **WhatsApp**, no por dashboard.

- [ ] Recibe la convocatoria por WhatsApp.
- [ ] Responde **confirmando** → la convocatoria pasa a `confirmada` (clasificación IA).
- [ ] Responde **rechazando** → `rechazada`.
- [ ] **Cancela** una convocatoria ya confirmada → estado `cancelada` + se notifica al OPERATOR que se busca reemplazo.
- [ ] **No responde**: llegan hasta **2 recordatorios**; tras el 2º sin respuesta → se crea una **tarea al OPERATOR** (aparece en el dashboard de Mind, `estado='abierta'`).

---

## 9. Feedback del cliente por email (F5) — validación de infra

- [ ] Enviar un reporte F5 a un email de prueba → llega con `[#token]` en el asunto.
- [ ] Responder ese email.
- [ ] ⚠️ **CRÍTICO**: la respuesta **DEBE** llegar al buzón Gmail que el tenant tiene conectado (el `reply-to` = ese Gmail). Confirmar que el `reply-to` del correo apunta al Gmail del tenant, no a `noreply@`.
- [ ] El poller de Gmail lee la respuesta → crea una **incidencia** `source='EMAIL'` ligada a la activación (por el `[#token]`).

---

## 10. Caveats conocidos (leer antes de reportar bugs)

1. **Frontend**: toda la migración fue **backend**. Si no hay pantalla para el **selector de agencia** (SERVICE_LEAD/SUPERADMIN), el provisioning de SL o los destinatarios por proyecto, esos flujos se testean **por API** (Postman/curl), no por UI.
2. **`user.client_id` nullable**: los SERVICE_LEAD tienen `client_id=null` hasta elegir agencia — es correcto.
3. **OPERATOR y aprobaciones**: ver §6 ⚠ — posible divergencia doc vs implementación a validar.
4. **Migraciones**: si algo "no anda", lo primero es confirmar §0.

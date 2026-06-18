# Informe de Auditoría de Seguridad — control-suite (backend)

> Auditoría estática del backend NestJS (40 módulos) realizada por revisión de código en paralelo.
> Fecha: 2026-06. Alcance: `backend/src`. **No existen tests** en el proyecto.
> Estado: diagnóstico. Ningún archivo fue modificado.

---

## 0. Hallazgo de fondo (causa raíz)

**El aislamiento multi-tenant es por convención, no por arquitectura.**

El `ClientIsolationGuard` (`common/guards/client-isolation.guard.ts`) es casi un *no-op*: solo
valida cuando la URL trae un parámetro `:clientId`; para el resto de las rutas hace `return true`.
En consecuencia, el aislamiento entre clientes depende de que **cada servicio**, a mano, filtre
por el `client_id` del JWT (`request.user.client_id`). Casi todas las fugas de este informe
derivan de un servicio que:

- arma `ds.query` crudo y **olvida** `AND client_id = $1`, o
- lee `client_id` desde el **input del request** (body/query/params) en vez del JWT, o
- lee `user.clientId` (que queda `undefined`) en vez de `user.client_id`.

**Recomendación arquitectónica:** enforzar el `client_id` del JWT a nivel framework
(guard/interceptor que lo inyecte y un repositorio tenant-scoped obligatorio), y unificar
el shape del JWT (`client_id` vs `clientId`). Sin esto, los fixes puntuales se vuelven a romper.

---

## 🔴 CRÍTICOS

| # | Ubicación | Descripción | Fix |
|---|-----------|-------------|-----|
| C1 | `modules/mind/mind-chat.service.ts:277` | `executeReadOnlyQuery` ejecuta SQL generado por la IA: `ds.query(sql, [clientId])`. El `client_id=$1` solo se aplica si el modelo decide usarlo. CTEs/sub-selects/`UNION` permiten leer otras tablas/tenants; `pg_sleep`/`generate_series` permiten DoS. | No ejecutar SQL del modelo. Usar un set fijo de queries parametrizadas seleccionadas por clave, con `AND client_id = $1` forzado. |
| C2 | `modules/whatsapp/whatsapp.webhook.controller.ts:16,31` | Webhook `@Public()` **sin** `WebhookSignatureGuard` (el guard existe pero no está aplicado). Payloads de Meta falsificables; `resolveChannel:106` mapea `phone_number_id` elegido por el atacante → escritura en cualquier tenant. | Aplicar `@UseGuards(WebhookSignatureGuard)` validando `x-hub-signature-256` sobre el rawBody. |
| C3 | `modules/gmail/gmail.controller.ts:39` + `gmail.service.ts:45` | OAuth callback `@Public()` sin nonce `state`/CSRF; `state` se usa crudo como `clientId`. Además multi-tenancy roto: un único buzón global `GMAIL_EMAIL` para todos los clientes. | Generar `state` firmado/almacenado en `connect`, verificar en `callback`; tokens por `client_id`. |
| C4 | `modules/auth/auth.controller.ts:12` + `auth.service.ts:23` | `POST /auth/register` es `@Public()` y acepta `client_id` del atacante → alta de cuenta en **cualquier** tenant. | Quitar el self-register público o atarlo a invitación/super_admin. |
| C5 | `modules/onboarding/onboarding.controller.ts:42` | `@Roles('super_admin')` es **no-op**: `RolesGuard` no está en `@UseGuards` ni es global. Cualquier usuario autenticado provisiona canales y crea usuarios `admin_cliente` (`onboarding.service.ts:212`). | Agregar `RolesGuard` a `@UseGuards`. |
| C6 | `modules/metrics/metrics.controller.ts:6` | `/metrics` totalmente público (`@SkipThrottle`), expone métricas de proceso + `f1_*_total{client_id}` (volumen de negocio y enumeración de tenants). | Proteger con auth interna/bearer o quitar labels `client_id`. |
| C7 | `modules/bodegas/bodegas.service.ts:96` | `WHERE id=$1 AND client_id=${i}` interpola el contador `i` (entero) en vez del placeholder `$${i}`; el `clientId` nunca se bindea → filtro de tenant roto + error SQL (uuid vs int) en cada update. | Cambiar `client_id=${i}` por `client_id=$${i}`. |

---

## 🟠 ALTOS

| # | Ubicación | Descripción | Fix |
|---|-----------|-------------|-----|
| H1 | `modules/users/users.controller.ts:20,31` | Lee `user.clientId` (camelCase), `undefined` en los tokens emitidos (solo setean `client_id`). `findAll(undefined)` / `create({client_id: undefined})` → filtrado roto / filas con client_id nulo. | Usar `user.client_id` en todo el código. |
| H2 | `modules/eventos-crudos/eventos-crudos.controller.ts:28,36,48` y `modules/canal-entrada/canal-entrada.controller.ts:32,38,48,57,65` | Mismo bug `user.clientId` undefined → `TenantRepository` con `where:{client_id:undefined}` que TypeORM puede descartar → acceso cross-tenant. | Usar `user.client_id`. |
| H3 | `modules/support/support.service.ts:35,75` | `findOne` = `SELECT * FROM tickets WHERE id=$1` sin `client_id` → IDOR (un tenant lee tickets de otro). `kpis()` agrega tickets de todos los tenants y está en la ruta de cliente. | Agregar `AND client_id=$1` (del JWT) en `findOne`/`kpis`. |
| H4 | `modules/rendiciones/rendiciones.service.ts:258-295,404,85-99` | UPDATEs de rendiciones (plata) sin `AND client_id`. `cerrarRendicionesSemana` selecciona borradores de **todos** los clientes y auto-aprueba (`estado='aprobada'`); `monto_total` puede ser null. | Agregar `client_id` a cada UPDATE; scopear el cron por cliente; validar totales. |
| H5 | `modules/f5/f5.controller.ts:31,48,84,118,145` | Bodies tipados `any`; insertan `body.*` sin validar. `body.persona_id` permite impersonar checkins; `destinatarios`/`htmlReporte` sin validar → email/HTML injection. | Reemplazar `any` por DTOs validados; nunca aceptar `persona_id` del body. |
| H6 | `modules/f5/f5.controller.ts:144` | `cerrarActivacion` setea `status='completed'`/`estado_f5='cerrada'` desde cualquier estado, sin precondición ni idempotencia. | Validar estado actual antes de cerrar; rechazar si ya cerrada/cancelada. |
| H7 | `common/ai/prompt-shield.service.ts:10-18,69` | 7 regex en inglés; injection en español/encoded pasa. `checkWithAI` *fail-open*. Mind solo usa `checkLocal`; `mind-analista`, `cron`, `report.processor`, `invoices` (OCR) no aplican shield. | Tratar todo input/DB como dato no confiable; enforzar shield en cada entrypoint IA; fail-closed. |
| H8 | `modules/mind/mind.controller.ts:52,57` | `/chat` y `/chat/stream` corren loop agéntico de hasta 5 llamadas Opus sin throttle ni tope de costo por tenant. | `@Throttle` + tope diario de tokens/costo por tenant antes de cada `messages.create`. |
| H9 | `common/guards/auth.guard.ts:38` | `jwt.verify(token, secret)` sin pinning de algoritmo. | `jwt.verify(token, secret, { algorithms: ['HS256'] })`. |
| H10 | `modules/webhooks/webhooks.controller.ts:37` y `whatsapp.webhook.controller.ts:38` | Comparación de verify-token con `===` (no constant-time) y fallback al literal `'change_me'` si falta el env. | `timingSafeEqual`; fail-closed si falta el secret. |
| H11 | `modules/document-ingestion/document-ingestion.controller.ts:41-67` | Upload sin límite de tamaño (buffer completo en memoria) ni allow-list de MIME. `target_table` viene del multipart sin validar → elige tabla destino. | Enforzar `limits.fileSize`, validar MIME y `target_table` contra enum. |
| H12 | `modules/gmail/gmail.controller.ts:61` | `@Public() POST /poll` dispara poll + extracción IA + writes para todos los clientes (DoS/costo). `@Get('status')` filtra `GMAIL_EMAIL`. | Quitar `@Public()`; requerir auth/secret interno. |

---

## 🟡 MEDIOS

| # | Ubicación | Descripción | Fix |
|---|-----------|-------------|-----|
| M1 | `modules/movimientos-pop/movimientos-pop.service.ts:43-80,142-173` | `create`/`createAdjustment`: INSERT del movimiento y `actualizarInventario` en queries separadas, **sin transacción** → estado inconsistente ante fallo parcial. | Envolver en una transacción (`queryRunner`). |
| M2 | `modules/movimientos-pop/movimientos-pop.service.ts:175-185` | TOCTOU: `checkStock` y el decremento ocurren en pasos separados sin lock → dos `salida` concurrentes dejan stock negativo. | `UPDATE ... WHERE cantidad >= $qty` con check de filas, o `CHECK (cantidad >= 0)`. |
| M3 | `modules/movimientos-pop/stock-returns.service.ts:71,139-162,249` | INSERT de retorno con `.catch(()=>{})`; loop de confirmación sin transacción; `resolvePhone` busca persona en promoters/collaborators/users **sin** `client_id` → notifica cross-tenant. | Quitar swallow; transaccionar; scopear `resolvePhone` por `client_id`. |
| M4 | `modules/equivalencias/equivalencias.controller.ts:24,34` | `@Body() body: any` sin DTO ni validación; `confianza_minima` numérica sin rango. | DTOs con `class-validator` (`@Min(0) @Max(1)` en confianza). |
| M5 | `modules/eventos-crudos/eventos-crudos.service.ts:79-95` | Retry no atómico (check `status==='error'` y update en pasos separados) → doble procesamiento. | `UPDATE ... WHERE id=$1 AND status='error'` y actuar solo si `rowCount=1`. |
| M6 | `modules/sheets/sheets.service.ts:151` | Export con `valueInputOption: 'USER_ENTERED'` y datos de email/OCR → inyección de fórmulas (`=HYPERLINK`, `=IMPORTDATA`). | Usar `'RAW'` o prefijar celdas riesgosas con `'`. |
| M7 | `modules/email-reports/email-reports.service.ts:44-62` | Campos de DB concatenados crudos en HTML del email → HTML/link injection (descripciones de incidencias de campo). | Escapar todos los valores interpolados. |
| M8 | `modules/onboarding/onboarding.service.ts:134-158` | `verifyWhatsAppOtp` nunca valida el `code`; setea `is_active=true` siempre (verificación de fachada). | Verificar el OTP contra Meta o quitar la falsa garantía. |
| M9 | `modules/onboarding/onboarding.service.ts:105,147` | `phone_number_id` hardcodeado (`'1118041604727374'`) como fallback. | Requerir env; fallar si falta. |
| M10 | `modules/mind/mind-analista.service.ts:107` | Sub-queries invoices/rendiciones/movimientos filtran solo por `project_id`, sin `client_id`. | Agregar `AND client_id=$x`. |
| M11 | `common/guards/webhook-signature.guard.ts:35,67` | `META_APP_SECRET`/`WEBHOOK_SECRET` default `''` → HMAC con clave vacía. | Denegar si el secret está vacío. |
| M12 | `modules/f1-review/f1-review.service.ts:219,86,116` | `phone` desde `doc.payload?.from` (dato ingerido) sin validar; `reason` sin DTO. JOIN `p.id::text = payload->>'project_id'` rompe uso de índice. | Validar reason/phone; castear el json a uuid una vez. |

---

## 🟢 BAJOS

- `common/guards/auth.guard.ts:35` — `authHeader.split(' ')[1]` sin verificar esquema `Bearer`.
- Rounds de bcrypt inconsistentes: 12 (`auth.service`, `onboarding`) vs 10 (`users.service`, `admin-users.controller`). Estandarizar ≥12.
- `common/interceptors/audit.interceptor.ts:55` — sanitiza solo `password/token/secret/api_key`; persiste bodies completos (base64 de archivos, PII).
- `modules/skus/skus.service.ts:39` — unicidad de `codigo` por SELECT+INSERT sin índice único `(client_id, codigo)` → TOCTOU.
- `modules/gmail/gmail.controller.ts:30-55` — interpola `url`/`err.message`/`GMAIL_EMAIL` en HTML sin escapar (XSS reflejado).
- `modules/project-resolver/project-resolver.service.ts:299` — `sanitize()` regex débil; depende de validar `proyecto_id` contra lista (ok como defensa estructural).
- `whatsapp-media.service.ts:62` — `arrayBuffer()` sin tope de tamaño (DoS memoria).
- Numerosos `.catch(() => {})` / `.catch(() => [])` que tragan errores de escritura relevantes (whatsapp, webhooks, project-inbox, activations).
- `modules/activations/activation.dto.ts:43` vs `activation.entity.ts:28` — enum de status desalineado (`scheduled` vs default `pending`); sin máquina de estados. `activation_date` es `date` pero el DTO acepta datetime.

---

## Notas (verificado que NO son problema)

- El SQL está mayormente **parametrizado** (`$1/$2`): no hay inyección clásica, **excepto** el SQL de la IA (C1) y el bug lógico `${i}` de bodegas (C7).
- `ClassSerializerInterceptor` + `@Exclude()` en `user.entity.ts:26` evita fugas de password en respuestas de entidad.
- `clients.controller.ts` está correctamente protegido (`AuthGuard + RolesGuard + @Roles('super_admin')`).
- `CreateMovimientoDto` valida `@IsInt() @Min(1)` en `cantidad`.
- promoters/campaigns/locations usan `TenantRepository` correctamente.

---

## Plan de remediación sugerido (orden)

1. **Raíz**: enforzar `client_id` del JWT a nivel framework + unificar `client_id`/`clientId` (resuelve H1, H2, y previene reincidencias).
2. **Críticos**: C1–C7 (fugas y accesos sin auth).
3. **Altos**: H3–H12.
4. **Tests de regresión**: por cada fix de aislamiento, un test "tenant A no ve datos de B".
5. **Medios/Bajos**: transacciones de stock, validaciones de DTO, escaping, swallow de errores.

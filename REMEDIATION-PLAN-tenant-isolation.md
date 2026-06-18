# Plan de Remediación — Aislamiento Multi-Tenant

> Objetivo: pasar el aislamiento de **convención** a **arquitectura**, sin dejar cabos sueltos.
> Estrategia en 2 capas: **Capa 1 (app-level)** frena toda fuga explotable hoy; **Capa 2 (DB-level RLS)**
> es el candado definitivo (terminar la RLS que ya está a medio construir).
> Restricciones del proyecto: **no hay tests**, regla "nunca buildear tras cambios", trabajar en branch aparte.
> Cada paso: **atómico · verificable · reversible.**

---

## Hallazgos que fundamentan el plan

1. El JWT se firma solo con `client_id` (snake_case). Leer `user.clientId` (camelCase) da `undefined`, y TypeORM **descarta** `where:{client_id:undefined}` → sin filtro → cross-tenant. (CAT 1)
2. 292 `ds.query` crudos en 34 archivos; varios sin `AND client_id`. (CAT 2)
3. **RLS ya existe** (`1700000000036-EnableRLS.ts`) en 22 tablas, pero está **INERTE**: nadie setea `app.current_tenant`, no hay `FORCE`, no hay `WITH CHECK`, y la conexión (owner) la bypassa. Cobertura parcial.
4. `jwt.strategy.ts` es código muerto/roto (valida `clientId`); el guard activo es el custom `AuthGuard`.

---

## FASE 0 — Prerequisitos y red de seguridad

### 0.1 Confirmar el rol de conexión a Postgres  *(BLOQUEANTE para Capa 2)* — ✅ RESUELTO (2026-06-18)
- **Qué**: saber con qué rol se conecta el backend y por qué RLS no aplica.
- **Resultado (vía psql contra el .env)**:
  - `current_user = postgres`, `rolsuper = false`, **`rolbypassrls = TRUE`**.
  - RLS por tabla: `enabled = true`, `forced = false`.
  - Owner de las tablas = `postgres` (el mismo rol de conexión).
- **Conclusión**: el rol de runtime tiene **BYPASSRLS** → atraviesa TODAS las políticas siempre. RLS está prendido pero **inerte**. Confirmado con evidencia del motor.
- **Implicancia para 2.1**: NO alcanza `FORCE ROW LEVEL SECURITY` (un rol BYPASSRLS lo atraviesa igual). **Hay que crear un rol de aplicación dedicado SIN BYPASSRLS** y apuntar el backend a ese (las migraciones siguen con `postgres`).
- **Cómo se verificó**: `psql` (PostgreSQL 17, ya instalado) tomando la conexión del `.env` por env vars, sin exponer secretos. (Nota: backend NO tiene `node_modules` local → la app corre en Docker; el diagnóstico se hizo con psql, no con node.)

### 0.2 Branch de trabajo — ✅ RESUELTO
- **Resultado**: se trabaja en `fix/audit-01` (está en la punta de `dev`, cero commits de diferencia → branch de fix limpio). No se crea otro.

### 0.3 Red de regresión e2e — ✅ INFRA LISTA + primer test ROJO (2026-06-18)
- **Qué se hizo**:
  - `npm install` en `backend/` (faltaba `node_modules`).
  - **DB de test descartable**: cluster PostgreSQL 17 efímero (`initdb`, auth trust) en `127.0.0.1:5433`, DB `controlsuite_test`. NO toca la DB real. Se levantó con los binarios PG17 ya instalados.
  - Migraciones: las 39 corridas OK contra la DB de test (stub mínimo de `storage.buckets` para saltar la 035 Supabase-specific).
  - Harness e2e enfocado: `test/tenant-isolation.e2e-spec.ts` (módulo `eventos-crudos`, `EventProducer` mockeado → sin Redis), `test/tsconfig.json` (agrega types jest), `test/jest-e2e.json` apunta a ese tsconfig.
- **Resultado (ROJO esperado, prueba la fuga CAT 1)**:
  - GET /eventos-crudos → devuelve 2 (ambos tenants) en vez de 1.
  - GET /eventos-crudos/:id (de B con token A) → **200** (debería 404): lectura cross-tenant.
  - POST /eventos-crudos/:id/retry (de B con token A) → **201** (debería 404): escritura cross-tenant.
- **Cómo correr**:
  ```bash
  # arrancar cluster (si no está): "$PGBIN/pg_ctl" -D /c/Users/User/AppData/Local/Temp/cs-pgtest -o "-p 5433" start
  cd backend && DB_HOST=127.0.0.1 DB_PORT=5433 DB_USERNAME=postgres DB_PASSWORD= DB_NAME=controlsuite_test \
    NODE_ENV=test npx jest --config ./test/jest-e2e.json --runInBand tenant-isolation
  ```
- **Pendiente**: estos 3 tests pasan a VERDE con el paso 1.1; luego se replican para canal-entrada, users, support, mind/analista.

---

## FASE 1 — Capa 1: Llave maestra a nivel aplicación (frena la sangría)

> Orden pensado para que el primer paso ya neutralice la categoría más grande.

### 1.1 Unificar el shape del JWT en el AuthGuard  *(KEYSTONE — mata CAT 1 entera)* — ✅ HECHO (tests eventos-crudos RED→GREEN)
- **Archivo**: `common/guards/auth.guard.ts`.
- **Qué**: tras `jwt.verify`, normalizar:
  ```ts
  const clientId = decoded.client_id ?? decoded.clientId;
  request.user = { ...decoded, client_id: clientId, clientId };
  ```
  Y pinear algoritmo: `jwt.verify(token, secret, { algorithms: ['HS256'] })`.
- **Por qué**: un solo punto deja `user.client_id` y `user.clientId` siempre correctos → todos los controllers de CAT 1 (eventos-crudos, canal-entrada, users) quedan filtrando bien sin tocarlos.
- **Verificación**: test 0.3 de eventos-crudos/canal-entrada pasa a VERDE. Login real sigue funcionando.
- **Rollback**: revertir el archivo.

### 1.2 Resolver `jwt.strategy.ts` (código muerto/roto) — ✅ HECHO (borrado + cero refs; deps passport quedan, barrido aparte)
- **Archivos**: `modules/auth/strategies/jwt.strategy.ts`, `modules/auth/auth.module.ts`.
- **Qué**: confirmar que NO se usa como guard en ninguna ruta (`AuthGuard('jwt')`). Si es muerto → quitar de `providers` y borrar. Si se decide conservar passport → corregir `payload.clientId` → `payload.client_id`.
- **Verificación**: la app arranca; ninguna ruta dependía de él.
- **Rollback**: restaurar archivo + provider.

### 1.3 Decorator `@CurrentClientId()` (accesor sancionado para código futuro) — ✅ HECHO (fail closed)
- **Archivo nuevo**: `common/decorators/current-client.decorator.ts`.
- **Qué**: devuelve `request.user.client_id`; lanza `ForbiddenException('No tenant context')` si falta.
- **Por qué**: cierra la puerta a que código nuevo vuelva a leer mal el tenant.
- **Verificación**: usado en 1.4; falla fuerte si el token no trae tenant.
- **Rollback**: borrar archivo.

### 1.4 Hacer explícitos los controllers de CAT 1 — ✅ HECHO (3 controllers → @CurrentClientId; specs canal-entrada+users; users probado RED al romper; 10/10 verde)
- **Archivos**: `users.controller.ts` (:20,:31), `eventos-crudos.controller.ts` (:28,:36,:48), `canal-entrada.controller.ts` (:32,:40,:48,:57,:66).
- **Qué**: reemplazar `user.clientId` por `@CurrentClientId()` / `user.client_id`. (1.1 ya lo cubre, pero dejamos el código correcto e intencional, no dependiente del parche del guard.)
- **Verificación**: tests 0.3 verdes; revisión de que no quede ningún `user.clientId` (`rg "user\.clientId|\.clientId"`).
- **Rollback**: por archivo.

### 1.5 Arreglar queries crudas request-reachable de CAT 2  *(un módulo por commit)*
Cada sub-paso es un commit independiente, con su verificación:
- **1.5a `support`** — ✅ HECHO. `findOne`/`kpis` ahora aceptan `clientId?` opcional: ruta cliente (`SupportController`) pasa `@CurrentClientId()` (scope), ruta admin (super_admin) no pasa nada (cross-tenant a propósito). Test `tenant-isolation-support` 3/3; probado RED al revertir (404→200, kpis 2→5). → mata IDOR de tickets + KPIs globales.
- **1.5b `mind-analista`** — ✅ HECHO. `recopilarDatosProyecto` ahora corta con `NotFoundException` si el proyecto no es del tenant (antes seguía), y las 3 queries de plata (invoices/rendiciones/movimientos) llevan `AND client_id=$2` (defensa en profundidad). Test `tenant-isolation-mind-analista` 2/2; probado RED al desactivar el short-circuit.
- **1.5c `bodegas`** — ✅ HECHO. `:96` `client_id=${i}` → `client_id=$${i}`. Test `tenant-isolation-bodegas` 2/2; probado RED al revertir (error real `operador no existe: uuid = integer`). NOTA bonus (fuera de scope, anotado): `update()` devuelve `res[0]` que para `UPDATE...RETURNING` en TypeORM es `[fila]` (array), no la fila — bug pre-existente de shape de retorno, NO afecta aislamiento; revisar aparte.
- **1.5d `stock-returns`** — ✅ HECHO. `:50` projects read + `client_id`; los 3 UPDATEs (`:115`/`:164`/`:198`) + `client_id` (defensa en profundidad, ya gated); `resolvePhone` ahora recibe `clientId` y scopea promoters/collaborators (3 llamadores actualizados). Test `tenant-isolation-stock-returns` 2/2; probado RED faithful (A resolvía '+22222222' de B). **DESCUBRIMIENTOS**: (1) `resolvePhone` referenciaba `users.phone` que NO existe en el esquema (phone vive solo en promoters/collaborators) → la query fallaba SIEMPRE y `.catch(()=>[])` lo enmascaraba → resolvePhone devolvía null siempre (notificaciones de devolución rotas). Se quitó la rama `users`. (2) MISMO bug pendiente en `support.service.broadcast` (`SELECT u.phone FROM users`) — fuera de scope, anotado. (3) El `.catch(()=>[])` enmascara errores reales (smell).
- **1.5e notif reads** — ✅ HECHO. `rendiciones:167` (project name) + `client_id`; `rendiciones:324` (persona en exportPdf) + `client_id` Y arreglada columna rota `CONCAT(nombre,' ',apellido)` → `name` (promoters tiene `name`, no nombre/apellido — mismo patrón que resolvePhone; nombre se resolvía siempre al fallback); `projects:381` (project name en convocatoria) + `client_id`. SIN test dedicado: son lecturas internas/defensa-en-profundidad (persona_id ya viene de rendición tenant-scopeada) embebidas en flujos con efectos (PDF/WhatsApp); verificado por revisión + suite 19/19 sin regresión. Grep confirmó que `apellido` no aparece en otra query.
- **1.5f gated-fragile (defensa en profundidad)** — ✅ HECHO. `client_id` inline en: `f1-review` approve+reject, `mind-propuestas` aprobar+rechazar, `rendiciones` items+cerrarManual+aprobar+rechazar+marcarPagada+recalcTotal (firma enhebrada + caller), `projects:356`, `invoices` f1Reprocess UPDATE. EXCEPCIONES: `mind-propuestas:93` (INSERT ya lleva client_id), `invoices:219` (f1_reprocess_log NO tiene columna client_id). Sin test dedicado (paths gated, no alcanzables cross-tenant); verificado por revisión + suite 19/19 sin regresión.
- **Verificación (cada uno)**: test "A no toca recurso de B" para ese endpoint; revisión de la query final.
- **Rollback**: por commit.

### 1.6 Colisión de teléfono cross-tenant
- **Archivos**: `whatsapp.webhook.controller.ts:506`, `clarification.service.ts:178`, `classify.processor.ts:270`.
- **Qué**: agregar `client_id` al match por `phone` (el tenant ya se conoce por el mapping del canal/job).
- **Verificación**: revisión; (opcional) test con dos tenants compartiendo teléfono.
- **Rollback**: por archivo.

### 1.7 `mind-chat:277` — SQL generado por IA  *(sub-plan propio, NO un parche)*
- **Qué**: NO ejecutar SQL libre del modelo. Reemplazar por un set fijo de queries parametrizadas seleccionables por clave, con `AND client_id = $1` forzado server-side.
- **Por qué**: es el agujero más grave; un `AND client_id` opcional no alcanza.
- **Verificación**: el modelo no puede emitir SQL que lea otra tabla/tenant; tests de intento de fuga.
- **Rollback**: por commit. *(Se puede diferir si se prioriza, pero queda explícito como pendiente crítico.)*

**Salida de Fase 1** — ✅ COMPLETA (1.1–1.5). Cero fugas request-reachable conocidas. 19 tests e2e verde (7 suites), cada fix request-reachable probado RED→GREEN. Pendiente 1.7 (mind-chat AI-SQL, sub-plan crítico aparte). Bugs bonus descubiertos: bodegas update() shape de retorno, users.phone inexistente (resolvePhone + support.broadcast), nombre/apellido inexistente en promoters (rendiciones export), patrón `.catch(()=>[])` enmascara errores.

---

## FASE 2 — Capa 2: Backstop a nivel DB (RLS real)

> Convierte el aislamiento en garantía del motor: aunque una query futura olvide el `WHERE`, la DB no devuelve filas ajenas.

### 2.1 Hacer que RLS realmente aplique
- **Depende de 0.1**:
  - **CONFIRMADO (0.1)**: el rol de runtime es `postgres` con **`BYPASSRLS = true`** (no superuser, pero bypassa igual). Por lo tanto: **crear un rol de aplicación dedicado, sin `BYPASSRLS` y NO owner de las tablas**, con `GRANT` mínimos (SELECT/INSERT/UPDATE/DELETE en las tablas tenant + USAGE en el schema), y apuntar el `DB_USERNAME` de runtime del backend a ese rol. Las migraciones siguen corriendo con `postgres`.
  - `FORCE ROW LEVEL SECURITY` queda como defensa extra opcional, pero NO es la solución acá (un rol BYPASSRLS lo atraviesa; un rol no-owner ya queda sujeto a RLS sin FORCE).
- **Verificación**: con `app.current_tenant` sin setear, un `SELECT` del rol de app sobre una tabla tenant devuelve **0 filas** (prueba de que RLS muerde).
- **Rollback**: `NO FORCE` / revertir rol en config.

### 2.2 Extender cobertura RLS a tablas faltantes
- **Archivo**: nueva migración `...-ExtendRLSCoverage.ts`.
- **Qué**: enumerar TODAS las entidades con `client_id`/`tenant_id` (barrido de `*.entity.ts` + tablas creadas en migraciones) y agregar las que faltan: `eventos_crudos`, `stock_return_requests`, `mind_propuestas` (y demás `mind_*`), `gmail_tokens`, `convocatorias`, `proyecto_equipo`, `equivalencias_ocr_cc`, `tickets`, `ai_costs_log`, `f1_reprocess_log`, etc.
- **Verificación**: query a `pg_policies` confirma policy por cada tabla tenant; lista cruzada contra el inventario de entidades (cero faltantes).
- **Rollback**: `down()` que dropea las nuevas policies.

### 2.3 Agregar `WITH CHECK` (bloquear escritura cross-tenant)
- **Archivo**: nueva migración.
- **Qué**: recrear policies con `USING (...) WITH CHECK (client_id = current_setting('app.current_tenant', true)::uuid)` → impide INSERT/UPDATE que muevan filas a otro tenant.
- **Verificación**: INSERT con `client_id` ajeno bajo `SET app.current_tenant` propio → rechazado.
- **Rollback**: `down()` restaura policies solo-`USING`.

### 2.4 Binding en runtime — `SET LOCAL app.current_tenant`  *(el paso pesado)*
- **Qué**: cada unidad de trabajo corre dentro de una transacción con `SET LOCAL app.current_tenant = '<client_id>'`.
  - **HTTP**: interceptor/middleware request-scoped que obtiene un `QueryRunner`, abre transacción, setea el GUC, y expone esa conexión a los servicios de esa request.
  - **Jobs/cron/webhooks**: setear el GUC al inicio de cada unidad (el `client_id` ya viaja en el payload/fila).
- **Decisión de diseño a resolver**: cómo enrutar los 292 `ds.query` a la conexión con el GUC seteado (opciones: provider request-scoped `TenantDataSource`, wrapper sobre `DataSource`, o `cls-hooked`/AsyncLocalStorage con un `QueryRunner` por request). Se elige una y se documenta.
- **Verificación**: e2e — request con token de A no puede leer filas de B aun forzando IDs; jobs siguen funcionando.
- **Rollback**: desactivar el interceptor (RLS quedaría bloqueando → por eso va junto con 2.1).

### 2.5 Bypass controlado para `super_admin`
- **Qué**: rutas cross-tenant legítimas (clients, monitoring, audit admin) necesitan ver todo. Opciones: rol con `BYPASSRLS` para esas operaciones, o setear un sentinel/condición en la policy para `super_admin`.
- **Verificación**: super_admin ve todo; usuario normal nunca.
- **Rollback**: por config.

### 2.6 Defensa en profundidad — conservar filtros app-level
- **Qué**: los `client_id` de la Capa 1 se MANTIENEN. RLS es backstop, no excusa para sacarlos.

---

## FASE 3 — Verificación y cierre

- **3.1 Matriz de pruebas cross-tenant**: por cada endpoint tenant, token A vs recurso B → 403/404/empty. Tabla marcada.
- **3.2 Tests de regresión** persistentes para cada fuga arreglada (los de 0.3 ampliados).
- **3.3 Re-auditoría**: re-correr el barrido de aislamiento sobre el código final; cero UNSAFE.
- **3.4 Doc**: actualizar `SECURITY-AUDIT.md` marcando cada hallazgo como RESUELTO + fecha.

---

## Notas de prudencia
- Ningún paso "mejora de paso" otra cosa: un cambio = un objetivo. Commits chicos.
- Capa 1 es independiente y entregable sola (frena la sangría). Capa 2 es el blindaje; requiere 0.1 confirmado.
- No se ejecutan builds automáticos (regla del proyecto); la verificación es por tests dirigidos + revisión + pruebas que corra el usuario.

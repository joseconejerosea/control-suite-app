# Pendientes DEV — Variables a modificar (mañana)

> Contexto: estas variables se setean en `backend/.env` del server
> (`~/entornos/control-suite-dev`) y se aplican con `docker compose up -d --force-recreate backend`.
> ⚠️ El deploy regenera el `.env` desde los GitHub Secrets → para que NO se borren,
> cargá los mismos valores en **GitHub → Settings → Secrets and variables → Actions**.

---

## 1. 🔴 La variable que FALTABA — `REDIS_TLS` (crítica)

**Problema:** BullMQ (las colas: OCR, classify, etc.) se conectaba a Upstash **sin TLS**
→ `ECONNRESET` sin parar → los workers no consumían → los jobs quedaban en `queued`
para siempre (ej: el OCR del comprobante nunca se procesaba).

**Causa:** en `queue.module.ts` el TLS solo se activa con `REDIS_TLS === 'true'`, y la
variable no estaba en el `.env`. Upstash (`rediss://`) EXIGE TLS.

```
REDIS_TLS=true
```

---

## 2. 🟢 Variables de WhatsApp / Meta

| Variable | Valor | De dónde sale |
|----------|-------|---------------|
| `WHATSAPP_PHONE_NUMBER_ID` | `1051291648061070` | Meta → WhatsApp → API Setup → "Phone number ID" |
| `META_WABA_ID` | `1341456194674619` | Meta → WhatsApp → API Setup → "WhatsApp Business Account ID" |
| `META_APP_SECRET` | `e52f9eaf17778c4b7eee35856e0cc625` | Meta → App Settings → Basic → "App secret" |
| `WHATSAPP_VERIFY_TOKEN` | `change-me` | Lo inventás vos (va igual en la config del Webhook en Meta) |
| `WHATSAPP_ACCESS_TOKEN` | ⚠️ **REGENERAR** | Meta → WhatsApp → API Setup → "Temporary access token" |

### ⚠️ Sobre el `WHATSAPP_ACCESS_TOKEN`
- El temporal **dura 24h** → el de hoy ya va a estar vencido mañana, hay que sacar uno nuevo.
- **Fix definitivo:** token PERMANENTE del **System User**
  (Business Settings → Usuarios del sistema → Generar token con permisos
  `whatsapp_business_messaging` + `whatsapp_business_management`). Ese no se vence.

---

## 3. 🟡 `ANTHROPIC_API_KEY` (para el OCR de comprobantes)

Estaba **vacía** en el `.env`. Sin ella, el OCR (flujo F1) tira `failed_ocr`.
Necesaria para que el comprobante se procese con Claude vision.

```
ANTHROPIC_API_KEY=<tu-api-key-de-anthropic>
```

---

## 4. Comando para aplicar TODO en el server

```bash
cd ~/entornos/control-suite-dev

set_env() {
  local key="$1" val="$2" file="backend/.env"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

set_env REDIS_TLS 'true'
set_env WHATSAPP_PHONE_NUMBER_ID '1051291648061070'
set_env META_WABA_ID '1341456194674619'
set_env META_APP_SECRET 'e52f9eaf17778c4b7eee35856e0cc625'
set_env WHATSAPP_VERIFY_TOKEN 'change-me'
set_env ANTHROPIC_API_KEY 'PEGAR_API_KEY'
set_env WHATSAPP_ACCESS_TOKEN 'PEGAR_TOKEN_NUEVO'   # regenerar (24h) o usar el permanente

docker compose up -d --force-recreate backend
docker compose logs -f --tail 20 backend   # el ECONNRESET debe PARAR
```

> Si el `WHATSAPP_ACCESS_TOKEN` se parte en líneas al pegar (token largo) y el `sed`
> tira `unterminated s command`, usá el método del `/tmp`:
> ```bash
> cat > /tmp/wa_token   # pegás token → Enter → Ctrl+D
> TOKEN=$(tr -d '[:space:]' < /tmp/wa_token)
> grep -v '^WHATSAPP_ACCESS_TOKEN=' backend/.env > backend/.env.tmp && echo "WHATSAPP_ACCESS_TOKEN=${TOKEN}" >> backend/.env.tmp && mv backend/.env.tmp backend/.env
> rm /tmp/wa_token
> ```

---

## 5. Permanente — GitHub Secrets (para que el deploy no los borre)

Cargar en **GitHub → Secrets and variables → Actions**:
- `META_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_VERIFY_TOKEN`, `META_WABA_ID`, `ANTHROPIC_API_KEY`

Y agregar `REDIS_TLS=true` al bloque del `.env` en `.github/workflows/deploy-backend.yml`
(o como Variable/Secret), sino el próximo deploy revive el ECONNRESET.

---

## 6. Código pendiente — DEPLOYAR

- [x] ~~Fix OCR storage_path~~ → DEPLOYADO y funcionando (OCR leyó el comprobante, 1069 chars).
- [ ] **Fix persist source** (en working tree, falta deployar):
      `backend/src/modules/queue/processors/persist.processor.ts` — `invoices.source`
      es NOT NULL pero el persist leía `eventos_crudos.canal` (null en WhatsApp, que llena
      `source`). Fix: `const channel = canal ?? source ?? 'unknown'` y usarlo en el INSERT,
      `resolvePersonaId` y el export a sheets. Type-check OK. **Era el `failed_classification:
      null value in column "source"`.** Sin esto, el comprobante no se guarda como invoice.
- [ ] **Cost logging OCR F1** (en working tree, falta deployar):
      `ocr.processor.ts` ahora captura el `usage` de Claude e inserta en `ai_costs_log`
      (antes se descartaba → la Auditoría AI no mostraba el gasto del flujo F1).
      Pendiente: hacer lo mismo en `classify.processor.ts` (también usa IA y no loguea costo).
- [ ] **Bug monitoring**: `monitoring.controller.ts:24` usa `SUM(costo_usd)` pero la
      columna real es `cost_usd` → esa query falla/devuelve 0 siempre. Corregir a `cost_usd`.
- [x] ~~**Bug SheetsService (CRÍTICO — revertía la factura)**~~: `getSheetId` usaba
      `clients.config_f1` y `canal_entrada.activo` (ambas inexistentes). Al fallar DENTRO
      de la transacción del persist, la abortaban → COMMIT hacía rollback → **la factura
      se borraba**. FIX (working tree, falta deployar): `config_f1`→`config`, `activo`→`is_active`.
      Type-check OK.
- [ ] **Mejora arquitectónica**: mover los side-effects del persist (sheets export, notify,
      rendiciones) FUERA de la transacción del invoice. Hoy, cualquier query que falle ahí
      adentro tira abajo la factura entera. El invoice + UPDATE evento deberían ser la tx;
      el resto, post-commit.
- [ ] **Mind → WhatsApp (BLOQUEADO — falta decisión de producto)**: la acción
      `enviar_recordatorio` de Mind (`mind-propuestas.service.ts:126`) nunca envía —
      devuelve `status: 'pendiente_whatsapp'`. El action se crea con `target: 'admins'`
      (`queue/processors/mind-proactive.processor.ts:110`), pero un "admin" es
      `users.role='admin_cliente'` y **`users` no tiene columna `phone`** (ver
      `user.entity.ts`; el UNION con users ya falló en stock-returns). Único teléfono real:
      `collaborators` (coordinator/brand_manager) o `promoters`. **Definir destinatario**
      (coordinadores / personas que deben rendir / ambos) antes de cablear `wa.sendText`.
      Implementación: importar `WhatsAppModule` en `MindModule` + inyectar `WhatsAppService`.
      Nota: F3 (stock returns) ya está cableado a WhatsApp y NO era huérfano.
- [ ] Sacar la línea de debug `[WhatsApp] RAW payload:` en
      `whatsapp.webhook.controller.ts` (loguea PII).
- [ ] Rotar credenciales expuestas en el chat (DB pass, Supabase service role, tokens).

## ✅ FLUJO F1 VERIFICADO E2E (2026-06-24)
Comprobante (boleta combustible) por WhatsApp → OCR Claude (1036 chars) → clasificación
(boleta/gastos/$70.995/0.95 conf) → **invoice creada** (`source=whatsapp`). Funciona.
Bloqueos resueltos: SanitizeInputPipe arrays, REDIS_TLS, OCR storage_path, persist source.

> Nota: el cliente "Control Suite Demo" NO tiene proyectos activos → el doc queda con
> `project_id=null` y el ProjectResolver no puede asignar proyecto. Para el flujo F1
> completo conviene crear un proyecto activo para el cliente. No bloquea el OCR/invoice.

> Orden mañana: (1) deployar el fix del OCR + sacar debug log, (2) aplicar las
> variables (sección 4, con `REDIS_TLS` y `ANTHROPIC_API_KEY`), (3) mandar un
> comprobante y verificar `queued → processing → ocr_done`.

---

## Cómo verificar que el OCR del comprobante funciona

```bash
PGPASSWORD='...' psql "host=aws-1-us-west-2.pooler.supabase.com port=5432 dbname=postgres user=postgres.zvfncjfydgvysnlybslw sslmode=require" \
  -c "SELECT status, processing_status_new, ocr_engine, error_message, created_at FROM eventos_crudos WHERE source='whatsapp' ORDER BY created_at DESC LIMIT 5;"
```
Debe progresar: `queued` → `processing` → `ocr_done`.

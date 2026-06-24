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

- [ ] **Fix OCR storage_path** (en working tree, falta mergear/deployar):
      `backend/src/modules/queue/processors/ocr.processor.ts` — ahora baja el archivo
      del Supabase Storage con `storage_path` cuando no hay `file_base64` (era el
      `"No file data in payload"`). Type-check OK. **Sin esto, el comprobante sigue en `failed_ocr`.**
- [ ] Sacar la línea de debug `[WhatsApp] RAW payload:` en
      `whatsapp.webhook.controller.ts` (loguea PII).
- [ ] Rotar credenciales expuestas en el chat (DB pass, Supabase service role, tokens).

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

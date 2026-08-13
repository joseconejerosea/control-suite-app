# T3 — Flujo de conversación WhatsApp v2.0 (design doc)

> Estado: **DISEÑO** (pre-implementación). Depende de **T2** (gate + reconocimiento del número) — **RESUELTO**.
> Baseline verificado contra código en [[CONSULTAS-CLIENTE-WHATSAPP.md]] y en la exploración del flujo actual (2026-08-13).

## 1. Problema

Hoy, cuando llega una **foto**, el bot no pregunta qué es: la encola al `OcrProcessor`, que con **visión IA (Claude Vision)** adivina `DOCUMENT / MATERIAL / EVIDENCE` y rutea. Si el triage no identifica bien → **deriva a operador**. Además cada foto paga costo de IA solo para adivinar el tipo.

- `handleImage` (`whatsapp.webhook.controller.ts:484`) → `ocrQueue.add('ocr', …)` (`:549`), sin preguntar el tipo.
- Existe un menú de acciones (`action-menu.service.ts`) pero **solo para texto** (`handleText:836`) y **desconectado del ruteo de la foto**: aunque el remitente elija "material", la foto siguiente vuelve a pasar por el triage de visión.

## 2. Objetivo (v2.0)

Recorrido claro y determinístico: **reconocer → preguntar solo el tipo (menú) → rutear por la elección**, sin que la visión IA decida el tipo. La visión queda **solo para leer** una factura ya confirmada (OCR de F1). Baja el costo de IA y elimina la derivación a operador por "no sé qué es esto".

## 3. Decisiones tomadas

| Decisión | Elegido |
|---|---|
| **Orden** | **Tipo primero**, activación solo si el tipo la necesita (una factura no se bloquea por falta de activación). |
| **Sin activación activa** (material/evidencia) | **Mensaje claro al remitente** ("No veo una activación activa hoy para asociar esto. Avisale a tu coordinador."). No deriva a operador a ciegas. Cero IA. |
| **Ruteo del tipo** | **Menú determinístico**. La visión IA nunca decide el tipo. |
| **Visión IA** | Solo para **leer** una factura confirmada (F1). |
| **Estado** | Backend (Redis, `WhatsAppSessionService`). |
| **Ubicación (GPS)** | Fuera del menú de "¿qué es esta foto?": sigue siendo su propio tipo de mensaje (pin de WhatsApp → `handleLocation`, F5 check-in). |

## 4. Máquina de estados (sesión Redis por remitente)

Estados relevantes de T3 (se suman a los de T2 — selección de tenant / affiliation code — y a los de cada intake):

```
idle
  ↓ (llega media, sin flujo activo, sin pendingType)
awaiting_type            pendingMedia = {storagePath, mimeType, caption}
  ↓ (texto = N° de menú válido)
  ├─ factura   → F1 (OCR-read)            → idle
  ├─ material  → in_flow:F3 (materialIntake) → … → idle
  └─ evidencia → in_flow:F5 (evidenceIntake) → … → idle

idle
  ↓ (llega TEXTO libre, sin flujo)
awaiting_action          (menú mostrado; SIN media buffereada)
  ↓ (texto = N° de menú válido)
awaiting_media           pendingType = <kind>   ("Dale, mandame la foto…")
  ↓ (llega media)
  → router(pendingType, media)   (igual que arriba)
```

Campos nuevos/uso en `WhatsAppSession`:
- `pendingType?: 'factura' | 'material' | 'evidencia'` — tipo elegido esperando media.
- `pendingMedia?: { storagePath, mimeType, caption }` — media buffereada esperando tipo. (hoy ya se buferea `base64/mimeType` para resumir intakes; se reutiliza el mecanismo).
- `state`: `awaiting_type` (media→tipo), `awaiting_media` (tipo→media), más los existentes.

## 5. Flujo detallado

### 5.1 Media entrante (foto/documento), sin flujo activo
1. Gate + reconocimiento (T2) ya resolvió cliente + persona. Si no reconocido → rechazo suave (T2), STOP.
2. ¿Devolución de stock pendiente? → sigue como hoy (F3_RETURN). *(no cambia)*
3. **Bufferea** la media en la sesión, `state = awaiting_type`.
4. Envía el menú:
   ```
   ¿Qué querés registrar? Respondé con el número:
   1) Factura o boleta
   2) Material POP
   3) Evidencia de actividad (foto)
   ```

### 5.2 Texto = número de menú
- `awaiting_type` (hay `pendingMedia`) → fija el tipo y **rutea la media buffereada ahora**.
- `awaiting_action` / `awaiting_media` (no hay media aún) → fija `pendingType`, `state = awaiting_media`, responde la guía ("Dale 👍 Mandame la foto…"). La próxima media entra por 5.1-paso-3 pero con `pendingType` ya seteado → rutea directo.
- Número inválido → re-muestra el menú (máx. reintentos como el `MAX_TENANT_SELECTION_ATTEMPTS` actual; al agotar, cierra el intento sin derivar).

### 5.3 Router `(tipo, media)`
- **factura** → `persistEvent(flow='F1')` + `ocrQueue` **solo para OCR-read** (leer la factura). El triage documento/material/evidencia **ya no se usa para rutear**.
- **material** → `materialIntake.start({ media, clientId, phone })`.
- **evidencia** → `evidenceIntake.start({ media, clientId, phone })`.

### 5.4 Activación (dentro de material/evidencia)
- Query de activas del cliente (`status IN ('scheduled','in_progress') AND estado_f5 ≠ 'cerrada'`).
  - **0** → **mensaje claro al remitente** (NO operador). Limpia la sesión.
  - **1** → auto-selecciona.
  - **≥2** → picker "lugar · fecha".
- Con activación → ejecuta el intake (registra movimiento POP / checkin) con `{tipo, activación, media}` conocidos.

## 6. Superficie de código (cambios)

| Pieza | Cambio |
|---|---|
| `handleImage` / `handleDocument` (`whatsapp.webhook.controller.ts`) | Si NO hay `pendingType`: bufferea media + `awaiting_type` + menú. Si HAY `pendingType`: rutea directo. **Deja de encolar al OCR-triage por defecto.** |
| `handleText` (menú, `:797`/`:836`) | Conecta la elección: fija `pendingType`, procesa `pendingMedia` si existe, o pide la foto. |
| **Router** (nuevo helper en el controller o un `WhatsAppIntakeRouter`) | `route(kind, media, ctx)` → F1 / materialIntake / evidenceIntake. |
| `OcrProcessor` (`queue/processors/ocr.processor.ts`) | **Elimina el triage de ruteo** (document/material/evidence). Queda **solo el OCR de F1** (leer factura). Ya no invoca material/evidence intake. |
| `material-intake.service` / `evidence-intake.service` | `start()` recibe `{media, activación}` desde el router (no desde el triage). `escalateNoActivation` cambia de **derivar-a-operador** a **mensaje claro al remitente**. |
| `action-menu.service` | El menú de media usa 3 opciones (factura/material/evidencia). "Ubicación" queda en el menú de texto/acciones pero no en el de "¿qué es esta foto?". |
| `WhatsAppSessionService` | `+pendingType`, reutiliza `pendingMedia`; estados `awaiting_type` / `awaiting_media`. |

## 7. Casos borde

- **Media mientras `awaiting_action`/`awaiting_media`**: si ya eligió tipo → rutea; si no → trata la media como 5.1 (pregunta el tipo).
- **Texto libre mientras `awaiting_type`** (no es número): re-pregunta el tipo (no descarta la media buffereada).
- **Reintentos**: menú inválido N veces → cierra el intento con mensaje no-técnico (sin derivar).
- **TTL de sesión**: `pendingMedia`/`pendingType` expiran con el TTL de la sesión Redis (si vuelve tarde, se re-pregunta).
- **Caption como atajo** (OPCIONAL, fuera de v1): si el caption dice "factura"/"material"/"evidencia", saltar el menú. Default v1: **siempre menú**.
- **Convocatoria abierta (F4)**: mantiene prioridad como hoy (un texto libre con convocatoria abierta va al clasificador F4 antes del menú).

## 8. Fuera de scope

- Audio/video (siguen solo-almacenamiento).
- Transcripción.
- Atajo por caption (futuro).
- Cambios en F4 (convocatorias) y en el check-in por GPS (`handleLocation`), salvo el wording del cierre.

## 9. Dependencias y riesgos

- **T2 (gate + reconocimiento): RESUELTO.** T3 asume que al llegar acá el cliente+persona ya están resueltos y los no-registrados fueron rechazados.
- **Prerequisito de datos**: material/evidencia necesitan una activación activa. La cadena proyecto→campaña→activación ya se puede crear desde la UI (ver [[projects/activation-chain-ui]]). Sin activación activa → mensaje claro (§3).
- **Riesgo de regresión**: el `OcrProcessor` pierde el ruteo; hay que verificar que ningún otro flujo (F1 persist, F3_RETURN, clarification) dependa del triage para algo distinto del OCR de factura.
```

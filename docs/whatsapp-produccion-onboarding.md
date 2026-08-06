# WhatsApp Cloud API — Producción y alta de clientes

Guía del modelo de WhatsApp en Control Suite BTL: qué se configura una sola vez
(producción) y qué se hace por cada cliente nuevo. El objetivo es dejar claro
dónde está el límite entre "configuración global" y "configuración por tenant",
porque es el punto donde más se confunde el setup.

## Las tres cosas que se llaman parecido

| Nombre | Qué es | Lo usamos |
|---|---|---|
| WhatsApp | App personal del celular | No |
| WhatsApp Business | App verde del store (pymes) | No |
| WhatsApp Business Platform (Cloud API) | Una **API**, no una app | **Sí** |

Clave: **WhatsApp Business (la app) y la Cloud API son incompatibles sobre el
mismo número.** Un número con la app instalada no se puede registrar en la Cloud
API — Meta lo rechaza. Nuestro backend ES el "WhatsApp" de cada número: los
mensajes entran por el webhook y salen por la API.

## Dos capas de configuración

### 1. Global — se hace UNA sola vez (producción)

No depende de ningún cliente. Se monta una vez y sirve para todos:

- **Meta Business Manager** verificado.
- **1 App** en developers.facebook.com con el producto WhatsApp.
- **1 WhatsApp Business Account (WABA)**.
- **1 System User token permanente** (ver sección Token).
- **1 webhook** apuntando a `https://<dominio>/webhooks/whatsapp`.

Variables de entorno globales:

| Variable | De dónde sale | Para qué |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | System User token (permanente) | Autenticar el envío. Uno solo sirve para **todos** los números de la WABA. |
| `META_APP_SECRET` | App → Settings → Basic | Verificar la firma `x-hub-signature-256` de cada webhook entrante. |
| `WHATSAPP_VERIFY_TOKEN` | Lo definimos nosotros | Validar el webhook con Meta (challenge GET). |
| `META_WABA_ID` | WhatsApp → API Setup | Provisioning en onboarding. |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup | Número de sistema / fallback para avisos internos. |

> La **App, la WABA y el token NO se duplican por cliente.** Es un error común
> pensar en "una Meta App por cliente". El token de System User tiene permiso
> sobre la WABA entera, así que el **mismo token** envía desde cualquier número
> de esa cuenta.

### 2. Por cliente — se hace en cada alta

Cada tenant tiene **su propio número**, y por lo tanto su propio
`phone_number_id`. Ese ID es lo que permite el ruteo multi-tenant: el webhook
identifica de qué cliente entró cada mensaje mirando el `phone_number_id` del
payload de Meta.

`backend/src/modules/whatsapp/whatsapp.webhook.controller.ts` (resolveChannel):

```ts
const phoneNumberId = value?.metadata?.phone_number_id;
// SELECT client_id, id FROM canal_entrada
//  WHERE config->>'phone_number_id' = $1 AND is_active = true
```

## El Token (lo más importante)

El token que Meta muestra en "API Setup" **dura 24 horas**. Sirve para probar y
**se muere solo al día siguiente**. En producción NO se usa.

Producción necesita un **System User token permanente**:

1. Business Settings → **Users → System Users** → crear uno (rol Admin).
2. Asignarle la **App** y la **WABA** como assets.
3. **Generate Token** → elegir la app → permisos `whatsapp_business_messaging`
   y `whatsapp_business_management`.
4. Marcarlo como **permanente** (sin expiración).

Ese token va en `WHATSAPP_ACCESS_TOKEN`.

## Qué aporta el cliente

Una sola cosa: **un número de teléfono** que cumpla dos condiciones.

1. **Sin WhatsApp activo** (ni normal ni Business). Si lo tiene, hay que darlo
   de baja antes de registrarlo.
2. **Que pueda recibir el OTP** de verificación (SMS o llamada) una única vez.

Recomendación: que sea un **número dedicado** (chip nuevo), no el celular
personal de nadie — al registrarlo en la Cloud API, ese número deja de funcionar
como WhatsApp común. El número puede proveerlo el cliente o comprarlo nosotros;
al promotor le da igual a qué número escribe.

Ese número es el **punto de entrada operativo** del cliente: es al que los
promotores y el staff le escriben para mandar boletas, fotos, ubicación y
responder convocatorias (flujos F1, F3, F4, F5).

## Modelos posibles (decisión de arquitectura)

### A. Un número compartido para todos

- Un solo `phone_number_id` global (`WHATSAPP_PHONE_NUMBER_ID`).
- El onboarding solo guarda metadata del cliente; no se registra nada por
  cliente. "Poné el número y listo."
- **Es como está codeado hoy** (fallback a número de test).
- Simple, pero se pierde el ruteo por cliente (todos entran por el mismo ID).

### B. Un número por cliente (modelo elegido)

- Cada tenant trae su número → cada número tiene su `phone_number_id`.
- Aprovecha el ruteo por `phone_number_id` que ya está en el webhook.
- **Obliga a un paso por número**: registrar el número en la WABA para obtener
  su `phone_number_id`. Ese ID lo asigna Meta — no se puede inventar ni tipear.

> No existe una tercera opción: tener números separados **sin registrarlos** no
> es posible en la Cloud API. Sin registro no hay `phone_number_id`, y sin
> `phone_number_id` no hay ruteo por tenant.

## Flujo de alta (Modelo B)

Por cada cliente nuevo:

1. Conseguir el número (lo da el cliente o lo compramos nosotros).
2. **Registrar el número en la WABA** (Business Manager o API) → verificar OTP →
   Meta devuelve el `phone_number_id`. ← paso que no se puede saltear.
3. Cargar ese `phone_number_id` en el `canal_entrada` del cliente vía onboarding.
4. Suscribir el número al webhook (campo `messages`).

El cliente no configura nada de su lado. El registro (paso 2) lo hacemos
nosotros, una vez por número (~2 minutos en Business Manager).

## Gaps de código conocidos (pendientes para producción Modelo B)

1. **Registro de número**: `provisionWhatsApp`
   (`backend/src/modules/onboarding/onboarding.service.ts`) hoy **no registra el
   número en Meta** — reusa el `phone_number_id` de test del env para todos los
   clientes. Comentario en el código: *"Meta test mode does not allow
   registering new numbers via API."* Para Modelo B hay que, o registrar el
   número a mano y pegar el `phone_number_id` real por cliente, o integrar la
   API de registro de Meta (Embedded Signup).

2. **Envío por número correcto**: `WhatsAppService`
   (`backend/src/modules/whatsapp/whatsapp.service.ts`) envía siempre desde un
   `phone_number_id` **global** del env:

   ```ts
   private readonly phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
   ```

   El entrante rutea por cliente, pero el saliente no: la respuesta sale desde el
   número global, no desde el del cliente. Para Modelo B, `sendText` /
   `sendTemplate` tienen que enviar desde el `phone_number_id` del canal del
   cliente (el webhook ya conoce `clientId` / `canalId` en cada handler). El env
   global queda solo como fallback para avisos de sistema.

## Webhook — recordatorios

- Callback URL: `https://<dominio>/webhooks/whatsapp`, campo `messages`.
- El GET de verificación devuelve el challenge **crudo**; si
  `WHATSAPP_VERIFY_TOKEN` no está seteado, rechaza fail-closed (403).
- Cada POST entrante valida la firma `x-hub-signature-256` contra
  `META_APP_SECRET` (fail-closed si falta).

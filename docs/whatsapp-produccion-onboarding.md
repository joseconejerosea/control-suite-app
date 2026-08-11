# WhatsApp Cloud API — Producción y alta de clientes

Guía del modelo de WhatsApp en Control Suite BTL. El producto usa **UN solo número
Meta global** para todos los clientes. Este doc explica qué se configura una sola
vez (producción) y cómo se da de alta un cliente y su staff sin tocar nada de Meta
por tenant.

## Las tres cosas que se llaman parecido

| Nombre | Qué es | Lo usamos |
|---|---|---|
| WhatsApp | App personal del celular | No |
| WhatsApp Business | App verde del store (pymes) | No |
| WhatsApp Business Platform (Cloud API) | Una **API**, no una app | **Sí** |

Clave: **WhatsApp Business (la app) y la Cloud API son incompatibles sobre el
mismo número.** Nuestro backend ES el "WhatsApp" del número global: los mensajes
entran por el webhook y salen por la API.

## Configuración global — se hace UNA sola vez (producción)

No depende de ningún cliente. Se monta una vez y sirve para **todos**:

- **Meta Business Manager** verificado.
- **1 App** en developers.facebook.com con el producto WhatsApp.
- **1 WhatsApp Business Account (WABA)**.
- **1 número** registrado en la Cloud API → su `phone_number_id`.
- **1 System User token permanente** (ver sección Token).
- **1 webhook** apuntando a `https://<dominio>/webhooks/whatsapp`, campo `messages`.

Variables de entorno (todas globales — no hay env por tenant):

| Variable | De dónde sale | Para qué |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup | El único número desde el que sale TODO el saliente. |
| `WHATSAPP_ACCESS_TOKEN` | System User token (permanente) | Autenticar el envío a la Cloud API. |
| `META_APP_SECRET` | App → Settings → Basic | Verificar la firma `x-hub-signature-256` de cada webhook entrante. |
| `WHATSAPP_VERIFY_TOKEN` | Lo definimos nosotros | Validar el webhook con Meta (challenge GET). |

> **App, WABA, token y número NO se duplican por cliente.** Un solo número global
> atiende a todas las agencias.

Variables que **ya NO se usan** (eran del provisioning por número, eliminado):
`META_WABA_ID` / `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_REGISTER_PIN`.

## El Token

El token que Meta muestra en "API Setup" **dura 24 horas** y no se usa en
producción. Producción necesita un **System User token permanente**:

1. Business Settings → **Users → System Users** → crear uno (rol Admin).
2. Asignarle la **App** y la **WABA** como assets.
3. **Generate Token** → elegir la app → permisos `whatsapp_business_messaging`
   y `whatsapp_business_management`.
4. Marcarlo como **permanente** (sin expiración).

Ese token va en `WHATSAPP_ACCESS_TOKEN`.

## Cómo se identifica el cliente (número único)

Como todos los mensajes entran por el mismo número, el tenant **no** se deduce del
`phone_number_id`. Se resuelve por el **remitente**: quién escribe.

`backend/src/modules/whatsapp/whatsapp.webhook.controller.ts` (`resolveInboundTenant`):

- Se buscan los clientes donde el teléfono del remitente está registrado (promotor
  activo / colaborador / usuario staff), cross-tenant.
- **1 candidato** → se pregunta igual para permitir operar por otra agencia.
- **2+ candidatos** → el bot pregunta "¿para qué agencia?" (lista + "otra agencia").
- **0 candidatos** → el bot pide el **código de afiliación** de la agencia.

El intake (foto/documento/texto) se **bufferea** hasta que el remitente responde, y
se reanuda bajo el `client_id` elegido.

## Alta de un cliente y su staff

Por cada cliente nuevo:

1. **Crear el cliente** (SuperAdmin) → se genera automáticamente su
   **código de afiliación** único (`clients.affiliation_code`, rotable).
2. **Onboarding** (3 pasos, sin configurar canales): crear cliente → crear admin
   (Manager) → activar. WhatsApp ya funciona (número global); no hay registro de
   número, OTP ni paso de canal.
3. El **Manager** ve y reparte su código de afiliación desde
   `client/config` (Integraciones) — puede rotarlo si se filtra.
4. El **staff** escribe al número global y, la primera vez, tipea el código →
   queda afiliado como promotor **activo** y puede operar (F1, F3, F4, F5).

El cliente no configura nada en Meta. No hay paso de registro por número.

## Salida (outbound)

Todo el saliente sale del único `WHATSAPP_PHONE_NUMBER_ID` global
(`backend/src/modules/whatsapp/whatsapp.service.ts`). No hay número por tenant.

## Webhook — recordatorios

- Callback URL: `https://<dominio>/webhooks/whatsapp`, campo `messages`.
- El GET de verificación devuelve el challenge **crudo**; si
  `WHATSAPP_VERIFY_TOKEN` no está seteado, rechaza fail-closed (403).
- Cada POST entrante valida la firma `x-hub-signature-256` contra
  `META_APP_SECRET` (fail-closed si falta).

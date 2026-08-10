# Deuda técnica: aviso a operadores por WhatsApp usa texto libre (ventana de 24h)

**Estado:** abierta · **Severidad:** media (los avisos por WhatsApp a operadores pueden NO entregarse) · **Alcance:** repo-wide (`OperatorNotifierService`, 7 call sites)
**Detectada:** revisando el aviso de "promotor desconocido / evidencia sin asociar" (subsistema de notificaciones).

## Qué pasa

`OperatorNotifierService.notificar()` avisa a los operadores (`admin_cliente`) por WhatsApp
usando **texto libre**:

```
notificar() -> WhatsappOutputService.sendTextOnce() -> WhatsAppService.sendText()
```

`sendText` postea a la Cloud API de Meta con `type: 'text'` (mensaje de forma libre),
NO un template.

## Por qué es un problema

WhatsApp Business Platform (Meta) permite enviar **texto libre** a un usuario **solo dentro
de la ventana de atención de 24 horas**, que se abre cuando **ese usuario le escribe al
número del negocio**. Fuera de esa ventana (o si el usuario nunca escribió), Meta **rechaza**
el mensaje de texto libre (error `131047` — "más de 24h desde la última respuesta del cliente").
Para iniciar/reabrir conversación hay que usar un **template pre-aprobado**.

Los operadores normalmente **no le escriben al número del bot** (no son clientes del negocio),
así que su ventana de 24h suele estar **cerrada**. En ese caso:

- El aviso in-app (campana / tab) **sí llega** — no depende de ninguna ventana. ✅ (canal confiable)
- El aviso por **WhatsApp NO llega** — Meta lo rechaza y el código no cae a un template. ❌

`sendText` no reintenta ni hace fallback a template; el mensaje simplemente no se entrega.

## Por qué NO es urgente

El diseño está cubierto: la **notificación in-app es el canal confiable**. El WhatsApp al
operador es best-effort (un extra cuando la ventana está abierta). Ningún aviso crítico se
pierde de forma silenciosa mientras la campana in-app funcione.

## Cómo se arreglaría (cuando se priorice)

Enviar el aviso al operador con un **template aprobado** vía `WhatsAppService.sendTemplate()`
(ya existe, `type: 'template'`) en lugar de `sendText`:

1. Crear el/los template(s) en Meta Business Manager (ej: `aviso_operador` con un parámetro de
   cuerpo) y esperar la aprobación de Meta.
2. Cambiar `OperatorNotifierService.notificar()` (o agregar un método) para usar `sendTemplate`
   cuando la ventana pueda estar cerrada. Opcional: intentar `sendText` y caer a template si
   Meta rechaza por ventana.

**Alcance:** afecta a los **7 call sites** de `OperatorNotifierService` (F5 incidencias/reportes,
Gmail, cron, convocatoria, evidencia). Es deuda pre-existente, no la introdujo el subsistema de
notificaciones.

## Archivos

- `backend/src/modules/whatsapp/operator-notifier.service.ts` — `notificar()` (usa sendTextOnce)
- `backend/src/modules/whatsapp/whatsapp-output.service.ts` — `sendTextOnce()`
- `backend/src/modules/whatsapp/whatsapp.service.ts` — `sendText()` (`type:'text'`) vs `sendTemplate()` (`type:'template'`)

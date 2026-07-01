# Control Suite — Flujos de WhatsApp, roles y consultas para el cliente

> Documento de relevamiento para validar con el cliente.
> Todo lo descripto en "Cómo funciona hoy" está **verificado contra el código**.
> Las secciones marcadas como **PREGUNTA** requieren una decisión de producto del cliente.

---

## 1. Las tres taxonomías de personas

En el sistema conviven **tres tipos de persona distintos**, no uno solo con subdivisiones. Es clave entender la diferencia porque define quién puede hacer qué.

| Taxonomía | Qué es | ¿Se loguea a la plataforma? | Identificador | Tiene teléfono |
|-----------|--------|------------------------------|---------------|----------------|
| **`users`** | Cuentas de la plataforma (panel web) | **SÍ** (email + contraseña) | Roles de acceso: `user`, `admin_cliente`, `super_admin` | No (columna inexistente hoy) |
| **`collaborators`** | Directorio de personal de terreno | No | `role_label`: `observer`, `supervisor`, `coordinator`, `brand_manager` | Sí |
| **`promoters`** | Directorio de promotores de terreno | No | `status`: `active`, `inactive`, `suspended` | Sí |

**Diferencia conceptual:**
- `users` son **cuentas**: se autentican, tienen contraseña, sus roles gobiernan permisos en el panel web.
- `collaborators` y `promoters` son **fichas de un directorio**: gente de terreno que **no entra a la plataforma**. Su único punto de contacto con el sistema es **WhatsApp**.

Las tres tablas están aisladas por cliente (multi-tenant: cada registro pertenece a un `client_id`).

---

## 2. Los roles de `collaborators` (role_label)

Valores posibles (con restricción en base de datos): `observer`, `supervisor`, `coordinator`, `brand_manager`. Valor por defecto: `observer`.

**Hallazgo importante (verificado):** hoy el `role_label` es una **etiqueta puramente descriptiva**. Se guarda y se muestra, pero **no se usa en ninguna parte del código para diferenciar permisos ni comportamiento**. No hay ninguna regla que diga "un observer no puede hacer X" o "un coordinator sí puede Y". Los cuatro valores son funcionalmente equivalentes en el sistema actual.

> **PREGUNTA 1 — Significado de los roles:** ¿Qué representa operativamente cada rol (observer / supervisor / coordinator / brand_manager)? ¿Hay una jerarquía o diferencia de responsabilidades real en el negocio, o es solo una etiqueta organizativa?

---

## 3. Flujos de ENTRADA (mensajes que recibe el agente por WhatsApp)

El número de WhatsApp pertenece a un cliente (se resuelve por el `phone_number_id` de Meta). Una vez identificado el cliente, el mensaje se procesa según su **tipo**:

| Tipo de mensaje | Flujo | Qué hace hoy |
|-----------------|-------|--------------|
| **Imagen / Documento** | **F1 — Comprobantes / OCR** | Descarga el archivo, intenta resolver a qué proyecto pertenece (varias señales); si es ambiguo, pregunta a cuál. Luego procesa con IA (lectura OCR vía Claude Vision), clasifica y registra el comprobante. |
| **Ubicación (GPS)** | **F5 — Check-in de ubicación** | Compara la ubicación enviada contra las activaciones programadas/en curso (cálculo de distancia, radio por defecto 200m). Si está dentro del radio → marca la activación "en vivo". Responde verificado / fuera de rango. |
| **Texto** | Varios | (1) Filtro de seguridad anti-inyección. (2) Si es respuesta a una aclaración pendiente, la procesa. (3) Si está eligiendo proyecto, toma el número. (4) Si responde "sí/no", lo toma como respuesta a una convocatoria. (5) Si no, guarda el texto y responde un mensaje genérico. |
| **Audio / Video** | Solo almacenamiento | Se guarda el archivo y se confirma la recepción. No hay procesamiento posterior. |

> **PREGUNTA 2 — Audio/video:** Hoy solo se almacenan. ¿El cliente espera algún procesamiento (transcripción, etc.) o está bien que solo queden guardados?

---

## 4. Flujos de SALIDA (notificaciones que envía el agente)

| Notificación | Destinatario | Estado actual |
|--------------|--------------|---------------|
| F1 — documento rechazado | Quien envió el documento | Operativo |
| Aclaración de proyecto | Quien envió el comprobante | Operativo |
| Convocatorias (F4) | Promotores convocados | Operativo (disparo manual) |
| Confirmación/rechazo de devolución de stock (F3) | Persona involucrada | Operativo |
| **Alerta de presupuesto excedido (rendiciones)** | Administrador del cliente | **ROTO** — consulta `users.phone`, columna que no existe. Falla en silencio. |
| **Broadcast de soporte** | Administrador del cliente | **ROTO** — mismo motivo. |
| **Recordatorio proactivo (Mind)** | Administradores | **NO implementado** — pendiente de decisión de destinatario. |

> **PREGUNTA 3 — Destinatario de los recordatorios de Mind:** Cuando el sistema genera un recordatorio proactivo, ¿a quién debe llegar? Opciones: a los administradores del cliente (cuentas `admin_cliente`), a los coordinadores/brand managers de terreno, o a las personas que deben rendir. Esto define de qué tabla se obtiene el teléfono.

---

## 5. Hueco de seguridad detectado en la ENTRADA

**Situación actual (verificada):** el agente **no valida quién le escribe**. Cualquier número de teléfono que le envíe un mensaje al WhatsApp del cliente activa el flujo completo — incluyendo el procesamiento con IA (que tiene costo) y el registro de datos en la cuenta del cliente.

**Riesgo:** un número desconocido puede disparar procesamiento de IA y ensuciar los datos del cliente con solo mandar mensajes/fotos.

**Solución propuesta y acordada (a confirmar con el cliente):** un control de acceso "suave" (*gate soft*):
- Si el número está registrado en el directorio del cliente (`promoters` o `collaborators` activos) → se procesa normalmente.
- Si el número **no** está registrado → no se procesa, y se responde: *"No estás registrado, contactá a tu coordinador."*

> **PREGUNTA 4 — Texto del mensaje y política:** ¿Confirma el cliente este enfoque? ¿El texto de rechazo le sirve o prefiere otro? ¿Quiere además que se notifique a algún coordinador cuando un desconocido intenta escribir?

> **PREGUNTA 5 — Quién está autorizado a escribir:** Recomendación técnica: autorizar a **todo `promoter` y `collaborator` activo, sin filtrar por rol** (porque el rol hoy no tiene semántica). ¿El cliente está de acuerdo, o hay algún rol que NO debería poder enviar mensajes al agente?

---

## 6. Detalle técnico a confirmar: formato de los teléfonos

WhatsApp entrega el número del remitente en formato internacional **sin el signo `+`** (ej: `56912345678`). Los teléfonos del directorio los carga una persona y pueden tener otro formato (con `+`, espacios o guiones). Para que el control de acceso funcione, hay que **normalizar ambos lados** antes de comparar.

> **PREGUNTA 6 — Carga de teléfonos:** ¿En qué formato cargan hoy los teléfonos del directorio? ¿Siempre con código de país? Esto evita que personas legítimas queden bloqueadas por una diferencia de formato.

---

## Resumen de decisiones pendientes del cliente

1. Significado/jerarquía real de los roles de collaborators.
2. Qué hacer con audio/video.
3. Destinatario de los recordatorios proactivos de Mind.
4. Confirmación del control de acceso "suave" y su mensaje.
5. Qué personas/roles están autorizados a escribirle al agente.
6. Formato en que se cargan los teléfonos.

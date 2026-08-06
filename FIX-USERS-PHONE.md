# El agujero de `users.phone` — por qué hay notificaciones que nunca llegan

> **Estado:** documentado y verificado en código el 2026-07-01.
> **Para quién:** cualquier dev que agarre esto sin contexto.
> **En una frase:** la tabla `users` no tiene columna `phone`, pero hay tres lugares
> del código que la consultan para mandar WhatsApp a los admins. Como el error se traga
> en silencio, las notificaciones **nunca salen y nadie se entera**.

---

## 1. El problema, sin vueltas

Cuando un admin del cliente tiene que enterarse de algo importante por WhatsApp
—que una rendición se pasó del presupuesto, que entró un ticket de soporte, que Mind
recomienda un recordatorio— el sistema hace esto:

```sql
SELECT u.phone FROM users u
WHERE u.client_id = $1 AND u.role = 'admin_cliente' AND u.phone IS NOT NULL
```

Busca el teléfono del admin en la tabla `users`. **Pero esa columna no existe.**

Mirá la entity real (`backend/src/modules/users/user.entity.ts`). Estas son TODAS
sus columnas:

| Columna | Tipo | |
|---|---|---|
| `id` | uuid | PK |
| `client_id` | uuid | tenant |
| `email` | varchar | |
| `password` | varchar | |
| `role` | varchar | `admin_cliente`, `user`, etc. |
| `full_name` | varchar(100) | nullable |
| `language` | varchar(5) | default `es` |
| `is_active` | boolean | default true |
| `created_at` / `updated_at` | timestamptz | |

**No hay `phone`. Punto.**

---

## 2. Por qué falla en SILENCIO (esto es lo peligroso)

Si la query simplemente reventara, alguien habría visto el error hace rato. Pero cada
consumidor la envuelve así:

```ts
const admins = await this.ds.query(`SELECT u.phone ...`, [clientId])
  .catch(() => []);   // ← acá se traga el error
```

Entonces cuando PostgreSQL responde *"column u.phone does not exist"*, el `.catch(() => [])`
lo convierte en un **array vacío**. El código sigue como si no hubiera ningún admin para
avisar, no manda nada, y **no deja rastro**. Cero excepciones, cero logs de error.

> **La consecuencia:** el sistema *cree* que notifica. El cliente *cree* que le van a avisar.
> Y en la realidad no sale nada. Es el peor tipo de bug: el que no grita.

---

## 3. Los tres lugares afectados (con archivo y línea)

### 🔴 F2 — Alerta de presupuesto excedido
`backend/src/modules/rendiciones/rendiciones.service.ts:198`

```sql
SELECT u.phone, u.language FROM users u
WHERE u.client_id = $1 AND u.role = 'admin_cliente' AND u.phone IS NOT NULL
```
Cuando una rendición se pasa del presupuesto, se supone que el admin recibe un WhatsApp
("Alerta presupuesto: el proyecto excede el budget en $X, requiere aprobación manual").
**No lo recibe.**

### 🔴 Soporte — Aviso de ticket
`backend/src/modules/support/support.service.ts:131`

```sql
SELECT u.phone FROM users u
WHERE u.client_id = $1 AND u.role = 'admin_cliente' AND u.phone IS NOT NULL LIMIT 1
```
El mensaje de soporte al admin del cliente **nunca llega**.

### 🟠 Mind → recordatorio (además, BLOQUEADO)
`backend/src/modules/mind/mind-propuestas.service.ts` (case `enviar_recordatorio`)

Acá hay DOS problemas encima:
1. Igual que los otros, no hay teléfono en `users`.
2. Falta una **decisión de producto**: ¿a quién llega el recordatorio de Mind?
   ¿a los admins, a los coordinadores, o a la persona que rinde? El action se crea con
   `target: 'admins'` (`queue/processors/mind-proactive.processor.ts:110`), pero eso
   todavía hay que confirmarlo con el cliente.

---

## 4. La raíz y por qué es una sola

Los tres cuelgan del mismo clavo: **no existe una forma de guardar el teléfono de un
usuario interno (admin/coordinador)**. Los teléfonos que SÍ existen en el sistema son los
de `promoters` y `collaborators` (gente de terreno) — por eso el gate de WhatsApp que ya
cerramos funciona: consulta esas dos tablas, no `users`.

O sea: el sistema sabe el teléfono del *personal de terreno*, pero no el del *admin que
gestiona*. Y las notificaciones que fallan son justamente las que van hacia adentro.

---

## 5. El arreglo tiene DOS partes (no una)

Mucho ojo con esto, porque es fácil creer que "agrego la columna y listo". No.

### Parte A — Esquema (que la columna exista)
- Migración TypeORM nueva: `1700000000043-AddPhoneToUsers.ts`
  (molde exacto ya existe: `1700000000027-AddFullNameToUsers.ts`).
- Agregar `phone` a la entity `User` (nullable, como `full_name`).

Con esto, las tres queries **dejan de reventar**. Pero todavía no notifican nada, porque…

### Parte B — Datos (que el teléfono se pueda cargar)
Las queries filtran `WHERE u.phone IS NOT NULL`. Si nadie carga el número, siguen sin
mandar. Entonces hace falta **una forma de setear el teléfono del admin**:
- ¿un campo en el panel de administración de usuarios?
- ¿un endpoint `PUT /users/:id`?
- ¿carga por seed inicial?

**Esto es diseño y hay que definirlo.** Sin la Parte B, la Parte A sola no arregla nada
visible — solo saca el error de silencio.

---

## 6. Lo que queda para el cliente (no lo decidimos nosotros)

- **¿Quién recibe el recordatorio de Mind?** admins / coordinadores / quien rinde.
  (rendiciones y support ya apuntan claro a `admin_cliente`, así que esos dos NO dependen
  de esta respuesta — se destraban solo con las Partes A + B.)
- **¿Cómo se cargan los teléfonos de los admins?** decisión de UX/onboarding.

---

## 7. Resumen para arrancar

| | Qué | Bloqueado por |
|---|---|---|
| **A. Migración + entity** | agregar `users.phone` | nada — se puede YA |
| **B. Carga del dato** | UI/endpoint para setear el teléfono | decisión de diseño |
| **Wiring rendiciones + support** | ya está escrito, se destraba con A+B | nada |
| **Wiring Mind** | conectar el envío | decisión de producto (destinatario) |

**El camino corto que desbloquea lo máximo:** Parte A + Parte B + verificar que
rendiciones y support notifican. Mind queda para cuando el cliente responda quién recibe.

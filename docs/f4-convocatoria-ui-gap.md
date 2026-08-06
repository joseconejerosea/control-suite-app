# F4 — Gap de UI: flujo de convocatoria sin frontend

**Fecha:** 2026-07-12
**Estado:** Hallazgo abierto (no es un bug de código; es una feature backend-complete sin UI)
**Severidad:** Alta — funcionalidad central de F4 no accesible para el cliente

## Resumen

El motor de **convocatoria de F4** (asignar turnos → aprobar → enviar a promotores por
WhatsApp → gestionar respuestas → cerrar ronda) está **completo en el backend** y
**autorizado para roles del cliente** (Manager / Service Lead), pero **ningún botón de la
app del cliente lo dispara**. La UI del cliente solo cubre el CRUD de proyectos y una vista
de solo lectura del calendario.

## Evidencia

### 1. Los endpoints están habilitados para roles del CLIENTE

`backend/src/modules/projects/projects.controller.ts`:

| Endpoint | Acción | Roles |
|----------|--------|-------|
| `POST /projects/:id/turno-equipo` | Asignar promotor a día(s) | Manager, Service Lead, Superadmin |
| `POST /projects/:id/aprobar` | Aprobación humana (gate) | Manager, Service Lead, Superadmin |
| `POST /projects/:id/convocar` | Enviar convocatoria por WhatsApp | Manager, Service Lead, Superadmin |
| `PATCH /projects/:id/convocatorias/:convId` | Actualizar estado manual | Manager, Service Lead, Superadmin |
| `GET /projects/:id/turno-equipo` · `/convocatorias` | Lectura | + Operator |

`Manager` y `Service Lead` son roles del cliente. Si el flujo fuera interno de la agencia,
estaría restringido a `SUPERADMIN`. Su inclusión indica que **el cliente es el actor previsto**.

### 2. El frontend asume una pantalla que no existe

`frontend/app/client/calendario/page.tsx` (empty-state):

> "Sin convocatorias para este proyecto — Asigna turnos desde la vista de proyecto para crear convocatorias"

Esa "vista de proyecto" con asignación de turnos **no existe**. La única página de proyectos
(`frontend/app/client/projects/page.tsx`) solo hace CRUD (crear / editar / listar); no hay
vista de detalle ni navegación a una.

### 3. El backend está completo (inversión que implica feature real)

`backend/src/modules/projects/projects.service.ts` implementa el ciclo entero:

- `asignarTurno` — crea convocatorias `pendiente` por persona × día (sin enviar WhatsApp).
- `aprobarProyecto` — gate humano; setea `aprobado_por_user_id` + `aprobado_at`.
- `enviarConvocatoria` — **bloquea el envío si no está aprobado** (`CONVOCATORIA_NO_APROBADA`,
  `projects.service.ts:334`); lock de idempotencia de 5 min por persona+día.
- `invalidarAprobacionSiEditadoPostEnvio` — editar post-envío invalida la aprobación y exige re-aprobar.
- `notificarReemplazoNecesario` — cancelación → avisa al Operator para reemplazo manual.
- `cerrarConvocatoriaSiCompleta` — cierra la ronda y manda resumen al operador (atómico/idempotente).

## Qué falta en la UI del cliente

Ninguna de estas acciones tiene botón en la app del cliente:

- [ ] Asignar turnos (persona × día) a un proyecto
- [ ] Aprobar el proyecto (gate previo al envío masivo)
- [ ] Enviar la convocatoria por WhatsApp
- [ ] Cambiar el estado de una convocatoria manualmente (confirmar / rechazar / cancelar)
- [ ] Estado `closed` del proyecto (dispara las devoluciones F3) — el dropdown solo ofrece
      `active` / `paused` / `archived`

Lo único que sí existe:

- ✅ CRUD de proyectos (`/client/projects`) — verificado E2E.
- ✅ Vista de calendario **solo lectura** (`/client/calendario`) — matriz persona × día + modal de detalle.

## Dónde debería vivir

Una **vista de detalle de proyecto** (`/client/projects/[id]`) es el lugar natural, con:
tab/sección de equipo y turnos (asignar), botón de aprobación (con el estado del gate visible),
botón de enviar convocatoria (deshabilitado hasta aprobar), y acción de cierre de proyecto.
El calendario ya existente serviría como vista de seguimiento de esa misma información.

## Recomendación

Construir la UI de convocatoria en el cliente. El backend no requiere cambios: los endpoints,
el gate de aprobación, la idempotencia y el ciclo de cierre ya están listos y probados por
patrón. Es trabajo de frontend + cableado a los endpoints existentes.

## Referencias

- `frontend/app/client/projects/page.tsx` — CRUD de proyectos (única página de proyectos)
- `frontend/app/client/calendario/page.tsx` — vista read-only de convocatorias
- `backend/src/modules/projects/projects.controller.ts` — endpoints F4 + roles
- `backend/src/modules/projects/projects.service.ts` — motor de convocatoria (asignar/aprobar/enviar/cerrar)

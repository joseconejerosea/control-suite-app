# Proyecto · Campaña · Activación — modelo de dominio

> **Estado:** base factual para acordar la definición (ticket B2 de la Matriz 22-ago).
> B2 **no es un bug**: es una definición de negocio pendiente del equipo. Este documento
> describe **qué son hoy estas tres entidades según el código y la base de datos**, para
> que la definición que se acuerde matchee la realidad del sistema (o para decidir, a
> conciencia, dónde cambiarla).

## Resumen en una línea

Hoy el sistema modela una jerarquía de tres niveles: **Proyecto → Campaña → Activación**.

## Las tres entidades (según el sistema actual)

### Proyecto
El **paraguas comercial**. Es lo que se crea desde "Nuevo proyecto".
Contiene: cliente final, presupuesto, ventana de fechas, brief, locales/PDV, perfil de
personas, hitos.
Tabla: `projects` (migración 013).

### Campaña
Una **sub-agrupación de ejecución dentro de un proyecto**.
Se vincula al proyecto con `campaigns.project_id`.
Tabla: `campaigns` (con `project_id` agregado en migración 015).

### Activación
La **ejecución concreta en terreno**: una fecha y un punto de venta, con sus promotores,
sus check-ins de ubicación y su evidencia fotográfica (lo que registran el bot de
WhatsApp y el flujo F5).
Tabla: `activations` (migración 006).

**Dato clave:** hoy **toda activación necesita obligatoriamente una campaña** —
`activations.campaign_id` es `NOT NULL` en la base. No existe una activación "suelta"
que cuelgue directo de un proyecto sin pasar por una campaña.

## Por qué "qué es cada cosa" está borroso (la deuda técnica)

El sistema está **a mitad de camino entre dos modelos**:

1. **Modelo original (campaña-céntrico):** la activación colgaba de la campaña
   (`activations.campaign_id NOT NULL`). La campaña era el contenedor principal.
2. **Modelo nuevo (proyecto-céntrico):** se agregaron los proyectos como nivel superior
   y se le pegó a la activación un `project_id` **directo y opcional** (migración 015).

El problema: **la UI nueva crea las activaciones seteando `campaign_id`, pero NO
`project_id`** (está comentado de forma literal en `activations.service.ts:58`). El
`campaign_id` quedó marcado como columna *legacy* (migración 057), pero sigue siendo
obligatorio.

**Consecuencia concreta:** para responder "¿esta activación pertenece a este proyecto?",
el sistema tiene que preguntar por **dos caminos a la vez**:

```sql
a.project_id = $proyecto
  OR a.campaign_id IN (SELECT id FROM campaigns WHERE project_id = $proyecto)
```

(ver `projects.service.ts:341-355` y `activations.service.ts:58-63`).

Es decir: conviven las dos jerarquías. Por eso ni el código tiene una respuesta única y
limpia a "¿qué es campaña vs proyecto?".

## Propuesta de definición (para acordar)

| Entidad | Definición de negocio propuesta |
|---|---|
| **Proyecto** | El negocio con un cliente: un presupuesto, unos locales, una ventana de fechas. El paraguas. |
| **Campaña** | Una tanda de ejecución dentro del proyecto. Hoy es obligatoria: toda activación cuelga de una campaña. |
| **Activación** | La ejecución concreta en un PDV y una fecha. Lo que se registra en terreno (check-ins, evidencia, material). |

## Decisión técnica pendiente (opcional, ya sería un ticket de código)

Si se quiere **limpiar la deuda**, hay que estandarizar el vínculo activación→proyecto en
**un solo camino**, en vez del `OR` dual de hoy. Dos opciones:

- **A) Poblar siempre `project_id`** en la activación al crearla (y dejar `campaign_id`
  como dato secundario o derivarlo). Simplifica las consultas a `a.project_id = $proyecto`.
- **B) Formalizar la campaña como capa obligatoria** del modelo (proyecto → campaña →
  activación siempre), y que la relación activación→proyecto se derive *siempre* vía
  campaña. Elimina el `project_id` directo de la activación.

Ambas cierran la ambigüedad; la elección depende de si el equipo quiere que la campaña
sea una capa real del negocio o solo un relic técnico.

---

*Fuente: modelo de datos y servicios del backend (migraciones 006/013/015/057,
`projects.service.ts`, `activations.service.ts`). Verificado 2026-08-26.*

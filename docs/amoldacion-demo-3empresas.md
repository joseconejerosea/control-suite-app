# Amoldación de la base demo (3 empresas) al modelo real de Control Suite

**Fuente:** `ControlSuite_Demo_3empresas.xlsx` (v1.0 — 26 ago 2026).
**Destino:** base de datos productiva de Control Suite (PostgreSQL).
**Estrategia:** carga **aditiva** — se agregan las 3 agencias demo *sin borrar* ningún dato existente.

El Excel fue armado sobre un esquema Prisma (`ARCHITECTURE.md`) que difiere del esquema
PostgreSQL real. Este documento deja constancia de cómo se **amolda** cada hoja del Excel a
las tablas reales, qué se conserva, qué se transforma y qué se decidió ante cada diferencia.

---

## 1. Decisiones de amoldación

| Tema | Decisión | Motivo |
|------|----------|--------|
| Aislamiento (multi-tenant) | Cada agencia = una fila en `clients`; todo cuelga por `client_id` | El sistema aísla por `client_id`, no por un `tenantId` externo |
| "Marca" (hoja *Client*) | Se guarda en `projects.cliente_final` + `projects.cliente_final_rut` | No existe tabla de marcas; el proyecto ya modela a su cliente final |
| IDs | Los slugs del Excel (`ten_terrenovivo`, `prj_...`) se convierten a **UUID determinístico** (estable) | La BD usa UUID; el UUID estable permite re-cargar sin duplicar (idempotencia) |
| Rol de los 3 dueños | `MANAGER` | El enum real sí tiene `MANAGER` (la discrepancia que marcaba el Excel queda resuelta) |
| Login de dueños | Contraseña demo compartida (hasheada con bcrypt) | Los correos son reales y sirven de login; la conexión Gmail para F1 es un paso OAuth aparte |
| Personal de terreno | Va a `promoters` (directorio, sin login), una fila por persona × agencia | En el modelo real el terreno no tiene cuenta; el canal de test es el teléfono |
| Capa `campaigns` | Se sintetiza 1 campaña por proyecto | `activations.campaign_id` es obligatorio; el Excel no modela campañas |
| Columnas con `*` | Se ignoran (`*perfil_terreno`, `*nota_demo`) | Son ayudas de lectura, no campos de BD (ya lo indica el Excel) |
| Fechas | Se cargan como `DATE`/`timestamptz` según la columna | El Excel ya las dejó a las 12:00 para esquivar el corrimiento de día |
| Montos | Número plano | El Excel ya evita el separador de miles |

---

## 2. Mapa hoja → tabla real

| Hoja Excel (Prisma) | Tabla real (PostgreSQL) | Notas de amoldación |
|---------------------|-------------------------|---------------------|
| **Tenant** (3) | `clients` | `name→nombre`, `slug→config`, `planStatus→plan/status`; se genera `affiliation_code` |
| **Client** (12 marcas) | — (a `projects`) | `name→cliente_final`, `rut→cliente_final_rut` del proyecto que la atiende |
| **User** dueños (3) | `users` | rol `MANAGER`, `name→full_name`, password demo hasheada |
| **User** terreno (12) | `promoters` | `name→first_name/last_name`, `phone`, `*perfil_terreno→rol` |
| **Project** (36) | `projects` (+ `campaigns`) | `budget→presupuesto_clp/budget`, `code→config`, `start/endDate→date`; 1 campaña sintética por proyecto |
| **Warehouse** (6) | `bodegas` | `name→nombre`, `location→direccion`, `isVirtual→tipo` |
| **PopItem** (24) | `skus` | `sku→codigo`, `name→nombre`, `minStock→min_stock`, `unit→(config)` |
| **PopStock** (24) | `inventario` | `warehouseId→bodega_id`, `itemId→sku_id`, `quantity→cantidad` |
| **StockMovement** (49) | `movimientos_pop` | `type→tipo`, `warehouseId→bodega_origen_id`, `projectId→proyecto_destino_id`, `responsibleId→persona_id` |
| **EventoCrudo** (15) | `eventos_crudos` | `rawPayload→payload`, `source`, `status`, `flow` |
| **Document** (12) | `document_uploads` | `fileUrl→storage_path`, `docType→(config)`, `uploadedBy→uploaded_by` |
| **Expense** (24) | `invoices` | `amount`, `vendor→vendor_name`, `docDate→invoice_date`, `category`, `status`, `projectId` |
| **ExpenseRendition** (8) | `rendiciones` (+ `rendicion_items`) | `personId→persona_id`, `weekStart/End→periodo`, `totalAmount→monto_total`; los `Expense` con `renditionId` se enlazan vía `rendicion_items` |
| **Convocation** (6) | (encabezado lógico) | El encabezado no tiene tabla; sus `PersonDay` se materializan en `convocatorias` |
| **PersonDay** (20) | `convocatorias` | Una fila por persona × día: `personId→persona_id`, `date→dia`, `status→estado` |
| **ConvocationMessage** (40) | `convocatoria_mensajes` | `direction`, `content→body`, `phone`, `sentAt` |
| **Activation** (9) | `activations` | `location→location (jsonb)`, `date→activation_date`, `status`, `supervisorId→(promoter/user)` |
| **ActivationEvent** (27) | `activation_events` | `source→event_type`, `content`, `mediaUrl→media_url` |

---

## 3. Orden de carga (respeta llaves foráneas)

```
clients → users → promoters → bodegas → skus → projects → campaigns
       → inventario → movimientos_pop → eventos_crudos → document_uploads
       → rendiciones → invoices → rendicion_items
       → convocatorias → convocatoria_mensajes → activations → activation_events
```

---

## 4. Escenarios de dolor conservados (para la demo)

Se preservan intactos los casos sembrados en el Excel, que son el valor de la demostración:

- **No-show de anfitrión + productor** (confirmaron y no llegaron) → `convocatorias.estado = no_show`.
- **Uniformes perdidos** (salieron y no volvieron) → `movimientos_pop` de salida sin retorno; saldo bajo en `inventario`.
- **Rendición que demoró semanas** → `rendiciones` con cierre a 19–23 días.
- **Rendición aún abierta** (40–50 días) → `rendiciones.estado = borrador/abierta`.
- **Reporte que salió tarde** (D+4 en vez de D+1) → reflejado en la activación.

---

## 5. Garantías de la carga

- **Aditiva:** no se elimina ni modifica ningún dato preexistente.
- **Idempotente:** re-ejecutar la carga no duplica (los UUID son determinísticos + `ON CONFLICT DO NOTHING`).
- **Transaccional:** todo entra en una sola transacción — o carga completa, o no carga nada.
- **Reversible:** toda la demo cuelga de 3 `client_id` conocidos; se puede quitar borrando esos 3 tenants.

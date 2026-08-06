/**
 * UserRole enum — fuente única de verdad para los roles del sistema.
 *
 * Estrategia de valores:
 *   KEY   = nombre canónico del modelo objetivo (legible, tipado)
 *   VALUE = string persistido actualmente en la DB (backward-compat)
 *
 * CERO migración de datos: los strings en Postgres quedan idénticos.
 * Ejemplo: MANAGER = 'admin_cliente' — la columna users.role sigue
 * almacenando 'admin_cliente'; el enum sólo le da nombre al concepto.
 */
export enum UserRole {
  SUPERADMIN   = 'super_admin',
  SERVICE_LEAD = 'service_lead',
  MANAGER      = 'admin_cliente',
  OPERATOR     = 'user',
  SUPERVISOR   = 'supervisor',
  STAFF        = 'staff',
}

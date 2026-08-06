/**
 * Labels amigables para los roles del sistema (modelo de 6 roles).
 * Mapea el string persistido en `user.role` → nombre legible para la UI.
 *
 * Fuente: docs/frontend-analysis-plan.md:133 + backend `UserRole` enum
 * (super_admin, service_lead, admin_cliente, user, supervisor, staff).
 *
 * OJO: los VALUES persistidos NO cambian (admin_cliente/user quedan igual en la DB);
 * esto es solo la capa de presentación.
 */
export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  service_lead: "Líder de Servicio",
  admin_cliente: "Manager",
  user: "Operador",
  supervisor: "Supervisor",
  staff: "Staff",
};

/** Devuelve el label amigable del rol; fallback: el string con guiones→espacios. */
export function roleLabel(role?: string | null): string {
  if (!role) return "";
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}

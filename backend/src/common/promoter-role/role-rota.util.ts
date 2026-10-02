/**
 * Taxonomía de roles para promotores.
 *
 * Rotativos (rota=true): promotor, anfitrion, productor.
 * No-rotativos (rota=false): supervisor, coordinador, brand_manager, observer.
 * Nulo / desconocido → rota=true (conservador: seguir preguntando agencia).
 */

export const PROMOTOR_ROL_TIPO_MEMBERS: readonly string[] = [
  'promotor',
  'anfitrion',
  'productor',
  'supervisor',
  'coordinador',
  'brand_manager',
  'observer',
] as const;

/** Roles que trabajan en múltiples clientes/proyectos (rotativos). */
export const ROTATING_ROLES: ReadonlySet<string> = new Set([
  'promotor',
  'anfitrion',
  'productor',
]);

/**
 * Devuelve `true` si el rol es rotativo (o desconocido/nulo).
 *
 * El default conservador (I-1) garantiza que un valor nulo o legacy
 * nunca salte la pregunta "¿qué agencia?" de forma involuntaria.
 */
export function isRota(rolTipo: string | null | undefined): boolean {
  if (rolTipo == null || rolTipo === '') return true;
  // Solo los roles no-rotativos conocidos devuelven false.
  if (ROTATING_ROLES.has(rolTipo)) return true;
  const nonRotating = new Set([
    'supervisor',
    'coordinador',
    'brand_manager',
    'observer',
  ]);
  return !nonRotating.has(rolTipo);
}

/**
 * F5 · Fase 1 (FUNDACIONES) — state machine del reporte al cliente.
 *
 * Estados en español, consistente con el resto del sistema (incidencias, F3, F4).
 *
 *   borrador ──/aprobar (humano)──▶ aprobado ──/enviar──▶ enviado  (terminal)
 *
 * INVARIANTE (process map §F5, línea 305-307): la IA propone, el humano dispone.
 * El report.processor genera SIEMPRE en 'borrador' (aprobado_at NULL). Sólo un
 * humano vía /aprobar pasa a 'aprobado' (setea aprobado_por_user_id + aprobado_at).
 * El envío exige 'aprobado' y manda la versión GUARDADA, no contenido del request.
 */
export const REPORTE_ESTADOS = ['borrador', 'aprobado', 'enviado'] as const;

export type ReporteEstado = (typeof REPORTE_ESTADOS)[number];

/** Único estado desde el que se puede enviar al cliente. */
export const REPORTE_ESTADO_ENVIABLE: ReporteEstado = 'aprobado';

/** Estado terminal: no admite más transiciones. */
export const REPORTE_ESTADO_TERMINAL: ReporteEstado = 'enviado';

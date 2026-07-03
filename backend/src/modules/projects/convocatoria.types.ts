/**
 * F4 Tier 2 · Fase 1 (FUNDACIONES) — state machine de una convocatoria.
 *
 * Estados en español, consistente con el contrato front↔back del resto del
 * sistema (F3). NO se normaliza a inglés.
 *
 *   pendiente ──enviarConvocatoria()──▶ enviada
 *                                         │
 *              clasificación 'confirma' ──┼───────▶ confirmada ──(operador,
 *              clasificación 'rechaza'  ──┘              │        día de activación)──▶ no_show
 *                                         └───────▶ rechazada    (terminal)
 *
 *   'ambiguo' NO cambia el estado: re-pregunta y, tras 2 intentos, escala al
 *   operador dejando la convocatoria en 'enviada' (sin resolver).
 *
 *   'no_show' — el promotor confirmó pero NO se presentó. Lo marca MANUALMENTE el
 *   operador el día de la activación (no hay check-in/geoloc: out-of-scope).
 *
 * 'reemplazada' — LEGACY. Los reemplazos fueron ELIMINADOS en Tier 3 (out-of-scope
 * en el spec + bypasseaban el gate humano). El flujo nuevo nunca produce este
 * estado; se conserva sólo para poder leer filas históricas sin romper el tipo.
 */
export const CONVOCATORIA_ESTADOS = [
  'pendiente',
  'enviada',
  'confirmada',
  'rechazada',
  'no_show',
  'reemplazada',
] as const;

export type ConvocatoriaEstado = (typeof CONVOCATORIA_ESTADOS)[number];

/** Estados terminales: no admiten más transiciones. */
export const CONVOCATORIA_ESTADOS_TERMINALES: readonly ConvocatoriaEstado[] = [
  'rechazada',
  'no_show',
  'reemplazada',
];

/**
 * Estados que cuentan como "respondida" para decidir si la convocatoria del
 * proyecto está completa (Fase 3, CLOSED). Todo lo que NO esté acá sigue abierto.
 */
export const CONVOCATORIA_ESTADOS_ABIERTOS: readonly ConvocatoriaEstado[] = [
  'pendiente',
  'enviada',
];

/**
 * Resultado de clasificar la respuesta de un promotor por WhatsApp (Fase 2, IA).
 * 'ambiguo' = no se pudo determinar la intención (pregunta, texto no relacionado).
 */
export type ConvocatoriaClasificacion = 'confirma' | 'rechaza' | 'ambiguo';

/** Clasificación resoluble → estado destino. 'ambiguo' no resuelve (no mapea). */
export const CLASIFICACION_A_ESTADO: Record<'confirma' | 'rechaza', ConvocatoriaEstado> = {
  confirma: 'confirmada',
  rechaza:  'rechazada',
};

/** Máximo de respuestas ambiguas antes de escalar al operador (Fase 2). */
export const MAX_INTENTOS_AMBIGUOS = 2;

/**
 * Dirección de un mensaje en convocatoria_mensajes (migración 046).
 * OUTBOUND = el sistema le escribe al promotor; INBOUND = el promotor responde.
 */
export type ConvocatoriaMessageDirection = 'INBOUND' | 'OUTBOUND';

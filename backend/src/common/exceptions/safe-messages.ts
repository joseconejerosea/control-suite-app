/**
 * Catalog of safe, neutral-professional Spanish strings for user-facing error messages.
 * These are the ONLY strings that may appear in HTTP response error bodies for
 * server-side integration/config/timeout/unexpected errors.
 *
 * Frozen to prevent accidental mutation at runtime.
 */
export const SAFE_MESSAGES = Object.freeze({
  INTEGRATION_FAILURE:
    'No se pudo completar la operación con el servicio externo. Intente nuevamente en unos minutos.',
  CONFIG_ERROR:
    'El servicio no está disponible por un problema de configuración. Contacte al administrador.',
  TIMEOUT: 'La operación tardó demasiado y fue cancelada. Intente nuevamente.',
  UNEXPECTED: 'Ocurrió un error inesperado. Intente nuevamente más tarde.',
  VALIDATION:
    'Los datos enviados no son válidos. Revíselos e intente nuevamente.',
} as const);

export type SafeMessageKey = keyof typeof SAFE_MESSAGES;

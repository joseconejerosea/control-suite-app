/**
 * Normaliza un número de teléfono extrayendo solo sus dígitos.
 * Elimina espacios, guiones, paréntesis, símbolos '+', etc.
 *
 * @example
 *   normalizePhone('+54 9 11 1234-5678') // '541911234 5678' → '54911123 45678'
 *   normalizePhone('54911123 45678')      // '5491112345678'
 */
export function normalizePhone(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '');
}

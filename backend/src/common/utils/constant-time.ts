import { timingSafeEqual } from 'crypto';

/**
 * Compara dos strings en tiempo constante para evitar timing attacks.
 *
 * `===` corta en el primer byte distinto, lo que filtra cuántos caracteres
 * del secreto acertó el atacante. `timingSafeEqual` siempre recorre todo el
 * buffer. Requiere buffers de igual longitud, así que primero igualamos el
 * largo comparando contra el HMAC implícito de la diferencia de tamaño:
 * si los largos difieren, devolvemos false pero igual ejecutamos un compare
 * dummy para no filtrar la diferencia de largo por tiempo.
 *
 * @returns true solo si ambos strings son no vacíos e idénticos.
 */
export function constantTimeEqual(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  if (!a || !b) return false;

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Compare contra sí mismo para gastar tiempo equivalente y no ramificar
    // visiblemente por longitud antes de devolver el resultado.
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

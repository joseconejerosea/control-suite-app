import { Job } from 'bullmq';

/**
 * True cuando el job está corriendo su ÚLTIMO intento (ya no va a reintentar
 * si vuelve a lanzar). En BullMQ v5, durante el intento k (1-indexado)
 * `job.attemptsMade === k - 1`; el job se configura con `opts.attempts` (default 1).
 *
 * Se usa para notificar al usuario UNA sola vez ante una falla que reintenta,
 * evitando mandarle un mensaje de error por cada reintento.
 */
export function isFinalAttempt(job: Pick<Job, 'attemptsMade' | 'opts'>): boolean {
  const made = job.attemptsMade ?? 0;
  const max = job.opts?.attempts ?? 1;
  return made + 1 >= max;
}

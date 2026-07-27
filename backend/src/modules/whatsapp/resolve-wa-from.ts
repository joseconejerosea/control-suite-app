import { DataSource } from 'typeorm';

/**
 * Resuelve el `phone_number_id` de WhatsApp DESDE el cual un worker de BullMQ debe
 * responder. Los workers NO heredan el ALS `runWithWaFrom` que el webhook setea por
 * request, así que sin esto todo envío desde un processor cae al número GLOBAL del
 * env (`WHATSAPP_PHONE_NUMBER_ID`) y Meta lo rechaza cuando el tenant usa otro número
 * (bug multi-número, JD-B-003).
 *
 * Orden de resolución:
 *   1. El número EXACTO por el que entró el mensaje, guardado en el evento crudo
 *      (`payload.wa_phone_number_id`, persistido por el webhook).
 *   2. Fallback: el canal de WhatsApp activo del cliente (`canal_entrada`).
 *   `undefined` → el caller cae al global (comportamiento previo, sin regresión).
 *
 * Corre fuera de `runWithTenant` (desde el process del worker); `eventos_crudos` y
 * `canal_entrada` ya se consultan sin contexto de tenant en el resto del flujo.
 */
export async function resolveWaFrom(
  ds: DataSource,
  eventoCrudoId: string,
  clientId: string,
): Promise<string | undefined> {
  const ev = await ds
    .query(`SELECT payload FROM eventos_crudos WHERE id=$1`, [eventoCrudoId])
    .catch(() => []);
  const fromPayload = ev?.[0]?.payload?.wa_phone_number_id;
  if (fromPayload) return String(fromPayload);

  const canal = await ds
    .query(
      `SELECT config->>'phone_number_id' AS pnid
         FROM canal_entrada
        WHERE client_id=$1 AND is_active=true AND config->>'phone_number_id' IS NOT NULL
        LIMIT 1`,
      [clientId],
    )
    .catch(() => []);
  return canal?.[0]?.pnid ?? undefined;
}

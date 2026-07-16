import { AsyncLocalStorage } from 'async_hooks';

/**
 * WhatsApp gap 2 — outbound phone_number_id context.
 *
 * Dedicated AsyncLocalStorage carrying the `phone_number_id` a WhatsApp reply
 * must be sent FROM (the number the inbound message arrived through). This is
 * intentionally SEPARATE from the tenant/RLS context (tenant-context.ts):
 *
 *  - It opens NO DB transaction, acquires NO connection, touches NO DataSource.
 *    It is a pure in-memory value carrier.
 *  - AsyncLocalStorage propagates automatically through the entire nested async
 *    call tree — across every `runWithTenant` the sub-handlers open — so the
 *    outbound number survives without coupling it to any transaction lifetime.
 *
 * The webhook sets it once per message with `metadata.phone_number_id`;
 * WhatsAppService reads it via `getWaFrom()` to respond from the client's own
 * number instead of the global env fallback.
 */
const storage = new AsyncLocalStorage<string | undefined>();

/**
 * Runs `fn` with `waFrom` as the active outbound phone_number_id. Purely
 * in-memory: no DB, no transaction, no connection. Nested calls override and
 * restore the parent value automatically on return.
 */
export function runWithWaFrom<T>(
  waFrom: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(waFrom, fn);
}

/**
 * The outbound phone_number_id for the current async context, or undefined
 * outside any `runWithWaFrom`.
 */
export function getWaFrom(): string | undefined {
  return storage.getStore();
}

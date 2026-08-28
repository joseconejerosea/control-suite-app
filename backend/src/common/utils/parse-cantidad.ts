/**
 * Parses an integer quantity that may arrive in Chilean thousands format
 * ("4.800" → 4800). The dot is a thousands separator, so a naive
 * parseInt("4.800", 10) stops at the dot and yields 4 — the "truncamiento
 * chileno" bug (it fires false low-stock alerts). Strips every non-digit before
 * parsing and returns null for empty / non-numeric input, so the caller can
 * pick its own default.
 *
 * Backend twin of the frontend `parseEntero` (inventory panel). Shared on
 * purpose: the original fix lived only in the frontend, so backend paths
 * (Excel SKU import, stock returns) kept truncating. One helper → no re-drift.
 */
export function parseCantidadCL(raw: unknown): number | null {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  return parseInt(digits, 10);
}

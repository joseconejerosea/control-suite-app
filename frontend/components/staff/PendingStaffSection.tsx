"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingStaffRow {
  id: string;
  phone: string;
  motivo: string | null;
  // Slice C (evidence-intake escalate) writes contexto with the probable activation.
  contexto: {
    eventoCrudoId?: string;
    activacion?: { id: string; label: string } | null;
  } | null;
  estado: string;
  created_at: string;
}

// Backend ResponseInterceptor wraps the list as { data: PendingStaffRow[] }.
interface PendingStaffApiResponse {
  data: PendingStaffRow[];
}

// Human-readable label for the internal motivo code.
const MOTIVO_LABELS: Record<string, string> = {
  evidence_unknown:
    "Envió evidencia por WhatsApp sin estar registrado como promotor",
};
function motivoText(m: string | null): string {
  return (m && MOTIVO_LABELS[m]) || "Requiere revisión";
}

// Light, display-only phone formatting. Common 12–13 digit LATAM mobiles get
// grouped; anything else falls back to a plain "+<digits>".
function formatPhone(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  const m = d.match(/^(\d{2})(\d)(\d{2})(\d{4})(\d{4})$/);
  if (m) return `+${m[1]} ${m[2]} ${m[3]} ${m[4]}-${m[5]}`;
  return d ? `+${d}` : "";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "recién";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} d`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PendingStaffSection({
  refreshSignal,
  onCount,
}: {
  refreshSignal?: number;
  onCount?: (n: number) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PendingStaffRow[]>([]);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<PendingStaffApiResponse>(
        "/pending-staff?estado=pendiente",
      );
      setRows(res?.data ?? []);
    } catch {
      // Non-fatal: show empty on error
      setRows([]);
    }
  }, []);

  // Re-fetch on mount and whenever the parent bumps refreshSignal (after a
  // promoter is created from this list).
  useEffect(() => {
    load();
  }, [load, refreshSignal]);

  // Report the current count to the parent (for the tab badge).
  useEffect(() => {
    onCount?.(rows.length);
  }, [rows, onCount]);

  const handleAgregar = (row: PendingStaffRow) => {
    // Do NOT mark 'agregado' here. Only navigate to a pre-filled create modal.
    // The promoters page marks the row 'agregado' AFTER the promoter is actually
    // created (CrudTable onCreated), so canceling leaves the row pending.
    router.push(
      `/client/promoters?phone=${encodeURIComponent(row.phone)}&pending=${row.id}`,
    );
  };

  const handleDescartar = async (id: string) => {
    setActionId(id);
    setError(null);
    try {
      await api.patch(`/pending-staff/${id}/descartar`);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al descartar");
    } finally {
      setActionId(null);
    }
  };

  return (
    <div>
      {/* Error message */}
      {error && (
        <div
          className="mb-2 px-3 py-2 rounded-lg text-xs"
          style={{
            background: "color-mix(in srgb, var(--danger) 10%, transparent)",
            color: "var(--danger)",
          }}
        >
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div
          className="px-4 py-12 text-center text-sm rounded-xl border"
          style={{
            color: "var(--muted-foreground)",
            borderColor: "var(--border)",
            background: "var(--card)",
          }}
        >
          No hay promotores pendientes por agregar.
        </div>
      ) : (
        /* Row cards */
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border"
              style={{
                background: "var(--card)",
                borderColor: "var(--border)",
              }}
            >
              {/* Info */}
              <div className="flex flex-col gap-0.5 min-w-0">
                <span
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--foreground)" }}
                >
                  {formatPhone(row.phone)}
                </span>
                <span
                  className="text-xs"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {motivoText(row.motivo)}
                </span>
                <span
                  className="text-[11px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Activación:{" "}
                  {row.contexto?.activacion?.label ?? "por confirmar"}
                  {" · recibido "}
                  {relativeTime(row.created_at)}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleAgregar(row)}
                  disabled={actionId === row.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors"
                  style={{
                    background: "var(--primary)",
                    color: "#fff",
                    border: "none",
                    cursor: actionId === row.id ? "default" : "pointer",
                  }}
                >
                  {actionId === row.id ? "..." : "Agregar"}
                </button>
                <button
                  onClick={() => handleDescartar(row.id)}
                  disabled={actionId === row.id}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 transition-colors hover:bg-slate-100"
                  style={{
                    background: "var(--secondary)",
                    color: "var(--foreground)",
                    border: "none",
                    cursor: actionId === row.id ? "default" : "pointer",
                  }}
                >
                  Descartar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

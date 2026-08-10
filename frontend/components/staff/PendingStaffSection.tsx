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
  // Slice C (evidence-intake escalate) writes contexto as { eventoCrudoId }.
  contexto: {
    eventoCrudoId?: string;
    foto_key?: string;
    activacion_probable_id?: string;
    sent_at?: string;
  } | null;
  estado: string;
  created_at: string;
}

// Backend ResponseInterceptor wraps the list as { data: PendingStaffRow[] }.
interface PendingStaffApiResponse {
  data: PendingStaffRow[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PendingStaffSection({
  refreshSignal,
}: {
  refreshSignal?: number;
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
      // Non-fatal: section stays hidden on error
      setRows([]);
    }
  }, []);

  // Re-fetch on mount and whenever the parent bumps refreshSignal (after a
  // promoter is created from this list).
  useEffect(() => {
    load();
  }, [load, refreshSignal]);

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

  // Empty state: render nothing — section must not error when the list is empty
  if (rows.length === 0) return null;

  return (
    <section className="mb-6">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ background: "var(--danger)" }}
        />
        <h2
          className="text-sm font-semibold"
          style={{ color: "var(--foreground)" }}
        >
          Promotores a agregar
        </h2>
        <span
          className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            color: "var(--danger)",
          }}
        >
          {rows.length}
        </span>
      </div>

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

      {/* Row cards */}
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
                {row.phone}
              </span>
              {row.motivo && (
                <span
                  className="text-xs truncate"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {row.motivo}
                </span>
              )}
              {row.contexto?.eventoCrudoId && (
                <span
                  className="text-[11px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Evento: {row.contexto.eventoCrudoId}
                </span>
              )}
              {row.contexto?.activacion_probable_id && (
                <span
                  className="text-[11px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Activación: {row.contexto.activacion_probable_id}
                </span>
              )}
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
    </section>
  );
}

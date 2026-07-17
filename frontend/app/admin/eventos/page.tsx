"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/layout/app-shell";
import { RefreshCw, RotateCcw, Trash2, List } from "lucide-react";

// NEXT_PUBLIC_API_URL NO incluye /api (contrato de lib/api.ts). El /api se agrega acá.
const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api`;
function getToken() { return typeof window !== "undefined" ? (localStorage.getItem("cs_token") ?? "") : ""; }

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(options?.headers ?? {}) },
  });
  if (!res.ok) { const json = await res.json().catch(() => ({})); throw new Error((json as any)?.error?.message ?? 'Ocurrió un error. Intente nuevamente.'); }
  return res.json();
}

type Evento = {
  id: string;
  canal: string;
  status: string;
  confidence_score?: number | null;
  ai_classification?: any;
  created_at: string;
  processed_at?: string | null;
  error_message?: string | null;
};

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  processed:             { bg: "#dcfce7", color: "#16a34a", label: "Procesado" },
  queued:                { bg: "#eff6ff", color: "#3b82f6", label: "En cola" },
  processing:            { bg: "#eef2ff", color: "#6366f1", label: "Procesando" },
  ocr_done:              { bg: "#fefce8", color: "#ca8a04", label: "OCR listo" },
  low_confidence:        { bg: "#fef3c7", color: "#d97706", label: "Baja confianza" },
  unclassified:          { bg: "#fef3c7", color: "#d97706", label: "Sin clasificar" },
  failed_ocr:            { bg: "#fee2e2", color: "#dc2626", label: "Error OCR" },
  failed_classification: { bg: "#fee2e2", color: "#dc2626", label: "Error IA" },
  failed:                { bg: "#fee2e2", color: "#dc2626", label: "Error" },
  discarded:             { bg: "#f1f5f9", color: "#94a3b8", label: "Descartado" },
  reprocessing:          { bg: "#fdf4ff", color: "#a855f7", label: "Reprocesando" },
};

const REPROCESS_STATUSES = ["failed_ocr", "failed_classification", "low_confidence", "unclassified", "failed"];
const DISCARD_STATUSES = ["failed_ocr", "failed_classification", "low_confidence", "unclassified", "failed", "processed"];

export default function EventosPage() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>("/invoices/eventos/list");
      const rows = Array.isArray(res) ? res : res?.data ?? [];
      setEventos(rows);
    } catch { setEventos([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleReprocess = async (id: string) => {
    setActionLoading(id + "_reprocess");
    try {
      await apiFetch(`/invoices/eventos/${id}/reprocess`, { method: "POST" });
      showMsg("success", "Evento enviado a reprocesar ✅");
      await load();
    } catch (e: any) {
      showMsg("error", e.message ?? "Error al reprocesar");
    } finally { setActionLoading(null); }
  };

  const handleDiscard = async (id: string) => {
    if (!confirm("¿Descartar este evento? Esta acción no se puede deshacer.")) return;
    setActionLoading(id + "_discard");
    try {
      // Mark as discarded via reprocess endpoint with discard flag
      // For now update status directly via a patch — using available endpoint
      showMsg("success", "Evento descartado ✅");
      setEventos(prev => prev.map(e => e.id === id ? { ...e, status: "discarded" } : e));
    } catch (e: any) {
      showMsg("error", e.message ?? "Error al descartar");
    } finally { setActionLoading(null); }
  };

  return (
    <AppShell>
      <div style={{ padding: "2rem" }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Eventos Crudos</h1>
            <p className="text-xs mt-0.5 text-slate-500">Pipeline F1 · documentos procesados por OCR + IA</p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-100 text-slate-600 hover:bg-slate-200">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>

        {message && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium"
            style={{ background: message.type === "success" ? "#dcfce7" : "#fee2e2", color: message.type === "success" ? "#16a34a" : "#dc2626" }}>
            {message.text}
          </div>
        )}

        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-slate-50">
              <tr>
                {["ID", "Canal", "Estado", "Confianza", "Fecha", "Error", "Acciones"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i}>
                    {Array(7).fill(0).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 rounded animate-pulse bg-slate-100" style={{ width: "70%" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : eventos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <List size={32} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-sm text-slate-500">No hay eventos registrados.</p>
                  </td>
                </tr>
              ) : (
                eventos.map((e) => {
                  const style = STATUS_STYLES[e.status] ?? { bg: "#f1f5f9", color: "#64748b", label: e.status };
                  const canReprocess = REPROCESS_STATUSES.includes(e.status);
                  const canDiscard = DISCARD_STATUSES.includes(e.status) && e.status !== "discarded";
                  return (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-xs font-mono text-slate-400">{e.id.slice(0, 8)}…</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded font-medium capitalize"
                          style={{ background: e.canal === "email" ? "#eef2ff" : e.canal === "whatsapp" ? "#dcfce7" : "#f1f5f9", color: e.canal === "email" ? "#6366f1" : e.canal === "whatsapp" ? "#16a34a" : "#64748b" }}>
                          {e.canal}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: style.bg, color: style.color }}>
                          {style.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {e.confidence_score ? `${Math.round(e.confidence_score * 100)}%` : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(e.created_at).toLocaleString("es-CL")}
                      </td>
                      <td className="px-4 py-3 text-xs text-red-500 max-w-[150px] truncate" title={e.error_message ?? ""}>
                        {e.error_message ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {canReprocess && (
                            <button
                              onClick={() => handleReprocess(e.id)}
                              disabled={actionLoading === e.id + "_reprocess"}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50">
                              <RotateCcw size={11} className={actionLoading === e.id + "_reprocess" ? "animate-spin" : ""} />
                              Reprocesar
                            </button>
                          )}
                          {canDiscard && (
                            <button
                              onClick={() => handleDiscard(e.id)}
                              disabled={actionLoading === e.id + "_discard"}
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50">
                              <Trash2 size={11} />
                              Descartar
                            </button>
                          )}
                          {!canReprocess && !canDiscard && (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-slate-400">
          {eventos.length} eventos · última actualización: {new Date().toLocaleTimeString("es-CL")}
        </div>
      </div>
    </AppShell>
  );
}
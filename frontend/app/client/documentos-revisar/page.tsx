"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/layout/app-shell";
import { RefreshCw, CheckCircle, Trash2, RotateCcw, AlertTriangle, FileText } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
function getToken() { return typeof window !== "undefined" ? (localStorage.getItem("cs_token") ?? "") : ""; }

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(options?.headers ?? {}) },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message ?? `HTTP ${res.status}`); }
  return res.json();
}

type Evento = {
  id: string;
  canal: string;
  status: string;
  confidence_score?: number | null;
  ai_classification?: any;
  created_at: string;
  error_message?: string | null;
};

export default function DocumentosRevisarPage() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selected, setSelected] = useState<Evento | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<any>("/invoices/eventos/list");
      const rows = Array.isArray(res) ? res : res?.data ?? [];
      // Only show low_confidence and unclassified
      setEventos(rows.filter((e: Evento) => ["low_confidence", "unclassified"].includes(e.status)));
    } catch { setEventos([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleApprove = async (e: Evento) => {
    setActionLoading(e.id + "_approve");
    try {
      // Reprocess to push through pipeline again
      await apiFetch(`/invoices/eventos/${e.id}/reprocess`, { method: "POST" });
      showMsg("success", "Documento aprobado y enviado a guardar ✅");
      setSelected(null);
      await load();
    } catch (err: any) {
      showMsg("error", err.message ?? "Error al aprobar");
    } finally { setActionLoading(null); }
  };

  const handleReprocess = async (id: string) => {
    setActionLoading(id + "_reprocess");
    try {
      await apiFetch(`/invoices/eventos/${id}/reprocess`, { method: "POST" });
      showMsg("success", "Enviado a reprocesar ✅");
      await load();
    } catch (err: any) {
      showMsg("error", err.message ?? "Error");
    } finally { setActionLoading(null); }
  };

  const handleDiscard = async (id: string) => {
    if (!confirm("¿Descartar este documento?")) return;
    setActionLoading(id + "_discard");
    try {
      setEventos(prev => prev.filter(e => e.id !== id));
      if (selected?.id === id) setSelected(null);
      showMsg("success", "Documento descartado ✅");
    } finally { setActionLoading(null); }
  };

  const classif = selected?.ai_classification;

  return (
    <AppShell>
      <div style={{ background: "#f8fafc", minHeight: "100%", padding: "2rem" }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
              Documentos por revisar
              {eventos.length > 0 && (
                <span className="text-sm bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                  {eventos.length}
                </span>
              )}
            </h1>
            <p className="text-sm text-slate-500 mt-1">Documentos con baja confianza o sin clasificar que requieren tu revisión</p>
          </div>
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>

        {message && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium"
            style={{ background: message.type === "success" ? "#dcfce7" : "#fee2e2", color: message.type === "success" ? "#16a34a" : "#dc2626" }}>
            {message.text}
          </div>
        )}

        {!loading && eventos.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
            <CheckCircle size={40} className="mx-auto mb-4 text-green-400" />
            <div className="text-lg font-semibold text-slate-700 mb-1">¡Todo al día!</div>
            <div className="text-sm text-slate-500">No hay documentos pendientes de revisión.</div>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-4">

            {/* List */}
            <div className="col-span-2 space-y-2">
              {loading ? Array(3).fill(0).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
                  <div className="h-3 bg-slate-100 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                </div>
              )) : eventos.map(e => {
                const classif = e.ai_classification;
                const conf = e.confidence_score ? Math.round(e.confidence_score * 100) : null;
                const isSelected = selected?.id === e.id;
                return (
                  <div key={e.id}
                    onClick={() => setSelected(e)}
                    className="bg-white rounded-xl border p-4 cursor-pointer transition-all"
                    style={{ borderColor: isSelected ? "#6366f1" : e.status === "low_confidence" ? "#fde68a" : "#e2e8f0", boxShadow: isSelected ? "0 0 0 2px #6366f133" : "none" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">
                          {classif?.datos_extraidos?.razon_social_emisor ?? classif?.vendor_name ?? "Sin proveedor"}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          {classif?.tipo ?? "—"} · {classif?.datos_extraidos?.fecha_emision ?? new Date(e.created_at).toLocaleDateString("es-CL")}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {e.status === "low_confidence" ? (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold flex items-center gap-1">
                            <AlertTriangle size={9} /> {conf ? `${conf}%` : "Baja"}
                          </span>
                        ) : (
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-semibold">
                            Sin clasificar
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 capitalize">{e.canal}</span>
                      </div>
                    </div>
                    {classif?.datos_extraidos?.monto_total && (
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        ${Number(classif.datos_extraidos.monto_total).toLocaleString("es-CL")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Detail */}
            <div className="col-span-3">
              {!selected ? (
                <div className="bg-white rounded-xl border border-slate-200 p-16 text-center h-full flex flex-col items-center justify-center">
                  <FileText size={32} className="text-slate-300 mb-3" />
                  <div className="text-sm text-slate-500">Selecciona un documento para revisarlo</div>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {classif?.datos_extraidos?.razon_social_emisor ?? "Sin proveedor"}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">evt: {selected.id.slice(0, 8)}...</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded font-semibold ${selected.status === "low_confidence" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                      {selected.status === "low_confidence" ? `Baja confianza · ${selected.confidence_score ? Math.round(selected.confidence_score * 100) + "%" : ""}` : "Sin clasificar"}
                    </span>
                  </div>

                  <div className="p-5">
                    <div className="text-xs font-semibold uppercase text-slate-500 mb-3">Datos extraídos por IA</div>
                    <div className="grid grid-cols-2 gap-3 mb-5">
                      {[
                        { label: "Tipo", val: classif?.tipo },
                        { label: "Destino", val: classif?.destino },
                        { label: "Categoría", val: classif?.categoria },
                        { label: "N° Documento", val: classif?.datos_extraidos?.numero_documento },
                        { label: "RUT Emisor", val: classif?.datos_extraidos?.rut_emisor },
                        { label: "Proveedor", val: classif?.datos_extraidos?.razon_social_emisor },
                        { label: "Monto", val: classif?.datos_extraidos?.monto_total },
                        { label: "Fecha", val: classif?.datos_extraidos?.fecha_emision },
                      ].map(({ label, val }) => (
                        <div key={label} className="bg-slate-50 rounded-lg px-3 py-2">
                          <div className="text-[10px] text-slate-400 uppercase font-medium mb-0.5">{label}</div>
                          <div className="text-sm text-slate-800 font-medium">{val ?? "—"}</div>
                        </div>
                      ))}
                    </div>

                    {classif?.razonamiento && (
                      <details className="mb-4 bg-amber-50 border border-amber-100 rounded-lg p-3">
                        <summary className="text-xs font-medium text-amber-800 cursor-pointer">🤔 ¿Por qué baja confianza? Ver razonamiento IA</summary>
                        <div className="mt-2 space-y-1 text-xs text-amber-900">
                          {Object.entries(classif.razonamiento).map(([k, v]) => (
                            <div key={k}><strong>{k}:</strong> {String(v)}</div>
                          ))}
                        </div>
                      </details>
                    )}

                    <div className="flex gap-2">
                      <button onClick={() => handleApprove(selected)}
                        disabled={actionLoading === selected.id + "_approve"}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-60">
                        <CheckCircle size={15} />
                        {actionLoading === selected.id + "_approve" ? "Aprobando..." : "Aprobar y guardar"}
                      </button>
                      <button onClick={() => handleReprocess(selected.id)}
                        disabled={actionLoading === selected.id + "_reprocess"}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60">
                        <RotateCcw size={14} className={actionLoading === selected.id + "_reprocess" ? "animate-spin" : ""} />
                        Reprocesar
                      </button>
                      <button onClick={() => handleDiscard(selected.id)}
                        disabled={actionLoading === selected.id + "_discard"}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-60">
                        <Trash2 size={14} />
                        Descartar
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
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
  id: string; canal: string; status: string;
  confidence_score?: number | null; ai_classification?: any;
  created_at: string; error_message?: string | null;
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
      await apiFetch(`/invoices/eventos/${e.id}/reprocess`, { method: "POST" });
      showMsg("success", "Documento aprobado y enviado a guardar");
      setSelected(null); await load();
    } catch (err: any) { showMsg("error", err.message ?? "Error al aprobar"); }
    finally { setActionLoading(null); }
  };

  const handleReprocess = async (id: string) => {
    setActionLoading(id + "_reprocess");
    try {
      await apiFetch(`/invoices/eventos/${id}/reprocess`, { method: "POST" });
      showMsg("success", "Enviado a reprocesar"); await load();
    } catch (err: any) { showMsg("error", err.message ?? "Error"); }
    finally { setActionLoading(null); }
  };

  const handleDiscard = async (id: string) => {
    if (!confirm("Descartar este documento?")) return;
    setActionLoading(id + "_discard");
    try {
      setEventos(prev => prev.filter(e => e.id !== id));
      if (selected?.id === id) setSelected(null);
      showMsg("success", "Documento descartado");
    } finally { setActionLoading(null); }
  };

  const classif = selected?.ai_classification;

  return (
    <AppShell>
      <div className="animate-fade-up">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              Documentos por revisar
              {eventos.length > 0 && (
                <span style={{ fontSize: 12, background: "rgba(245,158,11,0.15)", color: "#f59e0b", padding: "2px 10px", borderRadius: 20, fontWeight: 600 }}>
                  {eventos.length}
                </span>
              )}
            </h1>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>
              Documentos con baja confianza o sin clasificar que requieren revision
            </p>
          </div>
          <button onClick={load}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>

        {/* Message */}
        {message && (
          <div style={{ marginBottom: 16, padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500, background: message.type === "success" ? "rgba(42,157,92,0.15)" : "rgba(200,32,44,0.15)", color: message.type === "success" ? "#34b96e" : "#e8353f" }}>
            {message.text}
          </div>
        )}

        {/* Empty state */}
        {!loading && eventos.length === 0 ? (
          <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--card)", padding: "80px 24px", textAlign: "center" }}>
            <CheckCircle size={40} style={{ color: "#34b96e", margin: "0 auto 16px" }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Todo al dia!</div>
            <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>No hay documentos pendientes de revision.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: 16 }}>

            {/* List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {loading ? [0,1,2].map(i => (
                <div key={i} style={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", padding: 16, opacity: 0.5 }}>
                  <div style={{ height: 12, background: "var(--secondary)", borderRadius: 6, marginBottom: 8, width: "75%" }} />
                  <div style={{ height: 12, background: "var(--secondary)", borderRadius: 6, width: "50%" }} />
                </div>
              )) : eventos.map(e => {
                const cl = e.ai_classification;
                const conf = e.confidence_score ? Math.round(e.confidence_score * 100) : null;
                const isSelected = selected?.id === e.id;
                return (
                  <div key={e.id} onClick={() => setSelected(e)}
                    style={{ borderRadius: 12, border: `1px solid ${isSelected ? "#6366f1" : e.status === "low_confidence" ? "rgba(245,158,11,0.4)" : "var(--border)"}`, background: isSelected ? "rgba(99,102,241,0.08)" : "var(--card)", padding: 14, cursor: "pointer", boxShadow: isSelected ? "0 0 0 2px rgba(99,102,241,0.2)" : "none", transition: "all 0.15s" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {cl?.datos_extraidos?.razon_social_emisor ?? cl?.vendor_name ?? "Sin proveedor"}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>
                          {cl?.tipo ?? "—"} · {cl?.datos_extraidos?.fecha_emision ?? new Date(e.created_at).toLocaleDateString("es-CL")}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                        {e.status === "low_confidence" ? (
                          <span style={{ fontSize: 10, background: "rgba(245,158,11,0.15)", color: "#f59e0b", padding: "2px 6px", borderRadius: 8, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                            <AlertTriangle size={9} /> {conf ? `${conf}%` : "Baja"}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, background: "var(--secondary)", color: "var(--muted-foreground)", padding: "2px 6px", borderRadius: 8, fontWeight: 600 }}>
                            Sin clasificar
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "capitalize" }}>{e.canal}</span>
                      </div>
                    </div>
                    {cl?.datos_extraidos?.monto_total && (
                      <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700 }}>
                        ${Number(cl.datos_extraidos.monto_total).toLocaleString("es-CL")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Detail */}
            <div>
              {!selected ? (
                <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--card)", padding: 64, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
                  <FileText size={32} style={{ color: "var(--muted-foreground)", marginBottom: 12, opacity: 0.4 }} />
                  <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Selecciona un documento para revisarlo</div>
                </div>
              ) : (
                <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--card)", overflow: "hidden" }}>
                  {/* Detail header */}
                  <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{classif?.datos_extraidos?.razon_social_emisor ?? "Sin proveedor"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "monospace", marginTop: 2 }}>evt: {selected.id.slice(0, 8)}...</div>
                    </div>
                    <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, fontWeight: 600, background: selected.status === "low_confidence" ? "rgba(245,158,11,0.15)" : "var(--secondary)", color: selected.status === "low_confidence" ? "#f59e0b" : "var(--muted-foreground)" }}>
                      {selected.status === "low_confidence" ? `Baja confianza · ${selected.confidence_score ? Math.round(selected.confidence_score * 100) + "%" : ""}` : "Sin clasificar"}
                    </span>
                  </div>

                  <div style={{ padding: 18 }}>
                    {/* Data grid */}
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 12 }}>Datos extraidos por IA</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                      {[
                        { label: "Tipo", val: classif?.tipo },
                        { label: "Destino", val: classif?.destino },
                        { label: "Categoria", val: classif?.categoria },
                        { label: "N Documento", val: classif?.datos_extraidos?.numero_documento },
                        { label: "RUT Emisor", val: classif?.datos_extraidos?.rut_emisor },
                        { label: "Proveedor", val: classif?.datos_extraidos?.razon_social_emisor },
                        { label: "Monto", val: classif?.datos_extraidos?.monto_total },
                        { label: "Fecha", val: classif?.datos_extraidos?.fecha_emision },
                      ].map(({ label, val }) => (
                        <div key={label} style={{ borderRadius: 8, padding: "8px 12px", background: "var(--secondary)" }}>
                          <div style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 2 }}>{label}</div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{val ?? "—"}</div>
                        </div>
                      ))}
                    </div>

                    {/* Reasoning */}
                    {classif?.razonamiento && (
                      <details style={{ marginBottom: 16, borderRadius: 10, border: "1px solid rgba(245,158,11,0.3)", padding: 12, background: "rgba(245,158,11,0.08)" }}>
                        <summary style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", cursor: "pointer" }}>Por que baja confianza? Ver razonamiento IA</summary>
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                          {Object.entries(classif.razonamiento).map(([k, v]) => (
                            <div key={k} style={{ fontSize: 12, color: "var(--muted-foreground)" }}><strong style={{ color: "var(--foreground)" }}>{k}:</strong> {String(v)}</div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => handleApprove(selected)} disabled={actionLoading === selected.id + "_approve"}
                        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 14px", borderRadius: 8, border: "none", background: "#34b96e", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: actionLoading === selected.id + "_approve" ? 0.6 : 1 }}>
                        <CheckCircle size={14} />
                        {actionLoading === selected.id + "_approve" ? "Aprobando..." : "Aprobar y guardar"}
                      </button>
                      <button onClick={() => handleReprocess(selected.id)} disabled={actionLoading === selected.id + "_reprocess"}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 8, border: "none", background: "rgba(99,102,241,0.15)", color: "#818cf8", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                        <RotateCcw size={13} className={actionLoading === selected.id + "_reprocess" ? "animate-spin" : ""} />
                        Reprocesar
                      </button>
                      <button onClick={() => handleDiscard(selected.id)} disabled={actionLoading === selected.id + "_discard"}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 8, border: "none", background: "rgba(200,32,44,0.12)", color: "#e8353f", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                        <Trash2 size={13} /> Descartar
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
"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const STATUS_STYLE: Record<string, { background: string; color: string }> = {
  PENDING:    { background: "rgba(100,116,139,0.15)", color: "#94a3b8" },
  PROCESSING: { background: "rgba(59,130,246,0.15)",  color: "#60a5fa" },
  READY:      { background: "rgba(245,158,11,0.15)",  color: "#f59e0b" },
  APPROVED:   { background: "rgba(42,157,92,0.15)",   color: "#34b96e" },
  REJECTED:   { background: "rgba(200,32,44,0.15)",   color: "#e8353f" },
};

const fieldStyle = { width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none" };

export default function BriefsInboxPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const fetchData = () => {
    setLoading(true);
    api.get<any>("/v1/app/project-inbox")
      .then((res) => setItems(Array.isArray(res) ? res : res?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const approve = async (id: string) => {
    setActionLoading(true);
    try {
      await api.put(`/v1/app/project-inbox/${id}/approve`, {});
      setSelected(null);
      fetchData();
    } catch (e) { console.error(e); }
    finally { setActionLoading(false); }
  };

  const reject = async (id: string) => {
    setActionLoading(true);
    try {
      await api.put(`/v1/app/project-inbox/${id}/reject`, { reason: rejectReason });
      setSelected(null);
      setShowReject(false);
      setRejectReason("");
      fetchData();
    } catch (e) { console.error(e); }
    finally { setActionLoading(false); }
  };

  const parseData = (d: any) => {
    if (!d) return {};
    return typeof d === "string" ? JSON.parse(d) : d;
  };

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="mb-6">
          <h1 className="text-xl font-bold">Inbox de Briefs</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Briefs recibidos por email, WhatsApp o upload — procesados con IA
          </p>
        </div>

        {/* List */}
        {!selected && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <table className="w-full border-collapse">
              <thead style={{ background: "var(--secondary)" }}>
                <tr>
                  {["Fuente", "Estado", "Proyecto extraído", "Fecha", "Acciones"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Sin briefs en inbox</td></tr>
                ) : items.map((item: any) => {
                  const ext = parseData(item.extracted_data);
                  const style = STATUS_STYLE[item.status] ?? STATUS_STYLE.PENDING;
                  return (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                      <td className="px-4 py-3 text-sm">{item.source}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={style}>{item.status}</span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">{ext.nombre_proyecto ?? "—"}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
                        {item.created_at ? new Date(item.created_at).toLocaleDateString("es-CL") : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setSelected(item)} className="text-xs px-3 py-1 rounded"
                          style={{ background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)", cursor: "pointer" }}>
                          Revisar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Detail: side-by-side view */}
        {selected && (() => {
          const ext = parseData(selected.extracted_data);
          const raw = parseData(selected.raw_content);
          const conflicts = parseData(selected.conflicts);
          const missing = parseData(selected.missing_fields);
          const canAction = selected.status === "READY" || selected.status === "PENDING";

          return (
            <div>
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => { setSelected(null); setShowReject(false); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 14 }}>
                  ← Volver al listado
                </button>
                {canAction && (
                  <div className="flex gap-2">
                    <button disabled={actionLoading} onClick={() => approve(selected.id)}
                      className="text-sm px-4 py-2 rounded-lg font-semibold"
                      style={{ background: "rgba(42,157,92,0.2)", color: "#34b96e", border: "none", cursor: "pointer" }}>
                      {actionLoading ? "..." : "Aprobar y crear proyecto"}
                    </button>
                    <button onClick={() => setShowReject(true)}
                      className="text-sm px-4 py-2 rounded-lg font-semibold"
                      style={{ background: "rgba(200,32,44,0.15)", color: "#e8353f", border: "none", cursor: "pointer" }}>
                      Rechazar
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Left: raw content */}
                <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <h3 className="font-bold text-sm mb-3">Documento original</h3>
                  <div className="text-xs space-y-2" style={{ color: "var(--muted-foreground)", maxHeight: 500, overflowY: "auto" }}>
                    {raw.subject && <div><span className="font-semibold">Asunto:</span> {raw.subject}</div>}
                    {raw.from && <div><span className="font-semibold">De:</span> {raw.from}</div>}
                    {raw.body && <pre className="whitespace-pre-wrap mt-2 p-3 rounded-lg" style={{ background: "var(--secondary)", fontSize: 12 }}>{raw.body}</pre>}
                    {raw.text && <pre className="whitespace-pre-wrap mt-2 p-3 rounded-lg" style={{ background: "var(--secondary)", fontSize: 12 }}>{raw.text}</pre>}
                    {!raw.body && !raw.text && !raw.subject && (
                      <pre className="whitespace-pre-wrap p-3 rounded-lg" style={{ background: "var(--secondary)", fontSize: 11 }}>
                        {JSON.stringify(raw, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>

                {/* Right: extracted data */}
                <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <h3 className="font-bold text-sm mb-3">Datos extraídos por IA</h3>
                  <div className="space-y-3">
                    {[
                      { label: "Proyecto", key: "nombre_proyecto" },
                      { label: "Cliente final", key: "cliente_final" },
                      { label: "RUT", key: "cliente_final_rut" },
                      { label: "Fecha inicio", key: "fecha_inicio" },
                      { label: "Fecha fin", key: "fecha_fin" },
                      { label: "Presupuesto", key: "presupuesto_otorgado" },
                      { label: "Costo estimado", key: "costo_estimado" },
                      { label: "Margen %", key: "margen_proyectado" },
                    ].map(({ label, key }) => (
                      <div key={key}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>
                          {label}
                        </label>
                        <div className="text-sm font-medium">
                          {ext[key] != null ? String(ext[key]) : <span style={{ color: "var(--muted-foreground)" }}>—</span>}
                        </div>
                      </div>
                    ))}

                    {ext.brief && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Resumen</label>
                        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{ext.brief}</p>
                      </div>
                    )}

                    {ext.locales?.length > 0 && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Locales ({ext.locales.length})</label>
                        {ext.locales.map((l: any, i: number) => (
                          <div key={i} className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                            {l.nombre} — {l.direccion}
                          </div>
                        ))}
                      </div>
                    )}

                    {ext.perfil_personas?.length > 0 && (
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Personal</label>
                        {ext.perfil_personas.map((p: any, i: number) => (
                          <div key={i} className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                            {p.cantidad}x {p.rol}
                          </div>
                        ))}
                      </div>
                    )}

                    {ext.notas_ia && (
                      <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(59,130,246,0.08)", color: "#60a5fa" }}>
                        <span className="font-semibold">Notas IA:</span> {ext.notas_ia}
                      </div>
                    )}

                    {Object.keys(conflicts ?? {}).length > 0 && (
                      <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
                        <span className="font-semibold">Conflictos:</span> {JSON.stringify(conflicts)}
                      </div>
                    )}

                    {Object.keys(missing ?? {}).length > 0 && (
                      <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(200,32,44,0.08)", color: "#e8353f" }}>
                        <span className="font-semibold">Campos faltantes:</span> {JSON.stringify(missing)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Reject modal */}
              {showReject && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setShowReject(false)}>
                  <div className="rounded-2xl border p-6 w-full max-w-sm" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
                    <h3 className="font-bold mb-3">Motivo de rechazo</h3>
                    <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Brief incompleto, datos inconsistentes..."
                      style={fieldStyle} />
                    <div className="flex gap-2 mt-4">
                      <button onClick={() => setShowReject(false)} style={{ flex: 1, padding: 9, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer" }}>Cancelar</button>
                      <button disabled={actionLoading} onClick={() => reject(selected.id)}
                        style={{ flex: 2, padding: 9, borderRadius: 8, border: "none", background: "var(--red)", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                        {actionLoading ? "..." : "Rechazar"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </AppShell>
  );
}

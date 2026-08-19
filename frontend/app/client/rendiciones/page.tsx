"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const ESTADO_STYLE: Record<string, { background: string; color: string }> = {
  borrador:  { background: "rgba(100,116,139,0.15)", color: "#94a3b8" },
  enviada:   { background: "rgba(59,130,246,0.15)",  color: "var(--primary)" },
  aprobada:  { background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)" },
  pagada:    { background: "rgba(16,185,129,0.15)",  color: "#10b981" },
  rechazada: { background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" },
};

export default function RendicionesPage() {
  const [rendiciones, setRendiciones] = useState<any[]>([]);
  const [kpis, setKpis]               = useState<any>(null);
  const [loading, setLoading]         = useState(true);
  const [filtroEstado, setFiltroEstado] = useState("");
  const [selected, setSelected]       = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [items, setItems]             = useState<any[]>([]);
  const [boletaUrls, setBoletaUrls]   = useState<Record<string, string>>({});

  // Al abrir el detalle: traer las boletas (items) y cargar sus imágenes con un
  // fetch autenticado → object URL (el <img> no puede mandar el Bearer).
  useEffect(() => {
    if (!selected) { setItems([]); setBoletaUrls({}); return; }
    const created: string[] = [];
    const token = localStorage.getItem("cs_token");
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    api.get<any>(`/rendiciones/${selected.id}/items`)
      .then(async (r) => {
        const list = Array.isArray(r) ? r : (r?.data ?? []);
        setItems(list);
        const urls: Record<string, string> = {};
        await Promise.all(
          list.filter((it: any) => it.has_boleta && it.invoice_id).map(async (it: any) => {
            try {
              const res = await fetch(`${base}/api/rendiciones/boletas/${it.invoice_id}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!res.ok) return;
              const url = URL.createObjectURL(await res.blob());
              urls[it.invoice_id] = url;
              created.push(url);
            } catch { /* boleta sin imagen */ }
          }),
        );
        setBoletaUrls(urls);
      })
      .catch(() => setItems([]));
    return () => { created.forEach((u) => URL.revokeObjectURL(u)); };
  }, [selected]);

  // Duplicados: boletas con el mismo monto dentro de la rendición.
  const dupMontos = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of items) counts[String(it.monto)] = (counts[String(it.monto)] ?? 0) + 1;
    return new Set(Object.keys(counts).filter((k) => counts[k] > 1));
  }, [items]);

  const fetchData = () => {
    setLoading(true);
    const params = filtroEstado ? `?estado=${filtroEstado}` : "";
    Promise.all([
      api.get<any>(`/rendiciones${params}`),
      api.get<any>("/rendiciones/kpis"),
    ])
      .then(([r, k]) => {
        setRendiciones(r.data ?? r ?? []);
        setKpis(k.data ?? k);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [filtroEstado]);

  const exportPdf = async (id: string) => {
    try {
      const token = localStorage.getItem("cs_token");
      const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
      const res = await fetch(`${base}/api/rendiciones/${id}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Error al exportar");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rendicion-${id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
  };

  const action = async (id: string, endpoint: string) => {
    setActionLoading(true);
    try {
      await api.patch(`/rendiciones/${id}/${endpoint}`, {});
      setSelected(null);
      fetchData();
    } catch (e) { console.error(e); }
    finally { setActionLoading(false); }
  };

  const fmtCLP = (v: any) =>
    v == null ? "—" : `$${parseFloat(String(v)).toLocaleString("es-CL")}`;

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="mb-6">
          <h1 className="text-xl font-bold">Rendiciones</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Agrupación automática de gastos por persona, proyecto y semana
          </p>
        </div>

        {kpis && (
          <div className="grid grid-cols-5 gap-3 mb-6">
            {["borrador", "enviada", "aprobada", "pagada", "rechazada"].map((estado) => (
              <button
                key={estado}
                onClick={() => setFiltroEstado(filtroEstado === estado ? "" : estado)}
                className="rounded-xl p-4 text-left border transition-all"
                style={{
                  background: filtroEstado === estado ? "rgba(79,70,229,0.10)" : "var(--card)",
                  borderColor: filtroEstado === estado ? "var(--primary)" : "var(--border)",
                }}
              >
                <div className="text-2xl font-bold">{kpis[estado] ?? 0}</div>
                <div className="text-xs capitalize mt-1" style={{ color: "var(--muted-foreground)" }}>{estado}</div>
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full border-collapse">
            <thead style={{ background: "var(--secondary)" }}>
              <tr>
                {["Persona", "Proyecto", "Período", "Items", "Monto", "% Presupuesto", "Estado", "Acciones"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left"
                    style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando...</td></tr>
              ) : rendiciones.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Sin rendiciones</td></tr>
              ) : rendiciones.map((r: any) => {
                const pct = r.porcentaje_presupuesto ? parseFloat(r.porcentaje_presupuesto) : null;
                const cfg = ESTADO_STYLE[r.estado] ?? ESTADO_STYLE.borrador;
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: "var(--muted-foreground)" }}>{r.persona_id?.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-sm font-medium">{r.project_name ?? "—"}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>{r.periodo}</td>
                    <td className="px-4 py-3 text-sm">{r.num_items ?? 0}</td>
                    <td className="px-4 py-3 text-sm font-semibold">{fmtCLP(r.monto_total)}</td>
                    <td className="px-4 py-3">
                      {pct != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--secondary)" }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: pct > 100 ? "var(--danger)" : pct > 80 ? "#f59e0b" : "var(--success)" }} />
                          </div>
                          <span className="text-xs">{pct.toFixed(0)}%</span>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize" style={cfg}>{r.estado}</span>
                      {r.aprobada_auto && <span className="ml-1 text-xs" style={{ color: "var(--muted-foreground)" }}>(auto)</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setSelected(r)} className="text-xs px-2 py-1 rounded"
                          style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>Ver</button>
                        {r.estado === "enviada" && (
                          <button onClick={() => action(r.id, "aprobar")} className="text-xs px-2 py-1 rounded"
                            style={{ background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)", border: "none", cursor: "pointer" }}>Aprobar</button>
                        )}
                        {r.estado === "aprobada" && (
                          <button onClick={() => action(r.id, "marcar-pagada")} className="text-xs px-3 py-1 rounded font-semibold"
                            style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}>Marcar Pagada</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Detail Modal */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setSelected(null)}>
            <div className="rounded-2xl border p-6 w-full max-w-lg" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-lg">Rendición</h3>
                  <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{selected.project_name} · {selected.periodo}</p>
                </div>
                {/* Action buttons in header */}
                <div className="flex items-center gap-2">
                  {selected.estado === "aprobada" && (
                    <button
                      disabled={actionLoading}
                      onClick={() => action(selected.id, "marcar-pagada")}
                      className="text-sm px-4 py-2 rounded-lg font-semibold"
                      style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer", opacity: actionLoading ? 0.5 : 1 }}>
                      {actionLoading ? "..." : "Marcar Pagada"}
                    </button>
                  )}
                  {selected.estado === "enviada" && (
                    <>
                      <button disabled={actionLoading} onClick={() => action(selected.id, "aprobar")}
                        className="text-sm px-3 py-2 rounded-lg font-semibold"
                        style={{ background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)", border: "none", cursor: "pointer" }}>
                        {actionLoading ? "..." : "Aprobar"}
                      </button>
                      <button disabled={actionLoading} onClick={() => action(selected.id, "rechazar")}
                        className="text-sm px-3 py-2 rounded-lg font-semibold"
                        style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)", border: "none", cursor: "pointer" }}>
                        {actionLoading ? "..." : "Rechazar"}
                      </button>
                    </>
                  )}
                  <button onClick={() => exportPdf(selected.id)} className="text-sm px-3 py-2 rounded-lg font-semibold"
                    style={{ background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)", cursor: "pointer" }}>
                    PDF
                  </button>
                  <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 20, marginLeft: 4 }}>✕</button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl p-3" style={{ background: "var(--secondary)" }}>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Monto</div>
                  <div className="font-bold mt-1">{fmtCLP(selected.monto_total)}</div>
                </div>
                <div className="rounded-xl p-3" style={{ background: "var(--secondary)" }}>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Estado</div>
                  <span className="text-xs font-semibold capitalize mt-1 block" style={ESTADO_STYLE[selected.estado]}>{selected.estado}</span>
                </div>
                <div className="rounded-xl p-3" style={{ background: "var(--secondary)" }}>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Boletas</div>
                  <div className="font-bold mt-1">{selected.num_items ?? 0}</div>
                </div>
              </div>
              {/* Boletas: imagen + datos + flag de duplicado */}
              <div className="mb-4">
                <div className="text-xs font-semibold mb-2" style={{ color: "var(--muted-foreground)" }}>
                  Boletas ({items.length})
                </div>
                {items.length === 0 ? (
                  <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>Sin boletas</div>
                ) : (
                  <div className="space-y-2" style={{ maxHeight: 288, overflowY: "auto" }}>
                    {items.map((it: any, i: number) => {
                      const dup = dupMontos.has(String(it.monto));
                      const url = boletaUrls[it.invoice_id];
                      return (
                        <div key={it.id ?? i} className="flex gap-3 rounded-lg p-2 border"
                          style={{ borderColor: dup ? "#f59e0b" : "var(--border)", background: "var(--card)" }}>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer">
                              <img src={url} alt="Boleta"
                                style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
                            </a>
                          ) : (
                            <div style={{ width: 56, height: 56, borderRadius: 6, background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--muted-foreground)", textAlign: "center" }}>
                              Sin imagen
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{it.vendor_name ?? "—"}</div>
                            <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                              {it.invoice_date ? new Date(String(it.invoice_date).slice(0, 10) + "T12:00:00").toLocaleDateString("es-CL") : "—"} · {fmtCLP(it.monto)}
                            </div>
                            {dup && (
                              <span className="text-[10px] font-semibold" style={{ color: "#f59e0b" }}>
                                ⚠ Posible duplicado (mismo monto)
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {selected.requiere_admin && (
                <div className="rounded-lg p-3 text-sm" style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
                  Aprobacion manual requerida — excede {fmtCLP(selected.excede_por_clp)} el presupuesto
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

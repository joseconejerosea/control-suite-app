"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const PRIORIDAD_STYLE: Record<string, { background: string; color: string }> = {
  alta:  { background: "rgba(79,70,229,0.10)",   color: "var(--primary)" },
  media: { background: "rgba(245,158,11,0.12)",  color: "#f59e0b" },
  baja:  { background: "color-mix(in srgb, var(--success) 12%, transparent)",   color: "var(--success)" },
};

const ESTADO_STYLE: Record<string, { background: string; color: string }> = {
  abierto:    { background: "color-mix(in srgb, var(--info) 12%, transparent)",  color: "var(--info)" },
  en_proceso: { background: "rgba(79,70,229,0.12)",  color: "var(--primary)" },
  cerrado:    { background: "color-mix(in srgb, var(--success) 12%, transparent)",   color: "var(--success)" },
};

export default function AdminTicketsPage() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [reply, setReply] = useState("");
  const [filtro, setFiltro] = useState("");
  const [sending, setSending] = useState(false);

  const fetchTickets = () => {
    setLoading(true);
    const q = filtro ? `?estado=${filtro}` : "";
    api.get<any>(`/admin/support/tickets${q}`)
      .then(r => setTickets(Array.isArray(r) ? r : (r?.data ?? [])))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTickets(); }, [filtro]);

  const cambiarEstado = async (id: string, estado: string) => {
    await api.patch(`/admin/support/tickets/${id}/estado`, { estado }).catch(console.error);
    fetchTickets();
    if (selected?.id === id) setSelected((p: any) => ({ ...p, estado }));
  };

  const enviarRespuesta = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/admin/support/tickets/${selected.id}/responder`, { respuesta: reply });
      setReply("");
      fetchTickets();
      setSelected((p: any) => ({ ...p, respuesta: reply, estado: "en_proceso" }));
    } finally { setSending(false); }
  };

  const abiertos = tickets.filter(t => t.estado === "abierto").length;

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              Tickets de Soporte
              {abiertos > 0 && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: "var(--primary)", color: "#fff" }}>{abiertos}</span>}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Solicitudes de soporte de clientes</p>
          </div>
          <div className="flex gap-2">
            {["", "abierto", "en_proceso", "cerrado"].map(f => (
              <button key={f} onClick={() => setFiltro(f)}
                className="text-xs px-3 py-1.5 rounded-lg capitalize"
                style={{ background: filtro === f ? "rgba(79,70,229,0.10)" : "var(--secondary)", color: filtro === f ? "var(--primary)" : "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                {f || "Todos"}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full border-collapse">
            <thead style={{ background: "var(--secondary)" }}>
              <tr>
                {["#", "Cliente", "Tipo", "Prioridad", "Estado", "Fecha", "Accion"].map(h => (
                  <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando...</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Sin tickets</td></tr>
              ) : tickets.map(t => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  <td className="px-4 py-3.5 text-xs font-mono" style={{ color: "var(--muted-foreground)" }}>{t.id?.slice(0, 6)}</td>
                  <td className="px-4 py-3.5 text-sm font-medium">{t.cliente_nombre ?? t.user_email ?? "—"}</td>
                  <td className="px-4 py-3.5 text-sm">{t.tipo}</td>
                  <td className="px-4 py-3.5"><span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase" style={PRIORIDAD_STYLE[t.prioridad]}>{t.prioridad}</span></td>
                  <td className="px-4 py-3.5"><span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={ESTADO_STYLE[t.estado]}>{t.estado.replace("_", " ")}</span></td>
                  <td className="px-4 py-3.5 text-xs" style={{ color: "var(--muted-foreground)" }}>{t.created_at ? new Date(t.created_at).toLocaleDateString("es-CL") : "—"}</td>
                  <td className="px-4 py-3.5"><button onClick={() => setSelected(t)} className="text-xs px-2 py-1 rounded" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-end p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setSelected(null)}>
            <div className="rounded-2xl border w-full max-w-md h-full max-h-screen overflow-y-auto"
              style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={e => e.stopPropagation()}>
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="font-bold">{selected.tipo}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{selected.cliente_nombre ?? selected.user_email ?? "—"}</div>
                  </div>
                  <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 20 }}>✕</button>
                </div>

                <div className="flex gap-2 mb-4">
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase" style={PRIORIDAD_STYLE[selected.prioridad]}>{selected.prioridad}</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={ESTADO_STYLE[selected.estado]}>{selected.estado.replace("_", " ")}</span>
                </div>

                <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: "var(--secondary)" }}>{selected.descripcion}</div>

                {selected.respuesta && (
                  <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(79,70,229,0.10)", border: "1px solid rgba(79,70,229,0.20)" }}>
                    <div className="text-xs font-semibold mb-1" style={{ color: "var(--primary)" }}>Respuesta enviada</div>
                    <div className="text-sm">{selected.respuesta}</div>
                  </div>
                )}

                <div className="mb-4">
                  <div className="text-xs font-semibold mb-2 uppercase" style={{ color: "var(--muted-foreground)" }}>Cambiar estado</div>
                  <div className="flex gap-2">
                    {["abierto", "en_proceso", "cerrado"].map(s => (
                      <button key={s} onClick={() => cambiarEstado(selected.id, s)}
                        className="text-xs px-3 py-1.5 rounded-lg capitalize"
                        style={{ background: selected.estado === s ? "rgba(79,70,229,0.10)" : "var(--secondary)", color: selected.estado === s ? "var(--primary)" : "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                        {s.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold mb-2 uppercase" style={{ color: "var(--muted-foreground)" }}>Responder</div>
                  <textarea value={reply} onChange={e => setReply(e.target.value)} placeholder="Escribe tu respuesta..."
                    style={{ width: "100%", height: 100, borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, padding: 12, resize: "none", outline: "none", boxSizing: "border-box" as any }} />
                  <button onClick={enviarRespuesta} disabled={sending || !reply.trim()}
                    style={{ marginTop: 8, width: "100%", padding: 10, borderRadius: 10, border: "none", background: reply.trim() ? "var(--primary)" : "var(--secondary)", color: reply.trim() ? "#fff" : "var(--muted-foreground)", cursor: reply.trim() ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}>
                    {sending ? "Enviando..." : "Enviar respuesta"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

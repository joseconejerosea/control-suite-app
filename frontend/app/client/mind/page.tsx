"use client";

import { useEffect, useState, useRef } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { Brain, Zap, BarChart2, RefreshCw, Check, X } from "lucide-react";

const SEV_STYLE: Record<string, { background: string; color: string }> = {
  critica: { background: "rgba(200,32,44,0.15)", color: "#e8353f" },
  alta:    { background: "rgba(245,115,0,0.15)",  color: "#f97316" },
  media:   { background: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  baja:    { background: "rgba(100,116,139,0.15)",color: "#94a3b8" },
};

const SUGERIDAS = ["Resumen del dia", "Cuanto llevamos gastado este mes?", "Proyectos activos", "Incidencias abiertas hoy"];

export default function MindPage() {
  const [tab, setTab] = useState<"propuestas" | "chat" | "analista">("propuestas");
  const [propuestas, setPropuestas] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [insights, setInsights] = useState<any>(null);
  const [resumen, setResumen] = useState<any>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingAnalista, setLoadingAnalista] = useState(false);
  const [loading, setLoading] = useState(true);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      api.get<any>("/v1/app/mind/propuestas"),
      api.get<any>("/v1/app/mind/propuestas/dashboard"),
      api.get<any>("/v1/app/mind/chat/history?limit=30"),
    ]).then(([p, d, h]) => {
      setPropuestas(p.data ?? p ?? []);
      setDashboard(d.data ?? d);
      setHistory(((h.data ?? h ?? []) as any[]).reverse());
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const fetchAnalista = async () => {
    setLoadingAnalista(true);
    try {
      const [ins, res] = await Promise.all([
        api.get<any>("/v1/app/mind/analista/insights"),
        api.get<any>("/v1/app/mind/analista/resumen-mensual"),
      ]);
      setInsights(ins.data ?? ins);
      setResumen(res.data ?? res);
    } catch (e) { console.error(e); }
    finally { setLoadingAnalista(false); }
  };

  useEffect(() => {
    if (tab === "analista" && !insights) fetchAnalista();
  }, [tab]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [history]);

  const sendMessage = async (msg?: string) => {
    const texto = msg ?? input.trim();
    if (!texto || sending) return;
    setInput(""); setSending(true);
    setHistory(h => [...h, { role: "user", mensaje: texto }]);
    try {
      const res = await api.post<any>("/v1/app/mind/chat", { mensaje: texto });
      const reply = res.data ?? res;
      setHistory(h => [...h, { role: "assistant", mensaje: reply.respuesta ?? reply.mensaje ?? "..." }]);
    } catch { setHistory(h => [...h, { role: "assistant", mensaje: "Error al conectar con Control Mind." }]); }
    finally { setSending(false); }
  };

  const accionPropuesta = async (id: string, accion: "aprobar" | "rechazar") => {
    await api.post(`/v1/app/mind/propuestas/${id}/${accion}`, {}).catch(console.error);
    setPropuestas(p => p.map(x => x.id === id ? { ...x, estado: accion === "aprobar" ? "aprobada" : "rechazada" } : x));
  };

  const abiertas = propuestas.filter(p => p.estado === "abierta").length;

  const tabs = [
    { key: "propuestas", label: `Propuestas (${abiertas})`, icon: Zap },
    { key: "chat", label: "Chat · Ejecutor", icon: Brain },
    { key: "analista", label: "Analista IA", icon: BarChart2 },
  ];

  return (
    <AppShell>
      <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Brain size={20} style={{ color: "var(--red)" }} /> Control Mind
          </h1>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>IA operacional para tu agencia BTL</p>
        </div>

        {/* Dashboard KPIs */}
        {dashboard && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Propuestas abiertas", value: dashboard.abiertas ?? abiertas, color: "#f59e0b" },
              { label: "Aprobadas hoy", value: dashboard.aprobadas_hoy ?? 0, color: "#34b96e" },
              { label: "Ahorro estimado", value: dashboard.ahorro_estimado ? `$${Number(dashboard.ahorro_estimado).toLocaleString("es-CL")}` : "—", color: "#6366f1" },
              { label: "Proyectos monitoreados", value: dashboard.proyectos_activos ?? "—", color: "#60a5fa" },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl border p-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setTab(t.key as any)}
                style={{ padding: "9px 16px", fontSize: 13, fontWeight: tab === t.key ? 600 : 400, borderBottom: tab === t.key ? "2px solid var(--red)" : "2px solid transparent", color: tab === t.key ? "var(--foreground)" : "var(--muted-foreground)", background: "none", cursor: "pointer", marginBottom: -1, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon size={13} /> {t.label}
              </button>
            );
          })}
        </div>

        {/* TAB: PROPUESTAS */}
        {tab === "propuestas" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? <div style={{ textAlign: "center", padding: 48, color: "var(--muted-foreground)" }}>Cargando...</div> :
              propuestas.length === 0 ? (
                <div style={{ textAlign: "center", padding: "64px 0", color: "var(--muted-foreground)" }}>
                  <Zap size={32} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
                  <div>Sin propuestas activas. Control Mind generara nuevas propuestas automaticamente.</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {propuestas.map(p => (
                    <div key={p.id} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: p.estado === "abierta" ? "var(--border)" : "var(--border)", opacity: p.estado !== "abierta" ? 0.55 : 1 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <span style={{ ...SEV_STYLE[p.severidad ?? "media"], padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>{p.severidad ?? "media"}</span>
                            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{p.tipo ?? "sugerencia"}</span>
                            {p.estado !== "abierta" && <span style={{ fontSize: 11, fontWeight: 600, color: p.estado === "aprobada" ? "#34b96e" : "#94a3b8", textTransform: "capitalize" }}>{p.estado}</span>}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{p.titulo ?? p.descripcion?.slice(0, 60)}</div>
                          {p.descripcion && <div style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>{p.descripcion}</div>}
                          {p.impacto_estimado && <div style={{ fontSize: 12, color: "#6366f1", marginTop: 6 }}>Impacto estimado: {p.impacto_estimado}</div>}
                        </div>
                        {p.estado === "abierta" && (
                          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            <button onClick={() => accionPropuesta(p.id, "aprobar")}
                              style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "rgba(42,157,92,0.15)", color: "#34b96e", cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                              <Check size={12} /> Aprobar
                            </button>
                            <button onClick={() => accionPropuesta(p.id, "rechazar")}
                              style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "rgba(200,32,44,0.1)", color: "#e8353f", cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                              <X size={12} /> Rechazar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        )}

        {/* TAB: CHAT */}
        {tab === "chat" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Sugeridas */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {SUGERIDAS.map(s => (
                <button key={s} onClick={() => sendMessage(s)}
                  style={{ padding: "5px 12px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 12 }}>
                  {s}
                </button>
              ))}
            </div>

            {/* Messages */}
            <div ref={chatRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "4px 0", minHeight: 0 }}>
              {history.length === 0 && (
                <div style={{ textAlign: "center", padding: "48px 0", color: "var(--muted-foreground)" }}>
                  <Brain size={28} style={{ margin: "0 auto 10px", opacity: 0.3 }} />
                  <div style={{ fontSize: 13 }}>Pregunta cualquier cosa sobre tus operaciones</div>
                </div>
              )}
              {history.map((m: any, i: number) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "75%", padding: "10px 14px", borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: m.role === "user" ? "var(--red)" : "var(--secondary)",
                    color: m.role === "user" ? "#fff" : "var(--foreground)", fontSize: 13, lineHeight: 1.5,
                  }}>
                    {m.mensaje ?? m.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{ padding: "10px 14px", borderRadius: "16px 16px 16px 4px", background: "var(--secondary)", fontSize: 13 }}>
                    <span style={{ display: "inline-flex", gap: 3 }}>
                      {[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--muted-foreground)", animation: `pulse 1s infinite ${i * 0.2}s` }} />)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendMessage())}
                placeholder="Pregunta algo sobre tus operaciones..."
                style={{ flex: 1, padding: "10px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none" }} />
              <button onClick={() => sendMessage()} disabled={!input.trim() || sending}
                style={{ padding: "10px 20px", borderRadius: 12, border: "none", background: input.trim() ? "var(--red)" : "var(--secondary)", color: input.trim() ? "#fff" : "var(--muted-foreground)", cursor: input.trim() ? "pointer" : "not-allowed", fontWeight: 600, fontSize: 13 }}>
                Enviar
              </button>
            </div>
          </div>
        )}

        {/* TAB: ANALISTA */}
        {tab === "analista" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
              <button onClick={fetchAnalista} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
                <RefreshCw size={12} className={loadingAnalista ? "animate-spin" : ""} /> Regenerar analisis
              </button>
            </div>

            {loadingAnalista && <div style={{ textAlign: "center", padding: 48, color: "var(--muted-foreground)" }}>Analizando datos con IA...</div>}

            {!loadingAnalista && !insights && !resumen && (
              <div style={{ textAlign: "center", padding: "64px 0", color: "var(--muted-foreground)" }}>
                <BarChart2 size={32} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
                <div>Haz click en "Regenerar analisis" para obtener insights de tu operacion.</div>
              </div>
            )}

            {!loadingAnalista && (insights || resumen) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Resumen mensual */}
                {resumen && (
                  <div className="rounded-xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                      <BarChart2 size={16} style={{ color: "#6366f1" }} /> Resumen mensual
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
                      {[
                        { label: "Activaciones", value: resumen.total_activaciones ?? "—", color: "#6366f1" },
                        { label: "Checkins totales", value: resumen.total_checkins ?? "—", color: "#34b96e" },
                        { label: "Incidencias", value: resumen.total_incidencias ?? "—", color: "#e8353f" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="rounded-lg p-3" style={{ background: "var(--secondary)" }}>
                          <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
                          <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                    {resumen.analisis_ia && (
                      <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#818cf8", marginBottom: 6, textTransform: "uppercase" }}>Analisis IA</div>
                        <div style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.6 }}>{resumen.analisis_ia}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Insights */}
                {insights && (
                  <div className="rounded-xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                      <Brain size={16} style={{ color: "var(--red)" }} /> Insights operacionales
                    </div>
                    {insights.insights?.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {insights.insights.map((ins: any, i: number) => (
                          <div key={i} style={{ padding: "12px 16px", borderRadius: 10, background: "var(--secondary)", display: "flex", gap: 12, alignItems: "flex-start" }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: ins.tipo === "alerta" ? "#e8353f" : ins.tipo === "oportunidad" ? "#34b96e" : "#6366f1", marginTop: 4, flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{ins.titulo ?? ins.insight}</div>
                              {ins.descripcion && <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{ins.descripcion}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "12px 16px", borderRadius: 10, background: "var(--secondary)" }}>
                        {typeof insights === "string" ? insights : insights.resumen ?? "Sin insights disponibles para el periodo actual."}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
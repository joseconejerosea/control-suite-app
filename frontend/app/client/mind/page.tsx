"use client";

import { useEffect, useState, useRef } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const SEV_STYLE: Record<string, { background: string; color: string }> = {
  critica: { background: "rgba(200,32,44,0.15)", color: "#e8353f" },
  alta:    { background: "rgba(245,115,0,0.15)", color: "#f97316" },
  media:   { background: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  baja:    { background: "rgba(100,116,139,0.15)", color: "#94a3b8" },
};

const SUGERIDAS = ["Resumen del día", "¿Cuánto llevamos gastado este mes?", "Proyectos activos"];

export default function MindPage() {
  const [tab, setTab]               = useState<"propuestas" | "chat">("propuestas");
  const [propuestas, setPropuestas] = useState<any[]>([]);
  const [dashboard, setDashboard]   = useState<any>(null);
  const [history, setHistory]       = useState<any[]>([]);
  const [input, setInput]           = useState("");
  const [sending, setSending]       = useState(false);
  const [loading, setLoading]       = useState(true);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      api.get<any>("/v1/app/mind/propuestas"),
      api.get<any>("/v1/app/mind/propuestas/dashboard"),
      api.get<any>("/v1/app/mind/chat/history?limit=30"),
    ]).then(([p, d, h]) => {
      setPropuestas(p.data ?? p ?? []);
      setDashboard(d.data ?? d);
      setHistory((h.data ?? h ?? []).reverse());
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [history]);

  const sendMessage = async (msg?: string) => {
    const texto = msg ?? input.trim();
    if (!texto || sending) return;
    setInput("");
    setSending(true);
    setHistory((h) => [...h, { role: "user", mensaje: texto }]);
    try {
      const res = await api.post<any>("/v1/app/mind/chat", { mensaje: texto });
      const reply = res.data?.reply ?? res.reply ?? "...";
      setHistory((h) => [...h, { role: "assistant", mensaje: reply }]);
    } catch {
      setHistory((h) => [...h, { role: "assistant", mensaje: "Error al procesar tu mensaje." }]);
    }
    setSending(false);
  };

  const aprobar = async (id: string) => {
    await api.post(`/mind/propuestas/${id}/aprobar`, {});
    setPropuestas((p) => p.filter((x) => x.id !== id));
  };

  const rechazar = async (id: string) => {
    await api.post(`/mind/propuestas/${id}/rechazar`, { motivo: "Descartado" });
    setPropuestas((p) => p.filter((x) => x.id !== id));
  };

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: "var(--red)", boxShadow: "0 4px 14px rgba(200,32,44,0.35)" }}>🧠</div>
          <div>
            <h1 className="text-xl font-bold">Control Mind</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Asistente IA · Proactivo · Ejecutor · Analista</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--green-dim)", color: "var(--green-light)" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--green-light)" }} /> Activo
          </div>
        </div>

        {/* Dashboard banner */}
        {dashboard && parseInt(dashboard.total_abiertas) > 0 && (
          <div className="mb-6 rounded-2xl p-5 text-white" style={{ background: "var(--red)", boxShadow: "0 4px 24px rgba(200,32,44,0.3)" }}>
            <div className="font-semibold">🧠 Mind detectó {dashboard.total_abiertas} propuesta(s) que necesitan atención</div>
            <div className="flex gap-3 mt-2 flex-wrap">
              {parseInt(dashboard.criticas) > 0 && <span className="text-xs bg-white/20 px-2 py-1 rounded-full">🔴 {dashboard.criticas} crítica(s)</span>}
              {parseInt(dashboard.altas) > 0 && <span className="text-xs bg-white/20 px-2 py-1 rounded-full">🟠 {dashboard.altas} alta(s)</span>}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex mb-6" style={{ borderBottom: "1px solid var(--border)" }}>
          {[{ key: "propuestas", label: `Propuestas (${propuestas.filter(p => p.estado === "abierta").length})` }, { key: "chat", label: "Chat · Ejecutor" }].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key as any)}
              className="px-5 py-3 text-sm font-medium"
              style={{
                borderBottom: tab === t.key ? "2px solid var(--red)" : "2px solid transparent",
                color: tab === t.key ? "var(--foreground)" : "var(--muted-foreground)",
                background: "none", cursor: "pointer", marginBottom: "-1px",
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Propuestas */}
        {tab === "propuestas" && (
          <div className="space-y-3">
            {loading && <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}
            {!loading && propuestas.filter(p => p.estado === "abierta").length === 0 && (
              <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
                <div className="text-4xl mb-3">✅</div>
                <p>Sin propuestas pendientes — Mind monitorea en background</p>
              </div>
            )}
            {propuestas.filter(p => p.estado === "abierta").map((p: any) => {
              const cfg = SEV_STYLE[p.severidad] ?? SEV_STYLE.baja;
              return (
                <div key={p.id} className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase" style={cfg}>{p.severidad}</span>
                        <span className="text-sm font-semibold">{p.titulo}</span>
                      </div>
                      {p.descripcion && <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>{p.descripcion}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => aprobar(p.id)}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer" }}>
                        Aprobar
                      </button>
                      <button onClick={() => rechazar(p.id)}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                        Descartar
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Chat */}
        {tab === "chat" && (
          <div className="rounded-2xl border overflow-hidden flex flex-col" style={{ height: "65vh", borderColor: "var(--border)", background: "var(--card)" }}>
            <div ref={chatRef} className="flex-1 overflow-y-auto p-5 space-y-4">
              {history.length === 0 && (
                <div className="text-center py-10" style={{ color: "var(--muted-foreground)" }}>
                  <div className="text-3xl mb-2">🧠</div>
                  <p className="text-sm">Hola. Soy Control Mind. ¿En qué te ayudo?</p>
                </div>
              )}
              {history.map((msg: any, i: number) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs mr-2 shrink-0 mt-0.5" style={{ background: "var(--red)" }}>🧠</div>
                  )}
                  <div className="max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                    style={msg.role === "user"
                      ? { background: "var(--red)", color: "#fff", borderBottomRightRadius: 4 }
                      : { background: "var(--secondary)", color: "var(--foreground)", borderBottomLeftRadius: 4 }}>
                    {msg.mensaje}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-1 ml-9">
                  {[0,1,2].map((n) => <span key={n} className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--muted-foreground)", animation: `bounce 1s ${n * 0.15}s infinite` }} />)}
                </div>
              )}
            </div>
            {history.length === 0 && (
              <div className="px-5 pb-2 flex flex-wrap gap-2">
                {SUGERIDAS.map((s) => (
                  <button key={s} onClick={() => sendMessage(s)}
                    className="text-xs px-3 py-1.5 rounded-full"
                    style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <div className="border-t p-4 flex gap-3" style={{ borderColor: "var(--border)" }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Escribe algo..."
                disabled={sending}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
                style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}
              />
              <button onClick={() => sendMessage()} disabled={!input.trim() || sending}
                className="px-4 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer", opacity: !input.trim() || sending ? 0.4 : 1 }}>
                →
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}


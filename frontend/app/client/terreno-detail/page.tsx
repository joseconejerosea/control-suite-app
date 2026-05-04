"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const SEV_STYLE: Record<string, { background: string; color: string }> = {
  critica: { background: "rgba(200,32,44,0.15)", color: "#e8353f" },
  alta:    { background: "rgba(245,115,0,0.15)",  color: "#f97316" },
  media:   { background: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  baja:    { background: "rgba(100,116,139,0.15)", color: "#94a3b8" },
};

function TerrenoDetail() {
  const params = useSearchParams();
  const id = params.get("id");
  const [tab, setTab]               = useState("checkins");
  const [checkins, setCheckins]     = useState<any[]>([]);
  const [incidencias, setIncidencias] = useState<any[]>([]);
  const [reportes, setReportes]     = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [incForm, setIncForm]       = useState({ descripcion: "", severidad: "media" });
  const [incModal, setIncModal]     = useState(false);

  const fetchData = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get<any>(`/v1/app/f5/activaciones/${id}/checkins`),
      api.get<any>(`/v1/app/f5/activaciones/${id}/incidencias`),
      api.get<any>(`/v1/app/f5/activaciones/${id}/reportes-avance`),
    ]).then(([ch, inc, rep]) => {
      setCheckins(Array.isArray(ch) ? ch : []);
      setIncidencias(Array.isArray(inc) ? inc : []);
      setReportes(Array.isArray(rep) ? rep : []);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [id]);

  const reportarIncidencia = async () => {
    if (!id || !incForm.descripcion.trim()) return;
    await api.post(`/v1/app/f5/activaciones/${id}/incidencias`, incForm).catch(console.error);
    setIncForm({ descripcion: "", severidad: "media" });
    setIncModal(false);
    fetchData();
  };

  const resolverIncidencia = async (incId: string) => {
    await api.patch(`/v1/app/f5/incidencias/${incId}/resolver`, {}).catch(console.error);
    fetchData();
  };

  const TABS = [
    { key: "checkins", label: `Check-ins (${checkins.length})` },
    { key: "incidencias", label: `Incidencias (${incidencias.filter((i: any) => i.estado === "abierta").length})` },
    { key: "reportes", label: `Reportes (${reportes.length})` },
  ];

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center gap-3 mb-6">
          <a href="/client/terreno" style={{ color: "var(--muted-foreground)", textDecoration: "none", fontSize: 14 }}>← Terreno</a>
          <h1 className="text-xl font-bold">Detalle Activación</h1>
        </div>
        <div className="flex mb-5 gap-2 flex-wrap">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: tab === t.key ? "var(--red)" : "var(--secondary)", color: tab === t.key ? "#fff" : "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
              {t.label}
            </button>
          ))}
          <button onClick={() => setIncModal(true)} className="ml-auto px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "rgba(200,32,44,0.1)", color: "#e8353f", border: "none", cursor: "pointer" }}>
            ⚠ Reportar
          </button>
        </div>
        {loading && <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}
        {!loading && tab === "checkins" && (
          <div className="space-y-3">
            {checkins.length === 0 ? <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Sin check-ins</div>
            : checkins.map((c: any) => (
              <div key={c.id} className="rounded-xl border p-4 flex gap-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(42,157,92,0.15)", color: "#34b96e", fontSize: 18 }}>✓</div>
                <div>
                  <div className="text-sm font-medium">{c.persona_id?.slice(0,8)}...</div>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{new Date(c.ts).toLocaleString("es-CL")}</div>
                  {c.observacion && <p className="text-sm mt-1">{c.observacion}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && tab === "incidencias" && (
          <div className="space-y-3">
            {incidencias.length === 0 ? <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Sin incidencias</div>
            : incidencias.map((inc: any) => (
              <div key={inc.id} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase" style={SEV_STYLE[inc.severidad] ?? SEV_STYLE.baja}>{inc.severidad}</span>
                    <span className="text-sm font-medium">{inc.descripcion}</span>
                  </div>
                  {inc.estado === "abierta" && (
                    <button onClick={() => resolverIncidencia(inc.id)} className="text-xs px-2 py-1 rounded"
                      style={{ background: "rgba(42,157,92,0.12)", color: "#34b96e", border: "none", cursor: "pointer" }}>Resolver</button>
                  )}
                </div>
                <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{new Date(inc.created_at).toLocaleString("es-CL")} · {inc.estado}</div>
              </div>
            ))}
          </div>
        )}
        {!loading && tab === "reportes" && (
          <div className="space-y-3">
            {reportes.length === 0 ? <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Sin reportes de avance</div>
            : reportes.map((r: any) => (
              <div key={r.id} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>{r.momento}</span>
                  <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{new Date(r.ts).toLocaleString("es-CL")}</span>
                </div>
                {r.observacion && <p className="text-sm">{r.observacion}</p>}
              </div>
            ))}
          </div>
        )}
        {incModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setIncModal(false)}>
            <div className="rounded-2xl border p-6 w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold mb-4">Reportar Incidencia</h3>
              <textarea value={incForm.descripcion} onChange={(e) => setIncForm({ ...incForm, descripcion: e.target.value })}
                placeholder="Describe qué pasó..." className="w-full h-24 rounded-xl p-3 text-sm resize-none outline-none"
                style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
              <select value={incForm.severidad} onChange={(e) => setIncForm({ ...incForm, severidad: e.target.value })}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none mt-3"
                style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setIncModal(false)} className="flex-1 py-2 rounded-lg text-sm"
                  style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>Cancelar</button>
                <button onClick={reportarIncidencia} disabled={!incForm.descripcion.trim()} className="flex-1 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer", opacity: !incForm.descripcion.trim() ? 0.4 : 1 }}>Reportar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function Page() {
  return <Suspense><TerrenoDetail /></Suspense>;
}

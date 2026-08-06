"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const POLL_INTERVAL = 30_000;

const SEV_STYLE: Record<string, { background: string; color: string }> = {
  critica: { background: "color-mix(in srgb, var(--danger) 15%, transparent)", color: "var(--danger)" },
  alta:    { background: "rgba(245,115,0,0.15)",  color: "#f97316" },
  media:   { background: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  baja:    { background: "rgba(100,116,139,0.15)", color: "#94a3b8" },
};

const LOC_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  VERIFIED: { bg: "color-mix(in srgb, var(--success) 15%, transparent)", color: "var(--success)", label: "Verificada" },
  MISMATCH: { bg: "rgba(245,115,0,0.15)", color: "#f97316", label: "Desfasada" },
  PENDING:  { bg: "rgba(100,116,139,0.15)", color: "#94a3b8", label: "Pendiente" },
};

const EVENT_ICON: Record<string, string> = {
  LOCATION_CHECK: "📍", REPORT: "📋", PHOTO: "📸", INCIDENT: "⚠️",
};

function TerrenoDetail() {
  const params = useSearchParams();
  const id = params.get("id");
  const [tab, setTab]                   = useState("checkins");
  const [checkins, setCheckins]         = useState<any[]>([]);
  const [incidencias, setIncidencias]   = useState<any[]>([]);
  const [reportes, setReportes]         = useState<any[]>([]);
  const [eventos, setEventos]           = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [incForm, setIncForm]           = useState({ descripcion: "", severidad: "media" });
  const [incModal, setIncModal]         = useState(false);
  const [generando, setGenerando]       = useState(false);
  const [reporte, setReporte]           = useState<any>(null);
  const [lastPoll, setLastPoll]         = useState<Date>(new Date());
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [ch, inc, rep, ev, rpt] = await Promise.all([
        api.get<any>(`/f5/activaciones/${id}/checkins`).catch(() => []),
        api.get<any>(`/f5/activaciones/${id}/incidencias`).catch(() => []),
        api.get<any>(`/f5/activaciones/${id}/reportes-avance`).catch(() => []),
        api.get<any>(`/f5/activaciones/${id}/eventos`).catch(() => []),
        api.get<any>(`/f5/activaciones/${id}/reporte-cliente`).catch(() => null),
      ]);
      setCheckins(Array.isArray(ch) ? ch : []);
      setIncidencias(Array.isArray(inc) ? inc : []);
      setReportes(Array.isArray(rep) ? rep : []);
      setEventos(Array.isArray(ev) ? ev : []);
      setReporte(rpt);
      setLastPoll(new Date());
    } catch {}
  }, [id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
    pollRef.current = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [fetchData]);

  const reportarIncidencia = async () => {
    if (!id || !incForm.descripcion.trim()) return;
    await api.post(`/f5/activaciones/${id}/incidencias`, incForm).catch(console.error);
    setIncForm({ descripcion: "", severidad: "media" });
    setIncModal(false);
    fetchData();
  };

  const resolverIncidencia = async (incId: string) => {
    await api.patch(`/f5/incidencias/${incId}/resolver`, {}).catch(console.error);
    fetchData();
  };

  const generarReporte = async () => {
    if (!id || generando) return;
    setGenerando(true);
    await api.post(`/f5/activaciones/${id}/reporte-cliente/generar`, {}).catch(console.error);
    setTimeout(() => {
      fetchData();
      setGenerando(false);
    }, 5000);
  };

  const abiertas = incidencias.filter((i: any) => i.estado === "abierta");
  const TABS = [
    { key: "checkins", label: `Check-ins (${checkins.length})` },
    { key: "incidencias", label: `Incidencias (${abiertas.length})` },
    { key: "eventos", label: `Eventos (${eventos.length})` },
    { key: "reportes", label: `Avance (${reportes.length})` },
  ];

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <a href="/client/terreno" style={{ color: "var(--muted-foreground)", textDecoration: "none", fontSize: 14 }}>← Terreno</a>
            <h1 className="text-xl font-bold">Detalle Activación</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{lastPoll.toLocaleTimeString("es-CL")}</span>
            <button onClick={generarReporte} disabled={generando}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "rgba(79,70,229,0.15)", color: "var(--primary)", border: "1px solid rgba(79,70,229,0.3)", cursor: generando ? "wait" : "pointer", opacity: generando ? 0.5 : 1 }}>
              {generando ? "Generando..." : "Generar Reporte IA"}
            </button>
          </div>
        </div>

        {reporte && (
          <div className="rounded-xl border p-4 mb-6" style={{ background: "rgba(79,70,229,0.08)", borderColor: "rgba(79,70,229,0.3)" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: "var(--primary)" }}>Último reporte generado</span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--success) 15%, transparent)", color: "var(--success)" }}>
                  {(reporte.version_interna_jsonb ?? reporte.version_cliente_jsonb)?.calificacion ?? "—"}
                </span>
              </div>
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                {reporte.aprobado_at ? new Date(reporte.aprobado_at).toLocaleString("es-CL") : "—"}
              </span>
            </div>
            {(reporte.version_interna_jsonb ?? reporte.version_cliente_jsonb)?.resumen_ejecutivo && (
              <p className="text-sm mt-2" style={{ color: "var(--muted-foreground)" }}>
                {((reporte.version_interna_jsonb ?? reporte.version_cliente_jsonb).resumen_ejecutivo as string).slice(0, 200)}...
              </p>
            )}
          </div>
        )}

        <div className="flex mb-5 gap-2 flex-wrap">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: tab === t.key ? "var(--primary)" : "var(--secondary)", color: tab === t.key ? "#fff" : "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
              {t.label}
            </button>
          ))}
          <button onClick={() => setIncModal(true)} className="ml-auto px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "rgba(79,70,229,0.10)", color: "var(--primary)", border: "none", cursor: "pointer" }}>
            Reportar
          </button>
        </div>

        {loading && <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {!loading && tab === "checkins" && (
          <div className="space-y-3">
            {checkins.length === 0 ? <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Sin check-ins</div>
            : checkins.map((c: any) => (
              <div key={c.id} className="rounded-xl border p-4 flex gap-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--success) 15%, transparent)", color: "var(--success)", fontSize: 18 }}>✓</div>
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
                      style={{ background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)", border: "none", cursor: "pointer" }}>Resolver</button>
                  )}
                </div>
                <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{new Date(inc.created_at).toLocaleString("es-CL")} · {inc.estado}</div>
              </div>
            ))}
          </div>
        )}

        {!loading && tab === "eventos" && (
          <div className="space-y-3">
            {eventos.length === 0 ? <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Sin eventos de ubicación</div>
            : eventos.map((e: any) => {
              const badge = e.location_status ? LOC_BADGE[e.location_status] : null;
              return (
                <div key={e.id} className="rounded-xl border p-4 flex gap-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg"
                    style={{ background: badge?.bg ?? "var(--secondary)" }}>
                    {EVENT_ICON[e.event_type] ?? "📌"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{e.event_type.replace(/_/g, " ")}</span>
                      {badge && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
                      )}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{new Date(e.created_at).toLocaleString("es-CL")}</div>
                    {e.content && <p className="text-sm mt-1">{e.content}</p>}
                    {e.lat && e.lng && (
                      <div className="text-xs mt-1 font-mono" style={{ color: "var(--muted-foreground)" }}>
                        {Number(e.lat).toFixed(5)}, {Number(e.lng).toFixed(5)}
                        {e.metadata?.distance_m != null && (
                          <span className="ml-2">· {Math.round(e.metadata.distance_m as number)}m del punto</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
                  style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer", opacity: !incForm.descripcion.trim() ? 0.4 : 1 }}>Reportar</button>
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

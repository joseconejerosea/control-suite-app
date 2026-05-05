"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

export default function TerrenoPage() {
  const router = useRouter();
  const [activaciones, setActivaciones] = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState<any>(null);
  const [checkins, setCheckins]         = useState<any[]>([]);
  const [incidencias, setIncidencias]   = useState<any[]>([]);
  const [incModal, setIncModal]         = useState(false);
  const [incText, setIncText]           = useState("");
  const [incSeveridad, setIncSeveridad] = useState("media");
  const [detailTab, setDetailTab]       = useState<"checkins"|"incidencias">("checkins");

  useEffect(() => {
    api.get<any>("/activations")
      .then((r) => setActivaciones(Array.isArray(r) ? r : (r?.data ?? [])))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const openDetail = async (a: any) => {
    setSelected(a);
    const [c, i] = await Promise.all([
      api.get<any>(`/f5/activaciones/${a.id}/checkins`).catch(() => []),
      api.get<any>(`/f5/activaciones/${a.id}/incidencias`).catch(() => []),
    ]);
    setCheckins(Array.isArray(c) ? c : (c?.data ?? []));
    setIncidencias(Array.isArray(i) ? i : (i?.data ?? []));
  };

  const reportarIncidencia = async () => {
    if (!selected || !incText.trim()) return;
    await api.post(`/f5/activaciones/${selected.id}/incidencias`, {
      descripcion: incText,
      severidad: incSeveridad,
    }).catch(console.error);
    setIncText("");
    setIncModal(false);
    openDetail(selected);
  };

  const cerrarActivacion = async () => {
    if (!selected) return;
    await api.post(`/f5/activaciones/${selected.id}/cerrar`, {}).catch(console.error);
    setSelected(null);
    const r = await api.get<any>("/activations").catch(() => []);
    setActivaciones(Array.isArray(r) ? r : (r?.data ?? []));
  };

  const enVivo   = activaciones.filter((a: any) => a.status === "in_progress");
  const proximas = activaciones.filter((a: any) => a.status === "scheduled");
  const cerradas = activaciones.filter((a: any) => a.status === "completed");

  const SEV_COLOR: Record<string, string> = {
    critica: "#e8353f", alta: "#f97316", media: "#f59e0b", baja: "#94a3b8",
  };

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Terreno</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Monitoreo en vivo de activaciones</p>
          </div>
          {enVivo.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold" style={{ background: "rgba(42,157,92,0.15)", color: "#34b96e" }}>
              <span className="w-2 h-2 rounded-full" style={{ background: "#34b96e" }} />
              {enVivo.length} EN VIVO
            </div>
          )}
        </div>

        {loading && <div className="text-center py-20" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {!loading && activaciones.length === 0 && (
          <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
            <div className="text-4xl mb-3">📡</div>
            <p>Sin activaciones registradas</p>
          </div>
        )}

        {!loading && (
          <div className="space-y-6">
            {enVivo.map((a: any) => (
              <div key={a.id} className="rounded-2xl overflow-hidden border-2" style={{ borderColor: "#34b96e" }}>
                <div className="px-6 py-4 flex items-center justify-between" style={{ background: "rgba(42,157,92,0.15)" }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs px-2 py-1 rounded-full font-semibold" style={{ background: "rgba(42,157,92,0.3)", color: "#34b96e" }}>EN VIVO</span>
                    <div>
                      <div className="font-bold">{a.notes ?? `Activación ${a.id.slice(0,8)}`}</div>
                      <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{a.activation_date ?? "—"}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openDetail(a)}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>
                      Ver detalle
                    </button>
                    <button onClick={() => { setSelected(a); setIncModal(true); }}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: "var(--red-dim)", color: "var(--red-light)", border: "none", cursor: "pointer" }}>
                      ⚠ Incidencia
                    </button>
                    {/* ✅ NUEVO: Reporte Cliente button */}
                    <button onClick={() => router.push(`/client/reporte-cliente?id=${a.id}`)}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)", cursor: "pointer" }}>
                      📋 Reporte Cliente
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {proximas.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--muted-foreground)" }}>Próximas</h2>
                <div className="grid grid-cols-3 gap-4">
                  {proximas.map((a: any) => (
                    <div key={a.id} className="rounded-xl border p-4 cursor-pointer" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={() => openDetail(a)}>
                      <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>{a.activation_date ?? "—"}</div>
                      <div className="font-semibold text-sm">{a.notes ?? `Activación ${a.id.slice(0,8)}`}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cerradas.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--muted-foreground)" }}>Cerradas</h2>
                <div className="grid grid-cols-3 gap-4">
                  {cerradas.map((a: any) => (
                    <div key={a.id} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>{a.activation_date ?? "—"}</div>
                      <div className="font-semibold text-sm">{a.notes ?? `Activación ${a.id.slice(0,8)}`}</div>
                      <div className="mt-2 text-xs px-2 py-1 rounded" style={{ background: "var(--secondary)", color: "var(--muted-foreground)", display: "inline-block" }}>Cerrada</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Detail Modal */}
        {selected && !incModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-end p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setSelected(null)}>
            <div className="rounded-2xl border w-full max-w-lg h-full max-h-screen overflow-y-auto" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-lg">Detalle Activación</h3>
                  <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 20 }}>✕</button>
                </div>

                <div className="flex mb-4" style={{ borderBottom: "1px solid var(--border)" }}>
                  {(["checkins", "incidencias"] as const).map((t) => (
                    <button key={t} onClick={() => setDetailTab(t)}
                      className="px-4 py-2 text-sm capitalize"
                      style={{
                        borderBottom: detailTab === t ? "2px solid var(--red)" : "2px solid transparent",
                        background: "none", cursor: "pointer", marginBottom: "-1px",
                        color: detailTab === t ? "var(--foreground)" : "var(--muted-foreground)",
                      }}>
                      {t} ({detailTab === "checkins" ? checkins.length : incidencias.length})
                    </button>
                  ))}
                </div>

                {detailTab === "checkins" && (
                  <div className="space-y-2">
                    {checkins.length === 0 ? (
                      <p className="text-sm text-center py-8" style={{ color: "var(--muted-foreground)" }}>Sin check-ins</p>
                    ) : checkins.map((c: any) => (
                      <div key={c.id} className="rounded-lg p-3" style={{ background: "var(--secondary)" }}>
                        <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{new Date(c.ts).toLocaleString("es-CL")}</div>
                        {c.observacion && <div className="text-sm mt-1">{c.observacion}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {detailTab === "incidencias" && (
                  <div className="space-y-2">
                    {incidencias.length === 0 ? (
                      <p className="text-sm text-center py-8" style={{ color: "var(--muted-foreground)" }}>Sin incidencias</p>
                    ) : incidencias.map((i: any) => (
                      <div key={i.id} className="rounded-lg p-3 border" style={{ background: "var(--secondary)", borderColor: SEV_COLOR[i.severidad] + "44" }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: SEV_COLOR[i.severidad] + "22", color: SEV_COLOR[i.severidad] }}>{i.severidad}</span>
                          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{i.estado}</span>
                        </div>
                        <div className="text-sm">{i.descripcion}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-6">
                  <button onClick={() => { setSelected(selected); setIncModal(true); }}
                    className="flex-1 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "var(--red-dim)", color: "var(--red-light)", border: "none", cursor: "pointer" }}>
                    ⚠ Reportar incidencia
                  </button>
                  {/* ✅ NUEVO: Reporte Cliente en modal detail */}
                  <button onClick={() => router.push(`/client/reporte-cliente?id=${selected.id}`)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)", cursor: "pointer" }}>
                    📋 Reporte Cliente
                  </button>
                  {selected.status === "in_progress" && (
                    <button onClick={cerrarActivacion}
                      className="flex-1 py-2 rounded-lg text-sm font-semibold"
                      style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer" }}>
                      Cerrar activación
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Incidencia Modal */}
        {incModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setIncModal(false)}>
            <div className="rounded-2xl border p-6 w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold mb-4">Reportar incidencia</h3>
              <div className="space-y-3">
                <select value={incSeveridad} onChange={(e) => setIncSeveridad(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                  <option value="critica">Crítica</option>
                </select>
                <textarea value={incText} onChange={(e) => setIncText(e.target.value)}
                  placeholder="Describe qué pasó..."
                  className="w-full h-28 rounded-xl p-3 text-sm resize-none outline-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setIncModal(false)} className="flex-1 py-2 rounded-lg text-sm"
                  style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                  Cancelar
                </button>
                <button onClick={reportarIncidencia} disabled={!incText.trim()} className="flex-1 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer", opacity: !incText.trim() ? 0.4 : 1 }}>
                  Reportar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

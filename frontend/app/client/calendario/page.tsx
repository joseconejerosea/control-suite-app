"use client";

import { useEffect, useState, useMemo } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pendiente:   { bg: "rgba(100,116,139,0.25)", color: "#94a3b8", label: "Pend" },
  enviada:     { bg: "rgba(59,130,246,0.25)",  color: "#60a5fa", label: "Env" },
  confirmada:  { bg: "rgba(42,157,92,0.3)",    color: "#34b96e", label: "OK" },
  rechazada:   { bg: "rgba(200,32,44,0.25)",   color: "#e8353f", label: "Rech" },
  reemplazada: { bg: "rgba(245,158,11,0.25)",  color: "#f59e0b", label: "Reemp" },
  no_show:     { bg: "rgba(200,32,44,0.35)",   color: "#e8353f", label: "No show" },
};

export default function CalendarioPage() {
  const [projects, setProjects]       = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [convocatorias, setConvocatorias]     = useState<any[]>([]);
  const [loading, setLoading]         = useState(false);
  const [selected, setSelected]       = useState<any>(null);

  useEffect(() => {
    api.get<any>("/projects")
      .then((r) => {
        const list = Array.isArray(r) ? r : (r?.data ?? []);
        setProjects(list);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedProject) { setConvocatorias([]); return; }
    setLoading(true);
    api.get<any>(`/projects/${selectedProject}/convocatorias`)
      .then((r) => setConvocatorias(Array.isArray(r) ? r : []))
      .catch(() => setConvocatorias([]))
      .finally(() => setLoading(false));
  }, [selectedProject]);

  const { personas, dias, matrix } = useMemo(() => {
    const personaMap = new Map<string, string>();
    const diaSet = new Set<string>();

    for (const c of convocatorias) {
      personaMap.set(c.persona_id, c.persona_nombre ?? c.persona_id?.slice(0, 8));
      diaSet.add(c.dia?.slice(0, 10));
    }

    const dias = Array.from(diaSet).sort();
    const personas = Array.from(personaMap.entries()).map(([id, name]) => ({ id, name }));

    const matrix = new Map<string, any>();
    for (const c of convocatorias) {
      const key = `${c.persona_id}__${c.dia?.slice(0, 10)}`;
      matrix.set(key, c);
    }

    return { personas, dias, matrix };
  }, [convocatorias]);

  const formatDia = (d: string) => {
    const date = new Date(d + "T12:00:00");
    const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    return {
      dayName: dayNames[date.getDay()],
      dayNum: date.getDate(),
      month: date.toLocaleDateString("es-CL", { month: "short" }),
    };
  };

  const stats = useMemo(() => {
    const s: Record<string, number> = {};
    for (const c of convocatorias) {
      s[c.estado] = (s[c.estado] ?? 0) + 1;
    }
    return s;
  }, [convocatorias]);

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Calendario Convocatorias</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Persona × día con estado de convocatoria</p>
          </div>
        </div>

        {/* Project selector */}
        <div className="mb-6">
          <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}
            className="w-full max-w-md rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
            <option value="">Seleccionar proyecto...</option>
            {projects.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {!selectedProject && (
          <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
            <div className="text-4xl mb-3">📅</div>
            <p>Selecciona un proyecto para ver el calendario</p>
          </div>
        )}

        {loading && <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {selectedProject && !loading && convocatorias.length === 0 && (
          <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
            <p>Sin convocatorias para este proyecto</p>
            <p className="text-xs mt-1">Asigna turnos desde la vista de proyecto para crear convocatorias</p>
          </div>
        )}

        {selectedProject && !loading && convocatorias.length > 0 && (
          <>
            {/* Stats bar */}
            <div className="flex gap-3 mb-4 flex-wrap">
              {Object.entries(ESTADO_STYLE).map(([key, style]) => {
                const count = stats[key] ?? 0;
                if (!count) return null;
                return (
                  <div key={key} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ background: style.bg, color: style.color }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: style.color }} />
                    {key}: {count}
                  </div>
                );
              })}
              <div className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                Total: {convocatorias.length}
              </div>
            </div>

            {/* Calendar grid */}
            <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--border)" }}>
              <table className="w-full border-collapse" style={{ minWidth: dias.length * 70 + 180 }}>
                <thead>
                  <tr style={{ background: "var(--secondary)" }}>
                    <th className="px-4 py-3 text-left sticky left-0 z-10" style={{
                      fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px",
                      color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)",
                      background: "var(--secondary)", minWidth: 180,
                    }}>
                      Persona
                    </th>
                    {dias.map((d) => {
                      const f = formatDia(d);
                      return (
                        <th key={d} className="px-1 py-2 text-center" style={{
                          fontSize: 10, fontWeight: 500, color: "var(--muted-foreground)",
                          borderBottom: "1px solid var(--border)", minWidth: 60,
                        }}>
                          <div>{f.dayName}</div>
                          <div className="text-sm font-bold" style={{ color: "var(--foreground)" }}>{f.dayNum}</div>
                          <div>{f.month}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {personas.map((p) => (
                    <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-4 py-2 text-sm font-medium sticky left-0 z-10" style={{
                        background: "var(--card)", borderRight: "1px solid var(--border)",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180,
                      }}>
                        {p.name}
                      </td>
                      {dias.map((d) => {
                        const conv = matrix.get(`${p.id}__${d}`);
                        if (!conv) {
                          return <td key={d} className="px-1 py-2" style={{ background: "var(--card)" }} />;
                        }
                        const style = ESTADO_STYLE[conv.estado] ?? ESTADO_STYLE.pendiente;
                        return (
                          <td key={d} className="px-1 py-1" style={{ background: "var(--card)" }}>
                            <button onClick={() => setSelected(conv)}
                              className="w-full py-1.5 rounded-md text-xs font-semibold"
                              style={{ background: style.bg, color: style.color, border: "none", cursor: "pointer" }}>
                              {style.label}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="flex gap-4 mt-4 flex-wrap">
              {Object.entries(ESTADO_STYLE).map(([key, style]) => (
                <div key={key} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
                  <span className="w-3 h-3 rounded" style={{ background: style.bg, border: `1px solid ${style.color}` }} />
                  <span className="capitalize">{key.replace("_", " ")}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Detail Modal */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setSelected(null)}>
            <div className="rounded-2xl border p-6 w-full max-w-sm" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Detalle Convocatoria</h3>
                <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 18 }}>✕</button>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Persona</div>
                  <div className="text-sm font-medium">{selected.persona_nombre ?? selected.persona_id?.slice(0, 8)}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Día</div>
                  <div className="text-sm">{selected.dia ? new Date(selected.dia + "T12:00:00").toLocaleDateString("es-CL", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "—"}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Estado</div>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize"
                    style={{ background: (ESTADO_STYLE[selected.estado] ?? ESTADO_STYLE.pendiente).bg, color: (ESTADO_STYLE[selected.estado] ?? ESTADO_STYLE.pendiente).color }}>
                    {selected.estado?.replace("_", " ")}
                  </span>
                </div>
                {selected.local_nombre && (
                  <div>
                    <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Local</div>
                    <div className="text-sm">{selected.local_nombre}</div>
                    {selected.local_direccion && <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{selected.local_direccion}</div>}
                  </div>
                )}
                {selected.mensaje_enviado_at && (
                  <div>
                    <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Mensaje enviado</div>
                    <div className="text-sm">{new Date(selected.mensaje_enviado_at).toLocaleString("es-CL")}</div>
                  </div>
                )}
                {selected.respuesta_texto && (
                  <div>
                    <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Respuesta</div>
                    <div className="text-sm">{selected.respuesta_texto}</div>
                    {selected.respuesta_at && <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{new Date(selected.respuesta_at).toLocaleString("es-CL")}</div>}
                  </div>
                )}
                {selected.persona_phone && (
                  <div>
                    <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Teléfono</div>
                    <div className="text-sm font-mono">{selected.persona_phone}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

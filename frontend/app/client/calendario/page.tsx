"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/layout/app-shell";
import { api, getUser } from "@/lib/api";

// Calendario GLOBAL (read-only): monitoreo cross-proyecto por semana. Muestra las
// convocatorias de TODOS los proyectos y marca los puntos sin cubrir. La operación
// de asignar/convocar vive en /client/convocatorias; acá el único atajo es disparar
// las convocatorias YA asignadas (pendientes) de un punto sin cubrir.

type Conv = {
  proyecto_id: string; proyecto_nombre: string;
  persona_id: string; persona_nombre: string | null;
  dia: string; estado: string;
  local_nombre: string | null; local_direccion: string | null;
};
type Gap = {
  proyecto_id: string; proyecto_nombre: string;
  dia: string; local_nombre: string; local_direccion: string | null;
  tiene_pendientes: boolean;
  aprobado: boolean;
};

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pendiente:   { bg: "rgba(100,116,139,0.25)", color: "#94a3b8", label: "Pend" },
  enviada:     { bg: "rgba(79,70,229,0.25)",   color: "var(--primary)", label: "Env" },
  confirmada:  { bg: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)", label: "OK" },
  rechazada:   { bg: "color-mix(in srgb, var(--danger) 12%, transparent)",  color: "var(--danger)", label: "Rech" },
  reemplazada: { bg: "rgba(245,158,11,0.25)",  color: "#f59e0b", label: "Reemp" },
  no_show:     { bg: "color-mix(in srgb, var(--danger) 18%, transparent)",  color: "var(--danger)", label: "No show" },
  cancelada:   { bg: "color-mix(in srgb, var(--danger) 12%, transparent)",  color: "var(--danger)", label: "Cancel" },
};

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d: Date) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); x.setHours(12, 0, 0, 0); return x; };
const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
// Mismo criterio que el backend (normLocal): matchear local por nombre ignorando
// mayúsculas/espacios, para que el atajo Convocar encuentre las pendientes del gap.
const normLocal = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const formatDia = (iso: string) => {
  const date = new Date(iso + "T12:00:00");
  return { dayName: dayNames[date.getDay()], dayNum: date.getDate(), month: date.toLocaleDateString("es-CL", { month: "short" }) };
};

export default function CalendarioPage() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [convocatorias, setConvocatorias] = useState<Conv[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // OPERATOR (UserRole.OPERATOR = 'user') no puede convocar: el endpoint POST
  // /convocar excluye ese rol → un click garantiza 403. Se gatea el botón.
  const role = getUser()?.role;
  const canConvocar = role !== "user";

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); };
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => isoOf(addDays(weekStart, i))), [weekStart]);

  const load = () => {
    const desde = dias[0];
    const hasta = dias[6];
    setLoading(true);
    api.get<any>(`/projects/calendario?desde=${desde}&hasta=${hasta}`)
      .then((r) => {
        const d = r?.data ?? r;
        setConvocatorias(Array.isArray(d?.convocatorias) ? d.convocatorias : []);
        setGaps(Array.isArray(d?.gaps) ? d.gaps : []);
      })
      .catch(() => { setConvocatorias([]); setGaps([]); })
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [dias]);

  // Filas = proyectos con actividad (convocatoria o gap) en la semana.
  const proyectos = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of convocatorias) map.set(c.proyecto_id, c.proyecto_nombre);
    for (const g of gaps) if (!map.has(g.proyecto_id)) map.set(g.proyecto_id, g.proyecto_nombre);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [convocatorias, gaps]);

  const convAt = (proyId: string, dia: string) =>
    convocatorias.filter((c) => c.proyecto_id === proyId && c.dia?.slice(0, 10) === dia);
  const gapsAt = (proyId: string, dia: string) =>
    gaps.filter((g) => g.proyecto_id === proyId && g.dia === dia);

  // Atajo: enviar las convocatorias 'pendiente' (asignadas sin enviar) de un gap.
  const convocarGap = async (gap: Gap) => {
    const items = convocatorias
      .filter((c) =>
        c.proyecto_id === gap.proyecto_id &&
        c.dia?.slice(0, 10) === gap.dia &&
        normLocal(c.local_nombre) === normLocal(gap.local_nombre) &&
        c.estado === "pendiente")
      .map((c) => ({
        persona_id: c.persona_id,
        dia: c.dia?.slice(0, 10),
        local_nombre: c.local_nombre ?? undefined,
        local_direccion: c.local_direccion ?? undefined,
      }));
    if (!items.length) { showToast("No hay convocatorias pendientes para enviar en este punto."); return; }
    setBusy(true);
    try {
      const res = await api.post<any>(`/projects/${gap.proyecto_id}/convocar`, { modo: "manual", items });
      const d = res?.data ?? res;
      showToast(`Convocatoria enviada: ${d.enviados ?? 0} ok, ${d.errores ?? 0} con error`);
      load();
    } catch (e: any) { showToast(e.message ?? "Error al convocar"); } finally { setBusy(false); }
  };

  const rangeLabel = `${formatDia(dias[0]).dayNum} ${formatDia(dias[0]).month} – ${formatDia(dias[6]).dayNum} ${formatDia(dias[6]).month}`;
  const totalGaps = gaps.length;

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold">Calendario</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Monitoreo de convocatorias de todos los proyectos. Para asignar o convocar, entrá a{" "}
              <Link href="/client/convocatorias" style={{ color: "var(--primary)", fontWeight: 600 }}>Convocatorias</Link>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekStart((w) => addDays(w, -7))}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", cursor: "pointer", fontWeight: 600 }}>◀</button>
            <div className="text-sm font-semibold px-2 min-w-[140px] text-center">{rangeLabel}</div>
            <button onClick={() => setWeekStart((w) => addDays(w, 7))}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", cursor: "pointer", fontWeight: 600 }}>▶</button>
            <button onClick={() => setWeekStart(mondayOf(new Date()))}
              style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Hoy</button>
          </div>
        </div>

        {totalGaps > 0 && (
          <div className="mb-4 px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-2"
            style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
            <span>⚠</span> {totalGaps} punto{totalGaps === 1 ? "" : "s"} sin cubrir esta semana
          </div>
        )}

        {loading && <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {!loading && proyectos.length === 0 && (
          <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
            <div className="text-4xl mb-3">📅</div>
            <p>Sin convocatorias ni puntos programados en esta semana</p>
          </div>
        )}

        {!loading && proyectos.length > 0 && (
          <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--border)" }}>
            <table className="w-full border-collapse" style={{ minWidth: 7 * 150 + 200 }}>
              <thead>
                <tr style={{ background: "var(--secondary)" }}>
                  <th className="px-4 py-3 text-left sticky left-0 z-10"
                    style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)", background: "var(--secondary)", minWidth: 200 }}>
                    Proyecto
                  </th>
                  {dias.map((d) => {
                    const f = formatDia(d);
                    return (
                      <th key={d} className="px-2 py-2 text-center"
                        style={{ fontSize: 10, fontWeight: 500, color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)", minWidth: 150 }}>
                        <div>{f.dayName}</div>
                        <div className="text-sm font-bold" style={{ color: "var(--foreground)" }}>{f.dayNum}</div>
                        <div>{f.month}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {proyectos.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-4 py-2 text-sm font-medium sticky left-0 z-10"
                      style={{ background: "var(--card)", borderRight: "1px solid var(--border)", verticalAlign: "top", minWidth: 200, maxWidth: 200 }}>
                      {p.name}
                    </td>
                    {dias.map((d) => {
                      const cs = convAt(p.id, d);
                      const gs = gapsAt(p.id, d);
                      return (
                        <td key={d} className="px-1.5 py-1.5 align-top" style={{ background: "var(--card)", verticalAlign: "top" }}>
                          <div className="flex flex-col gap-1">
                            {cs.map((c, i) => {
                              const style = ESTADO_STYLE[c.estado] ?? ESTADO_STYLE.pendiente;
                              return (
                                <button key={`${c.persona_id}-${i}`} onClick={() => setSelected(c)}
                                  className="w-full px-2 py-1 rounded-md text-[11px] font-semibold text-left truncate"
                                  title={`${c.persona_nombre ?? c.persona_id} · ${c.estado}${c.local_nombre ? ` · ${c.local_nombre}` : ""}`}
                                  style={{ background: style.bg, color: style.color, border: "none", cursor: "pointer" }}>
                                  {c.persona_nombre ?? c.persona_id?.slice(0, 8)}
                                </button>
                              );
                            })}
                            {gs.map((g, i) => (
                              <div key={`gap-${i}`} className="px-2 py-1 rounded-md text-[11px]"
                                style={{ background: "rgba(245,158,11,0.12)", border: "1px dashed #f59e0b" }}>
                                <div className="font-semibold truncate" style={{ color: "#f59e0b" }} title={g.local_nombre}>⚠ {g.local_nombre}</div>
                                {g.tiene_pendientes && g.aprobado && canConvocar ? (
                                  <button onClick={() => convocarGap(g)} disabled={busy}
                                    className="mt-1 w-full py-0.5 rounded text-[11px] font-semibold"
                                    style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
                                    Convocar
                                  </button>
                                ) : (
                                  <Link href={`/client/convocatorias?proyecto=${g.proyecto_id}`}
                                    className="mt-1 block w-full py-0.5 rounded text-[11px] font-semibold text-center"
                                    style={{ background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)" }}>
                                    Asignar
                                  </Link>
                                )}
                              </div>
                            ))}
                            {cs.length === 0 && gs.length === 0 && (
                              <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>—</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        {!loading && proyectos.length > 0 && (
          <div className="flex gap-4 mt-4 flex-wrap">
            {Object.entries(ESTADO_STYLE).map(([key, style]) => (
              <div key={key} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
                <span className="w-3 h-3 rounded" style={{ background: style.bg, border: `1px solid ${style.color}` }} />
                <span className="capitalize">{key.replace("_", " ")}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
              <span className="w-3 h-3 rounded" style={{ background: "rgba(245,158,11,0.12)", border: "1px dashed #f59e0b" }} />
              <span>Punto sin cubrir</span>
            </div>
          </div>
        )}

        {/* Detail Modal (read-only) */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setSelected(null)}>
            <div className="rounded-2xl border p-6 w-full max-w-sm" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold">Detalle Convocatoria</h3>
                <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 18 }}>✕</button>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Proyecto</div>
                  <div className="text-sm font-medium">{selected.proyecto_nombre}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Persona</div>
                  <div className="text-sm font-medium">{selected.persona_nombre ?? selected.persona_id?.slice(0, 8)}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Día</div>
                  <div className="text-sm">{selected.dia ? new Date(selected.dia.slice(0, 10) + "T12:00:00").toLocaleDateString("es-CL", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "—"}</div>
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
                <Link href={`/client/convocatorias?proyecto=${selected.proyecto_id}`}
                  className="block w-full mt-2 py-2 rounded-lg text-sm font-semibold text-center"
                  style={{ background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)" }}>
                  Gestionar en Convocatorias →
                </Link>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div style={{ position: "fixed", bottom: 24, right: 24, background: "var(--ink)", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
            {toast}
          </div>
        )}
      </div>
    </AppShell>
  );
}

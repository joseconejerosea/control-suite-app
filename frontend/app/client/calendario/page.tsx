"use client";

import { useEffect, useState, useMemo } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pendiente:   { bg: "rgba(100,116,139,0.25)", color: "#94a3b8", label: "Pend" },
  enviada:     { bg: "rgba(79,70,229,0.25)",   color: "var(--primary)", label: "Env" },
  confirmada:  { bg: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)", label: "OK" },
  rechazada:   { bg: "color-mix(in srgb, var(--danger) 12%, transparent)",  color: "var(--danger)", label: "Rech" },
  reemplazada: { bg: "rgba(245,158,11,0.25)",  color: "#f59e0b", label: "Reemp" },
  no_show:     { bg: "color-mix(in srgb, var(--danger) 18%, transparent)",  color: "var(--danger)", label: "No show" },
};

const fieldStyle = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", boxSizing: "border-box" as any };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase" as any, display: "block", marginBottom: 4 };

const promoterName = (p: any) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || p?.name || (p?.id ? p.id.slice(0, 8) : "—");

// ─── ASIGNAR TURNO MODAL ────────────────────────────────────────────────────
function TurnoModal({ projectId, promoters, onClose, onDone }: { projectId: string; promoters: any[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ persona_id: "", dia: "", local_nombre: "", local_direccion: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSave = !!form.persona_id && !!form.dia;

  const save = async () => {
    if (!canSave) return;
    setSaving(true); setError("");
    try {
      await api.post(`/projects/${projectId}/turno-equipo`, {
        persona_id: form.persona_id,
        dias: [form.dia],
        local_nombre: form.local_nombre || undefined,
        local_direccion: form.local_direccion || undefined,
      });
      onDone(); onClose();
    } catch (e: any) { setError(e.message ?? "Error"); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl border w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="font-bold">Asignar turno</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 18 }}>✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label style={labelStyle}>Promotor *</label>
            <select value={form.persona_id} onChange={e => setForm(f => ({ ...f, persona_id: e.target.value }))} style={fieldStyle}>
              <option value="">Selecciona un promotor...</option>
              {promoters.map(p => <option key={p.id} value={p.id}>{promoterName(p)}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Día *</label>
            <input type="date" value={form.dia} onChange={e => setForm(f => ({ ...f, dia: e.target.value }))} style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>Local</label>
            <input value={form.local_nombre} onChange={e => setForm(f => ({ ...f, local_nombre: e.target.value }))} placeholder="Sucursal Centro" style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>Dirección</label>
            <input value={form.local_direccion} onChange={e => setForm(f => ({ ...f, local_direccion: e.target.value }))} placeholder="Av. Ejemplo 123" style={fieldStyle} />
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer" }}>Cancelar</button>
          <button onClick={save} disabled={saving || !canSave} style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: canSave ? "var(--primary)" : "var(--secondary)", color: canSave ? "#fff" : "var(--muted-foreground)", cursor: "pointer", fontWeight: 600 }}>
            {saving ? "Guardando..." : "Asignar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CalendarioPage() {
  const [projects, setProjects]               = useState<any[]>([]);
  const [promoters, setPromoters]             = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [convocatorias, setConvocatorias]     = useState<any[]>([]);
  const [loading, setLoading]                 = useState(false);
  const [selected, setSelected]               = useState<any>(null);
  const [showTurno, setShowTurno]             = useState(false);
  const [toast, setToast]                     = useState<string | null>(null);
  const [busy, setBusy]                       = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    api.get<any>("/projects").then(r => setProjects(Array.isArray(r) ? r : (r?.data ?? []))).catch(console.error);
    api.get<any>("/promoters").then(r => setPromoters(Array.isArray(r) ? r : (r?.data ?? []))).catch(console.error);
  }, []);

  const loadConvocatorias = () => {
    if (!selectedProject) { setConvocatorias([]); return; }
    setLoading(true);
    api.get<any>(`/projects/${selectedProject}/convocatorias`)
      .then((r) => setConvocatorias(Array.isArray(r) ? r : (r?.data ?? [])))
      .catch(() => setConvocatorias([]))
      .finally(() => setLoading(false));
  };

  useEffect(loadConvocatorias, [selectedProject]);

  const project   = useMemo(() => projects.find((p: any) => p.id === selectedProject), [projects, selectedProject]);
  const aprobado  = project?.config?.ia_status === "aprobado";
  const pendientes = useMemo(() => convocatorias.filter((c: any) => c.estado === "pendiente"), [convocatorias]);

  const refreshProject = async () => {
    // El estado de aprobación vive en projects.config.ia_status → recargar la lista.
    try { const r = await api.get<any>("/projects"); setProjects(Array.isArray(r) ? r : (r?.data ?? [])); } catch { /* noop */ }
  };

  const aprobar = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${selectedProject}/aprobar`, { comentario: "Aprobado desde calendario" });
      await refreshProject();
      showToast("Proyecto aprobado ✓");
    } catch (e: any) { showToast(e.message ?? "Error al aprobar"); } finally { setBusy(false); }
  };

  const enviarConvocatoria = async () => {
    if (!pendientes.length) return;
    setBusy(true);
    try {
      const items = pendientes.map((c: any) => ({
        persona_id: c.persona_id,
        dia: c.dia?.slice(0, 10),
        local_nombre: c.local_nombre ?? undefined,
        local_direccion: c.local_direccion ?? undefined,
      }));
      const res = await api.post<any>(`/projects/${selectedProject}/convocar`, { modo: "manual", items });
      const d = res?.data ?? res;
      showToast(`Convocatoria enviada: ${d.enviados ?? 0} ok, ${d.errores ?? 0} con error`);
      loadConvocatorias();
    } catch (e: any) { showToast(e.message ?? "Error al enviar"); } finally { setBusy(false); }
  };

  const { personas, dias, matrix } = useMemo(() => {
    const personaMap = new Map<string, string>();
    const diaSet = new Set<string>();
    for (const c of convocatorias) {
      const prom = promoters.find((p: any) => p.id === c.persona_id);
      personaMap.set(c.persona_id, prom ? promoterName(prom) : (c.persona_nombre ?? c.persona_id?.slice(0, 8)));
      diaSet.add(c.dia?.slice(0, 10));
    }
    const dias = Array.from(diaSet).sort();
    const personas = Array.from(personaMap.entries()).map(([id, name]) => ({ id, name }));
    const matrix = new Map<string, any>();
    for (const c of convocatorias) matrix.set(`${c.persona_id}__${c.dia?.slice(0, 10)}`, c);
    return { personas, dias, matrix };
  }, [convocatorias, promoters]);

  const formatDia = (d: string) => {
    const date = new Date(d + "T12:00:00");
    const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    return { dayName: dayNames[date.getDay()], dayNum: date.getDate(), month: date.toLocaleDateString("es-CL", { month: "short" }) };
  };

  const stats = useMemo(() => {
    const s: Record<string, number> = {};
    for (const c of convocatorias) s[c.estado] = (s[c.estado] ?? 0) + 1;
    return s;
  }, [convocatorias]);

  const btn = (label: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean } = {}) => (
    <button onClick={onClick} disabled={opts.disabled || busy}
      style={{ padding: "8px 14px", borderRadius: 10, border: opts.primary ? "none" : "1px solid var(--border)",
        background: opts.primary ? (opts.disabled ? "var(--secondary)" : "var(--primary)") : "var(--secondary)",
        color: opts.primary && !opts.disabled ? "#fff" : "var(--foreground)",
        cursor: opts.disabled || busy ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: opts.disabled ? 0.6 : 1 }}>
      {label}
    </button>
  );

  return (
    <AppShell>
      {showTurno && selectedProject && (
        <TurnoModal projectId={selectedProject} promoters={promoters} onClose={() => setShowTurno(false)} onDone={loadConvocatorias} />
      )}

      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Convocatorias</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Asigná turnos, aprobá y convocá a los promotores</p>
          </div>
        </div>

        {/* Project selector */}
        <div className="mb-4">
          <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)}
            className="w-full max-w-md rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
            <option value="">Seleccionar proyecto...</option>
            {projects.map((p: any) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        </div>

        {/* Toolbar de acciones */}
        {selectedProject && (
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <span className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={aprobado ? { background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)" } : { background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
              {aprobado ? "Aprobado ✓" : "Pendiente de aprobación"}
            </span>
            {!aprobado && btn("Aprobar proyecto", aprobar, { primary: true })}
            {btn("+ Asignar turno", () => setShowTurno(true))}
            {btn(
              `Enviar convocatoria${pendientes.length ? ` (${pendientes.length})` : ""}`,
              enviarConvocatoria,
              { primary: true, disabled: !aprobado || pendientes.length === 0 },
            )}
            {!aprobado && (
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Aprobá el proyecto para poder enviar</span>
            )}
          </div>
        )}

        {!selectedProject && (
          <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
            <div className="text-4xl mb-3">📅</div>
            <p>Selecciona un proyecto para gestionar las convocatorias</p>
          </div>
        )}

        {loading && <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {selectedProject && !loading && convocatorias.length === 0 && (
          <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
            <p>Sin convocatorias para este proyecto</p>
            <p className="text-xs mt-1">Usá "+ Asignar turno" para crear la primera.</p>
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
                  <div key={key} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: style.bg, color: style.color }}>
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
                    <th className="px-4 py-3 text-left sticky left-0 z-10" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)", background: "var(--secondary)", minWidth: 180 }}>
                      Persona
                    </th>
                    {dias.map((d) => {
                      const f = formatDia(d);
                      return (
                        <th key={d} className="px-1 py-2 text-center" style={{ fontSize: 10, fontWeight: 500, color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)", minWidth: 60 }}>
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
                      <td className="px-4 py-2 text-sm font-medium sticky left-0 z-10" style={{ background: "var(--card)", borderRight: "1px solid var(--border)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>
                        {p.name}
                      </td>
                      {dias.map((d) => {
                        const conv = matrix.get(`${p.id}__${d}`);
                        if (!conv) return <td key={d} className="px-1 py-2" style={{ background: "var(--card)" }} />;
                        const style = ESTADO_STYLE[conv.estado] ?? ESTADO_STYLE.pendiente;
                        return (
                          <td key={d} className="px-1 py-1" style={{ background: "var(--card)" }}>
                            <button onClick={() => setSelected(conv)} className="w-full py-1.5 rounded-md text-xs font-semibold" style={{ background: style.bg, color: style.color, border: "none", cursor: "pointer" }}>
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
                  <div className="text-sm font-medium">{promoters.find((p: any) => p.id === selected.persona_id) ? promoterName(promoters.find((p: any) => p.id === selected.persona_id)) : (selected.persona_nombre ?? selected.persona_id?.slice(0, 8))}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Día</div>
                  <div className="text-sm">{selected.dia ? new Date(selected.dia.slice(0, 10) + "T12:00:00").toLocaleDateString("es-CL", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "—"}</div>
                </div>
                <div>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Estado</div>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize" style={{ background: (ESTADO_STYLE[selected.estado] ?? ESTADO_STYLE.pendiente).bg, color: (ESTADO_STYLE[selected.estado] ?? ESTADO_STYLE.pendiente).color }}>
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
                  </div>
                )}
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

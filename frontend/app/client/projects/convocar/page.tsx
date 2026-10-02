"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { Send, Trash2, Plus, ArrowLeft } from "lucide-react";

type Item = {
  persona_id: string; name: string; phone: string | null; rol: string | null;
  dia: string | null; local_nombre: string | null; local_direccion: string | null;
};
type Disp = { id: string; name: string; phone: string | null; rol: string | null };

const inputStyle: CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)",
  background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", boxSizing: "border-box",
};

function ConvocarContent({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [disponibles, setDisponibles] = useState<Disp[]>([]);
  const [defaultDia, setDefaultDia] = useState<string>("");
  const [defaultLocal, setDefaultLocal] = useState<{ nombre?: string; direccion?: string }>({});
  const [addSel, setAddSel] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ enviados: number; errores: number; detalle: any[] } | null>(null);
  const [conflicts, setConflicts] = useState<any[] | null>(null);
  // B4: PDVs del proyecto para el desplegable de "Local" (fuente = endpoint de B5).
  const [locations, setLocations] = useState<{ id: string; name: string; address: string | null }[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<any>(`/projects/${projectId}/sugerir-convocatoria`);
      const d = r?.data ?? r;
      setItems(Array.isArray(d?.items) ? d.items : []);
      setDisponibles(Array.isArray(d?.disponibles) ? d.disponibles : []);
      setDefaultDia(d?.dia ?? "");
      const l0 = Array.isArray(d?.locales) ? d.locales[0] : null;
      setDefaultLocal(l0 ? { nombre: l0.nombre, direccion: l0.direccion } : {});
      // B4: PDVs individuales del proyecto para el desplegable de "Local".
      try {
        const rl = await api.get<any>(`/projects/${projectId}/locations`);
        const dl = rl?.data ?? rl;
        setLocations(Array.isArray(dl) ? dl : []);
      } catch { /* si el proyecto no tiene PDVs o el fetch falla, el campo cae a texto libre */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la sugerencia.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const upd = (i: number, patch: Partial<Item>) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => setItems((prev) => prev.filter((_, j) => j !== i));
  const add = () => {
    const p = disponibles.find((d) => d.id === addSel);
    if (!p) return;
    setItems((prev) => [...prev, {
      persona_id: p.id, name: p.name, phone: p.phone, rol: p.rol,
      dia: defaultDia || null, local_nombre: defaultLocal.nombre ?? null, local_direccion: defaultLocal.direccion ?? null,
    }]);
    setAddSel("");
  };

  const buildBody = () => ({
    items: items.map((it) => ({
      persona_id: it.persona_id, dia: it.dia,
      local_nombre: it.local_nombre || undefined, local_direccion: it.local_direccion || undefined,
    })),
    comentario: "Convocatoria aprobada y enviada desde la sugerencia IA",
  });

  const enviar = async () => {
    setError("");
    setResult(null);
    if (!items.length) { setError("Agregá al menos un anfitrión."); return; }
    if (items.some((it) => !it.dia)) { setError("Todos los anfitriones necesitan una fecha."); return; }
    if (items.some((it) => !it.phone)) { setError("Hay anfitriones sin teléfono cargado."); return; }
    setSending(true);
    try {
      const r = await api.post<any>(`/projects/${projectId}/convocar-anfitriones`, buildBody());
      const res = r?.data ?? r;
      // T6 — el backend detectó un choque de agenda: no envió nada, pide confirmación.
      if (Array.isArray(res?.conflicts) && res.conflicts.length) {
        setConflicts(res.conflicts);
        return;
      }
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la convocatoria.");
    } finally {
      setSending(false);
    }
  };

  // T6 — "Convocar a ambas": re-envía con force:true, saltando el chequeo de choque.
  const convocarAmbas = async () => {
    setError("");
    setSending(true);
    try {
      const r = await api.post<any>(`/projects/${projectId}/convocar-anfitriones`, { ...buildBody(), force: true });
      setResult(r?.data ?? r);
      setConflicts(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la convocatoria.");
    } finally {
      setSending(false);
    }
  };

  // T6 — "Eliminar la(s) otra(s)": cancela las convocatorias en conflicto y reintenta
  // sin force (ya no debería haber choque).
  const eliminarOtrasYConvocar = async () => {
    if (!conflicts) return;
    setError("");
    setSending(true);
    try {
      for (const c of conflicts) {
        await api.patch<any>(`/projects/${c.proyecto_id}/convocatorias/${c.convocatoria_id}`, { estado: "cancelada" });
      }
      const r = await api.post<any>(`/projects/${projectId}/convocar-anfitriones`, buildBody());
      setResult(r?.data ?? r);
      setConflicts(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la convocatoria.");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div style={{ padding: 24, color: "var(--muted-foreground)", fontSize: 13 }}>Cargando sugerencia…</div>;

  const yaAgregados = new Set(items.map((i) => i.persona_id));
  const paraAgregar = disponibles.filter((d) => !yaAgregados.has(d.id));

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Convocar anfitriones</h1>
        <button onClick={() => router.push("/client/projects")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
          <ArrowLeft size={14} /> Volver
        </button>
      </div>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: "0 0 20px" }}>
        La IA sugirió estos promotores según el perfil del proyecto. Revisá, ajustá fecha/local, agregá o quitá, y al enviar
        se <b>aprueba el proyecto</b> y sale la convocatoria por WhatsApp.
      </p>

      {result ? (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Convocatoria enviada</div>
          <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 16 }}>
            Enviados: <b style={{ color: "var(--success)" }}>{result.enviados}</b> · Errores: <b style={{ color: result.errores ? "var(--danger)" : "var(--foreground)" }}>{result.errores}</b>
          </div>
          {Array.isArray(result.detalle) && result.detalle.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
              {result.detalle.map((d: any, i: number) => (
                <div key={i}>{d.ok ? "✓" : "✗"} {d.persona_id?.slice(0, 8)} · {d.dia}{d.error ? ` — ${d.error}` : ""}</div>
              ))}
            </div>
          )}
          <button onClick={() => router.push("/client/projects")}
            style={{ marginTop: 20, padding: "10px 18px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            Volver a proyectos
          </button>
        </div>
      ) : (
        <>
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted-foreground)" }}>
                  <th style={{ padding: "10px 14px", fontWeight: 500 }}>Anfitrión</th>
                  <th style={{ padding: "10px 14px", fontWeight: 500 }}>Rol</th>
                  <th style={{ padding: "10px 14px", fontWeight: 500 }}>Teléfono</th>
                  <th style={{ padding: "10px 14px", fontWeight: 500 }}>Fecha</th>
                  <th style={{ padding: "10px 14px", fontWeight: 500 }}>Local</th>
                  <th style={{ padding: "10px 14px" }}></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "var(--muted-foreground)" }}>Sin sugerencias. Agregá anfitriones abajo.</td></tr>
                ) : items.map((it, i) => (
                  <tr key={it.persona_id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 14px", fontWeight: 500 }}>{it.name}</td>
                    <td style={{ padding: "8px 14px", color: "var(--muted-foreground)" }}>{it.rol || "—"}</td>
                    <td style={{ padding: "8px 14px", color: it.phone ? "var(--foreground)" : "var(--danger)" }}>{it.phone || "sin teléfono"}</td>
                    <td style={{ padding: "8px 14px", width: 150 }}>
                      <input type="date" value={it.dia ?? ""} onChange={(e) => upd(i, { dia: e.target.value })} style={inputStyle} />
                    </td>
                    <td style={{ padding: "8px 14px", width: 200 }}>
                      {locations.length > 0 ? (
                        <select
                          value={(() => {
                            // Match normalizado (trim + minúsculas): el nombre sugerido por IA
                            // puede venir con espacios/casing distintos al PDV guardado (trimmeado).
                            const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
                            const m = locations.find((l) => norm(l.name) === norm(it.local_nombre));
                            return m ? m.name : "";
                          })()}
                          onChange={(e) => {
                            const loc = locations.find((l) => l.name === e.target.value);
                            upd(i, { local_nombre: loc ? loc.name : null, local_direccion: loc?.address ?? null });
                          }}
                          style={inputStyle}
                        >
                          <option value="">— Local —</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.name}>{l.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input value={it.local_nombre ?? ""} onChange={(e) => upd(i, { local_nombre: e.target.value })} placeholder="Local" style={inputStyle} />
                      )}
                    </td>
                    <td style={{ padding: "8px 14px", textAlign: "right" }}>
                      <button onClick={() => remove(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 4 }}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Agregar anfitrión */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
            <select value={addSel} onChange={(e) => setAddSel(e.target.value)} style={{ ...inputStyle, maxWidth: 320 }}>
              <option value="">Agregar anfitrión…</option>
              {paraAgregar.map((d) => (
                <option key={d.id} value={d.id}>{d.name}{d.rol ? ` (${d.rol})` : ""}{d.phone ? "" : " — sin teléfono"}</option>
              ))}
            </select>
            <button onClick={add} disabled={!addSel}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: addSel ? "pointer" : "not-allowed", fontSize: 13 }}>
              <Plus size={14} /> Agregar
            </button>
          </div>

          {error && <div style={{ fontSize: 13, padding: "10px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)", marginBottom: 16 }}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingBottom: 40 }}>
            <button onClick={() => router.push("/client/projects")}
              style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
              Cancelar
            </button>
            <button onClick={enviar} disabled={sending || items.length === 0}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 22px", borderRadius: 8, border: "none", background: items.length ? "var(--primary)" : "var(--secondary)", color: items.length ? "#fff" : "var(--muted-foreground)", cursor: sending ? "default" : "pointer", fontSize: 13, fontWeight: 600, opacity: sending ? 0.7 : 1 }}>
              <Send size={14} /> {sending ? "Enviando…" : "Aprobar y enviar convocatoria"}
            </button>
          </div>
        </>
      )}

      {/* T6 — Pop-up de choque de agenda */}
      {conflicts && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998 }}
          onClick={() => setConflicts(null)}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, width: 480, maxWidth: "90vw" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Choque de agenda</h2>
            <div style={{ fontSize: 13, color: "var(--muted-foreground)", display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {conflicts.map((c: any, i: number) => (
                <div key={i}>
                  {c.persona_nombre} ya está convocado a {c.proyecto_nombre}
                  {c.local_nombre ? ` (${c.local_nombre})` : ""} el {c.dia}.
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={convocarAmbas} disabled={sending}
                style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", cursor: sending ? "default" : "pointer", fontSize: 13, fontWeight: 600, opacity: sending ? 0.7 : 1 }}>
                Convocar a ambas
              </button>
              <button onClick={eliminarOtrasYConvocar} disabled={sending}
                style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", cursor: sending ? "default" : "pointer", fontSize: 13, fontWeight: 600, opacity: sending ? 0.7 : 1 }}>
                Eliminar la(s) otra(s)
              </button>
              <button onClick={() => setConflicts(null)} disabled={sending}
                style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: sending ? "default" : "pointer", fontSize: 13 }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConvocarWrapper() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  if (!id) return <div style={{ padding: 24, color: "var(--muted-foreground)", fontSize: 13 }}>Falta el id del proyecto.</div>;
  return <ConvocarContent projectId={id} />;
}

export default function ConvocarProyectoPage() {
  return (
    <AppShell>
      <Suspense fallback={<div style={{ padding: 24, color: "var(--muted-foreground)", fontSize: 13 }}>Cargando…</div>}>
        <ConvocarWrapper />
      </Suspense>
    </AppShell>
  );
}

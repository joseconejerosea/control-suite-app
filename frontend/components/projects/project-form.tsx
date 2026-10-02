"use client";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Plus, Trash2, Upload } from "lucide-react";

// CLP sin decimales, separador de miles con punto. parseFloat("5.000.000") = 5, así que
// limpiamos a solo dígitos antes de parsear. undefined si no hay ningún dígito.
function parseCLP(v: unknown): number | undefined {
  const digits = String(v ?? "").replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : undefined;
}

// B1: el margen proyectado se calcula solo (margen sobre ingreso), no se escribe a mano.
// Margen % = (Presupuesto − Costo) / Presupuesto × 100. Requiere presupuesto > 0 y costo cargado.
// Redondeado a 1 decimal. null si faltan datos o el presupuesto es 0.
function computeMargenPct(budget: unknown, costo: unknown): number | null {
  const ingreso = parseCLP(budget);
  const cost = parseCLP(costo);
  if (ingreso == null || ingreso <= 0 || cost == null) return null;
  return Math.round(((ingreso - cost) / ingreso) * 1000) / 10;
}

type Local = { nombre: string; direccion: string };
type Persona = { rol: string; cantidad: string };

type FormState = {
  name: string;
  brief: string;
  objectives: string;
  status: string;
  start_date: string;
  end_date: string;
  budget: string;
  cliente_final: string;
  cliente_rut: string;
  costo_estimado: string;
  locales: Local[];
  personas: Persona[];
  hitos: string[];
};

const EMPTY: FormState = {
  name: "", brief: "", objectives: "", status: "active", start_date: "", end_date: "",
  budget: "", cliente_final: "", cliente_rut: "", costo_estimado: "",
  locales: [], personas: [], hitos: [],
};

// La IA (extracted_data / config.ia_extracted) usa nombres distintos a los del proyecto.
function fromExtracted(ex: any): Partial<FormState> {
  return {
    name: ex?.nombre_proyecto ?? "",
    brief: ex?.brief ?? "",
    start_date: (ex?.fecha_inicio ?? "").slice(0, 10),
    end_date: (ex?.fecha_fin ?? "").slice(0, 10),
    budget: ex?.presupuesto_otorgado != null ? String(ex.presupuesto_otorgado) : "",
    cliente_final: ex?.cliente_final ?? "",
    cliente_rut: ex?.cliente_final_rut ?? "",
    costo_estimado: ex?.costo_estimado != null ? String(ex.costo_estimado) : "",
    locales: Array.isArray(ex?.locales)
      ? ex.locales.map((l: any) => ({ nombre: l?.nombre ?? "", direccion: l?.direccion ?? "" }))
      : [],
    personas: Array.isArray(ex?.perfil_personas)
      ? ex.perfil_personas.map((p: any) => ({ rol: p?.rol ?? "", cantidad: p?.cantidad != null ? String(p.cantidad) : "" }))
      : [],
    hitos: Array.isArray(ex?.hitos) ? ex.hitos.map((h: any) => String(h)) : [],
  };
}

// Un proyecto existente: básicos en columnas, campos ricos en config (ia_extracted si vino
// de IA, o config plano si fue manual).
function fromProject(p: any): FormState {
  const cfg = p?.config ?? {};
  const ia = cfg?.ia_extracted ?? cfg ?? {};
  return {
    ...EMPTY,
    ...fromExtracted(ia),
    name: p?.name ?? "",
    brief: p?.description ?? ia?.brief ?? "",
    objectives: p?.objectives ?? "",
    status: p?.status ?? "active",
    start_date: (p?.start_date ?? "").slice(0, 10),
    end_date: (p?.end_date ?? "").slice(0, 10),
    budget: p?.budget != null ? String(p.budget) : "",
  };
}

// Empaqueta los campos ricos que van a project.config.
function buildConfig(f: FormState) {
  return {
    cliente_final: f.cliente_final || null,
    cliente_final_rut: f.cliente_rut || null,
    costo_estimado: parseCLP(f.costo_estimado) ?? null,
    margen_proyectado: computeMargenPct(f.budget, f.costo_estimado),
    locales: f.locales.filter((l) => l.nombre.trim() || l.direccion.trim()),
    perfil_personas: f.personas
      .filter((p) => p.rol.trim())
      .map((p) => ({ rol: p.rol, cantidad: p.cantidad ? Number(p.cantidad) : null })),
    hitos: f.hitos.filter((h) => h.trim()),
  };
}

const inputStyle: CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", boxSizing: "border-box",
};

export default function ProjectForm({ mode, projectId }: { mode: "create" | "edit"; projectId?: string }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // AI upload (solo create)
  const fileRef = useRef<HTMLInputElement>(null);
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInboxId, setAiInboxId] = useState<string | null>(null);
  const [aiMsg, setAiMsg] = useState("");

  // Config crudo del proyecto en edición, para preservar la procedencia (source, inbox_id,
  // notas_ia, ia_extracted) al guardar en lugar de aplastarla con buildConfig.
  const [rawConfig, setRawConfig] = useState<any>(null);

  useEffect(() => {
    if (mode === "edit" && projectId) {
      api.get<any>(`/projects/${projectId}`)
        .then((r) => {
          const proj = r?.data ?? r;
          setForm(fromProject(proj));
          setRawConfig(proj?.config ?? null);
        })
        .catch(() => setError("No se pudo cargar el proyecto."))
        .finally(() => setLoading(false));
    }
  }, [mode, projectId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  // ── Extracción IA desde documento ────────────────────────────────────────
  const processAIFile = async () => {
    if (!aiFile) return;
    setAiLoading(true);
    setAiMsg("");
    try {
      const fd = new FormData();
      fd.append("file", aiFile);
      const inbox = await api.upload<any>("/v1/app/project-inbox/upload", fd);
      const inboxId = inbox?.id ?? inbox?.data?.id;
      if (!inboxId) throw new Error("El backend no devolvió un id de inbox.");
      setAiInboxId(inboxId);

      const MAX_POLLS = 25, DELAY_MS = 1500;
      let sawProcessing = false;
      // El job de extracción reintenta (attempts:3) y vuelve el estado a PENDING entre intentos.
      // Exigimos 2 PENDING post-processing consecutivos antes de declarar fallo, para no
      // confundir un reintento en curso con una extracción fallida.
      let pendingAfterProcessing = 0;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
        const item = await api.get<any>(`/v1/app/project-inbox/${inboxId}`);
        const data = item?.data ?? item;
        if (data?.status === "PROCESSING") sawProcessing = true;
        if (data?.status === "READY") {
          // La extracción tardía no debe pisar lo que el usuario ya escribió: solo rellena
          // campos vacíos (string vacío o array vacío), nunca sobrescribe valores no vacíos.
          const extracted = fromExtracted(data?.extracted_data ?? {});
          setForm((prev) => {
            const merged: FormState = { ...prev };
            (Object.keys(extracted) as (keyof FormState)[]).forEach((k) => {
              const cur = prev[k];
              const isNonEmptyString = typeof cur === "string" && cur.trim() !== "";
              const isNonEmptyArray = Array.isArray(cur) && cur.length > 0;
              if (!isNonEmptyString && !isNonEmptyArray) {
                (merged as any)[k] = (extracted as any)[k];
              }
            });
            return merged;
          });
          setAiMsg("Datos extraídos. Revisá y completá lo que falte antes de crear.");
          return;
        }
        if (data?.status === "PENDING" && sawProcessing) {
          pendingAfterProcessing++;
          if (pendingAfterProcessing >= 2) {
            setAiMsg("No se pudieron extraer los datos automáticamente. Completá los campos a mano.");
            return;
          }
        } else {
          pendingAfterProcessing = 0;
        }
      }
      setAiMsg("La extracción está tardando. Podés completar los campos a mano y crear el proyecto.");
    } catch (e) {
      setAiMsg(e instanceof Error ? e.message : "Error al procesar el documento.");
    } finally {
      setAiLoading(false);
    }
  };

  // ── Guardar ───────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!form.name.trim()) { setError("El nombre del proyecto es obligatorio."); return; }
    setSaving(true);
    setError("");
    try {
      const rich = buildConfig(form);
      if (mode === "create" && aiInboxId) {
        // Vino de un documento → approve() del inbox (crea locations desde locales).
        // approve() ignora objectives/status (fija status='active'): hacemos un PATCH de
        // seguimiento para no perder esos campos.
        const res = await api.put<any>(`/v1/app/project-inbox/${aiInboxId}/approve`, {
          nombre_proyecto: form.name || undefined,
          brief: form.brief || undefined,
          fecha_inicio: form.start_date || undefined,
          fecha_fin: form.end_date || undefined,
          presupuesto_otorgado: parseCLP(form.budget),
          cliente_final: form.cliente_final || undefined,
          cliente_final_rut: form.cliente_rut || undefined,
          costo_estimado: parseCLP(form.costo_estimado),
          margen_proyectado: rich.margen_proyectado ?? undefined,
          locales: rich.locales,
          perfil_personas: rich.perfil_personas,
          hitos: rich.hitos,
        });
        const pid = (res as any)?.data?.project_id ?? (res as any)?.project_id;
        if (pid) {
          // .catch para que un seguimiento fallido no bloquee la navegación.
          await api.patch(`/projects/${pid}`, { objectives: form.objectives || undefined, status: form.status }).catch(() => {});
        }
      } else {
        // Preserva la procedencia del config existente (source, inbox_id, notas_ia). Si el
        // proyecto vino de IA (tiene ia_extracted), los campos ricos editados van DENTRO de
        // ia_extracted para que fromProject los relea; si no, van planos.
        const cfgObj = (rawConfig && typeof rawConfig === "object") ? rawConfig : {};
        const config = ("ia_extracted" in cfgObj)
          ? { ...cfgObj, ia_extracted: { ...(cfgObj.ia_extracted ?? {}), ...rich } }
          : { ...cfgObj, ...rich };
        const body = {
          name: form.name,
          description: form.brief || undefined,
          objectives: form.objectives || undefined,
          status: form.status,
          start_date: form.start_date || undefined,
          end_date: form.end_date || undefined,
          budget: parseCLP(form.budget),
          config,
        };
        if (mode === "edit" && projectId) await api.patch(`/projects/${projectId}`, body);
        else await api.post("/projects", body);
      }
      router.push("/client/projects");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el proyecto.");
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ color: "var(--muted-foreground)", fontSize: 13, padding: 24 }}>Cargando proyecto…</div>;
  }

  const label = (t: string) => (
    <label style={{ fontSize: 12, fontWeight: 500, color: "var(--muted-foreground)", display: "block", marginBottom: 6 }}>{t}</label>
  );
  const card = (title: string, children: ReactNode) => (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          {mode === "create" ? "Nuevo proyecto" : "Editar proyecto"}
        </h1>
        <button onClick={() => router.push("/client/projects")}
          style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
          ← Volver
        </button>
      </div>

      {mode === "create" && card("Crear desde documento (opcional)", (
        <div>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "0 0 12px" }}>
            PDF, Excel, Word, PPT, CSV — la IA extrae los datos y pre-llena el formulario. Después revisás.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => fileRef.current?.click()}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px dashed var(--border)", background: "var(--secondary)", color: "var(--foreground)", cursor: "pointer", fontSize: 13 }}>
              <Upload size={14} /> {aiFile ? aiFile.name : "Elegir documento"}
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.pptx,.ppt" style={{ display: "none" }}
              onChange={(e) => setAiFile(e.target.files?.[0] ?? null)} />
            <button onClick={processAIFile} disabled={!aiFile || aiLoading}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: aiFile ? "var(--primary)" : "var(--secondary)", color: aiFile ? "#fff" : "var(--muted-foreground)", cursor: aiFile && !aiLoading ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}>
              {aiLoading ? "Procesando…" : "Procesar con IA"}
            </button>
            {(aiFile || aiInboxId) && (
              <button onClick={() => { setAiFile(null); setAiInboxId(null); setAiMsg(""); if (fileRef.current) fileRef.current.value = ""; }}
                style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>
                Quitar documento
              </button>
            )}
          </div>
          {aiMsg && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 10 }}>{aiMsg}</div>}
        </div>
      ))}

      {card("Datos del proyecto", (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>{label("Nombre del proyecto *")}<input value={form.name} onChange={(e) => set("name", e.target.value)} style={inputStyle} placeholder="Q3 BTL Campaign" /></div>
          <div>{label("Descripción / Brief")}<textarea value={form.brief} onChange={(e) => set("brief", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} /></div>
          <div>{label("Objetivos")}<textarea value={form.objectives} onChange={(e) => set("objectives", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></div>
          <div>
            {label("Estado")}
            <select value={form.status} onChange={(e) => set("status", e.target.value)} style={inputStyle}>
              <option value="active">Activo</option>
              <option value="paused">Pausado</option>
              <option value="archived">Archivado</option>
              <option value="closed">Cerrado</option>
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>{label("Fecha inicio")}<input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} style={inputStyle} /></div>
            <div>{label("Fecha fin")}<input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} style={inputStyle} /></div>
          </div>
          <div>{label("Presupuesto (CLP)")}<input value={form.budget} onChange={(e) => set("budget", e.target.value)} style={inputStyle} placeholder="5000000" /></div>
        </div>
      ))}

      {card("Cliente y economía", (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>{label("Cliente final")}<input value={form.cliente_final} onChange={(e) => set("cliente_final", e.target.value)} style={inputStyle} placeholder="Marca / empresa" /></div>
          <div>{label("RUT del cliente")}<input value={form.cliente_rut} onChange={(e) => set("cliente_rut", e.target.value)} style={inputStyle} placeholder="76.123.456-7" /></div>
          <div>{label("Costo estimado (CLP)")}<input value={form.costo_estimado} onChange={(e) => set("costo_estimado", e.target.value)} style={inputStyle} placeholder="3000000" /></div>
          <div>{label("Margen proyectado (%)")}
            <input
              value={(() => { const m = computeMargenPct(form.budget, form.costo_estimado); return m != null ? `${m}%` : ""; })()}
              readOnly
              disabled
              title="Se calcula solo: (Presupuesto − Costo) / Presupuesto × 100"
              style={{ ...inputStyle, color: "var(--muted-foreground)", cursor: "not-allowed" }}
              placeholder="Se calcula solo"
            />
          </div>
        </div>
      ))}

      {card("Locales / PDVs", (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {form.locales.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <input value={l.nombre} onChange={(e) => set("locales", form.locales.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} style={inputStyle} placeholder="Nombre PDV" />
              <input value={l.direccion} onChange={(e) => set("locales", form.locales.map((x, j) => j === i ? { ...x, direccion: e.target.value } : x))} style={inputStyle} placeholder="Dirección" />
              <button onClick={() => set("locales", form.locales.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 6 }}><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => set("locales", [...form.locales, { nombre: "", direccion: "" }])}
            style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", padding: "6px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 12 }}>
            <Plus size={13} /> Agregar local
          </button>
        </div>
      ))}

      {card("Perfil de personas", (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {form.personas.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <input value={p.rol} onChange={(e) => set("personas", form.personas.map((x, j) => j === i ? { ...x, rol: e.target.value } : x))} style={inputStyle} placeholder="Rol (ej. promotora)" />
              <input value={p.cantidad} onChange={(e) => set("personas", form.personas.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))} style={{ ...inputStyle, maxWidth: 120 }} placeholder="Cantidad" />
              <button onClick={() => set("personas", form.personas.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 6 }}><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => set("personas", [...form.personas, { rol: "", cantidad: "" }])}
            style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", padding: "6px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 12 }}>
            <Plus size={13} /> Agregar rol
          </button>
        </div>
      ))}

      {card("Hitos", (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {form.hitos.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <input value={h} onChange={(e) => set("hitos", form.hitos.map((x, j) => j === i ? e.target.value : x))} style={inputStyle} placeholder="Hito / entregable" />
              <button onClick={() => set("hitos", form.hitos.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 6 }}><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => set("hitos", [...form.hitos, ""])}
            style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", padding: "6px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 12 }}>
            <Plus size={13} /> Agregar hito
          </button>
        </div>
      ))}

      {error && <div style={{ fontSize: 13, padding: "10px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)", marginBottom: 16 }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingBottom: 40 }}>
        <button onClick={() => router.push("/client/projects")}
          style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
          Cancelar
        </button>
        <button onClick={submit} disabled={saving || !form.name.trim()}
          style={{ padding: "10px 22px", borderRadius: 8, border: "none", background: form.name.trim() ? "var(--primary)" : "var(--secondary)", color: form.name.trim() ? "#fff" : "var(--muted-foreground)", cursor: saving ? "default" : "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {saving ? "Guardando…" : mode === "create" ? "Crear proyecto" : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useRef } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

type Project = {
  id: string;
  name: string;
  description?: string;
  status: string;
  start_date?: string;
  end_date?: string;
  budget?: number;
  objectives?: string;
};

const STATUS_STYLE: Record<string, { background: string; color: string }> = {
  active:   { background: "rgba(42,157,92,0.15)",  color: "#34b96e" },
  paused:   { background: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  archived: { background: "rgba(100,116,139,0.15)",color: "#94a3b8" },
};

// Las fechas de proyecto son date-only (columnas DATE, medianoche UTC). Sin timeZone:"UTC"
// se renderizan en hora local (Chile UTC-4) y caen al día anterior. Forzar UTC evita el corrimiento.
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("es-CL", { timeZone: "UTC" }) : "—";
const fmtMoney = (v?: number) => v ? `$${Number(v).toLocaleString("es-CL")}` : "—";

export default function ProjectsPage() {
  const [projects, setProjects]   = useState<Project[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [showForm, setShowForm]   = useState(false);
  const [showAI, setShowAI]       = useState(false);
  const [selected, setSelected]   = useState<Project | null>(null);
  const [form, setForm]           = useState({ name: "", description: "", objectives: "", status: "active", start_date: "", end_date: "", budget: "" });
  const [saving, setSaving]       = useState(false);

  // AI upload states
  const [aiFile, setAiFile]       = useState<File | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult]   = useState<any>(null);
  const [aiInboxId, setAiInboxId] = useState<string | null>(null);
  const [aiError, setAiError]     = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchProjects = () => {
    setLoading(true);
    api.get<any>("/projects")
      .then(r => setProjects(Array.isArray(r) ? r : (r?.data ?? [])))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProjects(); }, []);

  const filtered = projects.filter(p =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase())
  );

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (selected) {
        await api.patch(`/projects/${selected.id}`, { ...form, budget: form.budget ? parseFloat(form.budget) : undefined });
      } else {
        await api.post("/projects", { ...form, budget: form.budget ? parseFloat(form.budget) : undefined });
      }
      setShowForm(false);
      setSelected(null);
      setForm({ name: "", description: "", objectives: "", status: "active", start_date: "", end_date: "", budget: "" });
      fetchProjects();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const openEdit = (p: Project) => {
    setSelected(p);
    setForm({ name: p.name, description: p.description ?? "", objectives: p.objectives ?? "", status: p.status, start_date: p.start_date ?? "", end_date: p.end_date ?? "", budget: p.budget ? String(p.budget) : "" });
    setShowForm(true);
  };

  // CLP no usa decimales y el separador de miles es el punto: "5.000.000" o "$5.000.000".
  // parseFloat("5.000.000") devuelve 5 (se corta en el segundo punto), así que limpiamos
  // a solo dígitos antes de parsear. Devuelve undefined si no hay ningún dígito.
  const parseCLP = (v: any): number | undefined => {
    const digits = String(v ?? "").replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : undefined;
  };

  // Mapea el extracted_data del inbox (IA) a los campos editables del form de revisión.
  const mapExtracted = (ex: any) => ({
    nombre_proyecto: ex?.nombre_proyecto ?? "",
    brief: ex?.brief ?? "",
    fecha_inicio: ex?.fecha_inicio ?? "",
    fecha_fin: ex?.fecha_fin ?? "",
    presupuesto_otorgado: ex?.presupuesto_otorgado ?? "",
  });

  const processAIFile = async () => {
    if (!aiFile) return;
    setAiLoading(true);
    setAiError("");
    setAiResult(null);
    setAiInboxId(null);
    try {
      // 1) Subir el archivo real como multipart (el backend lo guarda en Storage y
      //    encola la extracción IA que puebla extracted_data → status READY).
      const fd = new FormData();
      fd.append("file", aiFile);
      const inbox = await api.upload<any>("/v1/app/project-inbox/upload", fd);
      const inboxId = inbox?.id ?? inbox?.data?.id;
      if (!inboxId) throw new Error("El backend no devolvió un id de inbox.");
      setAiInboxId(inboxId);

      // 2) Poll hasta READY (éxito) o PENDING tras haber estado PROCESSING (error IA).
      //    Cap ~40s.
      const MAX_POLLS = 25;
      const DELAY_MS = 1500;
      let sawProcessing = false;

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
        const item = await api.get<any>(`/v1/app/project-inbox/${inboxId}`);
        const data = item?.data ?? item;
        const status = data?.status;

        if (status === "PROCESSING") sawProcessing = true;

        if (status === "READY") {
          setAiResult(mapExtracted(data?.extracted_data ?? {}));
          return;
        }
        // Volver a PENDING tras PROCESSING = la extracción falló y reintenta/aborta.
        if (status === "PENDING" && sawProcessing) {
          setAiResult(mapExtracted({}));
          setAiError("No se pudieron extraer los datos automáticamente. Completa los campos a mano.");
          return;
        }
      }

      // Timeout: dejar el form editable para carga manual.
      setAiResult(mapExtracted({}));
      setAiError("La extracción está tardando. Podés completar los campos a mano y crear el proyecto.");
    } catch (e) {
      console.error(e);
      setAiError(e instanceof Error ? e.message : "Error al procesar el documento.");
    } finally { setAiLoading(false); }
  };

  const approveAI = async () => {
    if (!aiResult || !aiInboxId) return;
    setSaving(true);
    try {
      await api.put(`/v1/app/project-inbox/${aiInboxId}/approve`, {
        nombre_proyecto: aiResult.nombre_proyecto || undefined,
        brief: aiResult.brief || undefined,
        fecha_inicio: aiResult.fecha_inicio || undefined,
        fecha_fin: aiResult.fecha_fin || undefined,
        presupuesto_otorgado: parseCLP(aiResult.presupuesto_otorgado),
      });
      setShowAI(false);
      setAiFile(null);
      setAiResult(null);
      setAiInboxId(null);
      fetchProjects();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const inp = (field: string, label: string, type = "text", opts?: any) => (
    <div key={field}>
      <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--muted-foreground)" }}>{label}</label>
      {type === "textarea" ? (
        <textarea value={(form as any)[field]} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
          placeholder={opts?.placeholder} rows={3}
          style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, padding: "9px 12px", outline: "none", resize: "vertical", boxSizing: "border-box" as any }} />
      ) : type === "select" ? (
        <select value={(form as any)[field]} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
          style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none" }}>
          {opts?.options?.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type={type} value={(form as any)[field]} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
          placeholder={opts?.placeholder}
          style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", boxSizing: "border-box" as any }} />
      )}
    </div>
  );

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Proyectos</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Agrupa campañas y activaciones bajo un contenedor lógico</p>
          </div>
          <div className="flex gap-2">
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar proyectos..."
              style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", width: 200 }} />
            <button onClick={() => { setShowAI(true); setAiResult(null); setAiFile(null); setAiInboxId(null); setAiError(""); }}
              style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
              AI desde doc
            </button>
            <button onClick={() => { setShowForm(true); setSelected(null); setForm({ name: "", description: "", objectives: "", status: "active", start_date: "", end_date: "", budget: "" }); }}
              style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "var(--red)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              + Nuevo proyecto
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full border-collapse">
            <thead style={{ background: "var(--secondary)" }}>
              <tr>
                {["Nombre", "Estado", "Inicio", "Fin", "Presupuesto", "Acciones"].map(h => (
                  <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>No hay proyectos.</td></tr>
              ) : filtered.map(p => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  <td className="px-4 py-3 text-sm font-medium">{p.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize" style={STATUS_STYLE[p.status] ?? STATUS_STYLE.active}>{p.status}</span>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>{fmtDate(p.start_date)}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>{fmtDate(p.end_date)}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{fmtMoney(p.budget)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(p)} className="text-xs px-2 py-1 rounded"
                      style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Manual Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setShowForm(false)}>
            <div className="rounded-2xl border p-6 w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">{selected ? "Editar proyecto" : "Nuevo proyecto"}</h3>
                <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 20 }}>✕</button>
              </div>
              <div className="space-y-3">
                {inp("name", "Nombre del proyecto *", "text", { placeholder: "Q3 BTL Campaign" })}
                {inp("description", "Descripción", "textarea", { placeholder: "Descripción opcional" })}
                {inp("objectives", "Objetivos", "textarea", { placeholder: "Objetivos del proyecto (opcional)" })}
                {inp("status", "Estado", "select", { options: [{ value: "active", label: "Activo" }, { value: "paused", label: "Pausado" }, { value: "archived", label: "Archivado" }] })}
                <div className="grid grid-cols-2 gap-3">
                  {inp("start_date", "Fecha inicio", "date")}
                  {inp("end_date", "Fecha fin", "date")}
                </div>
                {inp("budget", "Presupuesto (CLP)", "number", { placeholder: "5000000" })}
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer" }}>Cancelar</button>
                <button onClick={save} disabled={saving || !form.name.trim()}
                  style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", background: form.name.trim() ? "var(--red)" : "var(--secondary)", color: form.name.trim() ? "#fff" : "var(--muted-foreground)", cursor: "pointer", fontWeight: 600 }}>
                  {saving ? "Guardando..." : selected ? "Guardar cambios" : "Crear proyecto"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* AI Upload Modal */}
        {showAI && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setShowAI(false)}>
            <div className="rounded-2xl border p-6 w-full max-w-lg" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-lg">Crear proyecto desde documento</h3>
                  <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>PDF, Excel, Word, PPT — AI extrae la info del proyecto</p>
                </div>
                <button onClick={() => setShowAI(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 20 }}>✕</button>
              </div>

              {!aiResult && (
                <div>
                  <div
                    onClick={() => fileRef.current?.click()}
                    style={{ border: "2px dashed var(--border)", borderRadius: 12, padding: 32, textAlign: "center", cursor: "pointer", marginBottom: 16 }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setAiFile(f); }}>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
                    <div className="font-medium text-sm mb-1">{aiFile ? aiFile.name : "Arrastra el documento aqui"}</div>
                    <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>PDF, Excel, Word, PowerPoint</div>
                    <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.docx,.doc,.pptx,.ppt" style={{ display: "none" }} onChange={e => setAiFile(e.target.files?.[0] ?? null)} />
                  </div>
                  {aiError && !aiLoading && (
                    <div className="text-xs px-3 py-2 rounded-lg mb-3" style={{ background: "rgba(200,32,44,0.12)", color: "var(--red-light, #f87171)" }}>{aiError}</div>
                  )}
                  <button onClick={processAIFile} disabled={!aiFile || aiLoading}
                    style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: aiFile ? "var(--red)" : "var(--secondary)", color: aiFile ? "#fff" : "var(--muted-foreground)", cursor: aiFile ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 600 }}>
                    {aiLoading ? "AI procesando documento..." : "Procesar con AI"}
                  </button>
                </div>
              )}

              {aiResult && (
                <div>
                  {/* Yellow approval banner - as per PDF spec */}
                  <div className="rounded-xl p-4 mb-4" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)" }}>
                    <div className="font-semibold text-sm" style={{ color: "#f59e0b" }}>Revision requerida antes de crear</div>
                    <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>Verifica que los datos extraidos por AI son correctos antes de aprobar.</div>
                  </div>

                  {aiError && (
                    <div className="text-xs px-3 py-2 rounded-lg mb-4" style={{ background: "rgba(200,32,44,0.12)", color: "var(--red-light, #f87171)" }}>{aiError}</div>
                  )}

                  <div className="space-y-3 mb-4">
                    {[
                      { label: "Nombre del proyecto", key: "nombre_proyecto" },
                      { label: "Descripcion / Brief", key: "brief" },
                      { label: "Fecha inicio", key: "fecha_inicio" },
                      { label: "Fecha fin", key: "fecha_fin" },
                      { label: "Presupuesto (CLP)", key: "presupuesto_otorgado" },
                    ].map(({ label, key }) => (
                      <div key={key}>
                        <label className="text-xs font-medium block mb-1" style={{ color: "var(--muted-foreground)" }}>{label}</label>
                        <input
                          value={aiResult[key] ?? ""}
                          onChange={e => setAiResult((prev: any) => ({ ...prev, [key]: e.target.value }))}
                          style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", boxSizing: "border-box" as any }}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => { setAiResult(null); setAiFile(null); setAiInboxId(null); setAiError(""); }}
                      style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer" }}>
                      Reintentar
                    </button>
                    <button onClick={approveAI} disabled={saving}
                      style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", background: "var(--red)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                      {saving ? "Creando..." : "Aprobar y crear proyecto"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import AppShell from "@/components/layout/app-shell";
import { X, Upload, Check, AlertCircle, ChevronRight, RefreshCw, Download, Plus, Loader2 } from "lucide-react";

// NEXT_PUBLIC_API_URL NO incluye /api (contrato de lib/api.ts). El /api se agrega acá.
const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api`;
function getToken() { return typeof window !== "undefined" ? (localStorage.getItem("cs_token") ?? "") : ""; }

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(options?.headers ?? {}) },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message ?? `HTTP ${res.status}`); }
  return res.json();
}

function formatCLP(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);
}

type Tab = "gastos" | "ventas" | "costos";
interface InvoiceRow {
  id: string; vendor_name: string | null; amount: number | null;
  currency: string; invoice_date: string | null; category: string;
  source: string; description: string | null; status: string; created_at: string;
  numero_documento?: string | null; rut_emisor?: string | null; destino?: string | null;
  confidence_score?: number | null;
}
interface ReportSection { total_amount: number; total_count: number; rows: InvoiceRow[]; }
interface ReportData { sales: ReportSection; costs: ReportSection; expenses: ReportSection; }
type StageStatus = "pending" | "running" | "completed" | "failed";
interface DisplayStage { name: string; label: string; status: StageStatus; }

const stageColors: Record<StageStatus, string> = {
  completed: "#34b96e", running: "#6366f1", failed: "#e8353f", pending: "var(--muted-foreground)",
};

function UploadModal({ target, onClose, onDone }: { target: Tab; onClose: () => void; onDone: () => void }) {
  const [stage, setStage] = useState<1 | 2 | 3 | 4>(1);
  const [file, setFile] = useState<File | null>(null);
  const [eventoId, setEventoId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [editedData, setEditedData] = useState<any>({});
  const [classifData, setClassifData] = useState<any>(null);
  const [confidencePct, setConfidencePct] = useState(0);
  const [animDone, setAnimDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const animTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [pipelineStages, setPipelineStages] = useState<DisplayStage[]>([
    { name: "upload", label: "Recepcion del documento", status: "completed" },
    { name: "ocr", label: "OCR · Extraccion de texto", status: "running" },
    { name: "classification", label: "Clasificacion IA", status: "pending" },
    { name: "persist", label: "Persistencia en base de datos", status: "pending" },
  ]);

  const targetLabel = { gastos: "Gastos", ventas: "Ventas", costos: "Costos" }[target];
  const stopPolling = () => { if (pollRef.current) clearInterval(pollRef.current); if (animTimerRef.current) clearTimeout(animTimerRef.current); };

  const animateAndProceed = useCallback((classif: any, conf: number) => {
    if (animDone) return;
    setAnimDone(true);
    setPipelineStages([{ name: "upload", label: "Recepcion del documento", status: "completed" }, { name: "ocr", label: "OCR · Extraccion de texto", status: "completed" }, { name: "classification", label: "Clasificacion IA", status: "running" }, { name: "persist", label: "Persistencia en base de datos", status: "pending" }]);
    setTimeout(() => {
      setPipelineStages([{ name: "upload", label: "Recepcion del documento", status: "completed" }, { name: "ocr", label: "OCR · Extraccion de texto", status: "completed" }, { name: "classification", label: "Clasificacion IA", status: "completed" }, { name: "persist", label: "Persistencia en base de datos", status: "running" }]);
      setTimeout(() => {
        setPipelineStages([{ name: "upload", label: "Recepcion del documento", status: "completed" }, { name: "ocr", label: "OCR · Extraccion de texto", status: "completed" }, { name: "classification", label: "Clasificacion IA", status: "completed" }, { name: "persist", label: "Persistencia en base de datos", status: "completed" }]);
        setTimeout(() => setStage(3), 700);
      }, 900);
    }, 900);
  }, [animDone]);

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await apiFetch<{ data: any }>(`/invoices/eventos/status/${id}`);
      const s = res.data.status;
      const terminal = ["processed", "low_confidence", "unclassified", "failed_ocr", "failed_classification", "duplicate", "failed"];
      if (terminal.includes(s)) {
        stopPolling();
        if (s === "duplicate") { setError("Documento duplicado."); setStage(1); }
        else if (["failed_ocr", "failed_classification", "failed"].includes(s)) {
          setPipelineStages(prev => prev.map(p => p.status === "running" ? { ...p, status: "failed" } : p));
          setError(res.data.error_message ?? "Error en pipeline.");
          setTimeout(() => setStage(1), 2000);
        } else {
          const classif = res.data.ai_classification;
          const conf = res.data.confidence_score ?? classif?.confidence_score ?? 0;
          setConfidencePct(Math.round(conf * 100));
          setClassifData(classif);
          setEditedData({ tipo: classif?.tipo ?? "", destino: classif?.destino ?? "", categoria: classif?.categoria ?? "", numero_documento: classif?.datos_extraidos?.numero_documento ?? "", rut_emisor: classif?.datos_extraidos?.rut_emisor ?? "", razon_social_emisor: classif?.datos_extraidos?.razon_social_emisor ?? "", monto_total: classif?.datos_extraidos?.monto_total ?? "", fecha_emision: classif?.datos_extraidos?.fecha_emision ?? "" });
          animateAndProceed(classif, conf);
        }
      }
    } catch { }
  }, [animateAndProceed]);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true); setError("");
    try {
      const base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
      const res = await fetch(`${API_BASE}/invoices/upload`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ file_base64: base64, mime_type: file.type || "image/jpeg", filename: file.name, target }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message ?? "Upload failed"); }
      const data = await res.json();
      const id = data?.data?.evento_crudo_id ?? data?.evento_crudo_id ?? data?.id;
      if (!id) throw new Error("No ID");
      setEventoId(id); setStage(2);
      animTimerRef.current = setTimeout(() => animateAndProceed(null, 0), 8000);
      pollRef.current = setInterval(() => pollStatus(id), 1500);
    } catch (e: any) { setError(e.message ?? "Upload failed"); } finally { setUploading(false); }
  };

  const handleConfirm = async () => { setStage(4); setTimeout(() => { onDone(); onClose(); }, 2000); };
  useEffect(() => () => stopPolling(), []);

  const inp = (key: string, label: string, type = "text") => (
    <div key={key}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>{label}</label>
      <input type={type} value={editedData[key] ?? ""} onChange={e => setEditedData((d: any) => ({ ...d, [key]: e.target.value }))}
        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", boxSizing: "border-box" as any }} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
      <div className="rounded-2xl border w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="font-bold text-base flex items-center gap-2">
              Subir documento
              <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: "var(--red)", color: "#fff" }}>{targetLabel}</span>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>IA</span>
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>La IA lee, clasifica y agrega al reporte correcto</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)" }}><X size={18} /></button>
        </div>

        {/* Steps */}
        <div className="px-5 pt-4 flex items-center gap-2">
          {[{ n: 1, label: "Subir" }, { n: 2, label: "Procesar" }, { n: 3, label: "Revisar" }, { n: 4, label: "Listo" }].map((s, i) => (
            <div key={s.n} className="flex items-center gap-2 flex-1">
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: stage >= s.n ? "#6366f1" : "var(--secondary)", color: stage >= s.n ? "#fff" : "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                {stage > s.n ? <Check size={12} /> : s.n}
              </div>
              <span style={{ fontSize: 12, fontWeight: stage === s.n ? 600 : 400, color: stage === s.n ? "var(--foreground)" : "var(--muted-foreground)" }}>{s.label}</span>
              {i < 3 && <div style={{ flex: 1, height: 1, background: stage > s.n ? "#6366f1" : "var(--border)" }} />}
            </div>
          ))}
        </div>

        <div className="p-5">
          {stage === 1 && (
            <div>
              <input ref={fileRef} type="file" accept=".pdf,image/*" style={{ display: "none" }} onChange={e => setFile(e.target.files?.[0] ?? null)} />
              {!file ? (
                <div onClick={() => fileRef.current?.click()} onDrop={e => { e.preventDefault(); setFile(e.dataTransfer.files[0]); }} onDragOver={e => e.preventDefault()}
                  style={{ border: "2px dashed var(--border)", borderRadius: 12, padding: 48, textAlign: "center", cursor: "pointer", background: "var(--secondary)" }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Arrastra el documento aqui</div>
                  <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>PDF, JPG, PNG · facturas, boletas, OCs</div>
                </div>
              ) : (
                <div style={{ borderRadius: 10, border: "1px solid var(--border)", padding: 16, background: "var(--secondary)", display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 24 }}>📄</span>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{file.name}</div><div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{(file.size / 1024).toFixed(0)} KB</div></div>
                  <button onClick={() => setFile(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 12 }}>Cambiar</button>
                </div>
              )}
              {error && <div style={{ color: "#e8353f", fontSize: 13, marginTop: 12 }}>{error}</div>}
            </div>
          )}

          {stage === 2 && (
            <div className="rounded-xl p-5" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1" }} />
                Procesando con IA · pipeline en tiempo real
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pipelineStages.map(ps => (
                  <div key={ps.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: "var(--card)", border: `1px solid ${ps.status === "running" ? "#6366f1" : ps.status === "completed" ? "#34b96e" : ps.status === "failed" ? "#e8353f" : "var(--border)"}` }}>
                    {ps.status === "completed" && <Check size={16} style={{ color: "#34b96e" }} />}
                    {ps.status === "running" && <Loader2 size={16} className="animate-spin" style={{ color: "#6366f1" }} />}
                    {ps.status === "failed" && <AlertCircle size={16} style={{ color: "#e8353f" }} />}
                    {ps.status === "pending" && <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid var(--border)" }} />}
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{ps.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stage === 3 && (
            <div>
              <div style={{ borderRadius: 10, border: "1px solid rgba(42,157,92,0.4)", padding: 16, background: "rgba(42,157,92,0.1)", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#34b96e", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Check size={18} color="#fff" />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#34b96e" }}>Clasificado como <strong>{classifData?.destino ?? editedData.destino ?? "—"}</strong></div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{classifData?.tipo ?? editedData.tipo ?? "—"} · {classifData?.categoria ?? editedData.categoria ?? "—"}{confidencePct > 0 && ` · ${confidencePct}% confianza`}</div>
                </div>
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Datos extraidos (editables)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[{ key: "tipo", label: "Tipo" }, { key: "numero_documento", label: "N documento" }, { key: "razon_social_emisor", label: "Proveedor / Emisor" }, { key: "rut_emisor", label: "RUT" }, { key: "fecha_emision", label: "Fecha", type: "date" }, { key: "monto_total", label: "Monto" }, { key: "categoria", label: "Categoria" }, { key: "destino", label: "Reporte destino" }].map(({ key, label, type }) => inp(key, label, type))}
              </div>
            </div>
          )}

          {stage === 4 && (
            <div style={{ textAlign: "center", padding: "48px 0" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(42,157,92,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <Check size={32} style={{ color: "#34b96e" }} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Documento guardado</div>
              <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>El reporte se actualizara en breve.</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "monospace" }}>{eventoId && `evt: ${eventoId.slice(0, 8)}...`}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", cursor: "pointer", fontSize: 13 }}>Cancelar</button>
            {stage === 1 && (
              <button onClick={handleUpload} disabled={!file || uploading}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: !file ? "var(--secondary)" : "#6366f1", color: !file ? "var(--muted-foreground)" : "#fff", cursor: !file ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                {uploading ? <><Loader2 size={14} className="animate-spin" />Subiendo...</> : <><Upload size={14} />Subir y procesar</>}
              </button>
            )}
            {stage === 3 && (
              <button onClick={handleConfirm} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#34b96e", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <Check size={14} /> Confirmar y guardar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ManualModal({ target, onClose, onDone }: { target: Tab; onClose: () => void; onDone: () => void }) {
  const targetLabel = { gastos: "Gastos", ventas: "Ventas", costos: "Costos" }[target];
  const [form, setForm] = useState({ vendor_name: "", amount: "", currency: "CLP", invoice_date: new Date().toISOString().slice(0, 10), category: target === "gastos" ? "expense" : target === "ventas" ? "sale" : "cost", description: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true); setError("");
    try {
      await apiFetch("/invoices", { method: "POST", body: JSON.stringify({ source: "manual", vendor_name: form.vendor_name || undefined, amount: form.amount ? parseFloat(form.amount) : undefined, currency: form.currency, invoice_date: form.invoice_date || undefined, category: form.category, description: form.description || undefined }) });
      onDone(); onClose();
    } catch (e: any) { setError(e.message ?? "Failed to save"); } finally { setSaving(false); }
  };

  const field = (key: keyof typeof form, label: string, type = "text", placeholder = "") => (
    <div key={key}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>{label}</label>
      <input type={type} placeholder={placeholder} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", boxSizing: "border-box" as any }} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
      <div className="rounded-2xl border w-full max-w-lg" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="font-bold text-base flex items-center gap-2">Registro manual <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>{targetLabel}</span></div>
            <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Sin IA · captura directa</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)" }}><X size={18} /></button>
        </div>
        <div className="p-5">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>{field("description", "Descripcion *", "text", "Ej: Bencina equipo terreno")}</div>
            {field("vendor_name", "Proveedor")}
            {field("invoice_date", "Fecha *", "date")}
            {field("amount", "Monto *", "number", "0")}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Moneda</label>
              <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none" }}>
                <option>CLP</option><option>USD</option><option>EUR</option>
              </select>
            </div>
          </div>
          {error && <div style={{ color: "#e8353f", fontSize: 13, marginTop: 12 }}>{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={save} disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { background: string; color: string }> = {
    email:    { background: "rgba(99,102,241,0.15)",  color: "#818cf8" },
    whatsapp: { background: "rgba(42,157,92,0.15)",   color: "#34b96e" },
    manual:   { background: "var(--secondary)",        color: "var(--muted-foreground)" },
  };
  const s = map[source] ?? map.manual;
  return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 600, background: s.background, color: s.color, textTransform: "capitalize" }}>{source}</span>;
}

function KpiCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? "var(--foreground)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

const TH = ({ children }: { children: React.ReactNode }) => (
  <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>{children}</th>
);
const TD = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <td style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", ...style }}>{children}</td>
);

export default function ReportesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("gastos");
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadTarget, setUploadTarget] = useState<Tab | null>(null);
  const [manualTarget, setManualTarget] = useState<Tab | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try { const res = await apiFetch<{ data: ReportData }>("/invoices/report"); setReport(res.data); } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const expenses = report?.expenses?.rows ?? [];
  const sales    = report?.sales?.rows ?? [];
  const costs    = report?.costs?.rows ?? [];

  const ActionBar = ({ tabKey }: { tabKey: Tab }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 14 }}>
      <button onClick={() => setUploadTarget(tabKey)}
        style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
        <Upload size={13} /> Subir doc IA
      </button>
      <button onClick={() => setManualTarget(tabKey)}
        style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
        <Plus size={13} /> Manual
      </button>
      <button style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
        <Download size={13} /> Exportar
      </button>
    </div>
  );

  const renderTable = (rows: InvoiceRow[], cols: { label: string; render: (r: InvoiceRow) => React.ReactNode }[]) => (
    <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: "var(--border)" }}>
      <table className="w-full border-collapse" style={{ fontSize: 13 }}>
        <thead><tr>{cols.map(c => <TH key={c.label}>{c.label}</TH>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length} style={{ padding: "40px 0", textAlign: "center", color: "var(--muted-foreground)" }}>Sin registros. Sube un documento o agrega manualmente.</td></tr>
          ) : rows.map(row => (
            <tr key={row.id} onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")} onMouseLeave={e => (e.currentTarget.style.background = "")}>
              {cols.map(c => <TD key={c.label}>{c.render(row)}</TD>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <AppShell>
      {uploadTarget && <UploadModal target={uploadTarget} onClose={() => setUploadTarget(null)} onDone={fetchReport} />}
      {manualTarget && <ManualModal target={manualTarget} onClose={() => setManualTarget(null)} onDone={fetchReport} />}

      <div className="animate-fade-up">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>Reportes Internos</h1>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>Documentos ingresados por WhatsApp, email o manual</p>
          </div>
          <button onClick={fetchReport} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
          {(["gastos", "ventas", "costos"] as Tab[]).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ padding: "10px 18px", fontSize: 14, fontWeight: activeTab === tab ? 600 : 400, borderBottom: activeTab === tab ? "2px solid var(--red)" : "2px solid transparent", color: activeTab === tab ? "var(--foreground)" : "var(--muted-foreground)", background: "none", cursor: "pointer", marginBottom: -1, textTransform: "capitalize" }}>
              {tab}
            </button>
          ))}
        </div>

        {/* GASTOS */}
        {activeTab === "gastos" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
              <KpiCard label="Total gastos" value={formatCLP(report?.expenses?.total_amount ?? null)} color="#e8353f" />
              <KpiCard label="Registros" value={String(report?.expenses?.total_count ?? 0)} />
              <KpiCard label="Confianza IA" value="—" color="#34b96e" />
            </div>
            <ActionBar tabKey="gastos" />
            {renderTable(expenses, [
              { label: "Fecha", render: r => <span style={{ color: "var(--muted-foreground)" }}>{r.invoice_date ?? "—"}</span> },
              { label: "Descripcion", render: r => <span style={{ fontWeight: 500 }}>{r.description ?? "—"}</span> },
              { label: "Proveedor", render: r => r.vendor_name ?? "—" },
              { label: "Monto", render: r => <span style={{ fontWeight: 700, color: "#e8353f" }}>{r.amount ? `−${formatCLP(r.amount)}` : "—"}</span> },
              { label: "Origen", render: r => <SourceBadge source={r.source} /> },
              { label: "Confianza", render: r => <span style={{ color: "var(--muted-foreground)" }}>{r.confidence_score ? `${Math.round(r.confidence_score * 100)}%` : "—"}</span> },
            ])}
            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {[
                { label: "Por fuente", content: (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {["email", "whatsapp", "manual"].map(src => {
                      const count = expenses.filter(r => r.source === src).length;
                      return (
                        <div key={src}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                            <span style={{ textTransform: "capitalize", color: "var(--muted-foreground)" }}>{src}</span>
                            <span style={{ fontWeight: 600 }}>{count}</span>
                          </div>
                          <div style={{ height: 4, borderRadius: 4, background: "var(--secondary)" }}>
                            <div style={{ height: "100%", borderRadius: 4, background: src === "email" ? "#818cf8" : src === "whatsapp" ? "#34b96e" : "var(--muted-foreground)", width: expenses.length ? `${count / expenses.length * 100}%` : "0%" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )},
                { label: "Total", content: <div style={{ fontSize: 28, fontWeight: 800, color: "#e8353f" }}>{formatCLP(report?.expenses?.total_amount ?? null)}</div> },
                { label: "Alertas IA", content: <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Documentos con confianza baja apareceran aqui para revision.</div> },
              ].map(({ label, content }) => (
                <div key={label} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{label}</div>
                  {content}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VENTAS */}
        {activeTab === "ventas" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
              <KpiCard label="Total ventas" value={formatCLP(report?.sales?.total_amount ?? null)} color="#34b96e" />
              <KpiCard label="Facturas" value={String(report?.sales?.total_count ?? 0)} />
              <KpiCard label="Por cobrar" value="—" color="#f59e0b" />
            </div>
            <ActionBar tabKey="ventas" />
            {renderTable(sales, [
              { label: "Fecha", render: r => <span style={{ color: "var(--muted-foreground)" }}>{r.invoice_date ?? "—"}</span> },
              { label: "N Factura", render: r => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{r.numero_documento ?? "—"}</span> },
              { label: "Cliente", render: r => <span style={{ fontWeight: 500 }}>{r.vendor_name ?? r.description ?? "—"}</span> },
              { label: "Monto", render: r => <span style={{ fontWeight: 700, color: "#34b96e" }}>+{formatCLP(r.amount)}</span> },
              { label: "Estado", render: r => <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: r.status === "approved" ? "rgba(42,157,92,0.15)" : "rgba(245,158,11,0.15)", color: r.status === "approved" ? "#34b96e" : "#f59e0b" }}>{r.status}</span> },
              { label: "Origen", render: r => <SourceBadge source={r.source} /> },
            ])}
          </div>
        )}

        {/* COSTOS */}
        {activeTab === "costos" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
              <KpiCard label="Total costos" value={formatCLP(report?.costs?.total_amount ?? null)} color="#f59e0b" />
              <KpiCard label="Registros" value={String(report?.costs?.total_count ?? 0)} />
              <KpiCard label="Margen bruto" value="—" color="#34b96e" />
            </div>
            <ActionBar tabKey="costos" />
            {renderTable(costs, [
              { label: "Fecha", render: r => <span style={{ color: "var(--muted-foreground)" }}>{r.invoice_date ?? "—"}</span> },
              { label: "OC / Factura", render: r => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{r.numero_documento ?? "—"}</span> },
              { label: "Proveedor", render: r => <span style={{ fontWeight: 500 }}>{r.vendor_name ?? "—"}</span> },
              { label: "Tipo", render: r => <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>{r.description ?? "—"}</span> },
              { label: "Monto", render: r => <span style={{ fontWeight: 700, color: "#f59e0b" }}>−{formatCLP(r.amount)}</span> },
              { label: "Origen", render: r => <SourceBadge source={r.source} /> },
            ])}
          </div>
        )}
      </div>
    </AppShell>
  );
}
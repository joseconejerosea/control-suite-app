"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import AppShell from "@/components/layout/app-shell";
import { X, Upload, Check, AlertCircle, ChevronRight, RefreshCw, Download, Plus, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
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
    { name: "upload", label: "Recepción del documento", status: "completed" },
    { name: "ocr", label: "OCR · Extracción de texto", status: "running" },
    { name: "classification", label: "Clasificación IA", status: "pending" },
    { name: "persist", label: "Persistencia en base de datos", status: "pending" },
  ]);

  const targetLabel = { gastos: "→ Gastos", ventas: "→ Ventas", costos: "→ Costos" }[target];

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
  };

  const animateAndProceed = useCallback((classif: any, conf: number) => {
    if (animDone) return;
    setAnimDone(true);

    setPipelineStages([
      { name: "upload", label: "Recepción del documento", status: "completed" },
      { name: "ocr", label: "OCR · Extracción de texto", status: "completed" },
      { name: "classification", label: "Clasificación IA", status: "running" },
      { name: "persist", label: "Persistencia en base de datos", status: "pending" },
    ]);
    setTimeout(() => {
      setPipelineStages([
        { name: "upload", label: "Recepción del documento", status: "completed" },
        { name: "ocr", label: "OCR · Extracción de texto", status: "completed" },
        { name: "classification", label: "Clasificación IA", status: "completed" },
        { name: "persist", label: "Persistencia en base de datos", status: "running" },
      ]);
      setTimeout(() => {
        setPipelineStages([
          { name: "upload", label: "Recepción del documento", status: "completed" },
          { name: "ocr", label: "OCR · Extracción de texto", status: "completed" },
          { name: "classification", label: "Clasificación IA", status: "completed" },
          { name: "persist", label: "Persistencia en base de datos", status: "completed" },
        ]);
        setTimeout(() => setStage(3), 700);
      }, 900);
    }, 900);
  }, [animDone]);

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await apiFetch<{ data: any }>(`/invoices/eventos/status/${id}`);
      const s = res.data.status;
      const terminalStatuses = ["processed", "low_confidence", "unclassified", "failed_ocr", "failed_classification", "duplicate", "failed"];

      if (terminalStatuses.includes(s)) {
        stopPolling();
        if (s === "duplicate") {
          setError("Documento duplicado — ya fue procesado antes.");
          setStage(1);
        } else if (s === "failed_ocr" || s === "failed_classification" || s === "failed") {
          setPipelineStages(prev => prev.map(p => p.status === "running" ? { ...p, status: "failed" } : p));
          setError(res.data.error_message ?? "Error en el pipeline. Intenta nuevamente.");
          setTimeout(() => setStage(1), 2000);
        } else if (s === "processed" || s === "low_confidence" || s === "unclassified") {
          const classif = res.data.ai_classification;
          const conf = res.data.confidence_score ?? classif?.confidence_score ?? 0;
          setConfidencePct(Math.round(conf * 100));
          setClassifData(classif);
          setEditedData({
            tipo: classif?.tipo ?? "",
            destino: classif?.destino ?? "",
            categoria: classif?.categoria ?? "",
            numero_documento: classif?.datos_extraidos?.numero_documento ?? "",
            rut_emisor: classif?.datos_extraidos?.rut_emisor ?? "",
            razon_social_emisor: classif?.datos_extraidos?.razon_social_emisor ?? "",
            monto_total: classif?.datos_extraidos?.monto_total ?? "",
            fecha_emision: classif?.datos_extraidos?.fecha_emision ?? "",
          });
          animateAndProceed(classif, conf);
        }
      } else if (s === "processing") {
        setPipelineStages([
          { name: "upload", label: "Recepción del documento", status: "completed" },
          { name: "ocr", label: "OCR · Extracción de texto", status: "running" },
          { name: "classification", label: "Clasificación IA", status: "pending" },
          { name: "persist", label: "Persistencia en base de datos", status: "pending" },
        ]);
      } else if (s === "ocr_done") {
        setPipelineStages([
          { name: "upload", label: "Recepción del documento", status: "completed" },
          { name: "ocr", label: "OCR · Extracción de texto", status: "completed" },
          { name: "classification", label: "Clasificación IA", status: "running" },
          { name: "persist", label: "Persistencia en base de datos", status: "pending" },
        ]);
      }
    } catch { }
  }, [animateAndProceed]);

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) setFile(f); };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true); setError("");
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const res = await fetch(`${API_BASE}/invoices/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ file_base64: base64, mime_type: file.type || "image/jpeg", filename: file.name, target }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).message ?? "Upload failed"); }
      const data = await res.json();
      const id = data?.data?.evento_crudo_id ?? data?.evento_crudo_id ?? data?.id;
      if (!id) throw new Error(`No ID: ${JSON.stringify(data)}`);
      setEventoId(id);
      setStage(2);

      // ✅ GUARANTEED: 8 sec baad animation chahe backend slow ho ya fast
      animTimerRef.current = setTimeout(() => animateAndProceed(null, 0), 8000);

      pollRef.current = setInterval(() => pollStatus(id), 1500);
    } catch (e: any) {
      setError(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    setStage(4);
    setTimeout(() => { onDone(); onClose(); }, 2000);
  };

  useEffect(() => () => stopPolling(), []);

  const stageColors: Record<StageStatus, string> = {
    completed: "#10b981", running: "#6366f1", failed: "#ef4444", pending: "#cbd5e1",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,15,25,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">

        <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-semibold text-lg flex items-center gap-2 text-slate-900">
              Subir documento <span className="text-sm font-normal text-slate-500">{targetLabel}</span>
              <span className="text-[10px] text-white px-1.5 py-0.5 rounded uppercase tracking-wider" style={{ background: "linear-gradient(135deg,#6366f1,#06b6d4)" }}>IA</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">La IA leerá el documento, lo clasificará y lo agregará al reporte correcto</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>

        <div className="px-6 pt-5">
          <div className="flex items-center px-2">
            {[{ n: 1, label: "Subir", sub: "archivo" }, { n: 2, label: "Procesar", sub: "OCR + IA" }, { n: 3, label: "Clasificar", sub: "y rutear" }, { n: 4, label: "Confirmar", sub: "y guardar" }].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2 text-xs flex-1">
                <div className="w-7 h-7 rounded-full flex items-center justify-center font-semibold text-xs shrink-0"
                  style={{ background: stage >= s.n ? "#6366f1" : "#e2e8f0", color: stage >= s.n ? "#fff" : "#94a3b8" }}>
                  {stage > s.n ? <Check size={12} /> : s.n}
                </div>
                <div><div className="font-medium text-slate-700">{s.label}</div><div className="text-[10px] text-slate-500">{s.sub}</div></div>
                {i < 3 && <div className="flex-1 h-0.5 mx-2" style={{ background: stage > s.n ? "#6366f1" : "#e2e8f0" }} />}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6">
          {stage === 1 && (
            <div>
              <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleFileChange} />
              {!file ? (
                <div onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer"
                  style={{ borderColor: "#c7d2fe", background: "linear-gradient(135deg,#eef2ff,#f0fdf4)" }}>
                  <div className="w-16 h-16 mx-auto rounded-full bg-white shadow-sm flex items-center justify-center mb-4">
                    <Upload size={28} style={{ color: "#6366f1" }} />
                  </div>
                  <div className="font-semibold mb-1 text-slate-800">Arrastra el documento aquí o haz click</div>
                  <div className="text-xs text-slate-500 mb-4">PDF, JPG, PNG · facturas, boletas, OCs · max 10MB</div>
                  <div className="flex items-center justify-center gap-2 text-[10px] text-slate-500 flex-wrap">
                    {["📄 Factura electrónica", "🧾 Boleta", "📋 Orden de compra", "📑 Comprobante"].map(t => (
                      <span key={t} className="bg-white px-2 py-1 rounded">{t}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                  <span className="text-lg">📄</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-800">{file.name}</div>
                    <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB · listo para subir</div>
                  </div>
                  <button onClick={() => setFile(null)} className="text-xs text-slate-500 hover:text-red-500">Cambiar</button>
                </div>
              )}
              <div className="mt-4 bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-900">
                <strong>💡 Tip:</strong> No te preocupes en qué tab estés. La IA detecta si es <strong>gasto</strong>, <strong>venta</strong> o <strong>costo</strong> y lo rutea solo.
              </div>
              {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
            </div>
          )}

          {stage === 2 && (
            <div>
              {file && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 flex items-center gap-3">
                  <span className="text-lg">📄</span>
                  <div className="flex-1"><div className="text-sm font-medium text-slate-900">{file.name}</div></div>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded font-medium">✓ subido</span>
                </div>
              )}
              <div className="rounded-xl p-5 border border-slate-200" style={{ background: "linear-gradient(135deg,#f8fafc,#eef2ff)" }}>
                <div className="text-sm font-semibold mb-4 flex items-center gap-2 text-slate-800">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  Procesando con IA · pipeline en tiempo real
                </div>
                <div className="space-y-2.5">
                  {pipelineStages.map((ps) => (
                    <div key={ps.name}
                      className="flex items-center gap-3 p-3 bg-white rounded-lg border transition-all duration-500"
                      style={{ borderColor: ps.status === "running" ? "#a5b4fc" : ps.status === "completed" ? "#86efac" : ps.status === "failed" ? "#fca5a5" : "#e2e8f0" }}>
                      {ps.status === "completed" && <Check size={18} style={{ color: "#10b981" }} />}
                      {ps.status === "running" && <Loader2 size={18} className="animate-spin" style={{ color: "#6366f1" }} />}
                      {ps.status === "failed" && <AlertCircle size={18} style={{ color: "#ef4444" }} />}
                      {ps.status === "pending" && <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-300" />}
                      <div className="flex-1">
                        <div className="text-sm font-medium text-slate-800">{ps.label}</div>
                      </div>
                      <div className="w-2 h-2 rounded-full transition-all duration-300" style={{ background: stageColors[ps.status] }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {stage === 3 && (
            <div>
              <div className="border border-green-300 rounded-xl p-5 mb-4" style={{ background: "linear-gradient(135deg,#f0fdf4,#ecfdf5)" }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                    <Check size={18} color="white" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-green-900">
                      La IA clasificó como{" "}
                      <span className="bg-green-200 px-1.5 rounded capitalize">{classifData?.destino ?? editedData.destino ?? "—"}</span>
                    </div>
                    <div className="text-xs text-green-800 mt-1">
                      {classifData?.tipo ?? editedData.tipo ?? "—"} · categoría "{classifData?.categoria ?? editedData.categoria ?? "Sin categoría"}"
                    </div>
                  </div>
                  <span className="text-[10px] bg-green-600 text-white px-2 py-1 rounded font-semibold">
                    {confidencePct > 0 ? `${confidencePct}% confianza` : "Procesado"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 mb-4 text-xs flex-wrap">
                {["PDF", "EVENTOS_CRUDOS", "Clasificación IA", `Reporte ${classifData?.destino ?? editedData.destino ?? ""}`].map((item, i, arr) => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: i === arr.length - 1 ? "#dcfce7" : "#f1f5f9", color: i === arr.length - 1 ? "#16a34a" : "#475569" }}>
                      {item}
                    </span>
                    {i < arr.length - 1 && <ChevronRight size={14} className="text-slate-400" />}
                  </div>
                ))}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="text-sm font-semibold mb-4 text-slate-800">Datos extraídos (puedes editarlos)</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "tipo", label: "Tipo" }, { key: "numero_documento", label: "N° documento" },
                    { key: "razon_social_emisor", label: "Proveedor / Emisor" }, { key: "rut_emisor", label: "RUT" },
                    { key: "fecha_emision", label: "Fecha", type: "date" }, { key: "monto_total", label: "Monto" },
                    { key: "categoria", label: "Categoría" }, { key: "destino", label: "Reporte destino" },
                  ].map(({ key, label, type }) => (
                    <div key={key}>
                      <label className="text-[10px] text-slate-500 uppercase font-medium block mb-1">{label}</label>
                      <input type={type ?? "text"} value={editedData[key] ?? ""}
                        onChange={e => setEditedData((d: any) => ({ ...d, [key]: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900"
                        style={{ background: "#f8fafc" }} />
                    </div>
                  ))}
                </div>
                {classifData?.razonamiento && (
                  <details className="mt-4 bg-slate-50 rounded-lg p-3">
                    <summary className="text-xs font-medium text-slate-700 cursor-pointer">🤔 ¿Por qué la IA decidió esto? Ver razonamiento</summary>
                    <div className="mt-3 space-y-2 text-xs text-slate-600">
                      {Object.entries(classifData.razonamiento).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-slate-400 font-mono">→</span>
                          <span><strong>{k}:</strong> {String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )}

          {stage === 4 && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <Check size={32} style={{ color: "#16a34a" }} />
              </div>
              <div className="text-lg font-semibold text-slate-800 mb-2">¡Documento guardado!</div>
              <div className="text-sm text-slate-500">El reporte se actualizará en breve.</div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-6 py-4 flex items-center justify-between bg-slate-50 rounded-b-2xl sticky bottom-0">
          <div className="text-xs text-slate-500">
            {eventoId && <span className="font-mono bg-slate-200 px-1 rounded text-[10px]">evt: {eventoId.slice(0, 8)}...</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-medium text-slate-700">Cancelar</button>
            {stage === 1 && (
              <button onClick={handleUpload} disabled={!file || uploading}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white flex items-center gap-2"
                style={{ background: !file ? "#cbd5e1" : "linear-gradient(135deg,#6366f1,#8b5cf6)", cursor: !file ? "not-allowed" : "pointer" }}>
                {uploading ? <><Loader2 size={14} className="animate-spin" />Subiendo...</> : <><Upload size={14} />Subir y procesar</>}
              </button>
            )}
            {stage === 3 && (
              <button onClick={handleConfirm} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
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
  const targetLabel = { gastos: "→ Gastos", ventas: "→ Ventas", costos: "→ Costos" }[target];
  const [form, setForm] = useState({
    vendor_name: "", amount: "", currency: "CLP",
    invoice_date: new Date().toISOString().slice(0, 10),
    category: target === "gastos" ? "expense" : target === "ventas" ? "sale" : "cost",
    description: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true); setError("");
    try {
      await apiFetch("/invoices", {
        method: "POST",
        body: JSON.stringify({
          source: "manual", vendor_name: form.vendor_name || undefined,
          amount: form.amount ? parseFloat(form.amount) : undefined,
          currency: form.currency, invoice_date: form.invoice_date || undefined,
          category: form.category, description: form.description || undefined,
        }),
      });
      onDone(); onClose();
    } catch (e: any) { setError(e.message ?? "Failed to save"); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,15,25,0.75)", backdropFilter: "blur(6px)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl">
        <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-lg text-slate-900">Agregar registro manual <span className="text-sm font-normal text-slate-500">{targetLabel}</span></h3>
            <p className="text-xs text-slate-500 mt-0.5">Sin IA · captura directa de los datos</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[10px] text-slate-500 uppercase font-medium block mb-1">Descripción *</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900" placeholder="Ej: Bencina equipo terreno"
                value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-medium block mb-1">Proveedor</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900"
                value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-medium block mb-1">Fecha *</label>
              <input type="date" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900"
                value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-medium block mb-1">Monto *</label>
              <input type="number" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900"
                placeholder="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-medium block mb-1">Moneda</label>
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900"
                value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                <option>CLP</option><option>USD</option><option>EUR</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-medium block mb-1">Categoría</label>
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900"
                value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="expense">Gasto (expense)</option>
                <option value="sale">Venta (sale)</option>
                <option value="cost">Costo (cost)</option>
              </select>
            </div>
          </div>
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
        <div className="border-t border-slate-200 px-6 py-4 flex items-center justify-between bg-slate-50 rounded-b-2xl">
          <div className="text-xs text-slate-500">Origen: <span className="font-mono bg-slate-200 px-1 rounded text-[10px]">manual</span></div>
          <div className="flex gap-2">
            <button onClick={onClose} className="bg-white border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium text-slate-700">Cancelar</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: "#6366f1", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Guardando..." : "Guardar registro"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    email: { bg: "#eef2ff", color: "#6366f1", label: "Email" },
    whatsapp: { bg: "#dcfce7", color: "#16a34a", label: "WhatsApp" },
    manual: { bg: "#f1f5f9", color: "#64748b", label: "Manual" },
  };
  const s = map[source] ?? map.manual;
  return <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function KpiCard({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1" style={{ color: subColor ?? "#0f172a" }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: subColor ?? "#94a3b8" }}>{sub}</div>}
    </div>
  );
}

export default function ReportesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("gastos");
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadTarget, setUploadTarget] = useState<Tab | null>(null);
  const [manualTarget, setManualTarget] = useState<Tab | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ data: ReportData }>("/invoices/report");
      setReport(res.data);
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const expenses = report?.expenses?.rows ?? [];
  const sales = report?.sales?.rows ?? [];
  const costs = report?.costs?.rows ?? [];

  const tabs: { key: Tab; label: string; badge?: string }[] = [
    { key: "gastos", label: "Gastos", badge: "principal" },
    { key: "ventas", label: "Ventas" },
    { key: "costos", label: "Costos" },
  ];

  return (
    <AppShell>
      {uploadTarget && <UploadModal target={uploadTarget} onClose={() => setUploadTarget(null)} onDone={fetchReport} />}
      {manualTarget && <ManualModal target={manualTarget} onClose={() => setManualTarget(null)} onDone={fetchReport} />}

      <div style={{ background: "#f8fafc", minHeight: "100%", padding: "2rem" }}>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Reportes Internos</h1>
          <p className="text-sm text-slate-500 mt-1">Información ingresada por WhatsApp, correo o registro manual</p>
        </div>

        <div className="flex gap-1 mb-6 border-b border-slate-200">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className="px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors"
              style={{ borderBottomColor: activeTab === tab.key ? "#6366f1" : "transparent", color: activeTab === tab.key ? "#6366f1" : "#64748b", background: "none" }}>
              {tab.label}
              {tab.badge && <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{tab.badge}</span>}
            </button>
          ))}
          <div className="ml-auto flex items-center pb-2">
            <button onClick={fetchReport} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {activeTab === "gastos" && (
          <div>
            <div className="grid grid-cols-4 gap-4 mb-4">
              <KpiCard label="Total gastos mes" value={formatCLP(report?.expenses?.total_amount ?? null)} subColor="#dc2626" sub="del presupuesto" />
              <KpiCard label="Registros" value={String(report?.expenses?.total_count ?? 0)} sub="este mes" />
              <KpiCard label="Fuentes" value="3" sub="Email · WhatsApp · Manual" />
              <KpiCard label="Confianza IA" value="—" subColor="#16a34a" sub="promedio OCR" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <input type="text" placeholder="Buscar descripción, proveedor..." className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-72 bg-white text-slate-900" />
              <div className="flex items-center gap-2">
                <button className="bg-white border border-slate-200 px-3 py-2 rounded-lg text-sm flex items-center gap-2 text-slate-700"><Download size={14} /> Exportar</button>
                <button onClick={() => setUploadTarget("gastos")} className="text-white px-3 py-2 rounded-lg text-sm flex items-center gap-2 shadow-sm" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
                  <Upload size={14} /> Subir documento <span className="text-[9px] bg-white/20 px-1 rounded uppercase">IA</span>
                </button>
                <button onClick={() => setManualTarget("gastos")} className="bg-white border-2 border-slate-300 hover:border-indigo-400 text-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2 font-medium">
                  <Plus size={14} /> Agregar manual
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-8">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>{["Fecha", "Descripción", "Proveedor", "Monto", "Origen", "Confianza"].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {expenses.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500 text-sm">Sin registros. Sube un documento o agrega manualmente.</td></tr>
                  ) : expenses.map(row => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{row.invoice_date ?? "—"}</td>
                      <td className="px-4 py-3 max-w-[200px] truncate text-slate-900 font-medium">{row.description ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-900 font-medium">{row.vendor_name ?? "—"}</td>
                      <td className="px-4 py-3 font-semibold text-red-600">{row.amount ? `−${formatCLP(row.amount)}` : "—"}</td>
                      <td className="px-4 py-3"><SourceBadge source={row.source} /></td>
                      <td className="px-4 py-3 text-xs text-slate-600 font-medium">{row.confidence_score ? `${Math.round(row.confidence_score * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-900 mb-1">
                Dashboard interactivo · Gastos
                <span className="text-[10px] text-white px-1.5 py-0.5 rounded uppercase tracking-wider" style={{ background: "linear-gradient(135deg,#6366f1,#06b6d4)" }}>live</span>
              </h2>
              <p className="text-xs text-slate-500 mb-4">Se actualiza con cada documento procesado por la IA</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="text-sm font-semibold mb-4 text-slate-800">Por fuente de ingreso</div>
                  <div className="space-y-3">
                    {[{ label: "Email", color: "#6366f1" }, { label: "WhatsApp", color: "#16a34a" }, { label: "Manual", color: "#94a3b8" }].map(s => {
                      const count = expenses.filter(r => r.source === s.label.toLowerCase()).length;
                      return (
                        <div key={s.label}>
                          <div className="flex justify-between text-xs mb-1"><span className="font-medium text-slate-700">{s.label}</span><span className="text-slate-900 font-semibold">{count}</span></div>
                          <div className="w-full h-2 bg-slate-100 rounded-full">
                            <div className="h-full rounded-full" style={{ width: expenses.length ? `${count / expenses.length * 100}%` : "0%", background: s.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="text-sm font-semibold mb-4 text-slate-800">Total gastos</div>
                  <div className="text-3xl font-bold text-red-600">{formatCLP(report?.expenses?.total_amount ?? null)}</div>
                  <div className="text-xs text-slate-500 mt-2">{report?.expenses?.total_count ?? 0} registros totales</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="text-sm font-semibold mb-4 text-slate-800">Alertas IA</div>
                  <div className="text-xs text-slate-500">Los documentos con confianza baja aparecerán aquí para revisión.</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "ventas" && (
          <div>
            <div className="grid grid-cols-4 gap-4 mb-4">
              <KpiCard label="Ventas mes" value={formatCLP(report?.sales?.total_amount ?? null)} subColor="#16a34a" sub="↑ vs mes anterior" />
              <KpiCard label="Facturas emitidas" value={String(report?.sales?.total_count ?? 0)} sub="este mes" />
              <KpiCard label="Por cobrar" value="—" subColor="#f59e0b" sub="pendientes" />
              <KpiCard label="Ticket promedio" value="—" sub="por activación" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <input type="text" placeholder="Buscar cliente, factura..." className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-72 bg-white text-slate-900" />
                <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white text-slate-900"><option>Todos los estados</option><option>Cobradas</option><option>Pendientes</option></select>
              </div>
              <div className="flex items-center gap-2">
                <button className="bg-white border border-slate-200 px-3 py-2 rounded-lg text-sm flex items-center gap-2 text-slate-700"><Download size={14} /> Exportar</button>
                <button onClick={() => setUploadTarget("ventas")} className="text-white px-3 py-2 rounded-lg text-sm flex items-center gap-2" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
                  <Upload size={14} /> Subir documento <span className="text-[9px] bg-white/20 px-1 rounded uppercase">IA</span>
                </button>
                <button onClick={() => setManualTarget("ventas")} className="bg-white border-2 border-slate-300 text-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2 font-medium">
                  <Plus size={14} /> Agregar manual
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-8">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>{["Fecha", "N° Factura", "Cliente / Descripción", "Monto", "Estado", "Origen"].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sales.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500 text-sm">Sin registros de ventas.</td></tr>
                  ) : sales.map(row => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{row.invoice_date ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-900">{row.numero_documento ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-900 font-medium">{row.vendor_name ?? row.description ?? "—"}</td>
                      <td className="px-4 py-3 font-semibold text-green-600">+{formatCLP(row.amount)}</td>
                      <td className="px-4 py-3"><span className="text-xs px-2 py-0.5 rounded" style={{ background: row.status === "approved" ? "#dcfce7" : "#fef3c7", color: row.status === "approved" ? "#16a34a" : "#92400e" }}>{row.status}</span></td>
                      <td className="px-4 py-3"><SourceBadge source={row.source} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="text-sm font-semibold mb-2 text-slate-800">Total ventas</div>
                <div className="text-3xl font-bold text-green-600">{formatCLP(report?.sales?.total_amount ?? null)}</div>
                <div className="text-xs text-slate-500 mt-2">{report?.sales?.total_count ?? 0} facturas</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="text-sm font-semibold mb-2 text-slate-800">Por fuente</div>
                <div className="space-y-2 mt-2">{["email", "whatsapp", "manual"].map(src => <div key={src} className="flex justify-between text-xs"><span className="capitalize text-slate-700">{src}</span><span className="font-semibold text-slate-900">{sales.filter(r => r.source === src).length}</span></div>)}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="text-sm font-semibold mb-2 text-slate-800">Insights IA</div>
                <div className="text-xs text-slate-500">Los insights de cobranza y márgenes aparecerán aquí.</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "costos" && (
          <div>
            <div className="grid grid-cols-4 gap-4 mb-4">
              <KpiCard label="Costos directos mes" value={formatCLP(report?.costs?.total_amount ?? null)} subColor="#ea580c" sub="sobre ventas" />
              <KpiCard label="Margen bruto" value="—" subColor="#16a34a" sub="vs mes anterior" />
              <KpiCard label="Proveedores activos" value="—" sub="este mes" />
              <KpiCard label="Promedio por proyecto" value="—" sub="proyectos activos" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <input type="text" placeholder="Buscar proveedor, OC, proyecto..." className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-72 bg-white text-slate-900" />
              <div className="flex items-center gap-2">
                <button className="bg-white border border-slate-200 px-3 py-2 rounded-lg text-sm flex items-center gap-2 text-slate-700"><Download size={14} /> Exportar</button>
                <button onClick={() => setUploadTarget("costos")} className="text-white px-3 py-2 rounded-lg text-sm flex items-center gap-2" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
                  <Upload size={14} /> Subir documento <span className="text-[9px] bg-white/20 px-1 rounded uppercase">IA</span>
                </button>
                <button onClick={() => setManualTarget("costos")} className="bg-white border-2 border-slate-300 text-slate-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2 font-medium">
                  <Plus size={14} /> Agregar manual
                </button>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-8">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>{["Fecha", "OC / Factura", "Proveedor", "Tipo costo", "Monto", "Origen"].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {costs.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500 text-sm">Sin registros de costos.</td></tr>
                  ) : costs.map(row => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{row.invoice_date ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-900">{row.numero_documento ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-900 font-medium">{row.vendor_name ?? "—"}</td>
                      <td className="px-4 py-3"><span className="text-xs bg-orange-50 text-orange-800 font-medium px-2 py-0.5 rounded">{row.description ?? "—"}</span></td>
                      <td className="px-4 py-3 font-semibold text-orange-600">−{formatCLP(row.amount)}</td>
                      <td className="px-4 py-3"><SourceBadge source={row.source} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="text-sm font-semibold mb-2 text-slate-800">Total costos</div>
                <div className="text-3xl font-bold text-orange-600">{formatCLP(report?.costs?.total_amount ?? null)}</div>
                <div className="text-xs text-slate-500 mt-2">{report?.costs?.total_count ?? 0} registros</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="text-sm font-semibold mb-2 text-slate-800">Por fuente</div>
                <div className="space-y-2 mt-2">{["email", "whatsapp", "manual"].map(src => <div key={src} className="flex justify-between text-xs"><span className="capitalize text-slate-700">{src}</span><span className="font-semibold text-slate-900">{costs.filter(r => r.source === src).length}</span></div>)}</div>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="text-sm font-semibold mb-2 text-slate-800">Márgenes</div>
                <div className="text-xs text-slate-500">Los márgenes por proyecto aparecerán aquí.</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
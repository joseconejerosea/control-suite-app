"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { Upload, FileText, Eye, RefreshCw, CheckCircle, AlertCircle, X, Database } from "lucide-react";

type Doc = {
  id: string; original_name: string; target_table: string; status: string;
  rows_inserted: number | null; rows_failed: number | null; created_at: string; mime_type: string;
};

type Preview = {
  rows?: Record<string, unknown>[];
  column_mapping?: Record<string, string>;
  parse_result?: { rows: Record<string, unknown>[]; column_mapping: Record<string, string>; confidence?: number };
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    uploaded:   { bg: "rgba(59,130,246,0.15)",  color: "#60a5fa" },
    processing: { bg: "rgba(139,92,246,0.15)",  color: "#a78bfa" },
    parsed:     { bg: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
    populated:  { bg: "var(--green-dim)",        color: "var(--green-light)" },
    error:      { bg: "var(--red-dim)",          color: "var(--red-light)" },
  };
  const s = map[status] ?? { bg: "var(--secondary)", color: "var(--muted-foreground)" };
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide"
      style={{ background: s.bg, color: s.color }}>{status}</span>
  );
}

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile]     = useState<File | null>(null);
  const [target, setTarget] = useState("promoters");
  const [loading, setLoad]  = useState(false);
  const [err, setErr]       = useState("");
  const inputRef            = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) return;
    setLoad(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("target_table", target);

      const token = localStorage.getItem("cs_token");
      // Base desde env (NO hardcodear localhost). El helper api.* no sirve acá porque
      // es multipart/form-data; construimos la URL con la misma base + /api.
      const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
      const res = await fetch(`${base}/api/documents/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? "Error al subir"); }
      onDone(); onClose();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error al subir"); }
    finally { setLoad(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl p-6 border animate-fade-up"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold">Subir documento</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted-foreground)", cursor: "pointer" }}><X size={16} /></button>
        </div>

        <div onClick={() => inputRef.current?.click()}
          className="rounded-xl p-8 text-center cursor-pointer transition-colors mb-4"
          style={{ border: `2px dashed ${file ? "var(--green)" : "var(--border)"}`, background: file ? "var(--green-dim)" : "var(--secondary)" }}>
          <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv,.docx,.doc,.pptx,.ppt,.mp4,.mov,.avi" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file ? (
            <div>
              <CheckCircle size={28} className="mx-auto mb-2" style={{ color: "var(--green)" }} />
              <div className="text-sm font-semibold">{file.name}</div>
              <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>{(file.size / 1024).toFixed(1)} KB</div>
            </div>
          ) : (
            <div>
              <Upload size={28} className="mx-auto mb-2" style={{ color: "var(--muted-foreground)" }} />
              <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>Click para seleccionar archivo</div>
              <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>PDF, CSV, XLSX · max 10MB</div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 mb-4">
          <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>Tabla destino</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
            {[
              { v: "promoters",     l: "Staff" },
              { v: "locations",     l: "Ubicaciones" },
              { v: "campaigns",     l: "Campañas" },
              { v: "activations",   l: "Activaciones" },
              { v: "collaborators", l: "Colaboradores" },
            ].map((t) => (
              <option key={t.v} value={t.v}>{t.l}</option>
            ))}
          </select>
        </div>

        {err && <div className="text-xs px-3 py-2 rounded-lg mb-3" style={{ background: "var(--red-dim)", color: "var(--red-light)" }}>{err}</div>}

        <div className="flex gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>Cancelar</button>
          <button onClick={submit} disabled={loading || !file}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer" }}>
            {loading ? <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} /> : <><Upload size={13} /> Subir</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ doc, onClose, onDone }: { doc: Doc; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoad]    = useState(true);
  const [popping, setPop]     = useState(false);
  const [err, setErr]         = useState("");

  useEffect(() => {
    api.get<Preview>(`/documents/${doc.id}/preview`)
      .then(setPreview).catch(() => setPreview(null)).finally(() => setLoad(false));
  }, [doc.id]);

  const populate = async () => {
    setPop(true); setErr("");
    try { await api.post(`/documents/${doc.id}/populate`, {}); onDone(); onClose(); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error al poblar"); }
    finally { setPop(false); }
  };

  const rows    = preview?.rows ?? preview?.parse_result?.rows ?? [];
  const mapping = preview?.column_mapping ?? preview?.parse_result?.column_mapping ?? {};
  const conf    = preview?.parse_result?.confidence;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl rounded-2xl p-6 border animate-fade-up"
        style={{ background: "var(--card)", borderColor: "var(--border)", maxHeight: "90vh", overflowY: "auto" }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold">Vista previa — {doc.original_name}</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Destino: {doc.target_table}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted-foreground)", cursor: "pointer" }}><X size={16} /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <span className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: "var(--border)", borderTopColor: "var(--red)" }} />
          </div>
        ) : !preview ? (
          <div className="text-center py-12 text-sm" style={{ color: "var(--muted-foreground)" }}>
            <AlertCircle size={24} className="mx-auto mb-2 opacity-40" />
            Ejecutá el parseo primero para extraer los datos de este documento.
          </div>
        ) : (
          <>
            {Object.keys(mapping).length > 0 && (
              <div className="mb-5">
                <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Mapeo de columnas</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(mapping).map(([src, tgt]) => (
                    <span key={src} className="px-2.5 py-1 rounded-full text-xs border"
                      style={{ background: "var(--secondary)", borderColor: "var(--border)", fontFamily: "monospace" }}>
                      {src} → <span style={{ color: "var(--green-light)" }}>{tgt}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {rows.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>
                  Filas de muestra ({rows.length} total)
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)", maxHeight: 220, overflowY: "auto" }}>
                  <table className="w-full border-collapse text-xs">
                    <thead style={{ background: "var(--secondary)" }}>
                      <tr>{Object.keys(rows[0]).map((k) => (
                        <th key={k} className="px-3 py-2 text-left" style={{ color: "var(--muted-foreground)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>{k}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 8).map((row, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                          {Object.values(row).map((v, j) => (
                            <td key={j} className="px-3 py-2">{String(v ?? "—")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {conf != null && (
              <div className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>
                Confianza IA: <span style={{ color: "var(--green-light)", fontWeight: 600 }}>{Math.round(conf * 100)}%</span>
              </div>
            )}

            {err && <div className="text-xs px-3 py-2 rounded-lg mb-3" style={{ background: "var(--red-dim)", color: "var(--red-light)" }}>{err}</div>}

            <div className="flex gap-3">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>Cerrar</button>
              <button onClick={populate} disabled={popping}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--green)", color: "#fff", border: "none", cursor: "pointer" }}>
                {popping ? <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} /> : <><Database size={13} /> Confirmar y poblar</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  const [docs, setDocs]         = useState<Doc[]>([]);
  const [loading, setLoad]      = useState(true);
  const [showUpload, setUpload] = useState(false);
  const [preview, setPreview]   = useState<Doc | null>(null);
  const [parsing, setParsing]   = useState<Record<string, boolean>>({});
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(async () => {
    setLoad(true);
    try {
      const res = await api.get<Doc[] | { data: Doc[] }>("/documents");
      setDocs(Array.isArray(res) ? res : (res as { data: Doc[] }).data ?? []);
    } catch { setDocs([]); } finally { setLoad(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const parse = async (doc: Doc) => {
    setParsing((p) => ({ ...p, [doc.id]: true }));
    try {
      await api.post(`/documents/${doc.id}/parse`, {});
      showToast("Parseo iniciado — actualizá en un momento", true);
      setTimeout(load, 2500);
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Error al parsear", false); }
    finally { setParsing((p) => ({ ...p, [doc.id]: false })); }
  };

  return (
    <AppShell>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl"
          style={{ background: toast.ok ? "var(--green)" : "var(--red)", color: "#fff" }}>
          {toast.msg}
        </div>
      )}

      <div className="animate-fade-up">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Documentos</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Sube CSV, Excel o PDF — la IA extrae y puebla tu base de datos</p>
          </div>
          <button onClick={() => setUpload(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 4px 14px rgba(200,32,44,0.3)" }}>
            <Upload size={14} /> Subir archivo
          </button>
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full border-collapse">
            <thead style={{ background: "var(--secondary)" }}>
              <tr>
                {["Archivo", "Tipo", "Destino", "Estado", "Filas", "Subido", "Acciones"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(4).fill(0).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    {Array(7).fill(0).map((_, j) => (
                      <td key={j} className="px-4 py-3.5"><div className="h-3.5 rounded animate-pulse" style={{ width: "70%", background: "var(--secondary)" }} /></td>
                    ))}
                  </tr>
                ))
              ) : docs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <FileText size={32} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Aún no hay documentos.</p>
                    <button onClick={() => setUpload(true)} className="mt-3 px-4 py-2 rounded-lg text-xs" style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>Sube tu primer archivo</button>
                  </td>
                </tr>
              ) : (
                docs.map((doc) => (
                  <tr key={doc.id} style={{ borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <FileText size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
                        <span className="text-sm font-medium">{doc.original_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs" style={{ color: "var(--muted-foreground)", fontFamily: "monospace" }}>
                      {doc.mime_type?.split("/").pop()?.replace("vnd.openxmlformats-officedocument.spreadsheetml.sheet","xlsx") ?? "—"}
                    </td>
                    <td className="px-4 py-3.5 text-xs" style={{ color: "var(--muted-foreground)", fontFamily: "monospace" }}>{doc.target_table}</td>
                    <td className="px-4 py-3.5"><StatusBadge status={doc.status} /></td>
                    <td className="px-4 py-3.5 text-sm">
                      {doc.rows_inserted != null ? (
                        <span>
                          <span style={{ color: "var(--green-light)", fontWeight: 600 }}>{doc.rows_inserted}</span>
                          {(doc.rows_failed ?? 0) > 0 && <span style={{ color: "var(--red-light)" }}> / {doc.rows_failed} fallidas</span>}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
                      {new Date(doc.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        {["uploaded", "error"].includes(doc.status) && (
                          <button onClick={() => parse(doc)} disabled={parsing[doc.id]}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs disabled:opacity-50"
                            style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                            {parsing[doc.id] ? <span className="w-3 h-3 border rounded-full animate-spin" style={{ borderColor: "var(--border)", borderTopColor: "var(--foreground)" }} /> : <><RefreshCw size={11} /> Parsear</>}
                          </button>
                        )}
                        {doc.status === "parsed" && (
                          <button onClick={() => setPreview(doc)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs"
                            style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                            <Eye size={11} /> Vista previa
                          </button>
                        )}
                        {doc.status === "populated" && (
                          <span className="flex items-center gap-1 text-xs" style={{ color: "var(--green-light)" }}>
                            <CheckCircle size={12} /> Listo
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showUpload && <UploadModal onClose={() => setUpload(false)} onDone={load} />}
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} onDone={load} />}
    </AppShell>
  );
}
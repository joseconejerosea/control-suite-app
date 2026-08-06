"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import {
  RefreshCw, CheckCircle, XCircle, AlertTriangle, FileText,
  ChevronLeft, ChevronRight, Filter, Search,
} from "lucide-react";

type F1Doc = {
  id: string;
  status: string;
  source: string;
  flow: string;
  confidence_score: number | null;
  ai_classification: any;
  payload: any;
  parsed_data: any;
  created_at: string;
  updated_at: string;
  project_name: string | null;
  signed_url?: string | null;
};

type Pagination = { page: number; limit: number; total: number; pages: number };
type Project = { id: string; name: string };

const TIPOS = [
  "factura_recibida", "factura_emitida", "boleta", "nota_credito", "nota_debito",
  "orden_compra", "comprobante", "contrato", "formulario",
  "liquidacion", "guia_despacho", "contrato_personal", "otro",
];

const STATUSES = [
  { value: "queued", label: "En cola" },
  { value: "processed", label: "Procesado" },
  { value: "low_confidence", label: "Baja confianza" },
  { value: "unclassified", label: "Sin clasificar" },
  { value: "approved", label: "Aprobado" },
  { value: "rejected", label: "Rechazado" },
  { value: "awaiting_clarification", label: "Esperando" },
  { value: "escalated", label: "Escalado" },
];

function statusColor(s: string) {
  const map: Record<string, { bg: string; fg: string }> = {
    processed:     { bg: "color-mix(in srgb, var(--success) 12%, transparent)", fg: "var(--success)" },
    approved:      { bg: "color-mix(in srgb, var(--success) 12%, transparent)", fg: "var(--success)" },
    low_confidence:{ bg: "rgba(245,158,11,0.15)", fg: "#f59e0b" },
    unclassified:  { bg: "var(--secondary)", fg: "var(--muted-foreground)" },
    rejected:      { bg: "rgba(79,70,229,0.10)", fg: "var(--danger)" },
    escalated:     { bg: "rgba(139,92,246,0.15)", fg: "var(--primary)" },
    queued:        { bg: "rgba(79,70,229,0.10)", fg: "var(--primary)" },
  };
  return map[s] ?? { bg: "var(--secondary)", fg: "var(--muted-foreground)" };
}

export default function DocumentosRevisarPage() {
  const [docs, setDocs] = useState<F1Doc[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selected, setSelected] = useState<F1Doc | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [filters, setFilters] = useState({
    project_id: "",
    tipo: "",
    status: "",
    confidence_min: "",
    confidence_max: "",
    date_from: "",
    date_to: "",
  });

  useEffect(() => {
    api.get<Project[] | { data: Project[] }>("/projects")
      .then((res) => setProjects(Array.isArray(res) ? res : (res as any).data ?? []))
      .catch(() => {});
  }, []);

  const buildQuery = useCallback((page: number) => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "20");
    if (filters.project_id) params.set("project_id", filters.project_id);
    if (filters.tipo) params.set("tipo", filters.tipo);
    if (filters.status) params.set("status", filters.status);
    if (filters.confidence_min) params.set("confidence_min", filters.confidence_min);
    if (filters.confidence_max) params.set("confidence_max", filters.confidence_max);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    return params.toString();
  }, [filters]);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      // El interceptor global envuelve la respuesta en { data, timestamp, path }, y
      // el endpoint paginado ya devuelve { data, pagination } → doble nesting.
      // Los docs están en res.data.data (no res.data, que es el objeto paginado).
      const res = await api.get<{ data: { data: F1Doc[]; pagination: Pagination } }>(
        `/app/f1-documents?${buildQuery(page)}`
      );
      setDocs(res.data?.data ?? []);
      setPagination(res.data?.pagination ?? { page: 1, limit: 20, total: 0, pages: 0 });
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { load(); }, [load]);

  const selectDoc = async (doc: F1Doc) => {
    setSelected(doc);
    setDetailLoading(true);
    try {
      // El interceptor global envuelve la respuesta en { data, timestamp, path }.
      // Sin desenvolver, `selected.id` queda undefined y el detalle crashea
      // (selected.id.slice(...)). Fallback a `res` por si algún endpoint no viene envuelto.
      const res = await api.get<{ data?: F1Doc }>(`/app/f1-documents/${doc.id}`);
      setSelected((res?.data ?? (res as unknown as F1Doc)));
    } catch { /* keep the list version */ }
    finally { setDetailLoading(false); }
  };

  const showMsg = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleApprove = async () => {
    if (!selected) return;
    setActionLoading("approve");
    try {
      await api.put(`/app/f1-documents/${selected.id}/approve`);
      showMsg("success", "Documento aprobado");
      setSelected(null);
      load(pagination.page);
    } catch (err: any) {
      showMsg("error", err.message ?? "Error al aprobar");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    setActionLoading("reject");
    try {
      await api.put(`/app/f1-documents/${selected.id}/reject`, { reason: rejectReason });
      showMsg("success", "Documento rechazado");
      setSelected(null);
      setShowRejectModal(false);
      setRejectReason("");
      load(pagination.page);
    } catch (err: any) {
      showMsg("error", err.message ?? "Error al rechazar");
    } finally {
      setActionLoading(null);
    }
  };

  const classif = selected?.ai_classification;
  const datos = classif?.datos_extraidos;
  const hasActiveFilters = Object.values(filters).some(Boolean);

  return (
    <AppShell>
      <div className="animate-fade-up">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              Documentos F1
              {pagination.total > 0 && (
                <span style={{ fontSize: 12, background: "rgba(79,70,229,0.10)", color: "var(--primary)", padding: "2px 10px", borderRadius: 20, fontWeight: 600 }}>
                  {pagination.total}
                </span>
              )}
            </h1>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>
              Documentos procesados por IA — revisar, aprobar o rechazar
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowFilters(!showFilters)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: `1px solid ${hasActiveFilters ? "var(--primary)" : "var(--border)"}`, background: hasActiveFilters ? "rgba(79,70,229,0.10)" : "var(--secondary)", color: hasActiveFilters ? "var(--primary)" : "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
              <Filter size={12} /> Filtros {hasActiveFilters && `(${Object.values(filters).filter(Boolean).length})`}
            </button>
            <button onClick={() => load(pagination.page)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Actualizar
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div style={{ marginBottom: 16, padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500, background: message.type === "success" ? "color-mix(in srgb, var(--success) 12%, transparent)" : "color-mix(in srgb, var(--danger) 12%, transparent)", color: message.type === "success" ? "var(--success)" : "var(--danger)" }}>
            {message.text}
          </div>
        )}

        {/* Filters panel */}
        {showFilters && (
          <div style={{ marginBottom: 16, padding: 16, borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 4, display: "block" }}>Proyecto</label>
                <select value={filters.project_id} onChange={e => setFilters(f => ({ ...f, project_id: e.target.value }))}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13 }}>
                  <option value="">Todos</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 4, display: "block" }}>Tipo</label>
                <select value={filters.tipo} onChange={e => setFilters(f => ({ ...f, tipo: e.target.value }))}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13 }}>
                  <option value="">Todos</option>
                  {TIPOS.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 4, display: "block" }}>Estado</label>
                <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13 }}>
                  <option value="">Todos</option>
                  {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 4, display: "block" }}>Confianza min</label>
                <input type="number" min="0" max="1" step="0.05" value={filters.confidence_min}
                  onChange={e => setFilters(f => ({ ...f, confidence_min: e.target.value }))}
                  placeholder="0.00"
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 4, display: "block" }}>Desde</label>
                <input type="date" value={filters.date_from}
                  onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 4, display: "block" }}>Hasta</label>
                <input type="date" value={filters.date_to}
                  onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13 }} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, gridColumn: "span 2" }}>
                <button onClick={() => load(1)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  <Search size={12} /> Buscar
                </button>
                <button onClick={() => { setFilters({ project_id: "", tipo: "", status: "", confidence_min: "", confidence_max: "", date_from: "", date_to: "" }); }}
                  style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
                  Limpiar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && docs.length === 0 ? (
          <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--card)", padding: "80px 24px", textAlign: "center" }}>
            <FileText size={40} style={{ color: "var(--muted-foreground)", margin: "0 auto 16px", opacity: 0.3 }} />
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Sin documentos</div>
            <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
              {hasActiveFilters ? "No hay documentos que coincidan con los filtros." : "No hay documentos pendientes de revisión."}
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: selected ? "2fr 3fr" : "1fr", gap: 16 }}>
            {/* List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {loading ? [0,1,2,3].map(i => (
                <div key={i} style={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", padding: 16, opacity: 0.5 }}>
                  <div style={{ height: 12, background: "var(--secondary)", borderRadius: 6, marginBottom: 8, width: "75%" }} />
                  <div style={{ height: 12, background: "var(--secondary)", borderRadius: 6, width: "50%" }} />
                </div>
              )) : docs.map(doc => {
                const cl = doc.ai_classification;
                const conf = doc.confidence_score ? Math.round(doc.confidence_score * 100) : null;
                const isSelected = selected?.id === doc.id;
                const sc = statusColor(doc.status);
                return (
                  <div key={doc.id} onClick={() => selectDoc(doc)}
                    style={{ borderRadius: 12, border: `1px solid ${isSelected ? "var(--primary)" : "var(--border)"}`, background: isSelected ? "rgba(79,70,229,0.10)" : "var(--card)", padding: 14, cursor: "pointer", boxShadow: isSelected ? "0 0 0 2px rgba(79,70,229,0.20)" : "none", transition: "all 0.15s" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {cl?.datos_extraidos?.razon_social_emisor ?? doc.payload?.original_name ?? "Sin proveedor"}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>
                          {cl?.tipo?.replace(/_/g, " ") ?? "—"} · {cl?.datos_extraidos?.fecha_emision ?? new Date(doc.created_at).toLocaleDateString("es-CL")}
                        </div>
                        {doc.project_name && (
                          <div style={{ fontSize: 10, color: "var(--primary)", marginTop: 3 }}>{doc.project_name}</div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 10, background: sc.bg, color: sc.fg, padding: "2px 8px", borderRadius: 8, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                          {doc.status === "low_confidence" && <AlertTriangle size={9} />}
                          {doc.status === "approved" ? "aprobado"
                            : doc.status === "rejected" ? "rechazado"
                            : conf != null ? `${conf}%` : doc.status.replace(/_/g, " ")}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "capitalize" }}>{doc.source}</span>
                      </div>
                    </div>
                    {datos?.monto_total && (
                      <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700 }}>
                        ${Number(cl?.datos_extraidos?.monto_total).toLocaleString("es-CL")}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Pagination */}
              {pagination.pages > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
                  <button disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)}
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--muted-foreground)", cursor: pagination.page <= 1 ? "default" : "pointer", opacity: pagination.page <= 1 ? 0.4 : 1, fontSize: 12 }}>
                    <ChevronLeft size={14} />
                  </button>
                  <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                    {pagination.page} / {pagination.pages}
                  </span>
                  <button disabled={pagination.page >= pagination.pages} onClick={() => load(pagination.page + 1)}
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--muted-foreground)", cursor: pagination.page >= pagination.pages ? "default" : "pointer", opacity: pagination.page >= pagination.pages ? 0.4 : 1, fontSize: 12 }}>
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Detail panel */}
            {selected && (
              <div style={{ position: "sticky", top: 16 }}>
                <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--card)", overflow: "hidden" }}>
                  {/* Header */}
                  <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{classif?.datos_extraidos?.razon_social_emisor ?? "Sin proveedor"}</div>
                      <div style={{ fontSize: 11, color: "var(--muted-foreground)", fontFamily: "monospace", marginTop: 2 }}>
                        {selected.id.slice(0, 8)}... · {selected.source}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {(() => { const sc = statusColor(selected.status); return (
                        <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 20, fontWeight: 600, background: sc.bg, color: sc.fg }}>
                          {selected.confidence_score ? `${Math.round(selected.confidence_score * 100)}%` : selected.status.replace(/_/g, " ")}
                        </span>
                      ); })()}
                      <button onClick={() => setSelected(null)}
                        style={{ background: "none", border: "none", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 18 }}>×</button>
                    </div>
                  </div>

                  <div style={{ padding: 18, maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
                    {/* Document image */}
                    {selected.signed_url && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 8 }}>Documento original</div>
                        <div style={{ borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden", background: "#000", maxHeight: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {selected.payload?.mime_type?.startsWith("image/") ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={selected.signed_url} alt="Documento" style={{ maxWidth: "100%", maxHeight: 300, objectFit: "contain" }} />
                          ) : (
                            <a href={selected.signed_url} target="_blank" rel="noopener noreferrer"
                              style={{ display: "flex", alignItems: "center", gap: 8, padding: 24, color: "var(--primary)", fontSize: 13 }}>
                              <FileText size={20} /> Abrir documento
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Extracted data */}
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 10 }}>Datos extraidos por IA</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                      {[
                        { label: "Tipo", val: classif?.tipo?.replace(/_/g, " ") },
                        { label: "Destino", val: classif?.destino },
                        { label: "N° Documento", val: datos?.numero_documento },
                        { label: "RUT Emisor", val: datos?.rut_emisor },
                        { label: "Proveedor", val: datos?.razon_social_emisor },
                        { label: "Monto Total", val: datos?.monto_total ? `$${Number(datos.monto_total).toLocaleString("es-CL")}` : null },
                        { label: "Fecha", val: datos?.fecha_emision },
                        { label: "Proyecto", val: selected.project_name },
                      ].map(({ label, val }) => (
                        <div key={label} style={{ borderRadius: 8, padding: "8px 12px", background: "var(--secondary)" }}>
                          <div style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 2 }}>{label}</div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{val ?? "—"}</div>
                        </div>
                      ))}
                    </div>

                    {/* Resolver info */}
                    {classif?.resolver_method && (
                      <div style={{ marginBottom: 16, padding: 10, borderRadius: 8, background: "rgba(79,70,229,0.10)", border: "1px solid rgba(79,70,229,0.20)" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)", marginBottom: 4 }}>Resolucion de proyecto</div>
                        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                          Metodo: <strong>{classif.resolver_method}</strong> · Confianza: <strong>{classif.resolver_confidence ? Math.round(classif.resolver_confidence * 100) + "%" : "—"}</strong>
                        </div>
                      </div>
                    )}

                    {/* Reasoning */}
                    {classif?.razonamiento && (
                      <details style={{ marginBottom: 16, borderRadius: 10, border: "1px solid rgba(245,158,11,0.3)", padding: 12, background: "rgba(245,158,11,0.06)" }}>
                        <summary style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", cursor: "pointer" }}>Razonamiento IA</summary>
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                          {Object.entries(classif.razonamiento).map(([k, v]) => (
                            <div key={k} style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                              <strong style={{ color: "var(--foreground)" }}>{k}:</strong> {String(v)}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Clarification history */}
                    {selected.parsed_data?.clarification_requested_at && (
                      <div style={{ marginBottom: 16, padding: 10, borderRadius: 8, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)", marginBottom: 4 }}>Historial de clarificacion</div>
                        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                          Solicitada: {new Date(selected.parsed_data.clarification_requested_at).toLocaleString("es-CL")}
                          {selected.parsed_data.clarification_resolved_at && (
                            <> · Resuelta: {new Date(selected.parsed_data.clarification_resolved_at).toLocaleString("es-CL")}</>
                          )}
                          {selected.parsed_data.clarification_attempts && (
                            <> · Intentos: {selected.parsed_data.clarification_attempts}</>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    {!["approved", "rejected"].includes(selected.status) && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={handleApprove} disabled={actionLoading === "approve"}
                          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 14px", borderRadius: 8, border: "none", background: "var(--success)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: actionLoading === "approve" ? 0.6 : 1 }}>
                          <CheckCircle size={14} />
                          {actionLoading === "approve" ? "Aprobando..." : "Aprobar"}
                        </button>
                        <button onClick={() => setShowRejectModal(true)}
                          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 14px", borderRadius: 8, border: "none", background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                          <XCircle size={14} /> Rechazar
                        </button>
                      </div>
                    )}

                    {/* Already approved/rejected */}
                    {selected.status === "approved" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)", fontSize: 13, fontWeight: 600 }}>
                        <CheckCircle size={14} /> Aprobado {selected.parsed_data?.approved_at ? `el ${new Date(selected.parsed_data.approved_at).toLocaleDateString("es-CL")}` : ""}
                      </div>
                    )}
                    {selected.status === "rejected" && (
                      <div style={{ padding: "10px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--danger) 8%, transparent)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
                          <XCircle size={14} /> Rechazado
                        </div>
                        {selected.parsed_data?.rejection_reason && (
                          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>Motivo: {selected.parsed_data.rejection_reason}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reject modal */}
      {showRejectModal && selected && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
          onClick={e => e.target === e.currentTarget && setShowRejectModal(false)}>
          <div style={{ width: "100%", maxWidth: 420, borderRadius: 16, padding: 24, border: "1px solid var(--border)", background: "var(--card)" }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Rechazar documento</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 6, display: "block" }}>Motivo del rechazo</label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                placeholder="Describe por que rechazas este documento..."
                rows={3}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, resize: "vertical" }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowRejectModal(false)}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", cursor: "pointer", fontSize: 13 }}>
                Cancelar
              </button>
              <button onClick={handleReject} disabled={actionLoading === "reject"}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--danger)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: actionLoading === "reject" ? 0.6 : 1 }}>
                {actionLoading === "reject" ? "Rechazando..." : "Confirmar rechazo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

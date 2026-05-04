"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

interface Activacion {
  id: string;
  nombre?: string;
  activation_date?: string;
  estado_f5?: string;
  status?: string;
  location?: { nombre?: string };
  campaign?: { nombre?: string };
}
interface Checkin { id: string; ts: string; observacion?: string; promotor?: { nombre?: string }; }
interface Incidencia { id: string; descripcion: string; severidad: string; estado: string; created_at: string; }
interface Reporte { id: string; momento: string; observacion?: string; created_at: string; }

function ReporteClienteContent() {
  const params = useSearchParams();
  const id = params.get("id");

  const [activacion, setActivacion] = useState<Activacion | null>(null);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [loading, setLoading] = useState(true);
  const [destinatarios, setDestinatarios] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get(`/activations/${id}`).catch(() => ({ data: null })),
      api.get(`/v1/app/f5/activaciones/${id}/checkins`).catch(() => ({ data: [] })),
      api.get(`/v1/app/f5/activaciones/${id}/incidencias`).catch(() => ({ data: [] })),
      api.get(`/v1/app/f5/activaciones/${id}/reportes-avance`).catch(() => ({ data: [] })),
    ] as const).then(([a, ch, inc, rep]) => {
      const aRaw = (a as any)?.data ?? a; setActivacion((aRaw as any)?.data ?? aRaw);
      const chData = (ch as any)?.data?.data ?? (ch as any)?.data;
      const incData = (inc as any)?.data?.data ?? (inc as any)?.data;
      const repData = (rep as any)?.data?.data ?? (rep as any)?.data;
      setCheckins(Array.isArray(chData) ? chData : []);
      setIncidencias(Array.isArray(incData) ? incData : []);
      setReportes(Array.isArray(repData) ? repData : []);
    }).catch(() => setError("Error cargando datos")).finally(() => setLoading(false));
  }, [id]);

  const fmt = (d?: string) => d ? new Date(d).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("es-CL", { dateStyle: "long" }) : "—";
  const incAbiertas = incidencias.filter((i) => i.estado === "abierta" || i.estado === "open");

  const buildHtml = () => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<style>body{font-family:Arial,sans-serif;color:#1a1a2e;max-width:700px;margin:0 auto;padding:32px}
h1{color:#4F46E5;border-bottom:2px solid #4F46E5;padding-bottom:8px}h2{color:#374151;margin-top:28px;font-size:16px}
.meta{background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0}.meta p{margin:4px 0;font-size:14px}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:bold}
.bg{background:#d1fae5;color:#065f46}.br{background:#fee2e2;color:#991b1b}.by{background:#fef3c7;color:#92400e}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
th{background:#4F46E5;color:white;padding:8px 12px;text-align:left}td{padding:8px 12px;border-bottom:1px solid #e5e7eb}
tr:nth-child(even) td{background:#f9fafb}.footer{margin-top:40px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px}
</style></head><body>
<h1>📋 Reporte de Activación</h1>
<div class="meta">
  <p><strong>Activación:</strong> ${activacion?.nombre ?? id}</p>
  <p><strong>Fecha:</strong> ${fmtDate(activacion?.activation_date)}</p>
  <p><strong>Estado:</strong> <span class="badge bg">${activacion?.estado_f5 ?? activacion?.status ?? "—"}</span></p>
  ${activacion?.location?.nombre ? `<p><strong>Ubicación:</strong> ${activacion.location.nombre}</p>` : ""}
  ${activacion?.campaign?.nombre ? `<p><strong>Campaña:</strong> ${activacion.campaign.nombre}</p>` : ""}
</div>
<h2>✅ Check-ins (${checkins.length})</h2>
${checkins.length === 0 ? "<p style='color:#9ca3af;font-size:13px'>Sin check-ins</p>" :
  `<table><tr><th>Promotor</th><th>Hora</th><th>Observación</th></tr>
  ${checkins.map(c => `<tr><td>${c.promotor?.nombre ?? "—"}</td><td>${fmt(c.ts)}</td><td>${c.observacion ?? "—"}</td></tr>`).join("")}
  </table>`}
<h2>⚠️ Incidencias (${incidencias.length})</h2>
${incidencias.length === 0 ? "<p style='color:#9ca3af;font-size:13px'>Sin incidencias</p>" :
  `<table><tr><th>Severidad</th><th>Descripción</th><th>Estado</th><th>Fecha</th></tr>
  ${incidencias.map(i => `<tr><td><span class="badge ${i.severidad === "alta" ? "br" : "by"}">${i.severidad}</span></td><td>${i.descripcion}</td><td>${i.estado}</td><td>${fmt(i.created_at)}</td></tr>`).join("")}
  </table>`}
<h2>📊 Reportes de Avance (${reportes.length})</h2>
${reportes.length === 0 ? "<p style='color:#9ca3af;font-size:13px'>Sin reportes</p>" :
  `<table><tr><th>Momento</th><th>Observación</th><th>Fecha</th></tr>
  ${reportes.map(r => `<tr><td>${r.momento}</td><td>${r.observacion ?? "—"}</td><td>${fmt(r.created_at)}</td></tr>`).join("")}
  </table>`}
<div class="footer">Generado por Control Suite · ${new Date().toLocaleString("es-CL")}</div>
</body></html>`;

  const enviar = async () => {
    if (!id || !destinatarios.trim()) { setError("Ingresa al menos un destinatario"); return; }
    setError(""); setSending(true);
    try {
      const emails = destinatarios.split(",").map(e => e.trim()).filter(Boolean);
      await api.post(`/v1/app/f5/activaciones/${id}/reporte-cliente/enviar`, { destinatarios: emails, htmlReporte: buildHtml() });
      setSent(true); setPreview(false);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Error al enviar.");
    } finally { setSending(false); }
  };

  const statColor = (e?: string) => {
    if (!e) return "#9ca3af";
    const s = e.toLowerCase();
    if (s.includes("progress") || s.includes("vivo")) return "#34b96e";
    if (s.includes("complet") || s.includes("cerr")) return "#6366f1";
    return "#f59e0b";
  };

  const tdStyle = { padding: "9px 18px" } as const;
  const thStyle = { padding: "8px 18px", textAlign: "left" as const, fontWeight: 500 };

  return (
    <div className="animate-fade-up" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="flex items-center gap-3 mb-6">
        <a href="/client/terreno" style={{ color: "var(--muted-foreground)", textDecoration: "none", fontSize: 13 }}>← Terreno</a>
        <span style={{ color: "var(--muted-foreground)" }}>/</span>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Reporte Cliente</h1>
      </div>

      {loading && <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}><div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>Cargando activación...</div>}
      {!loading && error && !activacion && <div className="rounded-xl border p-6 text-center" style={{ background: "#fee2e2", borderColor: "#fca5a5", color: "#991b1b" }}>{error}</div>}

      {!loading && activacion && (<>
        {/* Info */}
        <div className="rounded-xl border p-5 mb-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex items-start justify-between">
            <div>
              <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 4 }}>Activación</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{activacion.nombre ?? id?.slice(0, 8)}</div>
              {activacion.campaign?.nombre && <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 2 }}>{activacion.campaign.nombre}{activacion.location?.nombre && ` · ${activacion.location.nombre}`}</div>}
            </div>
            <span style={{ background: statColor(activacion.estado_f5 ?? activacion.status), color: "#fff", borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 600, textTransform: "uppercase" }}>
              {activacion.estado_f5 ?? activacion.status ?? "—"}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 10 }}>📅 {fmtDate(activacion.activation_date)}</div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: "Check-ins", value: checkins.length, color: "#34b96e", icon: "✅" },
            { label: "Incidencias abiertas", value: incAbiertas.length, color: incAbiertas.length > 0 ? "#e8353f" : "#34b96e", icon: "⚠️" },
            { label: "Reportes de avance", value: reportes.length, color: "#6366f1", icon: "📊" },
          ].map(({ label, value, color, icon }) => (
            <div key={label} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Check-ins */}
        <div className="rounded-xl border mb-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>✅ Check-ins</div>
          {checkins.length === 0 ? <div style={{ padding: "20px 18px", color: "var(--muted-foreground)", fontSize: 13 }}>Sin check-ins</div> : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead><tr style={{ color: "var(--muted-foreground)" }}><th style={thStyle}>Promotor</th><th style={thStyle}>Hora</th><th style={thStyle}>Observación</th></tr></thead>
              <tbody>{checkins.map((c, i) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--border)", background: i % 2 ? "var(--muted)" : "transparent" }}>
                  <td style={tdStyle}>{c.promotor?.nombre ?? "—"}</td><td style={tdStyle}>{fmt(c.ts)}</td><td style={{ ...tdStyle, color: "var(--muted-foreground)" }}>{c.observacion ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>

        {/* Incidencias */}
        <div className="rounded-xl border mb-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>⚠️ Incidencias</div>
          {incidencias.length === 0 ? <div style={{ padding: "20px 18px", color: "var(--muted-foreground)", fontSize: 13 }}>Sin incidencias</div> : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead><tr style={{ color: "var(--muted-foreground)" }}><th style={thStyle}>Severidad</th><th style={thStyle}>Descripción</th><th style={thStyle}>Estado</th><th style={thStyle}>Fecha</th></tr></thead>
              <tbody>{incidencias.map((inc, i) => (
                <tr key={inc.id} style={{ borderTop: "1px solid var(--border)", background: i % 2 ? "var(--muted)" : "transparent" }}>
                  <td style={tdStyle}><span style={{ background: inc.severidad === "alta" ? "#fee2e2" : "#fef3c7", color: inc.severidad === "alta" ? "#991b1b" : "#92400e", borderRadius: 12, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{inc.severidad}</span></td>
                  <td style={tdStyle}>{inc.descripcion}</td>
                  <td style={tdStyle}><span style={{ background: inc.estado === "abierta" || inc.estado === "open" ? "#fee2e2" : "#d1fae5", color: inc.estado === "abierta" || inc.estado === "open" ? "#991b1b" : "#065f46", borderRadius: 12, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{inc.estado}</span></td>
                  <td style={{ ...tdStyle, color: "var(--muted-foreground)" }}>{fmt(inc.created_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>

        {/* Reportes */}
        <div className="rounded-xl border mb-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>📊 Reportes de Avance</div>
          {reportes.length === 0 ? <div style={{ padding: "20px 18px", color: "var(--muted-foreground)", fontSize: 13 }}>Sin reportes de avance</div> : (
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead><tr style={{ color: "var(--muted-foreground)" }}><th style={thStyle}>Momento</th><th style={thStyle}>Observación</th><th style={thStyle}>Fecha</th></tr></thead>
              <tbody>{reportes.map((r, i) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border)", background: i % 2 ? "var(--muted)" : "transparent" }}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{r.momento}</td><td style={{ ...tdStyle, color: "var(--muted-foreground)" }}>{r.observacion ?? "—"}</td><td style={{ ...tdStyle, color: "var(--muted-foreground)" }}>{fmt(r.created_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>

        {/* Send */}
        {sent ? (
          <div className="rounded-xl border p-6 text-center" style={{ background: "#d1fae5", borderColor: "#6ee7b7" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <div style={{ fontWeight: 700, color: "#065f46", fontSize: 16 }}>Reporte enviado correctamente</div>
            <div style={{ color: "#047857", fontSize: 13, marginTop: 4 }}>Destinatarios: {destinatarios}</div>
            <button onClick={() => setSent(false)} style={{ marginTop: 16, background: "#065f46", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", cursor: "pointer", fontSize: 13 }}>Enviar a otro</button>
          </div>
        ) : (
          <div className="rounded-xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>📧 Enviar Reporte al Cliente</div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 6 }}>Destinatarios <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>(separados por coma)</span></label>
              <input type="text" value={destinatarios} onChange={(e) => setDestinatarios(e.target.value)} placeholder="cliente@empresa.cl, gerente@empresa.cl"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 14, boxSizing: "border-box", outline: "none" }} />
            </div>
            {error && <div style={{ color: "#e8353f", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setPreview(!preview)} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
                {preview ? "Ocultar preview" : "👁 Ver preview"}
              </button>
              <button onClick={enviar} disabled={sending} style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: sending ? "#9ca3af" : "#4F46E5", color: "#fff", cursor: sending ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600 }}>
                {sending ? "Enviando..." : "📤 Enviar reporte"}
              </button>
            </div>
            {preview && (
              <div ref={previewRef} style={{ marginTop: 18, borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
                <iframe srcDoc={buildHtml()} style={{ width: "100%", height: 480, border: "none" }} title="Preview reporte" />
              </div>
            )}
          </div>
        )}
      </>)}
    </div>
  );
}

// ✅ Suspense wrapper — required for useSearchParams() in Next.js App Router
export default function ReporteClientePage() {
  return (
    <AppShell>
      <Suspense fallback={
        <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>Cargando...
        </div>
      }>
        <ReporteClienteContent />
      </Suspense>
    </AppShell>
  );
}
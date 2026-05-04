"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { LayoutDashboard, Megaphone, Activity, Users, MapPin, FileText, Clock, TrendingUp, RefreshCw } from "lucide-react";

type KPI = {
  label: string;
  value: number | undefined;
  sub?: string;
  color: string;
  icon: React.ElementType;
  key: string;
  formula: string;
  source_tables: string[];
  description: string;
};

type Overview = {
  kpis: Record<string, number>;
  trends: { events_by_day: { date: string; count: number }[]; activations_by_week: { week: string; count: number }[] };
  generated_at: string;
};

const PERIODS = [
  { label: "Hoy",         value: "day" },
  { label: "Esta semana", value: "week" },
  { label: "Este mes",    value: "month" },
  { label: "Este año",    value: "year" },
];

// KPI metadata — formula + source tables for modal
const KPI_META: Record<string, { formula: string; source_tables: string[]; description: string }> = {
  total_projects:        { formula: "COUNT(*) WHERE client_id = :cid", source_tables: ["projects"], description: "Total de proyectos del cliente en todos los estados." },
  active_campaigns:      { formula: "COUNT(*) WHERE client_id = :cid AND status = 'active'", source_tables: ["campaigns"], description: "Campañas activas en el período seleccionado." },
  total_activations:     { formula: "COUNT(*) WHERE client_id = :cid", source_tables: ["activations"], description: "Total de activaciones registradas." },
  activations_completed: { formula: "COUNT(*) WHERE client_id = :cid AND status = 'completed'", source_tables: ["activations"], description: "Activaciones cerradas exitosamente." },
  active_promoters:      { formula: "COUNT(*) WHERE client_id = :cid AND active = true", source_tables: ["promoters"], description: "Promotores activos asignados al cliente." },
  total_locations:       { formula: "COUNT(*) WHERE client_id = :cid", source_tables: ["locations"], description: "Ubicaciones registradas para el cliente." },
  events_received_24h:   { formula: "COUNT(*) WHERE client_id = :cid AND created_at >= NOW() - INTERVAL '24h'", source_tables: ["eventos_crudos"], description: "Eventos recibidos en las últimas 24 horas." },
  documents_populated:   { formula: "COUNT(*) WHERE client_id = :cid AND status = 'populated'", source_tables: ["invoices", "eventos_crudos"], description: "Documentos procesados y persistidos exitosamente." },
};

function KPIModal({ kpi, onClose }: { kpi: KPI; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}>
      <div
        className="rounded-2xl border w-full max-w-lg overflow-hidden"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}22` }}>
              <kpi.icon size={16} style={{ color: kpi.color }} />
            </div>
            <div>
              <div className="font-bold text-base">{kpi.label}</div>
              <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{kpi.description}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", fontSize: 20 }}>✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Value */}
          <div className="rounded-xl p-4 flex items-center gap-4" style={{ background: "var(--secondary)" }}>
            <div style={{ fontSize: 42, fontWeight: 800, color: kpi.color, lineHeight: 1 }}>{kpi.value ?? "—"}</div>
            <div>
              <div className="text-xs font-semibold" style={{ color: "var(--muted-foreground)" }}>VALOR ACTUAL</div>
              {kpi.sub && <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>{kpi.sub}</div>}
            </div>
          </div>

          {/* Source tables */}
          <div>
            <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Tablas fuente</div>
            <div className="flex flex-wrap gap-2">
              {kpi.source_tables.map((t) => (
                <span key={t} className="px-2 py-1 rounded text-xs font-mono"
                  style={{ background: `${kpi.color}18`, color: kpi.color, border: `1px solid ${kpi.color}33` }}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Formula / Query */}
          <div>
            <div className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Fórmula</div>
            <div className="rounded-lg p-3 font-mono text-xs overflow-x-auto"
              style={{ background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)" }}>
              SELECT {kpi.formula}
              {"\n"}FROM {kpi.source_tables[0]}
              {"\n"}WHERE client_id = :client_id
            </div>
          </div>

          {/* Info */}
          <div className="rounded-lg p-3 text-xs" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
            Dato generado en tiempo real. Actualizado a las {new Date().toLocaleTimeString("es-CL")}.
            Aislado por <span className="font-mono" style={{ color: "var(--foreground)" }}>client_id</span> — sin acceso cruzado entre clientes.
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ kpi, loading, onClick }: { kpi: KPI; loading: boolean; onClick: () => void }) {
  return (
    <div
      className="rounded-xl p-5 border flex flex-col gap-3 cursor-pointer transition-all"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
      onClick={onClick}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = kpi.color; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; }}
      title="Click para ver detalle"
    >
      <div className="flex items-start justify-between">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}22` }}>
          <kpi.icon size={16} style={{ color: kpi.color }} />
        </div>
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--secondary)", color: "var(--muted-foreground)", fontSize: 10 }}>
          Ver detalle
        </span>
      </div>
      {loading ? (
        <div>
          <div className="h-7 w-16 rounded animate-pulse mb-2" style={{ background: "var(--secondary)" }} />
          <div className="h-3 w-24 rounded animate-pulse" style={{ background: "var(--secondary)" }} />
        </div>
      ) : (
        <div>
          <div className="text-2xl font-bold leading-none mb-1.5">{kpi.value ?? "—"}</div>
          <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{kpi.label}</div>
          {kpi.sub && <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>{kpi.sub}</div>}
        </div>
      )}
    </div>
  );
}

function SimpleBarChart({ data, color }: { data: { label: string; count: number }[]; color: string }) {
  if (!data.length) return <div className="flex items-center justify-center h-32 text-xs" style={{ color: "var(--muted-foreground)" }}>Sin datos</div>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-32 pt-2">
      {data.slice(-20).map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.label}: ${d.count}`}>
          <div className="w-full rounded-sm transition-all" style={{ height: `${(d.count / max) * 100}%`, minHeight: 2, background: color, opacity: 0.8 }} />
        </div>
      ))}
    </div>
  );
}

export default function DashboardShared() {
  const [overview, setOverview]     = useState<Overview | null>(null);
  const [loading, setLoading]       = useState(true);
  const [period, setPeriod]         = useState("month");
  const [projects, setProjects]     = useState<any[]>([]);
  const [projectId, setProjectId]   = useState("");
  const [activeKpi, setActiveKpi]   = useState<KPI | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (projectId) params.append("project_id", projectId);
      const res = await api.get<any>(`/dashboard/overview?${params}`);
      setOverview(res?.data ?? res);
    } catch { } finally { setLoading(false); }
  }, [period, projectId]);

  useEffect(() => {
    api.get<any>("/projects").then((r) => {
      const list = Array.isArray(r) ? r : (r?.data ?? []);
      setProjects(list);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const k = overview?.kpis ?? {};
  const eventsData = (overview?.trends?.events_by_day ?? []).map((e) => ({ label: e.date, count: e.count }));
  const actData    = (overview?.trends?.activations_by_week ?? []).map((e) => ({ label: e.week, count: e.count }));

  const kpis: KPI[] = [
    { key: "total_projects",        label: "Total Projects",    value: k.total_projects,        color: "var(--red)",   icon: LayoutDashboard, ...KPI_META.total_projects },
    { key: "active_campaigns",      label: "Active Campaigns",  value: k.active_campaigns,      color: "#3b82f6",      icon: Megaphone,       ...KPI_META.active_campaigns },
    { key: "total_activations",     label: "Total Activations", value: k.total_activations,     color: "var(--green)", icon: Activity,        ...KPI_META.total_activations },
    { key: "activations_completed", label: "Completed",         value: k.activations_completed, color: "var(--green)", icon: TrendingUp,      ...KPI_META.activations_completed },
    { key: "active_promoters",      label: "Active Promoters",  value: k.active_promoters,      color: "#f59e0b",      icon: Users,           ...KPI_META.active_promoters },
    { key: "total_locations",       label: "Locations",         value: k.total_locations,       color: "#8b5cf6",      icon: MapPin,          ...KPI_META.total_locations },
    { key: "events_received_24h",   label: "Events (24h)",      value: k.events_received_24h,   color: "#06b6d4",      icon: Clock,           sub: `${k.events_processed_24h ?? 0} processed`, ...KPI_META.events_received_24h },
    { key: "documents_populated",   label: "Docs Populated",    value: k.documents_populated,   color: "#f59e0b",      icon: FileText,        sub: `of ${k.documents_uploaded ?? 0} uploaded`, ...KPI_META.documents_populated },
  ];

  const selectStyle = {
    background: "var(--secondary)", border: "1px solid var(--border)",
    color: "var(--foreground)", borderRadius: 8, padding: "6px 12px",
    fontSize: 13, outline: "none", cursor: "pointer",
  };

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            {overview?.generated_at ? `Updated ${new Date(overview.generated_at).toLocaleTimeString()}` : "Operational overview"}
            <span className="ml-2 opacity-60">· Click any KPI to see the math</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} style={selectStyle}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {projects.length > 0 && (
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={selectStyle}>
              <option value="">Todos los proyectos</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name || p.nombre}</option>)}
            </select>
          )}
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors"
            style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {kpis.map((kpi) => (
          <KPICard key={kpi.key} kpi={kpi} loading={loading} onClick={() => setActiveKpi(kpi)} />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-xl p-5 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-1">Events Received</div>
          <div className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>
            {period === "day" ? "Últimas 24h" : period === "week" ? "Esta semana" : period === "month" ? "Últimos 30 días" : "Este año"}
          </div>
          <SimpleBarChart data={eventsData} color="var(--red)" />
        </div>
        <div className="rounded-xl p-5 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-1">Activations per Week</div>
          <div className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>Últimas 12 semanas</div>
          <SimpleBarChart data={actData} color="var(--green)" />
        </div>
      </div>

      {activeKpi && <KPIModal kpi={activeKpi} onClose={() => setActiveKpi(null)} />}
    </div>
  );
}
"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { Activity, RefreshCw } from "lucide-react";

export default function MonitoreoPage() {
  const [data, setData]     = useState<any>(null);
  const [loading, setLoad]  = useState(true);

  const load = useCallback(async () => {
    setLoad(true);
    try {
      const res = await api.get<any>("/dashboard/overview");
      setData(res?.data ?? res);
    } catch { setData(null); } finally { setLoad(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpis = [
    { label: "Eventos (24h)",       value: data?.kpis?.events_received_24h ?? "—",  color: "#6366f1" },
    { label: "Procesados (24h)",     value: data?.kpis?.events_processed_24h ?? "—", color: "#34b96e" },
    { label: "Activaciones totales", value: data?.kpis?.total_activations ?? "—",    color: "#f59e0b" },
    { label: "Completadas",          value: data?.kpis?.activations_completed ?? "—",color: "#60a5fa" },
  ];

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Monitoreo Operacional</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Estado en tiempo real de la plataforma</p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
            style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
            <RefreshCw size={12} /> Actualizar
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-xl p-5 border flex flex-col gap-3"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}22` }}>
                <Activity size={16} style={{ color: kpi.color }} />
              </div>
              {loading ? (
                <div className="h-7 w-16 rounded animate-pulse" style={{ background: "var(--secondary)" }} />
              ) : (
                <div>
                  <div className="text-2xl font-bold leading-none mb-1.5">{kpi.value}</div>
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{kpi.label}</div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-xl p-5 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="text-sm font-semibold mb-3">Estado de servicios</div>
          {[
            { name: "API Backend",        status: "operativo" },
            { name: "Base de datos",       status: "operativo" },
            { name: "Cola de eventos",     status: "operativo" },
            { name: "Procesador de docs",  status: "operativo" },
          ].map((s) => (
            <div key={s.name} className="flex items-center justify-between py-2.5 border-b last:border-0"
              style={{ borderColor: "var(--border)" }}>
              <span className="text-sm">{s.name}</span>
              <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#34b96e" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: "#34b96e" }} />
                {s.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

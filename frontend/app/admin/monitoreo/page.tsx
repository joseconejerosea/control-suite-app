"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { RefreshCw } from "lucide-react";

export default function MonitoreoPage() {
  const [overview, setOverview] = useState<any>(null);
  const [clients, setClients]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, cl] = await Promise.all([
        api.get<any>("/admin/monitoring").catch(() => null),
        api.get<any>("/admin/monitoring/clients").catch(() => []),
      ]);
      setOverview(ov?.data ?? ov);
      setClients(Array.isArray(cl) ? cl : (cl?.data ?? []));
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpis = [
    { label: "Eventos (24h)",        value: overview?.events_received_24h ?? "—",   color: "#6366f1" },
    { label: "Procesados (24h)",     value: overview?.events_processed_24h ?? "—",  color: "#34b96e" },
    { label: "Activaciones live",    value: overview?.live_activations ?? "—",      color: "#f59e0b" },
    { label: "Tasa de exito",        value: overview?.success_rate ? `${overview.success_rate}%` : "—", color: "#60a5fa" },
    { label: "Latencia avg (ms)",    value: overview?.avg_latency_ms ?? "—",        color: "#a78bfa" },
    { label: "Clientes activos",     value: (overview?.active_clients ?? clients.length) || "—", color: "#34b96e" },
  ];

  const flows = [
    { name: "F1 Documents",    key: "f1", icon: "📄" },
    { name: "F2 Rendiciones",  key: "f2", icon: "💰" },
    { name: "F3 Inventario",   key: "f3", icon: "📦" },
    { name: "F4 Projects",     key: "f4", icon: "🗂" },
    { name: "F5 Field",        key: "f5", icon: "📡" },
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

        {loading && <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {!loading && (<>
          {/* KPI Grid */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {kpis.map(({ label, value, color }) => (
              <div key={label} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
                <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Flow health */}
          <div className="rounded-xl border mb-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>Estado por Flow</div>
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {flows.map(f => {
                const fData = overview?.flows?.[f.key];
                const ok = !fData || (fData.error_rate ?? 0) < 5;
                return (
                  <div key={f.key} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span style={{ fontSize: 18 }}>{f.icon}</span>
                      <div>
                        <div className="text-sm font-medium">{f.name}</div>
                        {fData && <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                          {fData.total ?? 0} eventos · {fData.error_rate ?? 0}% errores
                        </div>}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{ background: ok ? "rgba(42,157,92,0.15)" : "rgba(200,32,44,0.15)", color: ok ? "#34b96e" : "#e8353f" }}>
                      {ok ? "Operacional" : "Atencion"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Clients table */}
          {clients.length > 0 && (
            <div className="rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>Clientes</div>
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ color: "var(--muted-foreground)" }}>
                    {["Cliente", "Eventos", "Documentos", "Estado"].map(h => (
                      <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c: any, i: number) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-4 py-3 text-sm font-medium">{c.nombre ?? c.name ?? c.id}</td>
                      <td className="px-4 py-3 text-sm">{c.eventos ?? "—"}</td>
                      <td className="px-4 py-3 text-sm">{c.documentos ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: "rgba(42,157,92,0.15)", color: "#34b96e" }}>Activo</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>)}
      </div>
    </AppShell>
  );
}

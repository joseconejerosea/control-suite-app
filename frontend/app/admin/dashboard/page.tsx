"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { RefreshCw } from "lucide-react";

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<any>(null);
  const [clients, setClients]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [period, setPeriod]     = useState("month");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, cl] = await Promise.all([
        api.get<any>(`/dashboard/overview?period=${period}`).catch(() => null),
        api.get<any>("/clients").catch(() => []),
      ]);
      setOverview(ov?.data ?? ov);
      setClients(Array.isArray(cl) ? cl : (cl?.data ?? []));
    } finally { setLoading(false); }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const k = overview?.kpis ?? {};

  const kpis = [
    { label: "Clientes activos",      value: clients.length || k.active_clients || "—", color: "#6366f1" },
    { label: "Eventos (24h)",         value: k.events_received_24h ?? "—",              color: "#34b96e" },
    { label: "Activaciones live",     value: k.total_activations ?? "—",               color: "#f59e0b" },
    { label: "Docs procesados",       value: k.documents_populated ?? "—",             color: "#60a5fa" },
    { label: "Promotores activos",    value: k.active_promoters ?? "—",                color: "#a78bfa" },
    { label: "Campanas activas",      value: k.active_campaigns ?? "—",                color: "#e8353f" },
  ];

  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString("es-CL") : "—";

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Dashboard Global</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Vista panoramica de todos los clientes</p>
          </div>
          <div className="flex gap-2">
            <select value={period} onChange={e => setPeriod(e.target.value)}
              style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none" }}>
              <option value="day">Hoy</option>
              <option value="week">Esta semana</option>
              <option value="month">Este mes</option>
              <option value="year">Este ano</option>
            </select>
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
              style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        {loading && <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {!loading && (<>
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {kpis.map(({ label, value, color }) => (
              <div key={label} className="rounded-xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div style={{ fontSize: 32, fontWeight: 800, color }}>{value}</div>
                <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Clients list */}
          {clients.length > 0 && (
            <div className="rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>Clientes ({clients.length})</div>
              <table className="w-full border-collapse">
                <thead><tr style={{ color: "var(--muted-foreground)", background: "var(--secondary)" }}>
                  {["Cliente", "Plan", "Creado", "Estado"].map(h => (
                    <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {clients.map((c: any, i: number) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td className="px-4 py-3 text-sm font-medium">{c.nombre ?? c.name ?? "—"}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>{c.plan ?? "starter"}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--muted-foreground)" }}>{fmtDate(c.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: c.activo !== false ? "rgba(42,157,92,0.15)" : "rgba(200,32,44,0.15)", color: c.activo !== false ? "#34b96e" : "#e8353f" }}>
                          {c.activo !== false ? "Activo" : "Inactivo"}
                        </span>
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

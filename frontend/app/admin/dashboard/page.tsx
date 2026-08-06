"use client";

import { useEffect, useState, useCallback } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { RefreshCw } from "lucide-react";

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<any>(null);
  const [clients, setClients]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // KPIs globales REALES (agregado de todos los tenants) vienen de monitoring.
      // /dashboard/overview es tenant-scoped → no sirve para la vista global.
      const [mon, cl] = await Promise.all([
        api.get<any>("/admin/monitoring").catch(() => null),
        api.get<any>("/clients").catch(() => []),
      ]);
      setOverview((mon?.data ?? mon)?.overview ?? null);
      setClients(Array.isArray(cl) ? cl : (cl?.data ?? []));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const o = overview ?? {};

  const kpis = [
    { label: "Clientes activos",   value: o.clients?.active ?? "—",    color: "var(--primary)" },
    { label: "Eventos (24h)",      value: o.events_24h?.total ?? "—",  color: "var(--success)" },
    { label: "Activaciones live",  value: o.activations?.live ?? "—",  color: "#f59e0b" },
    { label: "Docs (24h)",         value: o.docs_24h?.total ?? "—",    color: "var(--primary)" },
    { label: "Errores (24h)",      value: o.events_24h?.failed ?? "—", color: "var(--primary)" },
    { label: "Costo AI hoy",       value: o.ai_cost_hoy != null ? `$${Number(o.ai_cost_hoy).toFixed(4)}` : "—", color: "var(--primary)" },
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
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
            style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
            <RefreshCw size={12} /> Refresh
          </button>
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
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize"
                          style={{ background: c.status === "active" ? "color-mix(in srgb, var(--success) 15%, transparent)" : "rgba(79,70,229,0.15)", color: c.status === "active" ? "var(--success)" : "var(--primary)" }}>
                          {c.status ?? "—"}
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

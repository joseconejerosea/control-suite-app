"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

export default function MonitoringPage() {
  const [data, setData] = useState<any>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<any>("/admin/monitoring"),
      api.get<any>("/admin/monitoring/clients"),
    ]).then(([d, c]) => {
      setData(d?.data ?? d);
      setClients(Array.isArray(c) ? c : (c?.data ?? []));
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const KPI = ({ label, value, color = "#fff" }: any) => (
    <div className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color }}>{value ?? "—"}</div>
    </div>
  );

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="mb-6">
          <h1 className="text-xl font-bold">Monitoring</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Real-time platform health</p>
        </div>

        {loading && <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {!loading && data && (
          <>
            <div className="grid grid-cols-5 gap-4 mb-6">
              <KPI label="Clientes Activos" value={data.overview?.clients?.active} color="var(--success)" />
              <KPI label="Activaciones EN VIVO" value={data.overview?.activations?.live} color="var(--primary)" />
              <KPI label="Eventos 24h" value={data.overview?.events_24h?.total} />
              <KPI label="Errores 24h" value={data.overview?.events_24h?.failed} color={data.overview?.events_24h?.failed > 0 ? "var(--danger)" : "var(--success)"} />
              <KPI label="Costo AI hoy" value={`$${parseFloat(data.overview?.ai_cost_hoy ?? 0).toFixed(4)}`} color="var(--warning)" />
            </div>

            {data.flows?.length > 0 && (
              <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: "var(--border)" }}>
                <div className="px-4 py-3 font-semibold text-sm" style={{ background: "var(--secondary)" }}>Flows (7 días)</div>
                <table className="w-full border-collapse">
                  <thead style={{ background: "var(--secondary)" }}>
                    <tr>
                      {["Canal", "Total", "OK", "Failed", "Success Rate"].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.flows.map((f: any) => {
                      const rate = f.total > 0 ? ((f.ok / f.total) * 100).toFixed(1) : 0;
                      return (
                        <tr key={f.canal} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="px-4 py-2 text-sm font-medium">{f.canal}</td>
                          <td className="px-4 py-2 text-sm">{f.total}</td>
                          <td className="px-4 py-2 text-sm" style={{ color: "var(--success)" }}>{f.ok}</td>
                          <td className="px-4 py-2 text-sm" style={{ color: f.failed > 0 ? "var(--danger)" : "var(--muted-foreground)" }}>{f.failed}</td>
                          <td className="px-4 py-2">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{ background: parseFloat(rate as string) >= 90 ? "color-mix(in srgb, var(--success) 12%, transparent)" : "color-mix(in srgb, var(--danger) 12%, transparent)", color: parseFloat(rate as string) >= 90 ? "var(--success)" : "var(--danger)" }}>
                              {rate}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <div className="px-4 py-3 font-semibold text-sm" style={{ background: "var(--secondary)" }}>Estado por Cliente</div>
              <table className="w-full border-collapse">
                <thead style={{ background: "var(--secondary)" }}>
                  <tr>
                    {["Cliente", "Status", "Activaciones Live", "Eventos 24h", "Errores 24h"].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c: any) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td className="px-4 py-2 text-sm font-medium">{c.nombre}</td>
                      <td className="px-4 py-2">
                        <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: c.status === "active" ? "color-mix(in srgb, var(--success) 12%, transparent)" : "var(--secondary)", color: c.status === "active" ? "var(--success)" : "var(--muted-foreground)" }}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm">{c.activaciones_live}</td>
                      <td className="px-4 py-2 text-sm">{c.eventos_24h}</td>
                      <td className="px-4 py-2 text-sm" style={{ color: c.errores_24h > 0 ? "var(--danger)" : "var(--muted-foreground)" }}>{c.errores_24h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

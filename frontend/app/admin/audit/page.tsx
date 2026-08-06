"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

export default function AuditPage() {
  const [data, setData]       = useState<any>(null);
  const [actions, setActions] = useState<any[]>([]);
  const [days, setDays]       = useState("30");
  const [tab, setTab]         = useState<"costs" | "actions">("costs");
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      api.get<any>(`/admin/audit/ai-costs?days=${days}`).catch(() => null),
      api.get<any>("/admin/audit/actions").catch(() => []),
    ]).then(([costs, acts]) => {
      setData(costs?.data ?? costs);
      setActions(Array.isArray(acts) ? acts : (acts?.data ?? []));
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [days]);

  const fmtUSD = (v: any) => v ? `$${parseFloat(String(v)).toFixed(4)}` : "$0.0000";

  // El backend devuelve { total: { total_usd, total_input, total_output, total_calls },
  // byClient, byFlow, byDay }. Acá lo mapeamos a lo que renderiza la UI.
  const total       = data?.total ?? {};
  const totalCalls  = Number(total.total_calls) || 0;
  const totalCost   = Number(total.total_usd) || 0;
  const totalTokens = (Number(total.total_input) || 0) + (Number(total.total_output) || 0);
  const avgPerCall  = totalCalls > 0 ? totalCost / totalCalls : 0;

  const summaryKpis = [
    { label: "Total AI Cost", value: fmtUSD(totalCost), color: "var(--primary)" },
    { label: "Claude calls", value: totalCalls, color: "var(--warning)" },
    { label: "Tokens usados", value: totalTokens ? `${(totalTokens / 1000).toFixed(1)}K` : "0", color: "var(--success)" },
    { label: "Avg per call", value: fmtUSD(avgPerCall), color: "var(--primary)" },
  ];

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Auditoria</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Costos AI + Log de acciones criticas</p>
          </div>
          <div className="flex gap-2">
            <select value={days} onChange={e => setDays(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
              <option value="7">Ultimos 7 dias</option>
              <option value="30">Ultimos 30 dias</option>
              <option value="90">Ultimos 90 dias</option>
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex mb-5" style={{ borderBottom: "1px solid var(--border)" }}>
          {[["costs", "Costos AI"], ["actions", "Log de Acciones"]].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t as any)}
              className="px-4 py-2.5 text-sm font-medium"
              style={{ borderBottom: tab === t ? "2px solid var(--primary)" : "2px solid transparent", color: tab === t ? "var(--foreground)" : "var(--muted-foreground)", background: "none", cursor: "pointer", marginBottom: "-1px" }}>
              {label}
            </button>
          ))}
        </div>

        {loading && <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {!loading && tab === "costs" && (<>
          {/* KPI summary */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {summaryKpis.map(({ label, value, color }) => (
              <div key={label} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
                <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Per client breakdown */}
          {data?.byClient?.length > 0 && (
            <div className="rounded-xl border mb-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>Costo por cliente</div>
              <table className="w-full border-collapse">
                <thead><tr style={{ color: "var(--muted-foreground)" }}>
                  {["Cliente", "Llamadas", "Tokens", "Costo USD", "Margen"].map(h => (
                    <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.byClient.map((c: any, i: number) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-4 py-3 text-sm font-medium">{c.nombre ?? c.client_id?.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-sm">{c.calls ?? "—"}</td>
                      <td className="px-4 py-3 text-sm">{c.tokens ? `${(c.tokens / 1000).toFixed(1)}K` : "—"}</td>
                      <td className="px-4 py-3 text-sm font-semibold">{fmtUSD(c.costo)}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: (c.margin ?? 0) >= 0 ? "color-mix(in srgb, var(--success) 15%, transparent)" : "color-mix(in srgb, var(--danger) 12%, transparent)", color: (c.margin ?? 0) >= 0 ? "var(--success)" : "var(--danger)" }}>
                          {c.margin != null ? `${c.margin > 0 ? "+" : ""}${c.margin}%` : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Per flow */}
          {data?.byFlow?.length > 0 && (
            <div className="rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>Costo por flow</div>
              <table className="w-full border-collapse">
                <thead><tr style={{ color: "var(--muted-foreground)" }}>
                  {["Flow", "Llamadas", "Costo USD"].map(h => (
                    <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.byFlow.map((f: any, i: number) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-4 py-3 text-sm font-medium uppercase">{f.flow}</td>
                      <td className="px-4 py-3 text-sm">{f.calls}</td>
                      <td className="px-4 py-3 text-sm font-semibold">{fmtUSD(f.costo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalCalls === 0 && (
            <div className="text-center py-12 rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
              <div>Sin datos de costos AI para el periodo seleccionado</div>
              <div className="text-xs mt-2">Los costos se registran en ai_costs_log por cada llamada a Claude/Vision</div>
            </div>
          )}
        </>)}

        {!loading && tab === "actions" && (
          <div className="rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            {actions.length === 0 ? (
              <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                <div>Sin acciones registradas</div>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead><tr style={{ color: "var(--muted-foreground)", background: "var(--secondary)" }}>
                  {["Accion", "Usuario", "Recurso", "Fecha"].map(h => (
                    <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {actions.map((a: any, i: number) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td className="px-4 py-3 text-sm font-medium">{a.action ?? a.tipo ?? "—"}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>{a.user_email ?? a.user_id?.slice(0, 8) ?? "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--muted-foreground)" }}>{a.resource ?? a.entity ?? "—"}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
                        {a.created_at ? new Date(a.created_at).toLocaleString("es-CL") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

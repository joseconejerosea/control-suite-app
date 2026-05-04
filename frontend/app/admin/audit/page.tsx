"use client";
import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

export default function AuditPage() {
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    setLoading(true);
    api.get<any>(`/admin/audit/ai-costs?days=${days}`)
      .then(r => setData(r?.data ?? r))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [days]);

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Auditoría AI Costs</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Costos de Claude y Vision por cliente y flow</p>
          </div>
          <select value={days} onChange={e => setDays(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="90">Últimos 90 días</option>
          </select>
        </div>

        {loading && <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {!loading && data && (
          <>
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[
                { label: "Costo Total USD", value: `$${parseFloat(data.total?.total_usd ?? 0).toFixed(4)}`, color: "#f59e0b" },
                { label: "Total Calls", value: data.total?.total_calls ?? 0 },
                { label: "Input Tokens", value: (data.total?.total_input ?? 0).toLocaleString() },
                { label: "Output Tokens", value: (data.total?.total_output ?? 0).toLocaleString() },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>{label}</div>
                  <div className="text-2xl font-bold" style={{ color: color ?? "var(--foreground)" }}>{value}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <div className="px-4 py-3 font-semibold text-sm" style={{ background: "var(--secondary)" }}>Por Cliente</div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr style={{ background: "var(--secondary)" }}>
                      {["Cliente", "Calls", "Costo USD"].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.byClient ?? []).map((c: any, i: number) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td className="px-4 py-2 text-sm font-medium">{c.nombre ?? c.client_id?.slice(0, 8)}</td>
                        <td className="px-4 py-2 text-sm">{c.calls}</td>
                        <td className="px-4 py-2 text-sm font-semibold" style={{ color: "#f59e0b" }}>${parseFloat(c.costo).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <div className="px-4 py-3 font-semibold text-sm" style={{ background: "var(--secondary)" }}>Por Flow</div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr style={{ background: "var(--secondary)" }}>
                      {["Flow", "Model", "Calls", "Costo USD"].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold" style={{ color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.byFlow ?? []).map((f: any, i: number) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td className="px-4 py-2 text-sm font-medium">{f.flow}</td>
                        <td className="px-4 py-2 text-xs" style={{ color: "var(--muted-foreground)" }}>{f.model}</td>
                        <td className="px-4 py-2 text-sm">{f.calls}</td>
                        <td className="px-4 py-2 text-sm font-semibold" style={{ color: "#f59e0b" }}>${parseFloat(f.costo).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

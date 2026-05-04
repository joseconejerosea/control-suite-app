"use client";

import AppShell from "@/components/layout/app-shell";
import { CreditCard, DollarSign, Users, TrendingUp } from "lucide-react";

const MOCK_FACTURAS = [
  { id: "F-2026-001", cliente: "Agencia Nexus BTL",  monto: "$1.200.000", estado: "pagada",  fecha: "2026-04-01" },
  { id: "F-2026-002", cliente: "Experience Events",  monto: "$850.000",   estado: "pendiente",fecha: "2026-04-10" },
  { id: "F-2026-003", cliente: "BTL Masters",        monto: "$2.100.000", estado: "pagada",  fecha: "2026-03-28" },
];

const ESTADO_STYLE: Record<string, { bg: string; color: string }> = {
  pagada:    { bg: "rgba(42,157,92,0.12)",  color: "#34b96e" },
  pendiente: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
  vencida:   { bg: "rgba(200,32,44,0.12)",  color: "#e8353f" },
};

export default function FacturacionPage() {
  const kpis = [
    { label: "Clientes activos",   value: "10",        icon: Users,       color: "#6366f1" },
    { label: "Ingresos del mes",   value: "$4.150.000", icon: DollarSign,  color: "#34b96e" },
    { label: "Facturas pendientes",value: "2",          icon: CreditCard,  color: "#f59e0b" },
    { label: "Crecimiento",        value: "+12%",       icon: TrendingUp,  color: "#60a5fa" },
  ];

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="mb-6">
          <h1 className="text-xl font-bold">Facturación</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Resumen de facturación y pagos</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-xl p-5 border flex flex-col gap-3"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}22` }}>
                <kpi.icon size={16} style={{ color: kpi.color }} />
              </div>
              <div>
                <div className="text-2xl font-bold leading-none mb-1.5">{kpi.value}</div>
                <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{kpi.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full border-collapse">
            <thead style={{ background: "var(--secondary)" }}>
              <tr>
                {["Folio", "Cliente", "Monto", "Estado", "Fecha"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left"
                    style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MOCK_FACTURAS.map((f) => (
                <tr key={f.id} style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <td className="px-4 py-3.5 text-xs font-mono" style={{ color: "var(--muted-foreground)" }}>{f.id}</td>
                  <td className="px-4 py-3.5 text-sm font-medium">{f.cliente}</td>
                  <td className="px-4 py-3.5 text-sm font-semibold">{f.monto}</td>
                  <td className="px-4 py-3.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase"
                      style={ESTADO_STYLE[f.estado]}>{f.estado}</span>
                  </td>
                  <td className="px-4 py-3.5 text-xs" style={{ color: "var(--muted-foreground)" }}>{f.fecha}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

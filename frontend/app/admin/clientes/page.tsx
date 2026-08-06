"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const STATUS_STYLE: Record<string, { background: string; color: string }> = {
  active:      { background: "color-mix(in srgb, var(--success) 12%, transparent)",  color: "var(--success)" },
  onboarding:  { background: "color-mix(in srgb, var(--info) 12%, transparent)", color: "var(--info)" },
  suspended:   { background: "color-mix(in srgb, var(--danger) 12%, transparent)",  color: "var(--danger)" },
  inactive:    { background: "rgba(100,116,139,0.12)", color: "#94a3b8" },
};

export default function AdminClientesPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState("");

  useEffect(() => {
    api.get<any>("/clients")
      .then((r) => setClients(Array.isArray(r) ? r : (r?.data ?? [])))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = clients.filter((c: any) =>
    c.nombre?.toLowerCase().includes(search.toLowerCase()) ||
    c.rut?.includes(search)
  );

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "suspended" : "active";
    await api.patch(`/clients/${id}`, { status: newStatus }).catch(console.error);
    setClients((cs) => cs.map((c) => c.id === id ? { ...c, status: newStatus } : c));
  };

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Clientes</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              {clients.length} clientes registrados
            </p>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total", value: clients.length, color: "var(--foreground)" },
            { label: "Activos", value: clients.filter((c: any) => c.status === "active").length, color: "var(--success)" },
            { label: "Onboarding", value: clients.filter((c: any) => c.status === "onboarding").length, color: "var(--info)" },
            { label: "Suspendidos", value: clients.filter((c: any) => c.status === "suspended").length, color: "var(--danger)" },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
              <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>{kpi.label}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o RUT..."
            className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full border-collapse">
            <thead style={{ background: "var(--secondary)" }}>
              <tr>
                {["Nombre", "RUT", "Plan", "Estado", "Onboarding", "Acciones"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left"
                    style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando...</td></tr>
              ) : filtered.map((c: any) => {
                const cfg = STATUS_STYLE[c.status] ?? STATUS_STYLE.inactive;
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                    <td className="px-4 py-3 font-semibold text-sm">{c.nombre}</td>
                    <td className="px-4 py-3 text-sm font-mono" style={{ color: "var(--muted-foreground)" }}>{c.rut ?? "—"}</td>
                    <td className="px-4 py-3 text-sm capitalize">{c.plan}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize" style={cfg}>{c.status}</span>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>{c.onboarding_step}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleStatus(c.id, c.status)}
                        className="text-xs px-2 py-1 rounded"
                        style={{
                          background: c.status === "active" ? "color-mix(in srgb, var(--danger) 12%, transparent)" : "color-mix(in srgb, var(--success) 12%, transparent)",
                          color: c.status === "active" ? "var(--danger)" : "var(--success)",
                          border: "none", cursor: "pointer",
                        }}>
                        {c.status === "active" ? "Suspender" : "Activar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

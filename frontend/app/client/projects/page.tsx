"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

type Project = {
  id: string;
  name: string;
  description?: string;
  status: string;
  start_date?: string;
  end_date?: string;
  budget?: number;
  objectives?: string;
};

const STATUS_STYLE: Record<string, { background: string; color: string }> = {
  active:   { background: "rgba(42,157,92,0.15)",  color: "#34b96e" },
  paused:   { background: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  archived: { background: "rgba(100,116,139,0.15)",color: "#94a3b8" },
  closed:   { background: "rgba(100,116,139,0.15)",color: "#94a3b8" },
};

// Las fechas de proyecto son date-only (columnas DATE, medianoche UTC). Sin timeZone:"UTC"
// se renderizan en hora local (Chile UTC-4) y caen al día anterior. Forzar UTC evita el corrimiento.
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("es-CL", { timeZone: "UTC" }) : "—";
const fmtMoney = (v?: number) => v != null ? `$${Number(v).toLocaleString("es-CL")}` : "—";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");

  const fetchProjects = () => {
    setLoading(true);
    api.get<any>("/projects")
      .then(r => setProjects(Array.isArray(r) ? r : (r?.data ?? [])))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProjects(); }, []);

  const filtered = projects.filter(p =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Proyectos</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Agrupa campañas y activaciones bajo un contenedor lógico</p>
          </div>
          <div className="flex gap-2">
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar proyectos..."
              style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", width: 200 }} />
            <button onClick={() => router.push("/client/projects/nuevo")}
              style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "var(--red)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              + Nuevo proyecto
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full border-collapse">
            <thead style={{ background: "var(--secondary)" }}>
              <tr>
                {["Nombre", "Estado", "Inicio", "Fin", "Presupuesto", "Acciones"].map(h => (
                  <th key={h} className="px-4 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>No hay proyectos.</td></tr>
              ) : filtered.map(p => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  <td className="px-4 py-3 text-sm font-medium">{p.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold capitalize" style={STATUS_STYLE[p.status] ?? STATUS_STYLE.active}>{p.status}</span>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>{fmtDate(p.start_date)}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>{fmtDate(p.end_date)}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{fmtMoney(p.budget)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => router.push(`/client/projects/editar?id=${p.id}`)} className="text-xs px-2 py-1 rounded"
                        style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>Editar</button>
                      {(() => {
                        const terminal = p.status === "closed" || p.status === "archived";
                        return (
                          <button
                            onClick={() => { if (!terminal) router.push(`/client/projects/convocar?id=${p.id}`); }}
                            disabled={terminal}
                            title={terminal ? "Proyecto cerrado/archivado: no se puede convocar" : undefined}
                            className="text-xs px-2 py-1 rounded"
                            style={{ background: "var(--red-dim, rgba(200,32,44,0.12))", color: "var(--red-light, #f87171)", border: "none", cursor: terminal ? "default" : "pointer", opacity: terminal ? 0.4 : 1 }}>Convocar</button>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

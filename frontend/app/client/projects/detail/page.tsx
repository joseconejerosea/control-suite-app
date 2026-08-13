"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { StatusBadge, DateFmt, MoneyFmt } from "@/components/CrudTable";

interface Project {
  id: string;
  name?: string;
  description?: string | null;
  status?: string;
  start_date?: string;
  end_date?: string;
  budget?: number | null;
}

interface ProjectSummary {
  total_campaigns?: number;
  total_activations?: number;
  active_promoters?: number;
  budget_allocated?: string | number | null;
  budget_used?: string | number | null;
}

interface Campaign {
  id: string;
  name?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  budget?: number | null;
}

interface Collaborator {
  id: string;
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  role_label?: string | null;
}

interface Activation {
  id: string;
  activation_date?: string;
  status?: string;
}

interface DocumentUpload {
  id: string;
  original_name?: string;
  target_table?: string | null;
  status?: string;
  rows_inserted?: number | null;
  created_at?: string;
}

const TABS = ["Resumen", "Campañas", "Colaboradores", "Activaciones", "Archivos"];

function unwrap<T>(res: unknown): T {
  const raw = res as Record<string, unknown>;
  return (raw?.data ?? res) as T;
}

function unwrapArray<T>(res: unknown): T[] {
  const arr = res ? unwrap<unknown>(res) : [];
  return Array.isArray(arr) ? (arr as T[]) : [];
}

function ProjectDetailContent() {
  const router = useRouter();
  const id = useSearchParams().get("id");

  const [activeTab, setActiveTab] = useState("Resumen");
  const [project, setProject] = useState<Project | null>(null);
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [activations, setActivations] = useState<Activation[]>([]);
  const [files, setFiles] = useState<DocumentUpload[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      api.get<unknown>(`/projects/${id}`).catch(() => null),
      api.get<unknown>(`/projects/${id}/summary`).catch(() => null),
      api.get<unknown>(`/campaigns?project_id=${id}`).catch(() => null),
      api.get<unknown>(`/collaborators?project_id=${id}`).catch(() => null),
      api.get<unknown>(`/activations?project_id=${id}`).catch(() => null),
      api.get<unknown>(`/documents?project_id=${id}`).catch(() => null),
    ])
      .then(([p, s, c, col, act, docs]) => {
        setProject(p ? unwrap<Project>(p) : null);
        setSummary(s ? unwrap<ProjectSummary>(s) : null);
        setCampaigns(unwrapArray<Campaign>(c));
        setCollaborators(unwrapArray<Collaborator>(col));
        setActivations(unwrapArray<Activation>(act));
        setFiles(unwrapArray<DocumentUpload>(docs));
      })
      .finally(() => setLoading(false));
  }, [id]);

  const thStyle = {
    padding: "10px 16px",
    textAlign: "left" as const,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    color: "var(--muted-foreground)",
    borderBottom: "1px solid var(--border)",
  };
  const tdStyle = { padding: "12px 16px", fontSize: 14 } as const;

  if (!id) {
    return (
      <div className="animate-fade-up">
        <div
          className="rounded-xl border p-6 text-center text-sm"
          style={{ color: "var(--muted-foreground)", borderColor: "var(--border)" }}
        >
          No se especificó un proyecto.
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="flex items-center gap-3 mb-6">
        <a
          href="/client/projects"
          style={{ color: "var(--muted-foreground)", textDecoration: "none", fontSize: 14 }}
        >
          ← Proyectos
        </a>
        <h1 className="text-xl font-bold">Detalle de Proyecto</h1>
      </div>

      {loading && (
        <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>
          Cargando...
        </div>
      )}

      {!loading && !project && (
        <div
          className="rounded-xl border p-6 text-center text-sm"
          style={{ color: "var(--muted-foreground)", borderColor: "var(--border)" }}
        >
          No se encontró el proyecto.
        </div>
      )}

      {!loading && project && (
        <>
          {/* Header card */}
          <div
            className="rounded-xl border p-5 mb-6"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 4 }}>
                  Proyecto
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {project.name ?? id.slice(0, 8)}
                </div>
              </div>
              {StatusBadge(project.status)}
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <span style={{ color: "var(--muted-foreground)" }}>Inicio: </span>
                {DateFmt(project.start_date)}
              </div>
              <div>
                <span style={{ color: "var(--muted-foreground)" }}>Fin: </span>
                {DateFmt(project.end_date)}
              </div>
              <div>
                <span style={{ color: "var(--muted-foreground)" }}>Presupuesto: </span>
                {MoneyFmt(project.budget)}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "10px 18px",
                  fontSize: 14,
                  fontWeight: activeTab === tab ? 600 : 400,
                  borderBottom: activeTab === tab ? "2px solid var(--primary)" : "2px solid transparent",
                  color: activeTab === tab ? "var(--foreground)" : "var(--muted-foreground)",
                  background: "none",
                  cursor: "pointer",
                  marginBottom: -1,
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* TAB: RESUMEN */}
          {activeTab === "Resumen" && (
            <div>
              <div
                className="grid gap-4 mb-6"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
              >
                {[
                  { label: "Campañas", value: summary?.total_campaigns ?? 0 },
                  { label: "Activaciones", value: summary?.total_activations ?? 0 },
                  { label: "Promotores activos", value: summary?.active_promoters ?? 0 },
                  { label: "Presupuesto asignado", value: MoneyFmt(summary?.budget_allocated) },
                  { label: "Presupuesto usado", value: MoneyFmt(summary?.budget_used) },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="rounded-xl border p-4"
                    style={{ background: "var(--card)", borderColor: "var(--border)" }}
                  >
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 6 }}>
                      {c.label}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{c.value}</div>
                  </div>
                ))}
              </div>
              <div
                className="rounded-xl border p-5"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Descripción</div>
                <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                  {project.description || "Sin descripción."}
                </p>
              </div>
            </div>
          )}

          {/* TAB: CAMPAÑAS */}
          {activeTab === "Campañas" && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {campaigns.length === 0 ? (
                <div
                  className="text-center text-sm"
                  style={{ padding: "48px 16px", color: "var(--muted-foreground)" }}
                >
                  Sin campañas.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr style={{ background: "var(--secondary)" }}>
                        <th style={thStyle}>Nombre</th>
                        <th style={thStyle}>Estado</th>
                        <th style={thStyle}>Inicio</th>
                        <th style={thStyle}>Fin</th>
                        <th style={thStyle}>Presupuesto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map((c) => (
                        <tr
                          key={c.id}
                          style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                          onClick={() => router.push(`/client/campaign-detail?id=${c.id}`)}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                        >
                          <td style={tdStyle}>{c.name ?? "—"}</td>
                          <td style={tdStyle}>{StatusBadge(c.status)}</td>
                          <td style={tdStyle}>{DateFmt(c.start_date)}</td>
                          <td style={tdStyle}>{DateFmt(c.end_date)}</td>
                          <td style={tdStyle}>{MoneyFmt(c.budget)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB: COLABORADORES */}
          {activeTab === "Colaboradores" && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {collaborators.length === 0 ? (
                <div
                  className="text-center text-sm"
                  style={{ padding: "48px 16px", color: "var(--muted-foreground)" }}
                >
                  Sin colaboradores.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr style={{ background: "var(--secondary)" }}>
                        <th style={thStyle}>Nombre</th>
                        <th style={thStyle}>Email</th>
                        <th style={thStyle}>Teléfono</th>
                        <th style={thStyle}>Rol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collaborators.map((c) => (
                        <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={tdStyle}>{c.full_name ?? "—"}</td>
                          <td style={{ ...tdStyle, color: "var(--muted-foreground)" }}>{c.email ?? "—"}</td>
                          <td style={{ ...tdStyle, color: "var(--muted-foreground)" }}>{c.phone ?? "—"}</td>
                          <td style={tdStyle}>{StatusBadge(c.role_label)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB: ACTIVACIONES */}
          {activeTab === "Activaciones" && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {activations.length === 0 ? (
                <div
                  className="text-center text-sm"
                  style={{ padding: "48px 16px", color: "var(--muted-foreground)" }}
                >
                  Sin activaciones.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr style={{ background: "var(--secondary)" }}>
                        <th style={thStyle}>Fecha</th>
                        <th style={thStyle}>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activations.map((a) => (
                        <tr key={a.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={tdStyle}>{DateFmt(a.activation_date)}</td>
                          <td style={tdStyle}>{StatusBadge(a.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB: ARCHIVOS */}
          {activeTab === "Archivos" && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              {files.length === 0 ? (
                <div
                  className="text-center text-sm"
                  style={{ padding: "48px 16px", color: "var(--muted-foreground)" }}
                >
                  Sin archivos.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr style={{ background: "var(--secondary)" }}>
                        <th style={thStyle}>Nombre</th>
                        <th style={thStyle}>Tipo</th>
                        <th style={thStyle}>Estado</th>
                        <th style={thStyle}>Filas</th>
                        <th style={thStyle}>Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f) => (
                        <tr key={f.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={tdStyle}>{f.original_name ?? "—"}</td>
                          <td style={{ ...tdStyle, color: "var(--muted-foreground)" }}>{f.target_table ?? "—"}</td>
                          <td style={tdStyle}>{StatusBadge(f.status)}</td>
                          <td style={tdStyle}>{f.rows_inserted ?? 0}</td>
                          <td style={tdStyle}>{DateFmt(f.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ProjectDetailPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
            Cargando...
          </div>
        }
      >
        <ProjectDetailContent />
      </Suspense>
    </AppShell>
  );
}

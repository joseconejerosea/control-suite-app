"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { StatusBadge, DateFmt, MoneyFmt } from "@/components/CrudTable";

interface Campaign {
  id: string;
  name?: string;
  description?: string | null;
  status?: string;
  start_date?: string;
  end_date?: string;
  budget?: number | null;
}

interface Activation {
  id: string;
  activation_date?: string;
  status?: string;
  location_name?: string;
  promoter_name?: string;
  notes?: string;
}

function unwrap<T>(res: unknown): T {
  const raw = res as Record<string, unknown>;
  return ((raw?.data ?? res) as T);
}

function CampaignDetailContent() {
  const router = useRouter();
  const id = useSearchParams().get("id");

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [activations, setActivations] = useState<Activation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      api.get<unknown>(`/campaigns/${id}`).catch(() => null),
      api.get<unknown>(`/activations?campaign_id=${id}`).catch(() => null),
    ])
      .then(([c, a]) => {
        setCampaign(c ? unwrap<Campaign>(c) : null);
        const arr = a ? unwrap<unknown>(a) : [];
        setActivations(Array.isArray(arr) ? (arr as Activation[]) : []);
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
          No se especificó una campaña.
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <a
            href="/client/campaigns"
            style={{ color: "var(--muted-foreground)", textDecoration: "none", fontSize: 14 }}
          >
            ← Campañas
          </a>
          <h1 className="text-xl font-bold">Detalle de Campaña</h1>
        </div>
        <button
          onClick={() => router.push("/client/activaciones")}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{
            background: "var(--primary)",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(79,70,229,0.3)",
          }}
        >
          + Nueva activación
        </button>
      </div>

      {loading && (
        <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>
          Cargando...
        </div>
      )}

      {!loading && !campaign && (
        <div
          className="rounded-xl border p-6 text-center text-sm"
          style={{ color: "var(--muted-foreground)", borderColor: "var(--border)" }}
        >
          No se encontró la campaña.
        </div>
      )}

      {!loading && campaign && (
        <>
          {/* Header card */}
          <div
            className="rounded-xl border p-5 mb-6"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 4 }}>
                  Campaña
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {campaign.name ?? id.slice(0, 8)}
                </div>
              </div>
              {StatusBadge(campaign.status)}
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <span style={{ color: "var(--muted-foreground)" }}>Inicio: </span>
                {DateFmt(campaign.start_date)}
              </div>
              <div>
                <span style={{ color: "var(--muted-foreground)" }}>Fin: </span>
                {DateFmt(campaign.end_date)}
              </div>
              <div>
                <span style={{ color: "var(--muted-foreground)" }}>Presupuesto: </span>
                {MoneyFmt(campaign.budget)}
              </div>
            </div>
            {campaign.description && (
              <p className="text-sm mt-3" style={{ color: "var(--muted-foreground)" }}>
                {campaign.description}
              </p>
            )}
          </div>

          {/* Activations table */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: "var(--border)" }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid var(--border)",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Activaciones ({activations.length})
            </div>
            {activations.length === 0 ? (
              <div
                className="text-center text-sm"
                style={{ padding: "48px 16px", color: "var(--muted-foreground)" }}
              >
                Esta campaña no tiene activaciones aún.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr style={{ background: "var(--secondary)" }}>
                      <th style={thStyle}>Fecha</th>
                      <th style={thStyle}>Ubicación</th>
                      <th style={thStyle}>Promotor</th>
                      <th style={thStyle}>Estado</th>
                      <th style={thStyle}>Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activations.map((a) => (
                      <tr key={a.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={tdStyle}>{DateFmt(a.activation_date)}</td>
                        <td style={tdStyle}>{a.location_name ?? "—"}</td>
                        <td style={tdStyle}>{a.promoter_name ?? "—"}</td>
                        <td style={tdStyle}>{StatusBadge(a.status)}</td>
                        <td style={{ ...tdStyle, color: "var(--muted-foreground)" }}>
                          {a.notes ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function CampaignDetailPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
            Cargando...
          </div>
        }
      >
        <CampaignDetailContent />
      </Suspense>
    </AppShell>
  );
}

"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import CrudTable, { StatusBadge } from "@/components/CrudTable";
import PendingStaffSection from "@/components/staff/PendingStaffSection";
import { api } from "@/lib/api";

function PromotersContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // Set when navigated from PendingStaffSection "Agregar": pre-fill the phone and
  // (pendingId) mark that roster row 'agregado' ONLY after the promoter is created.
  const prefillPhone = searchParams.get("phone") ?? "";
  const pendingId = searchParams.get("pending") ?? "";
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"Staff" | "Promotores a agregar">(
    "Staff",
  );
  const [pendingCount, setPendingCount] = useState(0);
  // While a ?phone= is present (came from "Agregar"/deep-link) force the Staff tab
  // so the auto-opened create modal is visible; otherwise honor the clicked tab.
  const effectiveTab = prefillPhone ? "Staff" : activeTab;

  const handleCreated = async () => {
    if (pendingId) {
      try {
        await api.patch(`/pending-staff/${pendingId}/agregar`);
      } catch {
        // Non-fatal: the promoter was created; the roster row can be resolved later.
      }
    }
    setRefreshKey((k) => k + 1); // re-fetch the pending list
    router.replace("/client/promoters"); // clear the query so a reload doesn't re-open
  };

  return (
    <AppShell>
      {/* Tabs */}
      <div
        className="flex gap-1 mb-5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {(["Staff", "Promotores a agregar"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: effectiveTab === t ? 600 : 400,
              borderBottom:
                effectiveTab === t
                  ? "2px solid var(--primary)"
                  : "2px solid transparent",
              color:
                effectiveTab === t
                  ? "var(--foreground)"
                  : "var(--muted-foreground)",
              background: "none",
              cursor: "pointer",
              marginBottom: -1,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {t}
            {t === "Promotores a agregar" && pendingCount > 0 && (
              <span
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{
                  background:
                    "color-mix(in srgb, var(--danger) 12%, transparent)",
                  color: "var(--danger)",
                }}
              >
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Staff */}
      <div style={{ display: effectiveTab === "Staff" ? "block" : "none" }}>
        <CrudTable
          title="Staff"
          subtitle="Personal de terreno asignado a activaciones"
          endpoint="/promoters"
          autoOpenCreate={!!prefillPhone}
          onCreated={handleCreated}
          defaultForm={{
            first_name: "",
            last_name: "",
            email: "",
            phone: prefillPhone,
            rol: "",
            status: "active",
          }}
          columns={[
            { key: "first_name", label: "Nombre" },
            { key: "last_name", label: "Apellido" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Teléfono" },
            { key: "rol", label: "Rol" },
            { key: "status", label: "Estado", render: StatusBadge },
          ]}
          fields={[
            {
              key: "first_name",
              label: "Nombre",
              required: true,
              placeholder: "María",
            },
            {
              key: "last_name",
              label: "Apellido",
              required: true,
              placeholder: "González",
            },
            {
              key: "email",
              label: "Email",
              type: "email",
              placeholder: "maria@example.com",
            },
            {
              key: "phone",
              label: "Teléfono",
              type: "tel",
              placeholder: "+56 9 1234 5678",
            },
            {
              key: "rol",
              label: "Rol",
              placeholder: "Promotora / Anfitriona / Supervisor",
            },
            {
              key: "status",
              label: "Estado",
              type: "select",
              options: [
                { value: "active", label: "Activo" },
                { value: "inactive", label: "Inactivo" },
              ],
            },
          ]}
        />
      </div>

      {/* Tab: Promotores a agregar */}
      <div
        style={{
          display: effectiveTab === "Promotores a agregar" ? "block" : "none",
        }}
      >
        <PendingStaffSection
          refreshSignal={refreshKey}
          onCount={setPendingCount}
        />
      </div>
    </AppShell>
  );
}

export default function PromotersPage() {
  // useSearchParams requires a Suspense boundary during prerender (Next 16).
  return (
    <Suspense>
      <PromotersContent />
    </Suspense>
  );
}

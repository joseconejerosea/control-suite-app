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
      <PendingStaffSection refreshSignal={refreshKey} />
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

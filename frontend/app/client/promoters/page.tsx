"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import CrudTable, { StatusBadge } from "@/components/CrudTable";
import PendingStaffSection from "@/components/staff/PendingStaffSection";

function PromotersContent() {
  const searchParams = useSearchParams();
  // Pre-fill phone when navigated from PendingStaffSection "Agregar" action.
  const prefillPhone = searchParams.get("phone") ?? "";

  return (
    <AppShell>
      <PendingStaffSection />
      <CrudTable
        title="Staff"
        subtitle="Personal de terreno asignado a activaciones"
        endpoint="/promoters"
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
          { key: "last_name",  label: "Apellido" },
          { key: "email",      label: "Email" },
          { key: "phone",      label: "Teléfono" },
          { key: "rol",        label: "Rol" },
          { key: "status",     label: "Estado", render: StatusBadge },
        ]}
        fields={[
          { key: "first_name", label: "Nombre",   required: true, placeholder: "María" },
          { key: "last_name",  label: "Apellido", required: true, placeholder: "González" },
          { key: "email",      label: "Email",    type: "email",  placeholder: "maria@example.com" },
          { key: "phone",      label: "Teléfono", type: "tel",    placeholder: "+56 9 1234 5678" },
          { key: "rol",        label: "Rol",      placeholder: "Promotora / Anfitriona / Supervisor" },
          { key: "status",     label: "Estado",   type: "select",
            options: [{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }] },
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

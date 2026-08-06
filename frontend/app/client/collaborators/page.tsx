"use client";

import AppShell from "@/components/layout/app-shell";
import CrudTable, { StatusBadge } from "@/components/CrudTable";

export default function CollaboratorsPage() {
  return (
    <AppShell>
      <CrudTable
        title="Colaboradores"
        subtitle="Terceros vinculados a proyectos — supervisores, brand managers, coordinadores"
        endpoint="/collaborators"
        defaultForm={{ full_name: "", email: "", phone: "", role_label: "observer" }}
        columns={[
          { key: "full_name",  label: "Nombre" },
          { key: "email",      label: "Email" },
          { key: "phone",      label: "Teléfono" },
          { key: "role_label", label: "Rol",   render: StatusBadge },
          { key: "is_active",  label: "Activo",
            render: (v) => <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: v ? "color-mix(in srgb, var(--success) 12%, transparent)" : "var(--secondary)", color: v ? "var(--success)" : "var(--muted-foreground)" }}>
              {v ? "Sí" : "No"}
            </span> },
        ]}
        fields={[
          { key: "full_name",  label: "Nombre completo", required: true, placeholder: "Carlos Reyes" },
          { key: "email",      label: "Email",           type: "email",  placeholder: "carlos@brand.com" },
          { key: "phone",      label: "Teléfono",        type: "tel",    placeholder: "+56 9 8765 4321" },
          { key: "role_label", label: "Rol",             type: "select",
            options: [
              { value: "observer",      label: "Observador" },
              { value: "supervisor",    label: "Supervisor" },
              { value: "coordinator",   label: "Coordinador" },
              { value: "brand_manager", label: "Brand Manager" },
            ]},
        ]}
      />
    </AppShell>
  );
}

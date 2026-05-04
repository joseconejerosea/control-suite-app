import AppShell from "@/components/layout/app-shell";
import CrudTable, { StatusBadge } from "@/components/CrudTable";

export default function CollaboratorsPage() {
  return (
    <AppShell>
      <CrudTable
        title="Collaborators"
        subtitle="External stakeholders linked to projects — supervisors, brand managers, coordinators"
        endpoint="/collaborators"
        defaultForm={{ full_name: "", email: "", phone: "", role_label: "observer" }}
        columns={[
          { key: "full_name",  label: "Name" },
          { key: "email",      label: "Email" },
          { key: "phone",      label: "Phone" },
          { key: "role_label", label: "Role",   render: StatusBadge },
          { key: "is_active",  label: "Active",
            render: (v) => <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: v ? "var(--green-dim)" : "var(--secondary)", color: v ? "var(--green-light)" : "var(--muted-foreground)" }}>
              {v ? "Yes" : "No"}
            </span> },
        ]}
        fields={[
          { key: "full_name",  label: "Full Name", required: true, placeholder: "Carlos Reyes" },
          { key: "email",      label: "Email",     type: "email",  placeholder: "carlos@brand.com" },
          { key: "phone",      label: "Phone",     type: "tel",    placeholder: "+56 9 8765 4321" },
          { key: "role_label", label: "Role",      type: "select",
            options: [
              { value: "observer",      label: "Observer" },
              { value: "supervisor",    label: "Supervisor" },
              { value: "coordinator",   label: "Coordinator" },
              { value: "brand_manager", label: "Brand Manager" },
            ]},
        ]}
      />
    </AppShell>
  );
}

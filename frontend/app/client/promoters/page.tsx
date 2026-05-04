import AppShell from "@/components/layout/app-shell";
import CrudTable, { StatusBadge } from "@/components/CrudTable";

export default function PromotersPage() {
  return (
    <AppShell>
      <CrudTable
        title="Promoters"
        subtitle="Field staff assigned to activations"
        endpoint="/promoters"
        defaultForm={{ first_name: "", last_name: "", email: "", phone: "", status: "active" }}
        columns={[
          { key: "first_name", label: "First Name" },
          { key: "last_name",  label: "Last Name" },
          { key: "email",      label: "Email" },
          { key: "phone",      label: "Phone" },
          { key: "status",     label: "Status", render: StatusBadge },
        ]}
        fields={[
          { key: "first_name", label: "First Name", required: true, placeholder: "María" },
          { key: "last_name",  label: "Last Name",  required: true, placeholder: "González" },
          { key: "email",      label: "Email",      type: "email",  placeholder: "maria@example.com" },
          { key: "phone",      label: "Phone",      type: "tel",    placeholder: "+56 9 1234 5678" },
          { key: "status",     label: "Status",     type: "select",
            options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
        ]}
      />
    </AppShell>
  );
}

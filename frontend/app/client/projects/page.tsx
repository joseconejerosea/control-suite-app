import AppShell from "@/components/layout/app-shell";
import CrudTable, { StatusBadge, DateFmt, MoneyFmt } from "@/components/CrudTable";

export default function ProjectsPage() {
  return (
    <AppShell>
      <CrudTable
        title="Projects"
        subtitle="Group campaigns and activations under a logical container"
        endpoint="/projects"
        defaultForm={{ name: "", description: "", status: "active", start_date: "", end_date: "", budget: 0 as any }}
        columns={[
          { key: "name",       label: "Name" },
          { key: "status",     label: "Status",     render: StatusBadge },
          { key: "start_date", label: "Start Date",  render: DateFmt },
          { key: "end_date",   label: "End Date",    render: DateFmt },
          { key: "budget",     label: "Budget",      render: MoneyFmt },
        ]}
        fields={[
          { key: "name",        label: "Project Name",  required: true,  placeholder: "Q3 BTL Campaign" },
          { key: "description", label: "Description",   type: "textarea", placeholder: "Optional description" },
          { key: "status",      label: "Status",        type: "select",
            options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }, { value: "archived", label: "Archived" }] },
          { key: "start_date",  label: "Start Date",    type: "date" },
          { key: "end_date",    label: "End Date",      type: "date" },
          { key: "budget",      label: "Budget (USD)",  type: "number",  placeholder: "50000" },
        ]}
      />
    </AppShell>
  );
}
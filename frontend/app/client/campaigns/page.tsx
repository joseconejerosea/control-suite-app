import AppShell from "@/components/layout/app-shell";
import CrudTable, { StatusBadge, DateFmt, MoneyFmt } from "@/components/CrudTable";

export default function CampaignsPage() {
  return (
    <AppShell>
      <CrudTable
        title="Campaigns"
        subtitle="Marketing campaigns with budgets, dates, and status tracking"
        endpoint="/campaigns"
        defaultForm={{ name: "", description: "", status: "draft", start_date: "", end_date: "", budget: 0 as any }}
        columns={[
          { key: "name",       label: "Name" },
          { key: "status",     label: "Status",     render: StatusBadge },
          { key: "start_date", label: "Start Date",  render: DateFmt },
          { key: "end_date",   label: "End Date",    render: DateFmt },
          { key: "budget",     label: "Budget",      render: MoneyFmt },
        ]}
        fields={[
          { key: "name",        label: "Campaign Name", required: true, placeholder: "Verano 2025 BTL" },
          { key: "description", label: "Description",   type: "textarea", placeholder: "Campaign description" },
          { key: "status",      label: "Status",        type: "select",
            options: [
              { value: "draft",   label: "Draft" },
              { value: "active",  label: "Active" },
              { value: "paused",  label: "Paused" },
              { value: "ended",   label: "Ended" },
            ]},
          { key: "start_date", label: "Start Date", type: "date" },
          { key: "end_date",   label: "End Date",   type: "date" },
          { key: "budget",     label: "Budget (USD)", type: "number", placeholder: "25000" },
        ]}
      />
    </AppShell>
  );
}
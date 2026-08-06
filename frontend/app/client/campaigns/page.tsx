"use client";

import AppShell from "@/components/layout/app-shell";
import CrudTable, { StatusBadge, DateFmt, MoneyFmt } from "@/components/CrudTable";

export default function CampaignsPage() {
  return (
    <AppShell>
      <CrudTable
        title="Campañas"
        subtitle="Campañas de marketing con presupuestos, fechas y seguimiento de estado"
        endpoint="/campaigns"
        defaultForm={{ name: "", description: "", status: "draft", start_date: "", end_date: "", budget: 0 as any }}
        columns={[
          { key: "name",       label: "Nombre" },
          { key: "status",     label: "Estado",     render: StatusBadge },
          { key: "start_date", label: "Inicio",     render: DateFmt },
          { key: "end_date",   label: "Fin",        render: DateFmt },
          { key: "budget",     label: "Presupuesto", render: MoneyFmt },
        ]}
        fields={[
          { key: "name",        label: "Nombre de campaña", required: true, placeholder: "Verano 2025 BTL" },
          { key: "description", label: "Descripción",       type: "textarea", placeholder: "Descripción de la campaña" },
          { key: "status",      label: "Estado",            type: "select",
            options: [
              { value: "draft",   label: "Borrador" },
              { value: "active",  label: "Activa" },
              { value: "paused",  label: "Pausada" },
              { value: "ended",   label: "Finalizada" },
            ]},
          { key: "start_date", label: "Fecha inicio", type: "date" },
          { key: "end_date",   label: "Fecha fin",    type: "date" },
          { key: "budget",     label: "Presupuesto (USD)", type: "number", placeholder: "25000" },
        ]}
      />
    </AppShell>
  );
}
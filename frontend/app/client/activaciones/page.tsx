"use client";

import AppShell from "@/components/layout/app-shell";
import CrudTable, { StatusBadge, DateFmt } from "@/components/CrudTable";

export default function ActivacionesPage() {
  return (
    <AppShell>
      <CrudTable
        title="Activaciones"
        subtitle="Activaciones de terreno por campaña, ubicación y promotor"
        endpoint="/activations"
        defaultForm={{
          campaign_id: "",
          location_id: "",
          promoter_id: "",
          activation_date: "",
          status: "scheduled",
          notes: "",
        }}
        columns={[
          { key: "campaign_name", label: "Campaña" },
          { key: "location_name", label: "Ubicación" },
          { key: "promoter_name", label: "Promotor" },
          { key: "activation_date", label: "Fecha", render: DateFmt },
          { key: "status", label: "Estado", render: StatusBadge },
          { key: "notes", label: "Notas" },
        ]}
        fields={[
          {
            key: "campaign_id",
            label: "Campaña",
            required: true,
            optionsEndpoint: "/campaigns",
            optionsLabelKey: "name",
          },
          {
            key: "location_id",
            label: "Ubicación",
            optionsEndpoint: "/locations",
            optionsLabelKey: "name",
          },
          {
            key: "promoter_id",
            label: "Promotor",
            optionsEndpoint: "/promoters",
            optionsLabel: (r) =>
              `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() ||
              String(r.email ?? ""),
          },
          { key: "activation_date", label: "Fecha de activación", type: "date", required: true },
          {
            key: "status",
            label: "Estado",
            type: "select",
            options: [
              { value: "scheduled", label: "Agendada" },
              { value: "in_progress", label: "En curso" },
              { value: "completed", label: "Completada" },
              { value: "cancelled", label: "Cancelada" },
            ],
          },
          { key: "notes", label: "Notas", type: "textarea", placeholder: "Notas de la activación" },
        ]}
      />
    </AppShell>
  );
}

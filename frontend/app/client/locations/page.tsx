"use client";

import AppShell from "@/components/layout/app-shell";
import CrudTable from "@/components/CrudTable";

export default function LocationsPage() {
  return (
    <AppShell>
      <CrudTable
        title="Ubicaciones"
        subtitle="Ubicaciones físicas donde se realizan las activaciones"
        endpoint="/locations"
        defaultForm={{ name: "", address: "", city: "", region: "" }}
        columns={[
          { key: "name",    label: "Nombre" },
          { key: "city",    label: "Ciudad" },
          { key: "region",  label: "Región" },
          { key: "address", label: "Dirección" },
        ]}
        fields={[
          { key: "name",    label: "Nombre de la ubicación", required: true, placeholder: "Mall Costanera Centro" },
          { key: "address", label: "Dirección",                              placeholder: "Av. Andrés Bello 2447" },
          { key: "city",    label: "Ciudad",                                 placeholder: "Santiago" },
          { key: "region",  label: "Región",                                 placeholder: "Región Metropolitana" },
        ]}
      />
    </AppShell>
  );
}
"use client";

import AppShell from "@/components/layout/app-shell";
import CrudTable from "@/components/CrudTable";

export default function LocationsPage() {
  return (
    <AppShell>
      <CrudTable
        title="Locations"
        subtitle="Physical locations where activations take place"
        endpoint="/locations"
        defaultForm={{ name: "", address: "", city: "", region: "" }}
        columns={[
          { key: "name",    label: "Name" },
          { key: "city",    label: "City" },
          { key: "region",  label: "Region" },
          { key: "address", label: "Address" },
        ]}
        fields={[
          { key: "name",    label: "Location Name", required: true, placeholder: "Mall Costanera Centro" },
          { key: "address", label: "Address",                       placeholder: "Av. Andrés Bello 2447" },
          { key: "city",    label: "City",                          placeholder: "Santiago" },
          { key: "region",  label: "Region",                        placeholder: "Región Metropolitana" },
        ]}
      />
    </AppShell>
  );
}
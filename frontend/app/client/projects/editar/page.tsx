"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import ProjectForm from "@/components/projects/project-form";

function EditarContent() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  if (!id) {
    return <div style={{ padding: 24, color: "var(--muted-foreground)", fontSize: 13 }}>Falta el id del proyecto.</div>;
  }
  return <ProjectForm mode="edit" projectId={id} />;
}

export default function EditarProyectoPage() {
  return (
    <AppShell>
      <Suspense fallback={<div style={{ padding: 24, color: "var(--muted-foreground)", fontSize: 13 }}>Cargando…</div>}>
        <EditarContent />
      </Suspense>
    </AppShell>
  );
}

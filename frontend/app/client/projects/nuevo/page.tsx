"use client";
import AppShell from "@/components/layout/app-shell";
import ProjectForm from "@/components/projects/project-form";

export default function NuevoProyectoPage() {
  return (
    <AppShell>
      <ProjectForm mode="create" />
    </AppShell>
  );
}

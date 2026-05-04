"use client";

import AppShell from "@/components/layout/app-shell";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { useState } from "react";

const MOCK_LOGS = [
  { accion: "Cliente creado",     entidad: "Experience Events",       usuario: "jose@controlsuite.cl",  fecha: "hace 12 min" },
  { accion: "Usuario actualizado",entidad: "María López",             usuario: "jose@controlsuite.cl",  fecha: "hace 1 hora" },
  { accion: "Documento subido",   entidad: "promotores_abril.xlsx",   usuario: "admin@nexusbtl.cl",     fecha: "hace 2 horas" },
  { accion: "Campaña creada",     entidad: "Verano 2026 BTL",         usuario: "admin@nexusbtl.cl",     fecha: "hace 3 horas" },
  { accion: "Login",              entidad: "jose@controlsuite.cl",    usuario: "jose@controlsuite.cl",  fecha: "hace 5 horas" },
];

export default function AuditoriaPage() {
  const [logs] = useState(MOCK_LOGS);

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Auditoría</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Registro de acciones en la plataforma</p>
          </div>
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          {logs.map((log, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-4 border-b last:border-0 transition-colors"
              style={{ borderColor: "var(--border)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(99,102,241,0.12)" }}>
                  <ShieldCheck size={14} style={{ color: "#6366f1" }} />
                </div>
                <div>
                  <div className="text-sm font-medium">{log.accion} · <span style={{ color: "var(--muted-foreground)" }}>{log.entidad}</span></div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>por {log.usuario}</div>
                </div>
              </div>
              <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>{log.fecha}</div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

"use client";

import { useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { Bell, CheckCircle } from "lucide-react";

type Ticket = {
  id: string;
  cliente: string;
  asunto: string;
  prioridad: "alta" | "media" | "baja";
  estado: "abierto" | "en_proceso" | "cerrado";
  fecha: string;
};

const MOCK_TICKETS: Ticket[] = [
  { id: "T-001", cliente: "Agencia Nexus BTL",   asunto: "Error al subir documento PDF",    prioridad: "alta",  estado: "abierto",    fecha: "2026-04-24" },
  { id: "T-002", cliente: "Experience Events",   asunto: "No carga el dashboard",           prioridad: "media", estado: "en_proceso", fecha: "2026-04-23" },
  { id: "T-003", cliente: "BTL Masters",         asunto: "Solicitud de nuevo usuario",      prioridad: "baja",  estado: "abierto",    fecha: "2026-04-22" },
];

const PRIORIDAD_STYLE: Record<string, { bg: string; color: string }> = {
  alta:  { bg: "rgba(200,32,44,0.12)",   color: "#e8353f" },
  media: { bg: "rgba(245,158,11,0.12)",  color: "#f59e0b" },
  baja:  { bg: "rgba(42,157,92,0.12)",   color: "#34b96e" },
};

const ESTADO_STYLE: Record<string, { bg: string; color: string }> = {
  abierto:    { bg: "rgba(59,130,246,0.12)",  color: "#60a5fa" },
  en_proceso: { bg: "rgba(139,92,246,0.12)",  color: "#a78bfa" },
  cerrado:    { bg: "rgba(42,157,92,0.12)",   color: "#34b96e" },
};

export default function TicketsPage() {
  const [tickets] = useState<Ticket[]>(MOCK_TICKETS);

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              Tickets de Soporte
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: "var(--red)", color: "#fff" }}>
                {tickets.filter(t => t.estado === "abierto").length}
              </span>
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Solicitudes de soporte de clientes</p>
          </div>
        </div>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full border-collapse">
            <thead style={{ background: "var(--secondary)" }}>
              <tr>
                {["#", "Cliente", "Asunto", "Prioridad", "Estado", "Fecha"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left"
                    style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <td className="px-4 py-3.5 text-xs font-mono" style={{ color: "var(--muted-foreground)" }}>{t.id}</td>
                  <td className="px-4 py-3.5 text-sm font-medium">{t.cliente}</td>
                  <td className="px-4 py-3.5 text-sm">{t.asunto}</td>
                  <td className="px-4 py-3.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase"
                      style={PRIORIDAD_STYLE[t.prioridad]}>{t.prioridad}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase"
                      style={ESTADO_STYLE[t.estado]}>{t.estado.replace("_", " ")}</span>
                  </td>
                  <td className="px-4 py-3.5 text-xs" style={{ color: "var(--muted-foreground)" }}>{t.fecha}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

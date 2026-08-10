"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, FolderOpen, MapPin, Users, Megaphone,
  FileText, UserCircle, Building2,
  Bell, List, Activity, CreditCard, ShieldCheck,
  AlertTriangle, Receipt, Package, Brain, Radio, GitCompare,
  Settings, CalendarDays,
} from "lucide-react";

const CLIENT_SECTIONS = [
  { label: "General", items: [{ label: "Dashboard", icon: LayoutDashboard, href: "/client/dashboard" }] },
  { label: "Operación", items: [
    { label: "Reportes Internos", icon: FileText, href: "/client/reportes" },
    { label: "Documentos por revisar", icon: AlertTriangle, href: "/client/documentos-revisar" },
    { label: "Inventario POP", icon: Package, href: "/client/inventario" },
    { label: "Rendiciones", icon: Receipt, href: "/client/rendiciones" },
    { label: "Terreno", icon: Radio, href: "/client/terreno" },
    { label: "Calendario", icon: CalendarDays, href: "/client/calendario" },
    { label: "Proyectos", icon: FolderOpen, href: "/client/projects" },
    { label: "Campañas", icon: Megaphone, href: "/client/campaigns" },
    { label: "Ubicaciones", icon: MapPin, href: "/client/locations" },
    { label: "Staff", icon: Users, href: "/client/promoters" },
    { label: "Documentos", icon: FileText, href: "/client/documents" },
    { label: "Colaboradores", icon: UserCircle, href: "/client/collaborators" },
  ]},
  { label: "Configuración", items: [
    { label: "Usuarios",          icon: UserCircle,  href: "/client/usuarios" },
    { label: "Configuración",     icon: Settings,    href: "/client/config" },
    { label: "Equivalencias OCR", icon: GitCompare,  href: "/client/equivalencias" },
  ]},
  { label: "IA", items: [{ label: "Control Mind", icon: Brain, href: "/client/mind" }] },
];

const ADMIN_SECTIONS = [
  { label: "Plataforma", items: [
    { label: "Clientes", icon: Building2, href: "/admin/clientes" },
    { label: "Eventos Crudos", icon: List, href: "/admin/eventos" },
  ]},
  { label: "Operación", items: [
    { label: "Tickets", icon: Bell, href: "/admin/tickets", badge: "3" },
    { label: "Monitoreo", icon: Activity, href: "/admin/monitoring" },
  ]},
  { label: "Administración", items: [
    { label: "Facturación", icon: CreditCard, href: "/admin/facturacion" },
    { label: "Auditoría AI", icon: ShieldCheck, href: "/admin/audit" },
  ]},
];

const SUPER_ADMIN_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/admin/dashboard" },
  { label: "Onboarding", icon: Building2, href: "/admin/onboarding" },
  { label: "Clientes", icon: Users, href: "/admin/clientes" },
  { label: "Monitoreo", icon: Activity, href: "/admin/monitoring" },
  { label: "Tickets", icon: Bell, href: "/admin/tickets" },
  { label: "Auditoría AI", icon: ShieldCheck, href: "/admin/audit" },
  { label: "Usuarios", icon: UserCircle, href: "/admin/usuarios" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [user, setUser] = useState<Record<string, string> | null>(null);
  const [role, setRole] = useState<"admin" | "client">("client");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("cs_user");
      if (stored) setUser(JSON.parse(stored));
    } catch {}
  }, []);

  const isSuperAdmin = user?.role === "super_admin";
  // El toggle "Administrador" expone ADMIN_SECTIONS = secciones de PLATAFORMA (Clientes/tenants,
  // Facturación, Auditoría AI, Monitoreo global) — territorio de SUPERADMIN / SERVICE_LEAD, NO del
  // admin_cliente, que es admin del TENANT (MANAGER) y solo debe ver las secciones de Cliente.
  // Se reserva para SERVICE_LEAD cuando ese rol exista en el front (migración a 6 roles).
  const showPlatformToggle = false; // TODO(roles-6): user?.role === "service_lead"
  const sections = isSuperAdmin
    ? [{ label: "", items: SUPER_ADMIN_ITEMS.map(i => ({ ...i, badge: undefined })) }]
    : role === "admin" ? ADMIN_SECTIONS : CLIENT_SECTIONS;

  return (
    <aside className="w-60 flex-shrink-0 border-r overflow-y-auto py-4" style={{ background: "var(--sidebar)", borderColor: "var(--line)" }}>
      {/* Reserved role toggle (SERVICE_LEAD) — hidden until the 6-role migration */}
      {showPlatformToggle && (
        <div className="px-3 pb-3">
          <div className="flex rounded-lg p-0.5 text-xs" style={{ background: "var(--secondary)" }}>
            <button onClick={() => setRole("admin")} className="flex-1 py-1.5 rounded-md font-medium"
              style={{ background: role === "admin" ? "var(--card)" : "transparent", color: role === "admin" ? "var(--foreground)" : "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
              Administrador
            </button>
            <button onClick={() => setRole("client")} className="flex-1 py-1.5 rounded-md font-medium"
              style={{ background: role === "client" ? "var(--card)" : "transparent", color: role === "client" ? "var(--foreground)" : "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
              Cliente
            </button>
          </div>
        </div>
      )}

      <nav className="flex flex-col">
        {sections.map((section: any, si: number) => (
          <div key={section.label || si}>
            {section.label && (
              <div className={`px-4 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${si === 0 ? "pt-2" : "pt-5"}`}>
                {section.label}
              </div>
            )}
            {section.items.map((item: any) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link key={item.href} href={item.href}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors ${active ? "font-medium" : "text-slate-700 hover:bg-slate-50"}`}
                  style={active ? { background: "linear-gradient(90deg, rgba(79,70,229,0.10), rgba(79,70,229,0))", color: "var(--primary)", boxShadow: "inset 2px 0 0 var(--primary)" } : undefined}>
                  <Icon size={16} strokeWidth={active ? 2 : 1.75} className={active ? "" : "text-slate-500"} style={active ? { color: "var(--primary)" } : undefined} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: "var(--primary)", color: "#fff" }}>{item.badge}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
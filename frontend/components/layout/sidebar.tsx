"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, FolderOpen, MapPin, Users, Megaphone,
  FileText, UserCircle, Zap, Building2, ChevronRight,
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
    { label: "Promotores", icon: Users, href: "/client/promoters" },
    { label: "Documentos", icon: FileText, href: "/client/documents" },
    { label: "Colaboradores", icon: UserCircle, href: "/client/collaborators" },
  ]},
  { label: "Configuración", items: [
    { label: "Configuración",     icon: Settings,    href: "/client/config" },
    { label: "Equivalencias OCR", icon: GitCompare,  href: "/client/equivalencias" },
    { label: "Reglas Aprobación", icon: ShieldCheck, href: "/client/rendiciones-config" },
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
  const isAdmin = isSuperAdmin || user?.role === "admin_cliente";
  const sections = isSuperAdmin
    ? [{ label: "", items: SUPER_ADMIN_ITEMS.map(i => ({ ...i, badge: undefined })) }]
    : role === "admin" ? ADMIN_SECTIONS : CLIENT_SECTIONS;

  return (
    <aside className="flex flex-col w-60 flex-shrink-0 border-r" style={{ background: "var(--navy)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-2.5 px-4 py-5 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--red)", boxShadow: "0 4px 14px rgba(200,32,44,0.35)" }}>
          <Zap size={15} color="#fff" strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-sm font-bold leading-none">Control Suite</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Operations Platform</div>
        </div>
      </div>

      {!isSuperAdmin && isAdmin && (
        <div className="px-3 py-3 border-b" style={{ borderColor: "var(--border)" }}>
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

      {user && (
        <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
            {(user.email?.[0] ?? "U").toUpperCase()}
          </div>
          <div className="overflow-hidden">
            <div className="text-xs truncate" style={{ color: "var(--foreground)" }}>{user.email}</div>
            <div className="text-xs" style={{ color: "var(--muted-foreground)", textTransform: "uppercase", fontSize: "10px" }}>{user.role?.replace("_", " ")}</div>
          </div>
        </div>
      )}

      <nav className="flex-1 px-2 py-3 overflow-y-auto flex flex-col gap-0.5">
        {sections.map((section: any) => (
          <div key={section.label} className="mb-2">
            {section.label && (
              <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)", opacity: 0.5, fontSize: "10px" }}>
                {section.label}
              </div>
            )}
            {section.items.map((item: any) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link key={item.href} href={item.href}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all"
                  style={{ background: active ? "var(--red-dim)" : "transparent", color: active ? "var(--red-light)" : "var(--muted-foreground)", fontWeight: active ? 600 : 400, textDecoration: "none" }}>
                  <Icon size={15} strokeWidth={active ? 2.5 : 1.8} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold" style={{ background: "var(--red)", color: "#fff" }}>{item.badge}</span>}
                  {active && <ChevronRight size={12} />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-2 py-3 border-t" style={{ borderColor: "var(--border)" }}>
        <button onClick={() => { localStorage.removeItem("cs_token"); localStorage.removeItem("cs_user"); window.location.href = "/login"; }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm"
          style={{ background: "none", border: "none", color: "var(--muted-foreground)", cursor: "pointer" }}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
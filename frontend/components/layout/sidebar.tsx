"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, FolderOpen, MapPin, Users, Megaphone,
  FileText, UserCircle, Building2,
  Bell, List, Activity, CreditCard, ShieldCheck,
  AlertTriangle, Receipt, Package, Brain, Radio, GitCompare,
  Settings, CalendarDays, Zap, Layers, Boxes, ChevronDown,
} from "lucide-react";

// Un item puede ser un link plano ({ href }) o un grupo colapsable ({ children }).
const CLIENT_SECTIONS = [
  { label: "General", items: [{ label: "Dashboard", icon: LayoutDashboard, href: "/client/dashboard" }] },
  { label: "Operación", items: [
    { label: "Planificación", icon: Layers, children: [
      { label: "Proyectos", icon: FolderOpen, href: "/client/projects" },
      { label: "Campañas", icon: Megaphone, href: "/client/campaigns" },
      { label: "Activaciones", icon: Zap, href: "/client/activaciones" },
    ]},
    { label: "Recursos", icon: Boxes, children: [
      { label: "Ubicaciones", icon: MapPin, href: "/client/locations" },
      { label: "Staff", icon: Users, href: "/client/promoters" },
      { label: "Colaboradores", icon: UserCircle, href: "/client/collaborators" },
    ]},
    { label: "Terreno", icon: Radio, children: [
      { label: "Terreno", icon: Radio, href: "/client/terreno" },
      { label: "Calendario", icon: CalendarDays, href: "/client/calendario" },
      { label: "Inventario POP", icon: Package, href: "/client/inventario" },
    ]},
    { label: "Documentos", icon: FileText, children: [
      { label: "Documentos", icon: FileText, href: "/client/documents" },
      { label: "Documentos por revisar", icon: AlertTriangle, href: "/client/documentos-revisar" },
      { label: "Reportes Internos", icon: FileText, href: "/client/reportes" },
      { label: "Rendiciones", icon: Receipt, href: "/client/rendiciones" },
    ]},
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

const ACTIVE_STYLE = {
  background: "linear-gradient(90deg, rgba(79,70,229,0.10), rgba(79,70,229,0))",
  color: "var(--primary)",
  boxShadow: "inset 2px 0 0 var(--primary)",
} as const;

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(href + "/");

function NavLink({ item, pathname, indented }: { item: any; pathname: string; indented?: boolean }) {
  const Icon = item.icon;
  const active = isActive(pathname, item.href);
  return (
    <Link href={item.href}
      className={`w-full flex items-center gap-2.5 ${indented ? "pl-9 pr-4" : "px-4"} py-2 text-sm text-left transition-colors ${active ? "font-medium" : "text-slate-700 hover:bg-slate-50"}`}
      style={active ? ACTIVE_STYLE : undefined}>
      <Icon size={16} strokeWidth={active ? 2 : 1.75} className={active ? "" : "text-slate-500"} style={active ? { color: "var(--primary)" } : undefined} />
      <span className="flex-1">{item.label}</span>
      {item.badge && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: "var(--primary)", color: "#fff" }}>{item.badge}</span>}
    </Link>
  );
}

function NavGroup({ item, pathname, open, onToggle }: { item: any; pathname: string; open: boolean; onToggle: () => void }) {
  const Icon = item.icon;
  const hasActive = item.children.some((c: any) => isActive(pathname, c.href));
  return (
    <div>
      <button onClick={onToggle}
        className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors bg-transparent border-0 cursor-pointer ${hasActive ? "font-medium" : "text-slate-700 hover:bg-slate-50"}`}
        style={hasActive ? { color: "var(--primary)" } : undefined}>
        <Icon size={16} strokeWidth={hasActive ? 2 : 1.75} className={hasActive ? "" : "text-slate-500"} style={hasActive ? { color: "var(--primary)" } : undefined} />
        <span className="flex-1">{item.label}</span>
        <ChevronDown size={14} className="text-slate-400 transition-transform" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} />
      </button>
      {open && item.children.map((c: any) => <NavLink key={c.href} item={c} pathname={pathname} indented />)}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [user, setUser] = useState<Record<string, string> | null>(null);
  const [role, setRole] = useState<"admin" | "client">("client");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem("cs_user");
      if (stored) setUser(JSON.parse(stored));
    } catch {}
  }, []);

  // Estado de grupos abiertos: hidrata de localStorage y fuerza abierto el grupo
  // que contiene la ruta activa (para que al navegar el item quede visible).
  useEffect(() => {
    let next: Record<string, boolean> = {};
    try { next = JSON.parse(localStorage.getItem("cs_sidebar_groups") || "{}"); } catch {}
    for (const section of CLIENT_SECTIONS) {
      for (const it of section.items as any[]) {
        if (it.children?.some((c: any) => isActive(pathname, c.href))) next[it.label] = true;
      }
    }
    setOpenGroups(next);
  }, [pathname]);

  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try { localStorage.setItem("cs_sidebar_groups", JSON.stringify(next)); } catch {}
      return next;
    });
  };

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
            {section.items.map((item: any) =>
              item.children
                ? <NavGroup key={item.label} item={item} pathname={pathname} open={!!openGroups[item.label]} onToggle={() => toggleGroup(item.label)} />
                : <NavLink key={item.href} item={item} pathname={pathname} />
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}

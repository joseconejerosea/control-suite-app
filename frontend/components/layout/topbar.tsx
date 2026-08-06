"use client";

import { usePathname, useRouter } from "next/navigation";
import { clearAuth } from "@/lib/api";
import { LogOut, Bell } from "lucide-react";
import { useState, useEffect } from "react";

const TITLES: Record<string, string> = {
  "/client/dashboard":     "Dashboard",
  "/admin/dashboard":      "Admin Dashboard",
  "/admin/onboarding":     "Client Onboarding",
  "/admin/clientes":       "Clientes",
  "/admin/usuarios":       "Usuarios por Cliente",
  "/admin/eventos":        "Eventos Crudos",
  "/admin/tickets":        "Tickets",
  "/admin/monitoreo":      "Monitoreo",
  "/admin/facturacion":    "Facturación",
  "/admin/auditoria":      "Auditoría",
  "/client/projects":      "Proyectos",
  "/client/campaigns":     "Campañas",
  "/client/locations":     "Ubicaciones",
  "/client/promoters":     "Staff",
  "/client/documents":     "Documentos",
  "/client/collaborators": "Colaboradores",
  "/client/reportes":      "Reportes Internos",
  "/client/inventario":    "Inventario POP",
};

export default function Topbar() {
  const pathname = usePathname();
  const router   = useRouter();
  const title    = TITLES[pathname] ?? "Control Suite";
  const [user, setUser] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("cs_user");
      if (stored) setUser(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "CS";

  const logout = () => {
    clearAuth();
    router.push("/login");
  };

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b flex-shrink-0"
      style={{ background: "var(--paper)", borderColor: "var(--line)" }}>
      <h1 className="font-semibold text-sm">{title}</h1>

      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button className="relative p-2 rounded-lg transition-colors"
          style={{ background: "var(--secondary)", border: "none", cursor: "pointer", color: "var(--muted-foreground)" }}>
          <Bell size={15} />
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ background: "var(--danger)" }} />
        </button>

        {/* User avatar */}
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
          style={{ background: "var(--ai-gradient)", color: "#fff" }}>
          {initials}
        </div>

        {/* Logout */}
        <button onClick={logout}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
          <LogOut size={12} /> Sign out
        </button>
      </div>
    </header>
  );
}

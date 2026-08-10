"use client";

import { useRouter } from "next/navigation";
import { clearAuth } from "@/lib/api";
import { Zap, LogOut } from "lucide-react";
import { useState } from "react";
import NotificationsBell from "@/components/notifications/NotificationsBell";

export default function Topbar() {
  const router = useRouter();
  const [user] = useState<Record<string, string> | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = localStorage.getItem("cs_user");
      return stored ? (JSON.parse(stored) as Record<string, string>) : null;
    } catch {
      return null;
    }
  });

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "CS";

  const logout = () => {
    clearAuth();
    router.push("/login");
  };

  return (
    <header
      className="h-14 flex items-center justify-between px-6 border-b flex-shrink-0"
      style={{ background: "var(--paper)", borderColor: "var(--line)" }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md flex items-center justify-center bg-gradient-to-br from-indigo-500 to-cyan-500">
          <Zap size={16} color="#fff" strokeWidth={2.5} />
        </div>
        <span className="font-semibold text-sm">
          Control Suite <span className="text-indigo-600">BTL</span>
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <NotificationsBell />

        <button
          onClick={logout}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          style={{ border: "none", cursor: "pointer" }}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white bg-gradient-to-br from-indigo-500 to-cyan-500"
          >
            {initials}
          </div>
          {user?.email && (
            <span className="text-xs font-medium max-w-[160px] truncate hidden sm:inline" style={{ color: "var(--foreground)" }}>
              {user.email}
            </span>
          )}
          <LogOut size={13} style={{ color: "var(--muted-foreground)" }} />
        </button>
      </div>
    </header>
  );
}

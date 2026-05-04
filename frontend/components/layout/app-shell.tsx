"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Sidebar from "./sidebar";
import Topbar from "./topbar";

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("cs_token");
    const userStr = localStorage.getItem("cs_user");

    if (!token || !userStr) {
      router.replace("/login");
      return;
    }

    try {
      const user = JSON.parse(userStr);
      if (pathname.startsWith("/admin") && user.role !== "super_admin") {
        router.replace("/client/dashboard");
        return;
      }
      if (pathname.startsWith("/client") && user.role === "super_admin") {
        router.replace("/admin/dashboard");
        return;
      }
    } catch { 
      router.replace("/login");
      return;
    }

    setReady(true);
  }, [pathname, router]);

  if (!ready) return null;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--background)" }}>
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-7 animate-fade-up">
          {children}
        </main>
      </div>
    </div>
  );
}
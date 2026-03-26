"use client";

import type { ReactNode } from "react";
import Sidebar from "./sidebar";
import Topbar from "./topbar";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />

      <div className="flex flex-col flex-1">
        <Topbar />

        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
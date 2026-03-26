"use client";

import AppShell from "@/components/layout/app-shell"; // ✅ works same as AdminDashboard

export default function ClientDashboard() {
  return (
    <AppShell>
      <h1 className="text-2xl font-bold">Client Dashboard</h1>
      <p className="mt-2 text-gray-600">Welcome to client panel</p>
    </AppShell>
  );
}
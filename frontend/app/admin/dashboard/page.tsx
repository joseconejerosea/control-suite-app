"use client";

import AppShell from "@/components/layout/app-shell"; // ✅ works now

export default function AdminDashboard() {
  return (
    <AppShell>
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>
      <p className="mt-2 text-gray-600">Welcome to admin panel</p>
    </AppShell>
  );
}
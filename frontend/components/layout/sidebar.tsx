"use client";

import Link from "next/link";

export default function Sidebar() {
  return (
    <aside className="w-64 bg-white border-r h-full">
      <div className="p-4 text-xl font-bold border-b">
        Ref Monitor
      </div>

      <nav className="p-4 flex flex-col gap-3">
        <Link href="/admin/dashboard" className="hover:text-blue-600">
          Admin Dashboard
        </Link>

        <Link href="/client/dashboard" className="hover:text-blue-600">
          Client Dashboard
        </Link>
      </nav>
    </aside>
  );
}
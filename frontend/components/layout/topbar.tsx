"use client";

export default function Topbar() {
  return (
    <header className="h-14 bg-white border-b flex items-center justify-between px-6">
      <h1 className="font-semibold">Dashboard</h1>

      <button
        onClick={() => {
          localStorage.removeItem("token");
          localStorage.removeItem("role");
          window.location.href = "/login";
        }}
        className="text-sm bg-black text-white px-3 py-1 rounded"
      >
        Logout
      </button>
    </header>
  );
}
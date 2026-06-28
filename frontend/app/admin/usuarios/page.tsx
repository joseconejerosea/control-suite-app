"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const ROLE_STYLE: Record<string, { background: string; color: string; label: string }> = {
  admin_cliente: { background: "rgba(99,102,241,0.12)", color: "#818cf8", label: "Admin" },
  user:          { background: "rgba(100,116,139,0.12)", color: "#94a3b8", label: "Usuario" },
  super_admin:   { background: "rgba(245,158,11,0.12)", color: "#f59e0b", label: "Super Admin" },
};

export default function AdminUsuariosPage() {
  const [clients, setClients]       = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [users, setUsers]           = useState<any[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser]     = useState<any>(null);
  const [form, setForm]             = useState({ email: "", password: "", full_name: "", role: "user" });
  const [search, setSearch]         = useState("");

  useEffect(() => {
    api.get<any>("/clients")
      .then((r) => setClients(Array.isArray(r) ? r : (r?.data ?? [])))
      .catch(console.error);
  }, []);

  const fetchUsers = async (clientId: string) => {
    if (!clientId) return;
    setError(null);
    setLoading(true);
    try {
      const r = await api.get<any>(`/v1/app/admin/users?client_id=${clientId}`);
      setUsers(Array.isArray(r) ? r : (r?.data ?? []));
    } catch {
      setError("Error al cargar usuarios");
      setUsers([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (selectedClient) fetchUsers(selectedClient);
  }, [selectedClient]);

  const createUser = async () => {
    if (!selectedClient || !form.email || !form.password) return;
    setError(null);
    try {
      await api.post("/v1/app/admin/users", { ...form, client_id: selectedClient });
    } catch {
      setError("Error al crear usuario");
      return;
    }
    setShowCreate(false);
    setForm({ email: "", password: "", full_name: "", role: "user" });
    fetchUsers(selectedClient);
  };

  const updateUser = async () => {
    if (!editUser) return;
    setError(null);
    const body: any = {};
    if (editUser.role) body.role = editUser.role;
    if (editUser.full_name !== undefined) body.full_name = editUser.full_name;
    if (editUser.is_active !== undefined) body.is_active = editUser.is_active;
    try {
      await api.patch(`/v1/app/admin/users/${editUser.id}`, body);
    } catch {
      setError("Error al actualizar usuario");
      return;
    }
    setEditUser(null);
    fetchUsers(selectedClient);
  };

  const toggleActive = async (u: any) => {
    setError(null);
    try {
      await api.patch(`/v1/app/admin/users/${u.id}`, { is_active: !u.is_active });
    } catch {
      setError("Error al cambiar estado del usuario");
      return;
    }
    fetchUsers(selectedClient);
  };

  const filtered = users.filter((u: any) =>
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(search.toLowerCase())
  );

  const clientName = clients.find((c: any) => c.id === selectedClient)?.nombre ?? "";

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Usuarios por Tenant</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Gestión de usuarios de cada cliente
            </p>
          </div>
        </div>

        {/* Client selector */}
        <div className="flex gap-3 mb-6">
          <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
            <option value="">Seleccionar cliente...</option>
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.nombre} ({c.status})</option>
            ))}
          </select>
          {selectedClient && (
            <button onClick={() => { setShowCreate(true); setForm({ email: "", password: "", full_name: "", role: "user" }); }}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer" }}>
              + Crear usuario
            </button>
          )}
        </div>

        {!selectedClient && (
          <div className="text-center py-16" style={{ color: "var(--muted-foreground)" }}>
            <div className="text-4xl mb-3">👥</div>
            <p>Selecciona un cliente para ver sus usuarios</p>
          </div>
        )}

        {selectedClient && (
          <>
            {/* Error banner */}
            {error && (
              <div className="flex items-center justify-between rounded-xl px-4 py-3 mb-4"
                style={{ background: "rgba(200,32,44,0.10)", border: "1px solid rgba(200,32,44,0.35)", color: "#e8353f" }}>
                <span className="text-sm">{error}</span>
                <button onClick={() => setError(null)}
                  style={{ background: "none", border: "none", color: "#e8353f", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 0 0 12px" }}>
                  ×
                </button>
              </div>
            )}

            {/* KPIs */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: "Total", value: users.length, color: "var(--foreground)" },
                { label: "Activos", value: users.filter((u: any) => u.is_active).length, color: "#34b96e" },
                { label: "Admins", value: users.filter((u: any) => u.role === "admin_cliente").length, color: "#818cf8" },
                { label: "Inactivos", value: users.filter((u: any) => !u.is_active).length, color: "#e8353f" },
              ].map((kpi) => (
                <div key={kpi.label} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
                  <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>{kpi.label}</div>
                </div>
              ))}
            </div>

            {/* Search */}
            <div className="mb-4">
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por email o nombre..."
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
            </div>

            {/* Users table */}
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <table className="w-full border-collapse">
                <thead style={{ background: "var(--secondary)" }}>
                  <tr>
                    {["Email", "Nombre", "Rol", "Estado", "Creado", "Acciones"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left"
                        style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Sin usuarios</td></tr>
                  ) : filtered.map((u: any) => {
                    const roleStyle = ROLE_STYLE[u.role] ?? ROLE_STYLE.user;
                    return (
                      <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                        <td className="px-4 py-3 text-sm font-mono">{u.email}</td>
                        <td className="px-4 py-3 text-sm">{u.full_name ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={roleStyle}>{roleStyle.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{ background: u.is_active ? "rgba(42,157,92,0.12)" : "rgba(200,32,44,0.12)", color: u.is_active ? "#34b96e" : "#e8353f" }}>
                            {u.is_active ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
                          {u.created_at ? new Date(u.created_at).toLocaleDateString("es-CL") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => setEditUser({ ...u })}
                              className="text-xs px-2 py-1 rounded"
                              style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "none", cursor: "pointer" }}>
                              Editar
                            </button>
                            <button onClick={() => toggleActive(u)}
                              className="text-xs px-2 py-1 rounded"
                              style={{
                                background: u.is_active ? "rgba(200,32,44,0.12)" : "rgba(42,157,92,0.12)",
                                color: u.is_active ? "#e8353f" : "#34b96e",
                                border: "none", cursor: "pointer",
                              }}>
                              {u.is_active ? "Desactivar" : "Activar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Create Modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setShowCreate(false)}>
            <div className="rounded-2xl border p-6 w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold mb-1">Crear usuario</h3>
              <p className="text-xs mb-4" style={{ color: "var(--muted-foreground)" }}>Cliente: {clientName}</p>
              <div className="space-y-3">
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  placeholder="Nombre completo" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="Email" type="email" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
                <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Contraseña (mín. 8 caracteres)" type="password" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                  <option value="user">Usuario</option>
                  <option value="admin_cliente">Admin Cliente</option>
                </select>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setShowCreate(false)} className="flex-1 py-2 rounded-lg text-sm"
                  style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                  Cancelar
                </button>
                <button onClick={createUser} disabled={!form.email || form.password.length < 8}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer", opacity: !form.email || form.password.length < 8 ? 0.4 : 1 }}>
                  Crear
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setEditUser(null)}>
            <div className="rounded-2xl border p-6 w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold mb-1">Editar usuario</h3>
              <p className="text-xs mb-4 font-mono" style={{ color: "var(--muted-foreground)" }}>{editUser.email}</p>
              <div className="space-y-3">
                <input value={editUser.full_name ?? ""} onChange={(e) => setEditUser({ ...editUser, full_name: e.target.value })}
                  placeholder="Nombre completo" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
                <select value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                  <option value="user">Usuario</option>
                  <option value="admin_cliente">Admin Cliente</option>
                </select>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={editUser.is_active} onChange={(e) => setEditUser({ ...editUser, is_active: e.target.checked })} />
                  Activo
                </label>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setEditUser(null)} className="flex-1 py-2 rounded-lg text-sm"
                  style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                  Cancelar
                </button>
                <button onClick={updateUser} className="flex-1 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer" }}>
                  Guardar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

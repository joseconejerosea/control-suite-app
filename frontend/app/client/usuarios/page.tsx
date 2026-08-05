"use client";
import { useState, useEffect, useCallback } from "react";
import { UserCircle, Plus, Pencil, Save, X, Bell, BellOff } from "lucide-react";
import AppShell from "@/components/layout/app-shell";
import { roleLabel } from "@/lib/roles";

// NEXT_PUBLIC_API_URL NO incluye /api (contrato de lib/api.ts). El /api se agrega acá.
const API = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api`;

// Roles que el MANAGER puede asignar (espeja AdminCreateUserDto @IsIn del backend).
// VALUE = string persistido en users.role (ver UserRole enum). MANAGER='admin_cliente'.
const ROLE_OPTIONS = [
  { value: "admin_cliente", label: "Manager" },
  { value: "user",          label: "Operador" },
  { value: "supervisor",    label: "Supervisor" },
];

function getToken() {
  try { return localStorage.getItem("cs_token") ?? ""; } catch { return ""; }
}
function getUser(): { client_id?: string } {
  try { return JSON.parse(localStorage.getItem("cs_user") ?? "{}"); } catch { return {}; }
}

type TenantUser = {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  phone: string | null;
  is_active: boolean;
};

type FormState = {
  email: string;
  password: string;
  role: string;
  full_name: string;
  phone: string;
  is_active: boolean;
};

const EMPTY_FORM: FormState = {
  email: "", password: "", role: "admin_cliente", full_name: "", phone: "", is_active: true,
};

export default function UsuariosPage() {
  const [users, setUsers]   = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]   = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Modal: null = cerrado; { id: null } = crear; { id } = editar
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm]       = useState<FormState>(EMPTY_FORM);

  const clientId = getUser().client_id ?? "";

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };
  const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

  const load = useCallback(async () => {
    if (!clientId) { setLoading(false); return; }
    try {
      const r = await fetch(`${API}/v1/app/admin/users?client_id=${clientId}`, { headers: authHeaders() });
      const d = await r.json();
      // El ResponseInterceptor global envuelve las respuestas en { data, timestamp, path },
      // así que la lista viene en d.data — no es un array pelado. (Bug detectado en dev:
      // sin este desenvuelto la tabla mostraba "Sin usuarios" con usuarios reales cargados.)
      setUsers(Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []));
    } catch { /* best-effort */ }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(EMPTY_FORM); setEditing({ id: null }); };
  const openEdit = (u: TenantUser) => {
    setForm({ email: u.email, password: "", role: u.role, full_name: u.full_name ?? "", phone: u.phone ?? "", is_active: u.is_active });
    setEditing({ id: u.id });
  };
  const closeModal = () => { setEditing(null); setForm(EMPTY_FORM); };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.id === null) {
        // Crear
        const res = await fetch(`${API}/v1/app/admin/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            client_id: clientId,
            email: form.email,
            password: form.password,
            role: form.role,
            full_name: form.full_name || undefined,
            phone: form.phone || undefined,
          }),
        });
        if (!res.ok) { showToast("No se pudo crear (revisá email/contraseña ≥8)"); setSaving(false); return; }
        showToast("Usuario creado ✓");
      } else {
        // Editar (no cambia contraseña acá)
        const res = await fetch(`${API}/v1/app/admin/users/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            role: form.role,
            full_name: form.full_name || undefined,
            phone: form.phone,
            is_active: form.is_active,
          }),
        });
        if (!res.ok) { showToast("No se pudo guardar"); setSaving(false); return; }
        showToast("Usuario actualizado ✓");
      }
      closeModal();
      await load();
    } catch { showToast("Error de red"); }
    finally { setSaving(false); }
  };

  // Un usuario recibe las notificaciones "avisar al operador" si es Manager
  // (role='admin_cliente') Y tiene teléfono cargado. Ver OperatorNotifierService.
  const recibeAvisos = (u: TenantUser) => u.role === "admin_cliente" && !!(u.phone && u.phone.trim());

  const input = (val: string, onChange: (v: string) => void, placeholder = "", type = "text") => (
    <input type={type} value={val} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 13, boxSizing: "border-box" }} />
  );

  return (
    <AppShell>
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <UserCircle size={20} />
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Usuarios</h1>
        </div>
        <button onClick={openCreate}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 7, background: "var(--red, #C8202C)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          <Plus size={14} /> Agregar usuario
        </button>
      </div>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", margin: "0 0 20px" }}>
        Managers y operadores del tenant. Los <b>Managers con teléfono</b> son quienes reciben las
        notificaciones automáticas (feedback de cliente, escalaciones, alertas).
      </p>

      {/* Tabla */}
      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 24, color: "var(--muted-foreground)", fontSize: 13 }}>Cargando…</div>
        ) : users.length === 0 ? (
          <div style={{ padding: 24, color: "var(--muted-foreground)", fontSize: 13, textAlign: "center" }}>
            Sin usuarios. Agregá el primero con “Agregar usuario”.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted-foreground)" }}>
                <th style={{ padding: "10px 14px", fontWeight: 500 }}>Nombre</th>
                <th style={{ padding: "10px 14px", fontWeight: 500 }}>Email</th>
                <th style={{ padding: "10px 14px", fontWeight: 500 }}>Rol</th>
                <th style={{ padding: "10px 14px", fontWeight: 500 }}>Teléfono</th>
                <th style={{ padding: "10px 14px", fontWeight: 500 }}>Notificaciones</th>
                <th style={{ padding: "10px 14px", fontWeight: 500 }}>Estado</th>
                <th style={{ padding: "10px 14px", fontWeight: 500 }}></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderTop: "1px solid var(--border)", opacity: u.is_active ? 1 : 0.5 }}>
                  <td style={{ padding: "10px 14px", fontWeight: 500 }}>{u.full_name || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "var(--muted-foreground)" }}>{u.email}</td>
                  <td style={{ padding: "10px 14px" }}>{roleLabel(u.role)}</td>
                  <td style={{ padding: "10px 14px", color: u.phone ? "var(--foreground)" : "var(--muted-foreground)" }}>{u.phone || "—"}</td>
                  <td style={{ padding: "10px 14px" }}>
                    {u.role !== "admin_cliente" ? (
                      <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>—</span>
                    ) : recibeAvisos(u) ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, background: "#2a9d5c22", color: "#2a9d5c", borderRadius: 99, padding: "3px 9px", fontWeight: 600 }}>
                        <Bell size={12} /> Recibe avisos
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, background: "#e76f5122", color: "#e76f51", borderRadius: 99, padding: "3px 9px", fontWeight: 600 }}>
                        <BellOff size={12} /> Falta teléfono
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: 11, background: u.is_active ? "#2a9d5c22" : "var(--secondary)", color: u.is_active ? "#2a9d5c" : "var(--muted-foreground)", borderRadius: 99, padding: "3px 9px", fontWeight: 600 }}>
                      {u.is_active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    <button onClick={() => openEdit(u)} title="Editar"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 4 }}>
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal crear/editar */}
      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998 }}
          onClick={closeModal}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, width: 440, maxWidth: "90vw" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{editing.id === null ? "Agregar usuario" : "Editar usuario"}</h2>
              <button onClick={closeModal} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)" }}><X size={16} /></button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 4 }}>Nombre completo</label>
                {input(form.full_name, v => setForm(f => ({ ...f, full_name: v })), "María González")}
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 4 }}>Email</label>
                {editing.id === null
                  ? input(form.email, v => setForm(f => ({ ...f, email: v })), "maria@empresa.com", "email")
                  : <div style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "8px 0" }}>{form.email}</div>}
              </div>
              {editing.id === null && (
                <div>
                  <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 4 }}>Contraseña (mín. 8)</label>
                  {input(form.password, v => setForm(f => ({ ...f, password: v })), "••••••••", "password")}
                </div>
              )}
              <div>
                <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 4 }}>Rol</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 13 }}>
                  {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 4 }}>
                  Teléfono {form.role === "admin_cliente" && <span style={{ color: "#e76f51" }}>· necesario para recibir notificaciones</span>}
                </label>
                {input(form.phone, v => setForm(f => ({ ...f, phone: v })), "+56 9 1234 5678", "tel")}
              </div>
              {editing.id !== null && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  Activo
                </label>
              )}
            </div>

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={closeModal}
                style={{ padding: "8px 14px", borderRadius: 7, background: "none", border: "1px solid var(--border)", color: "var(--muted-foreground)", cursor: "pointer", fontSize: 13 }}>
                Cancelar
              </button>
              <button onClick={save} disabled={saving}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 7, background: "var(--red, #C8202C)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                <Save size={14} /> {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "#1a1a2e", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
          {toast}
        </div>
      )}
    </div>
    </AppShell>
  );
}

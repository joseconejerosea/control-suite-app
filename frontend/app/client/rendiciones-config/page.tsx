"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

interface ApprovalRule {
  id?: string;
  nombre: string;
  cap_monto: number;
  cap_categoria: string;
  requiere_aprobacion_desde: number;
  aprobador_user_id: string;
  proyecto_id: string;
  activa: boolean;
}

const CATEGORIAS = ["gastos", "ventas", "costos", "general"];

export default function RendicionesConfigPage() {
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<ApprovalRule | null>(null);
  const [form, setForm] = useState<ApprovalRule>({
    nombre: "",
    cap_monto: 100000,
    cap_categoria: "general",
    requiere_aprobacion_desde: 50000,
    aprobador_user_id: "",
    proyecto_id: "",
    activa: true,
  });

  const fetchData = () => {
    setLoading(true);
    Promise.all([
      api.get<any>("/rendiciones/reglas").catch(() => ({ data: [] })),
      api.get<any>("/projects").catch(() => []),
      api.get<any>("/collaborators").catch(() => []),
    ]).then(([r, p, u]) => {
      setRules(Array.isArray(r) ? r : (r?.data ?? []));
      setProjects(Array.isArray(p) ? p : (p?.data ?? []));
      setUsers(Array.isArray(u) ? u : (u?.data ?? []));
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ nombre: "", cap_monto: 100000, cap_categoria: "general", requiere_aprobacion_desde: 50000, aprobador_user_id: "", proyecto_id: "", activa: true });
    setModal(true);
  };

  const openEdit = (rule: ApprovalRule) => {
    setEditing(rule);
    setForm({ ...rule });
    setModal(true);
  };

  const save = async () => {
    if (editing?.id) {
      await api.patch(`/rendiciones/reglas/${editing.id}`, form).catch(console.error);
    } else {
      await api.post("/rendiciones/reglas", form).catch(console.error);
    }
    setModal(false);
    fetchData();
  };

  const toggle = async (rule: ApprovalRule) => {
    await api.patch(`/rendiciones/reglas/${rule.id}`, { activa: !rule.activa }).catch(console.error);
    fetchData();
  };

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Reglas de Aprobación</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Configura límites y aprobadores para rendiciones
            </p>
          </div>
          <button onClick={openNew} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer" }}>
            + Nueva Regla
          </button>
        </div>

        {/* Rules List */}
        {loading ? (
          <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>
        ) : rules.length === 0 ? (
          <div className="rounded-xl border p-12 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <div className="text-3xl mb-3">📋</div>
            <p className="font-medium mb-1">Sin reglas configuradas</p>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Crea la primera regla de aprobación para controlar los montos de rendiciones
            </p>
            <button onClick={openNew} className="mt-4 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer" }}>
              Crear primera regla
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule: any, i: number) => (
              <div key={rule.id ?? i} className="rounded-xl border p-4 flex items-center gap-4"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{rule.nombre}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs" style={{
                      background: rule.activa ? "rgba(42,157,92,0.12)" : "var(--secondary)",
                      color: rule.activa ? "#34b96e" : "var(--muted-foreground)"
                    }}>
                      {rule.activa ? "Activa" : "Inactiva"}
                    </span>
                    {rule.cap_categoria && (
                      <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa" }}>
                        {rule.cap_categoria}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 text-xs" style={{ color: "var(--muted-foreground)" }}>
                    <span>Límite: <strong style={{ color: "var(--foreground)" }}>${(rule.cap_monto ?? 0).toLocaleString("es-CL")}</strong></span>
                    <span>Aprobación desde: <strong style={{ color: "var(--foreground)" }}>${(rule.requiere_aprobacion_desde ?? 0).toLocaleString("es-CL")}</strong></span>
                    {rule.proyecto_id && <span>Proyecto específico</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toggle(rule)} className="text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: "var(--secondary)", border: "none", cursor: "pointer", color: "var(--muted-foreground)" }}>
                    {rule.activa ? "Desactivar" : "Activar"}
                  </button>
                  <button onClick={() => openEdit(rule)} className="text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: "var(--secondary)", border: "none", cursor: "pointer", color: "var(--foreground)" }}>
                    Editar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info box */}
        <div className="mt-6 rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
          <div className="text-sm font-semibold mb-2">Cómo funcionan las reglas</div>
          <div className="text-xs space-y-1" style={{ color: "var(--muted-foreground)" }}>
            <p>• <strong>Límite por monto:</strong> Si una rendición supera el cap, requiere aprobación manual</p>
            <p>• <strong>Por categoría:</strong> Aplica solo a items de esa categoría (gastos, ventas, costos)</p>
            <p>• <strong>Por proyecto:</strong> Si se deja vacío, aplica a todos los proyectos</p>
            <p>• <strong>Aprobador:</strong> El colaborador que debe aprobar cuando se supera el límite</p>
          </div>
        </div>

        {/* Modal */}
        {modal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setModal(false)}>
            <div className="rounded-2xl border p-6 w-full max-w-lg" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-lg mb-4">{editing ? "Editar" : "Nueva"} Regla de Aprobación</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--muted-foreground)" }}>Nombre de la regla</label>
                  <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                    placeholder="ej: Límite general gastos"
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: "var(--muted-foreground)" }}>Cap monto (CLP)</label>
                    <input type="number" value={form.cap_monto} onChange={(e) => setForm({ ...form, cap_monto: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: "var(--muted-foreground)" }}>Aprobación desde (CLP)</label>
                    <input type="number" value={form.requiere_aprobacion_desde} onChange={(e) => setForm({ ...form, requiere_aprobacion_desde: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--muted-foreground)" }}>Categoría</label>
                  <select value={form.cap_categoria} onChange={(e) => setForm({ ...form, cap_categoria: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--muted-foreground)" }}>Proyecto (opcional)</label>
                  <select value={form.proyecto_id} onChange={(e) => setForm({ ...form, proyecto_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                    <option value="">Todos los proyectos</option>
                    {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name || p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--muted-foreground)" }}>Aprobador</label>
                  <select value={form.aprobador_user_id} onChange={(e) => setForm({ ...form, aprobador_user_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                    <option value="">Seleccionar aprobador</option>
                    {users.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.nombre || u.email}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="activa" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
                  <label htmlFor="activa" className="text-sm">Regla activa</label>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setModal(false)} className="flex-1 py-2 rounded-lg text-sm"
                  style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>Cancelar</button>
                <button onClick={save} disabled={!form.nombre.trim()} className="flex-1 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: "var(--red)", color: "#fff", border: "none", cursor: "pointer", opacity: !form.nombre.trim() ? 0.4 : 1 }}>
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
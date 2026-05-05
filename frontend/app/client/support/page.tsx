"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const TIPO_OPTIONS = ["Error en sistema", "Solicitud de acceso", "Consulta funcional", "Problema con WhatsApp", "Otro"];

const ESTADO_STYLE: Record<string, { background: string; color: string }> = {
  abierto:    { background: "rgba(59,130,246,0.12)",  color: "#60a5fa" },
  en_proceso: { background: "rgba(139,92,246,0.12)",  color: "#a78bfa" },
  cerrado:    { background: "rgba(42,157,92,0.12)",   color: "#34b96e" },
};

export default function SupportPage() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ tipo: "", descripcion: "", prioridad: "media" });
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);

  const fetchTickets = () => {
    setLoading(true);
    api.get<any>("/support/tickets")
      .then(r => setTickets(Array.isArray(r) ? r : (r?.data ?? [])))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTickets(); }, []);

  const submit = async () => {
    if (!form.tipo || !form.descripcion.trim()) return;
    setSending(true);
    try {
      await api.post("/support/tickets", form);
      setForm({ tipo: "", descripcion: "", prioridad: "media" });
      setShowForm(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      fetchTickets();
    } finally { setSending(false); }
  };

  return (
    <AppShell>
      <div className="animate-fade-up" style={{ maxWidth: 700, margin: "0 auto" }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Soporte</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Crea y sigue tus tickets de soporte</p>
          </div>
          <button onClick={() => setShowForm(!showForm)}
            style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "var(--red)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            + Nuevo ticket
          </button>
        </div>

        {success && (
          <div className="rounded-xl p-4 mb-4 text-sm font-medium" style={{ background: "rgba(42,157,92,0.15)", color: "#34b96e" }}>
            Ticket creado correctamente. El equipo de soporte se pondra en contacto pronto.
          </div>
        )}

        {showForm && (
          <div className="rounded-xl border p-5 mb-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="font-semibold mb-4">Nuevo ticket de soporte</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--muted-foreground)" }}>Tipo de solicitud</label>
                <select value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none" }}>
                  <option value="">Selecciona un tipo...</option>
                  {TIPO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--muted-foreground)" }}>Prioridad</label>
                <div className="flex gap-2">
                  {["baja", "media", "alta"].map(p => (
                    <button key={p} onClick={() => setForm(prev => ({ ...prev, prioridad: p }))}
                      className="text-xs px-3 py-1.5 rounded-lg capitalize"
                      style={{ background: form.prioridad === p ? "var(--red-dim)" : "var(--secondary)", color: form.prioridad === p ? "var(--red-light)" : "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--muted-foreground)" }}>Descripcion</label>
                <textarea value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
                  placeholder="Describe el problema con el mayor detalle posible..."
                  style={{ width: "100%", height: 100, borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, padding: 12, resize: "none", outline: "none", boxSizing: "border-box" as any }} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowForm(false)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer" }}>
                Cancelar
              </button>
              <button onClick={submit} disabled={sending || !form.tipo || !form.descripcion.trim()}
                style={{ flex: 2, padding: 10, borderRadius: 8, border: "none", background: form.tipo && form.descripcion.trim() ? "var(--red)" : "var(--secondary)", color: form.tipo && form.descripcion.trim() ? "#fff" : "var(--muted-foreground)", cursor: "pointer", fontWeight: 600 }}>
                {sending ? "Enviando..." : "Crear ticket"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>
        ) : tickets.length === 0 ? (
          <div className="rounded-xl border p-12 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🎫</div>
            <div className="font-medium mb-2">Sin tickets activos</div>
            <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>Crea un ticket si necesitas ayuda del equipo de soporte</div>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map(t => (
              <div key={t.id} className="rounded-xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-sm">{t.tipo}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{t.id?.slice(0, 8)} · {t.created_at ? new Date(t.created_at).toLocaleDateString("es-CL") : "—"}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={ESTADO_STYLE[t.estado]}>{t.estado.replace("_", " ")}</span>
                </div>
                <div className="text-sm mb-2" style={{ color: "var(--muted-foreground)" }}>{t.descripcion}</div>
                {t.respuesta && (
                  <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8" }}>
                    <span className="font-semibold">Respuesta: </span>{t.respuesta}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

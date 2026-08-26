"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

// destino: enum destino_reporte de la DB (gastos/ventas/costos). El diccionario OCR le
// indica a la IA de clasificación que un keyword mapea a esta categoría y destino.
const DESTINOS = ["gastos", "ventas", "costos"] as const;
const EMPTY_FORM = { keyword: "", categoria: "", destino: "gastos", confidence_boost: "0.10" };

export default function EquivalenciasPage() {
  const [items, setItems]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm]       = useState({ ...EMPTY_FORM });

  const fetchData = () => {
    setLoading(true);
    api.get<any>("/v1/app/equivalencias")
      .then((r) => setItems(Array.isArray(r) ? r : (r?.data ?? [])))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const openNew = () => { setEditing(null); setForm({ ...EMPTY_FORM }); setModal(true); };
  const openEdit = (item: any) => { setEditing(item); setForm({ keyword: item.keyword ?? "", categoria: item.categoria ?? "", destino: item.destino ?? "gastos", confidence_boost: String(item.confidence_boost ?? "0.10") }); setModal(true); };

  const save = async () => {
    const payload = { ...form, confidence_boost: parseFloat(form.confidence_boost) };
    // Anexo · NO tragar el error (antes: .catch(console.error) + cerrar el modal igual →
    // "guardado silencioso": el form se cerraba como si funcionara aunque el POST fallara).
    // Ahora solo cerramos/refrescamos en ÉXITO; en error avisamos y dejamos el modal abierto.
    try {
      if (editing) await api.patch(`/v1/app/equivalencias/${editing.id}`, payload);
      else await api.post("/v1/app/equivalencias", payload);
      setModal(false);
      fetchData();
    } catch (e) {
      alert("No se pudo guardar la equivalencia: " + (e instanceof Error ? e.message : "error inesperado"));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar?")) return;
    await (api as any).delete(`/v1/app/equivalencias/${id}`).catch(console.error);
    fetchData();
  };

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Equivalencias OCR</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Diccionario que guía a la IA: keyword → categoría y destino contable</p>
          </div>
          <button onClick={openNew} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}>
            + Nueva
          </button>
        </div>
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full border-collapse">
            <thead style={{ background: "var(--secondary)" }}>
              <tr>
                {["Keyword", "Categoría", "Destino", "Boost", "Acciones"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left"
                    style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Cargando...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Sin equivalencias</td></tr>
              ) : items.map((item: any) => (
                <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <td className="px-4 py-3 text-sm font-mono">{item.keyword}</td>
                  <td className="px-4 py-3 text-sm font-medium">{item.categoria}</td>
                  <td className="px-4 py-3 text-sm capitalize" style={{ color: "var(--muted-foreground)" }}>{item.destino}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)" }}>
                      +{(parseFloat(item.confidence_boost) * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(item)} className="text-xs px-2 py-1 rounded" style={{ background: "var(--secondary)", border: "none", cursor: "pointer" }}>Editar</button>
                      <button onClick={() => remove(item.id)} className="text-xs px-2 py-1 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "none", cursor: "pointer" }}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {modal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setModal(false)}>
            <div className="rounded-2xl border p-6 w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-lg mb-4">{editing ? "Editar" : "Nueva"} Equivalencia</h3>
              <div className="space-y-3">
                {[["Keyword (texto que aparece en el OCR)", "keyword"], ["Categoría contable", "categoria"]].map(([label, key]) => (
                  <div key={key}>
                    <label className="text-xs font-medium block mb-1" style={{ color: "var(--muted-foreground)" }}>{label}</label>
                    <input value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
                  </div>
                ))}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--muted-foreground)" }}>Destino</label>
                  <select value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none capitalize"
                    style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                    {DESTINOS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "var(--muted-foreground)" }}>Boost de confianza (0.0 - 1.0)</label>
                  <input type="text" inputMode="decimal" value={form.confidence_boost}
                    onChange={(e) => setForm({ ...form, confidence_boost: e.target.value.replace(/[^\d.]/g, "") })}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setModal(false)} className="flex-1 py-2 rounded-lg text-sm"
                  style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>Cancelar</button>
                <button onClick={save} className="flex-1 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}>Guardar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

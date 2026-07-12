"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { Plus, X, Package, Warehouse, ArrowLeftRight } from "lucide-react";

const TABS = ["Bodega", "SKUs", "Movimientos", "Devoluciones"];

const ESTADO_STYLE: Record<string, { background: string; color: string }> = {
  ok:      { background: "rgba(42,157,92,0.12)",  color: "#34b96e" },
  bajo:    { background: "rgba(245,158,11,0.12)", color: "#f59e0b" },
  critico: { background: "rgba(200,32,44,0.12)",  color: "#e8353f" },
};

function getEstado(cantidad: number): string {
  if (cantidad <= 0) return "critico";
  if (cantidad < 5)  return "bajo";
  return "ok";
}

const fieldStyle = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", boxSizing: "border-box" as any };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase" as any, display: "block", marginBottom: 4 };

// ─── BODEGA MODAL ───────────────────────────────────────────────────────
function BodegaModal({ onClose, onDone, bodegas }: { onClose: () => void; onDone: () => void; bodegas: any[] }) {
  const [form, setForm] = useState({ nombre: "", direccion: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!form.nombre.trim() || !form.direccion.trim()) return;
    setSaving(true); setError("");
    try {
      await api.post("/v1/app/bodegas", { nombre: form.nombre, direccion: form.direccion });
      onDone(); onClose();
    } catch (e: any) { setError(e.message ?? "Error"); } finally { setSaving(false); }
  };

  const canSave = form.nombre.trim() && form.direccion.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl border w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="font-bold flex items-center gap-2"><Warehouse size={16} /> Nueva Bodega</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)" }}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label style={labelStyle}>Nombre *</label><input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Bodega Central" style={fieldStyle} /></div>
          <div><label style={labelStyle}>Dirección *</label><input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} placeholder="Av. Ejemplo 123, Santiago" style={fieldStyle} /></div>
          {error && <div style={{ color: "#e8353f", fontSize: 12 }}>{error}</div>}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer" }}>Cancelar</button>
          <button onClick={save} disabled={saving || !canSave} style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: canSave ? "var(--red)" : "var(--secondary)", color: canSave ? "#fff" : "var(--muted-foreground)", cursor: "pointer", fontWeight: 600 }}>
            {saving ? "Guardando..." : "Crear bodega"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SKU MODAL ──────────────────────────────────────────────────────────
function SkuModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ nombre: "", codigo: "", min_stock: "5" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!form.nombre.trim()) return;
    setSaving(true); setError("");
    try {
      await api.post("/v1/app/skus", { nombre: form.nombre, codigo: form.codigo || undefined, min_stock: parseInt(form.min_stock) || 5 });
      onDone(); onClose();
    } catch (e: any) { setError(e.message ?? "Error"); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl border w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="font-bold flex items-center gap-2"><Package size={16} /> Nuevo SKU / Material</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)" }}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label style={labelStyle}>Nombre *</label><input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Afiche A3" style={fieldStyle} /></div>
          <div><label style={labelStyle}>Codigo SKU</label><input value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} placeholder="MAT-001" style={fieldStyle} /></div>
          <div><label style={labelStyle}>Stock minimo</label><input type="number" value={form.min_stock} onChange={e => setForm(f => ({ ...f, min_stock: e.target.value }))} style={fieldStyle} /></div>
          {error && <div style={{ color: "#e8353f", fontSize: 12 }}>{error}</div>}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer" }}>Cancelar</button>
          <button onClick={save} disabled={saving || !form.nombre.trim()} style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: form.nombre.trim() ? "var(--red)" : "var(--secondary)", color: form.nombre.trim() ? "#fff" : "var(--muted-foreground)", cursor: "pointer", fontWeight: 600 }}>
            {saving ? "Guardando..." : "Crear SKU"}
          </button>
        </div>
      </div>
    </div>
  );
}

// tipos que requieren proyecto_destino_id. El traslado NO lo lleva: es un movimiento
// entre bodegas, sin proyecto. Marcarlo como requerido contaminaba la merma del proyecto.
const TIPOS_CON_PROYECTO = new Set(["salida", "consumo"]);

// ─── MOVIMIENTO MODAL ────────────────────────────────────────────────────
function MovimientoModal({ onClose, onDone, bodegas, skus, projects }: { onClose: () => void; onDone: () => void; bodegas: any[]; skus: any[]; projects: any[] }) {
  const [form, setForm] = useState({ sku_id: "", bodega_origen_id: "", bodega_destino_id: "", tipo: "entrada", cantidad: "", observacion: "", proyecto_destino_id: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const requiereProyecto = TIPOS_CON_PROYECTO.has(form.tipo);
  // El traslado exige ambas bodegas (origen y destino); el backend las requiere.
  const esTraslado = form.tipo === "transfer";
  const canSave = !!form.sku_id && !!form.cantidad
    && (!requiereProyecto || !!form.proyecto_destino_id)
    && (!esTraslado || (!!form.bodega_origen_id && !!form.bodega_destino_id));

  const save = async () => {
    if (!canSave) return;
    setSaving(true); setError("");
    try {
      await api.post("/v1/app/movimientos/manual", {
        sku_id: form.sku_id,
        bodega_origen_id: form.bodega_origen_id || undefined,
        bodega_destino_id: form.bodega_destino_id || undefined,
        tipo: form.tipo,
        cantidad: parseInt(form.cantidad),
        observacion: form.observacion || undefined,
        proyecto_destino_id: form.proyecto_destino_id || undefined,
      });
      onDone(); onClose();
    } catch (e: any) { setError(e.message ?? "Error"); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl border w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="font-bold flex items-center gap-2"><ArrowLeftRight size={16} /> Registrar Movimiento</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)" }}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label style={labelStyle}>SKU / Material *</label>
            <select value={form.sku_id} onChange={e => setForm(f => ({ ...f, sku_id: e.target.value }))} style={fieldStyle}>
              <option value="">Selecciona un SKU...</option>
              {skus.map(s => <option key={s.id} value={s.id}>{s.nombre} {s.codigo ? `(${s.codigo})` : ""}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Tipo de movimiento</label>
            <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value, proyecto_destino_id: "" }))} style={fieldStyle}>
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
              <option value="devolucion">Devolución</option>
              <option value="consumo">Consumo</option>
              <option value="merma">Merma</option>
              <option value="transfer">Traslado</option>
              <option value="adjustment">Ajuste</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Proyecto destino {requiereProyecto ? "*" : ""}</label>
            <select value={form.proyecto_destino_id} onChange={e => setForm(f => ({ ...f, proyecto_destino_id: e.target.value }))} style={fieldStyle}>
              <option value="">Ninguno</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Bodega origen</label>
              <select value={form.bodega_origen_id} onChange={e => setForm(f => ({ ...f, bodega_origen_id: e.target.value }))} style={fieldStyle}>
                <option value="">Ninguna</option>
                {bodegas.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Bodega destino</label>
              <select value={form.bodega_destino_id} onChange={e => setForm(f => ({ ...f, bodega_destino_id: e.target.value }))} style={fieldStyle}>
                <option value="">Ninguna</option>
                {bodegas.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </div>
          </div>
          <div><label style={labelStyle}>Cantidad *</label><input type="number" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))} placeholder="0" style={fieldStyle} /></div>
          <div><label style={labelStyle}>Observacion</label><input value={form.observacion} onChange={e => setForm(f => ({ ...f, observacion: e.target.value }))} placeholder="Motivo del movimiento..." style={fieldStyle} /></div>
          {error && <div style={{ color: "#e8353f", fontSize: 12 }}>{error}</div>}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer" }}>Cancelar</button>
          <button onClick={save} disabled={saving || !canSave} style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: canSave ? "var(--red)" : "var(--secondary)", color: canSave ? "#fff" : "var(--muted-foreground)", cursor: "pointer", fontWeight: 600 }}>
            {saving ? "Guardando..." : "Registrar movimiento"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────
export default function InventarioPage() {
  const [activeTab, setActiveTab] = useState("Bodega");
  const [inventario, setInventario] = useState<any[]>([]);
  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [bodegas, setBodegas] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showBodegaModal, setShowBodegaModal] = useState(false);
  const [showSkuModal, setShowSkuModal] = useState(false);
  const [showMovModal, setShowMovModal] = useState(false);
  const [alertas, setAlertas] = useState<any[]>([]);
  const [devoluciones, setDevoluciones] = useState<any[]>([]);
  const [rejectModal, setRejectModal] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      api.get<any>("/v1/app/inventario").catch(() => []),
      api.get<any>("/v1/app/movimientos").catch(() => []),
      api.get<any>("/v1/app/bodegas").catch(() => []),
      api.get<any>("/v1/app/skus").catch(() => []),
      api.get<any>("/v1/app/skus/alertas-stock").catch(() => []),
      api.get<any>("/v1/app/stock/returns/pending").catch(() => []),
      api.get<any>("/projects").catch(() => []),
    ]).then(([inv, mov, bod, sk, al, dev, proj]) => {
      setInventario(Array.isArray(inv) ? inv : (inv?.data ?? []));
      setMovimientos(Array.isArray(mov) ? mov : (mov?.data ?? []));
      setBodegas(Array.isArray(bod) ? bod : (bod?.data ?? []));
      setSkus(Array.isArray(sk) ? sk : (sk?.data ?? []));
      setAlertas(Array.isArray(al) ? al : (al?.data ?? []));
      setDevoluciones(Array.isArray(dev) ? dev : (dev?.data ?? []));
      setProjects(Array.isArray(proj) ? proj : (proj?.data ?? []));
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  const q = search.toLowerCase();
  const filteredInv = inventario.filter(item => !q || item.sku_nombre?.toLowerCase().includes(q) || item.sku_codigo?.toLowerCase().includes(q) || item.bodega_nombre?.toLowerCase().includes(q));
  const filteredMov = movimientos.filter(m => !q || m.sku_nombre?.toLowerCase().includes(q) || m.tipo?.toLowerCase().includes(q));
  const filteredSkus = skus.filter(s => !q || s.nombre?.toLowerCase().includes(q) || s.codigo?.toLowerCase().includes(q));

  const TH = ({ c }: { c: string }) => <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>{c}</th>;

  return (
    <AppShell>
      {showBodegaModal && <BodegaModal onClose={() => setShowBodegaModal(false)} onDone={fetchAll} bodegas={bodegas} />}
      {showSkuModal && <SkuModal onClose={() => setShowSkuModal(false)} onDone={fetchAll} />}
      {showMovModal && <MovimientoModal onClose={() => setShowMovModal(false)} onDone={fetchAll} bodegas={bodegas} skus={skus} projects={projects} />}

      <div className="animate-fade-up">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>Inventario POP</h1>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>Materiales y stock de punto de venta</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por SKU, marca, bodega..."
              style={{ width: 240, padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none" }} />
            <button onClick={() => setShowMovModal(true)}
              style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <ArrowLeftRight size={13} /> Movimiento
            </button>
            <button onClick={() => setShowSkuModal(true)}
              style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <Package size={13} /> + SKU
            </button>
            <button onClick={() => setShowBodegaModal(true)}
              style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "var(--red)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <Warehouse size={13} /> + Bodega
            </button>
          </div>
        </div>

        {/* Alertas stock */}
        {alertas.length > 0 && (
          <div style={{ marginBottom: 16, padding: "10px 16px", borderRadius: 10, background: "rgba(200,32,44,0.08)", border: "1px solid rgba(200,32,44,0.25)", fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: "#e8353f" }}>Alertas stock bajo:</span>
            <span style={{ color: "var(--muted-foreground)", marginLeft: 8 }}>{alertas.map((a: any) => a.nombre ?? a.sku_nombre).join(" · ")}</span>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ padding: "10px 18px", fontSize: 14, fontWeight: activeTab === tab ? 600 : 400, borderBottom: activeTab === tab ? "2px solid var(--red)" : "2px solid transparent", color: activeTab === tab ? "var(--foreground)" : "var(--muted-foreground)", background: "none", cursor: "pointer", marginBottom: -1 }}>
              {tab}
            </button>
          ))}
        </div>

        {loading && <div style={{ textAlign: "center", padding: 48, color: "var(--muted-foreground)" }}>Cargando...</div>}

        {/* TAB: BODEGA */}
        {!loading && activeTab === "Bodega" && (
          filteredInv.length === 0 ? (
            <div style={{ textAlign: "center", padding: "64px 0", color: "var(--muted-foreground)" }}>
              {search ? `Sin resultados para "${search}"` : "Sin stock registrado"}
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <table className="w-full border-collapse">
                <thead><tr><TH c="SKU" /><TH c="Bodega" /><TH c="Cliente final" /><TH c="Cantidad" /><TH c="Estado" /></tr></thead>
                <tbody>
                  {filteredInv.map((item: any, i: number) => {
                    const estado = getEstado(item.cantidad ?? 0);
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 500 }}>{item.sku_nombre ?? item.nombre ?? item.sku_codigo ?? item.codigo ?? "—"}</td>
                        <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--muted-foreground)" }}>{item.bodega_nombre ?? "—"}</td>
                        <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--muted-foreground)" }}>{item.cliente_final ?? "—"}</td>
                        <td style={{ padding: "10px 16px", fontSize: 14, fontWeight: 700 }}>{item.cantidad ?? 0}</td>
                        <td style={{ padding: "10px 16px" }}>
                          <span style={{ ...ESTADO_STYLE[estado], padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>{estado}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* TAB: SKUs */}
        {!loading && activeTab === "SKUs" && (
          <div>
            {filteredSkus.length === 0 ? (
              <div style={{ textAlign: "center", padding: "64px 0", color: "var(--muted-foreground)" }}>
                {search ? `Sin resultados para "${search}"` : "Sin SKUs registrados — crea el primero"}
              </div>
            ) : (
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <table className="w-full border-collapse">
                  <thead><tr><TH c="Codigo" /><TH c="Nombre" /><TH c="Stock min" /><TH c="Estado" /></tr></thead>
                  <tbody>
                    {filteredSkus.map((s: any) => (
                      <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "10px 16px", fontSize: 12, fontFamily: "monospace", color: "var(--muted-foreground)" }}>{s.codigo ?? "—"}</td>
                        <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 500 }}>{s.nombre}</td>
                        <td style={{ padding: "10px 16px", fontSize: 13 }}>{s.min_stock ?? 5}</td>
                        <td style={{ padding: "10px 16px" }}>
                          <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.active !== false ? "rgba(42,157,92,0.12)" : "rgba(100,116,139,0.12)", color: s.active !== false ? "#34b96e" : "#94a3b8" }}>
                            {s.active !== false ? "Activo" : "Inactivo"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB: MOVIMIENTOS */}
        {!loading && activeTab === "Movimientos" && (
          filteredMov.length === 0 ? (
            <div style={{ textAlign: "center", padding: "64px 0", color: "var(--muted-foreground)" }}>
              {search ? `Sin resultados para "${search}"` : "Sin movimientos registrados"}
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
              <table className="w-full border-collapse">
                <thead><tr><TH c="SKU" /><TH c="Tipo" /><TH c="Cantidad" /><TH c="Origen" /><TH c="Destino" /><TH c="Fecha" /></tr></thead>
                <tbody>
                  {filteredMov.map((m: any, i: number) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}>
                      <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 500 }}>{m.sku_nombre ?? "—"}</td>
                      <td style={{ padding: "10px 16px", fontSize: 13, textTransform: "capitalize", color: "var(--muted-foreground)" }}>{m.tipo ?? "—"}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14, fontWeight: 700 }}>{m.cantidad ?? 0}</td>
                      <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--muted-foreground)" }}>{m.bodega_nombre ?? m.bodega_origen ?? "—"}</td>
                      <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--muted-foreground)" }}>{m.proyecto_nombre ?? m.bodega_destino ?? "—"}</td>
                      <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--muted-foreground)" }}>
                        {m.created_at ? new Date(m.created_at).toLocaleDateString("es-CL") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* TAB: DEVOLUCIONES */}
        {!loading && activeTab === "Devoluciones" && (
          devoluciones.length === 0 ? (
            <div style={{ textAlign: "center", padding: "64px 0", color: "var(--muted-foreground)" }}>
              Sin devoluciones pendientes
            </div>
          ) : (
            <div className="space-y-3">
              {devoluciones.map((d: any) => {
                const hours = Math.floor(parseFloat(d.hours_since_request ?? 0));
                const isOverdue = hours >= 24;
                const items = typeof d.items === "string" ? JSON.parse(d.items) : (d.items ?? []);
                const classLabel = d.photo_classification === "looks_correct"
                  ? { text: "Coincide", bg: "rgba(42,157,92,0.12)", color: "#34b96e" }
                  : d.photo_classification === "does_not_match"
                  ? { text: "No coincide", bg: "rgba(200,32,44,0.12)", color: "#e8353f" }
                  : { text: "Sin foto", bg: "rgba(100,116,139,0.12)", color: "#94a3b8" };

                return (
                  <div key={d.id} className="rounded-xl border p-4" style={{ borderColor: isOverdue ? "rgba(200,32,44,0.4)" : "var(--border)", background: "var(--card)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div className="font-semibold text-sm">{d.project_name}</div>
                        <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                          Persona: {d.persona_id?.slice(0, 8)}... · Solicitado hace {hours}h
                          {isOverdue && <span style={{ color: "#e8353f", fontWeight: 600, marginLeft: 8 }}>VENCIDO</span>}
                        </div>
                        <div className="mt-2 text-xs space-y-0.5">
                          {items.map((it: any, i: number) => (
                            <div key={i} style={{ color: "var(--muted-foreground)" }}>
                              {it.sku_nombre} ({it.codigo}): <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{it.pendiente} uds</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: classLabel.bg, color: classLabel.color }}>
                          {classLabel.text}
                        </span>
                        {d.has_photo && (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              disabled={actionLoading}
                              onClick={async () => {
                                setActionLoading(true);
                                try { await api.put(`/v1/app/stock/returns/${d.id}/confirm`); fetchAll(); } catch (e) { console.error(e); }
                                finally { setActionLoading(false); }
                              }}
                              style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "rgba(42,157,92,0.15)", color: "#34b96e", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                              Confirmar
                            </button>
                            <button
                              onClick={() => { setRejectModal(d.id); setRejectReason(""); }}
                              style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "rgba(200,32,44,0.15)", color: "#e8353f", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                              Rechazar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Reject reason modal */}
        {rejectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setRejectModal(null)}>
            <div className="rounded-2xl border p-6 w-full max-w-sm" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={e => e.stopPropagation()}>
              <h3 className="font-bold mb-3">Motivo de rechazo</h3>
              <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Foto no coincide con material..."
                style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", fontSize: 13, outline: "none", marginBottom: 12 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setRejectModal(null)} style={{ flex: 1, padding: 9, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer" }}>Cancelar</button>
                <button
                  disabled={actionLoading}
                  onClick={async () => {
                    setActionLoading(true);
                    try { await api.put(`/v1/app/stock/returns/${rejectModal}/reject`, { reason: rejectReason }); setRejectModal(null); fetchAll(); } catch (e) { console.error(e); }
                    finally { setActionLoading(false); }
                  }}
                  style={{ flex: 2, padding: 9, borderRadius: 8, border: "none", background: "var(--red)", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
                  {actionLoading ? "..." : "Rechazar"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { Plus, X, Package, Warehouse, ArrowLeftRight } from "lucide-react";

const TABS = ["Bodega", "SKUs", "Movimientos"];

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
  const [form, setForm] = useState({ nombre: "", ubicacion: "", capacidad: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!form.nombre.trim()) return;
    setSaving(true); setError("");
    try {
      await api.post("/bodegas", { nombre: form.nombre, ubicacion: form.ubicacion || undefined, capacidad: form.capacidad ? parseInt(form.capacidad) : undefined });
      onDone(); onClose();
    } catch (e: any) { setError(e.message ?? "Error"); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl border w-full max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="font-bold flex items-center gap-2"><Warehouse size={16} /> Nueva Bodega</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)" }}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label style={labelStyle}>Nombre *</label><input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Bodega Central" style={fieldStyle} /></div>
          <div><label style={labelStyle}>Ubicacion</label><input value={form.ubicacion} onChange={e => setForm(f => ({ ...f, ubicacion: e.target.value }))} placeholder="Santiago, Chile" style={fieldStyle} /></div>
          <div><label style={labelStyle}>Capacidad (unidades)</label><input type="number" value={form.capacidad} onChange={e => setForm(f => ({ ...f, capacidad: e.target.value }))} placeholder="1000" style={fieldStyle} /></div>
          {error && <div style={{ color: "#e8353f", fontSize: 12 }}>{error}</div>}
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} style={{ flex: 1, padding: "9px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer" }}>Cancelar</button>
          <button onClick={save} disabled={saving || !form.nombre.trim()} style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: form.nombre.trim() ? "var(--red)" : "var(--secondary)", color: form.nombre.trim() ? "#fff" : "var(--muted-foreground)", cursor: "pointer", fontWeight: 600 }}>
            {saving ? "Guardando..." : "Crear bodega"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SKU MODAL ──────────────────────────────────────────────────────────
function SkuModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ nombre: "", codigo: "", descripcion: "", unidad_medida: "unidad", stock_minimo: "5" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!form.nombre.trim()) return;
    setSaving(true); setError("");
    try {
      await api.post("/skus", { nombre: form.nombre, codigo: form.codigo || undefined, descripcion: form.descripcion || undefined, unidad_medida: form.unidad_medida, stock_minimo: parseInt(form.stock_minimo) || 5 });
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
          <div><label style={labelStyle}>Descripcion</label><input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Afiches para punto de venta" style={fieldStyle} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Unidad medida</label>
              <select value={form.unidad_medida} onChange={e => setForm(f => ({ ...f, unidad_medida: e.target.value }))} style={fieldStyle}>
                <option value="unidad">Unidad</option>
                <option value="caja">Caja</option>
                <option value="kg">Kg</option>
                <option value="metro">Metro</option>
              </select>
            </div>
            <div><label style={labelStyle}>Stock minimo</label><input type="number" value={form.stock_minimo} onChange={e => setForm(f => ({ ...f, stock_minimo: e.target.value }))} style={fieldStyle} /></div>
          </div>
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

// ─── MOVIMIENTO MODAL ────────────────────────────────────────────────────
function MovimientoModal({ onClose, onDone, bodegas, skus }: { onClose: () => void; onDone: () => void; bodegas: any[]; skus: any[] }) {
  const [form, setForm] = useState({ sku_id: "", bodega_origen_id: "", bodega_destino_id: "", tipo_movimiento: "entrada", cantidad: "", observacion: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!form.sku_id || !form.cantidad) return;
    setSaving(true); setError("");
    try {
      await api.post("/movimientos-pop/manual", { sku_id: form.sku_id, bodega_origen_id: form.bodega_origen_id || undefined, bodega_destino_id: form.bodega_destino_id || undefined, tipo_movimiento: form.tipo_movimiento, cantidad: parseInt(form.cantidad), observacion: form.observacion || undefined });
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
            <select value={form.tipo_movimiento} onChange={e => setForm(f => ({ ...f, tipo_movimiento: e.target.value }))} style={fieldStyle}>
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
              <option value="traslado">Traslado</option>
              <option value="ajuste">Ajuste</option>
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
          <button onClick={save} disabled={saving || !form.sku_id || !form.cantidad} style={{ flex: 2, padding: "9px", borderRadius: 8, border: "none", background: (form.sku_id && form.cantidad) ? "var(--red)" : "var(--secondary)", color: (form.sku_id && form.cantidad) ? "#fff" : "var(--muted-foreground)", cursor: "pointer", fontWeight: 600 }}>
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showBodegaModal, setShowBodegaModal] = useState(false);
  const [showSkuModal, setShowSkuModal] = useState(false);
  const [showMovModal, setShowMovModal] = useState(false);
  const [alertas, setAlertas] = useState<any[]>([]);

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      api.get<any>("/v1/app/inventario").catch(() => []),
      api.get<any>("/v1/app/movimientos").catch(() => []),
      api.get<any>("/bodegas").catch(() => []),
      api.get<any>("/skus").catch(() => []),
      api.get<any>("/skus/alertas-stock").catch(() => []),
    ]).then(([inv, mov, bod, sk, al]) => {
      setInventario(Array.isArray(inv) ? inv : (inv?.data ?? []));
      setMovimientos(Array.isArray(mov) ? mov : (mov?.data ?? []));
      setBodegas(Array.isArray(bod) ? bod : (bod?.data ?? []));
      setSkus(Array.isArray(sk) ? sk : (sk?.data ?? []));
      setAlertas(Array.isArray(al) ? al : (al?.data ?? []));
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  const q = search.toLowerCase();
  const filteredInv = inventario.filter(item => !q || item.sku_nombre?.toLowerCase().includes(q) || item.sku_codigo?.toLowerCase().includes(q) || item.bodega_nombre?.toLowerCase().includes(q));
  const filteredMov = movimientos.filter(m => !q || m.sku_nombre?.toLowerCase().includes(q) || m.tipo_movimiento?.toLowerCase().includes(q));
  const filteredSkus = skus.filter(s => !q || s.nombre?.toLowerCase().includes(q) || s.codigo?.toLowerCase().includes(q));

  const TH = ({ c }: { c: string }) => <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", background: "var(--secondary)", borderBottom: "1px solid var(--border)" }}>{c}</th>;

  return (
    <AppShell>
      {showBodegaModal && <BodegaModal onClose={() => setShowBodegaModal(false)} onDone={fetchAll} bodegas={bodegas} />}
      {showSkuModal && <SkuModal onClose={() => setShowSkuModal(false)} onDone={fetchAll} />}
      {showMovModal && <MovimientoModal onClose={() => setShowMovModal(false)} onDone={fetchAll} bodegas={bodegas} skus={skus} />}

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
                        <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 500 }}>{item.sku_nombre ?? item.sku_codigo ?? "—"}</td>
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
                  <thead><tr><TH c="Codigo" /><TH c="Nombre" /><TH c="Unidad" /><TH c="Stock min" /><TH c="Estado" /></tr></thead>
                  <tbody>
                    {filteredSkus.map((s: any) => (
                      <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--secondary)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "10px 16px", fontSize: 12, fontFamily: "monospace", color: "var(--muted-foreground)" }}>{s.codigo ?? "—"}</td>
                        <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 500 }}>{s.nombre}</td>
                        <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--muted-foreground)", textTransform: "capitalize" }}>{s.unidad_medida ?? "unidad"}</td>
                        <td style={{ padding: "10px 16px", fontSize: 13 }}>{s.stock_minimo ?? 5}</td>
                        <td style={{ padding: "10px 16px" }}>
                          <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.activo !== false ? "rgba(42,157,92,0.12)" : "rgba(100,116,139,0.12)", color: s.activo !== false ? "#34b96e" : "#94a3b8" }}>
                            {s.activo !== false ? "Activo" : "Inactivo"}
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
                      <td style={{ padding: "10px 16px", fontSize: 13, textTransform: "capitalize", color: "var(--muted-foreground)" }}>{m.tipo_movimiento ?? "—"}</td>
                      <td style={{ padding: "10px 16px", fontSize: 14, fontWeight: 700 }}>{m.cantidad ?? 0}</td>
                      <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--muted-foreground)" }}>{m.bodega_origen ?? "—"}</td>
                      <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--muted-foreground)" }}>{m.bodega_destino ?? "—"}</td>
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
      </div>
    </AppShell>
  );
}
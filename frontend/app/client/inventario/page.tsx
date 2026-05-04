"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";

const TABS = ["Bodega", "Movimientos"];

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

export default function InventarioPage() {
  const [activeTab, setActiveTab]     = useState("Bodega");
  const [inventario, setInventario]   = useState<any[]>([]);
  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<any>("/v1/app/inventario"),
      api.get<any>("/v1/app/movimientos"),
    ])
      .then(([inv, mov]) => {
        setInventario(Array.isArray(inv) ? inv : (inv?.data ?? []));
        setMovimientos(Array.isArray(mov) ? mov : (mov?.data ?? []));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="mb-6">
          <h1 className="text-xl font-bold">Inventario POP</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Materiales y stock de punto de venta
          </p>
        </div>

        <div className="flex mb-5" style={{ borderBottom: "1px solid var(--border)" }}>
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-2.5 text-sm font-medium"
              style={{
                borderBottom: activeTab === tab ? "2px solid var(--red)" : "2px solid transparent",
                color: activeTab === tab ? "var(--foreground)" : "var(--muted-foreground)",
                background: "none", cursor: "pointer", marginBottom: "-1px",
              }}>
              {tab}
            </button>
          ))}
        </div>

        {loading && <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>}

        {!loading && activeTab === "Bodega" && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <table className="w-full border-collapse">
              <thead style={{ background: "var(--secondary)" }}>
                <tr>
                  {["SKU", "Bodega", "Cliente final", "Cantidad", "Estado"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left"
                      style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inventario.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Sin stock registrado</td></tr>
                ) : inventario.map((item: any, i: number) => {
                  const estado = getEstado(item.cantidad);
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                      <td className="px-4 py-3.5 text-sm font-medium">{item.nombre ?? item.codigo ?? "—"}</td>
                      <td className="px-4 py-3.5 text-sm" style={{ color: "var(--muted-foreground)" }}>{item.bodega ?? "—"}</td>
                      <td className="px-4 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
                          {item.cliente_final ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-sm font-semibold">{item.cantidad}</td>
                      <td className="px-4 py-3.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase" style={ESTADO_STYLE[estado]}>{estado}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && activeTab === "Movimientos" && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <table className="w-full border-collapse">
              <thead style={{ background: "var(--secondary)" }}>
                <tr>
                  {["SKU", "Tipo", "Cantidad", "Bodega", "Proyecto", "Fecha"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left"
                      style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movimientos.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>Sin movimientos registrados</td></tr>
                ) : movimientos.map((m: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                    <td className="px-4 py-3.5 text-sm font-medium">{m.sku_nombre ?? "—"}</td>
                    <td className="px-4 py-3.5">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase"
                        style={["entrada","devolucion"].includes(m.tipo)
                          ? { background: "rgba(42,157,92,0.12)", color: "#34b96e" }
                          : { background: "rgba(200,32,44,0.12)", color: "#e8353f" }}>
                        {m.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-sm font-semibold">{m.cantidad}</td>
                    <td className="px-4 py-3.5 text-sm" style={{ color: "var(--muted-foreground)" }}>{m.bodega_nombre ?? "—"}</td>
                    <td className="px-4 py-3.5 text-sm" style={{ color: "var(--muted-foreground)" }}>{m.proyecto_nombre ?? "—"}</td>
                    <td className="px-4 py-3.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
                      {m.created_at ? new Date(m.created_at).toLocaleDateString("es-CL") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

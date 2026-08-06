"use client";

import { useState, useEffect, useMemo } from "react";
import AppShell from "@/components/layout/app-shell";
import { Search } from "lucide-react";
import { api } from "@/lib/api";

const TABS = ["Bodega", "Movimientos"];

const ESTADO_STYLE: Record<string, { bg: string; color: string }> = {
  ok:      { bg: "color-mix(in srgb, var(--success) 12%, transparent)",  color: "var(--success)" },
  OK:      { bg: "color-mix(in srgb, var(--success) 12%, transparent)",  color: "var(--success)" },
  bajo:    { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
  critico: { bg: "color-mix(in srgb, var(--danger) 12%, transparent)",  color: "var(--danger)" },
};

export default function InventarioPage() {
  const [activeTab, setActiveTab] = useState("Bodega");
  const [bodega, setBodega]       = useState<any[]>([]);
  const [movimientos, setMov]     = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<any>("/v1/app/inventario").catch(() => []),
      api.get<any>("/v1/app/movimientos").catch(() => []),
    ]).then(([b, m]) => {
      setBodega(Array.isArray(b) ? b : (b?.data ?? []));
      setMov(Array.isArray(m) ? m : (m?.data ?? []));
    }).finally(() => setLoading(false));
  }, []);

  const filteredBodega = useMemo(() => {
    if (!search.trim()) return bodega;
    const q = search.toLowerCase();
    return bodega.filter((item: any) =>
      (item.nombre ?? item.sku ?? "").toLowerCase().includes(q) ||
      (item.cliente_final ?? item.cliente ?? "").toLowerCase().includes(q)
    );
  }, [bodega, search]);

  const filteredMov = useMemo(() => {
    if (!search.trim()) return movimientos;
    const q = search.toLowerCase();
    return movimientos.filter((m: any) =>
      (m.nombre ?? m.sku ?? "").toLowerCase().includes(q) ||
      (m.tipo ?? "").toLowerCase().includes(q)
    );
  }, [movimientos, search]);

  return (
    <AppShell>
      <div className="animate-fade-up">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Inventario POP</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>Materiales y stock de punto de venta</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "var(--secondary)", border: "1px solid var(--border)", width: 280 }}>
            <Search size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar SKU, nombre, cliente..."
              className="outline-none bg-transparent text-sm w-full"
              style={{ color: "var(--foreground)" }}
            />
            {search && (
              <button onClick={() => setSearch("")}
                style={{ color: "var(--muted-foreground)", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
                x
              </button>
            )}
          </div>
        </div>

        <div className="flex mb-5" style={{ borderBottom: "1px solid var(--border)" }}>
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 500,
                borderTop: "none",
                borderLeft: "none",
                borderRight: "none",
                borderBottom: activeTab === tab ? "2px solid var(--primary)" : "2px solid transparent",
                color: activeTab === tab ? "var(--foreground)" : "var(--muted-foreground)",
                background: "none",
                cursor: "pointer",
                marginBottom: -1,
              }}>
              {tab}
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-center py-12" style={{ color: "var(--muted-foreground)" }}>Cargando...</div>
        )}

        {!loading && activeTab === "Bodega" && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <table className="w-full border-collapse">
              <thead style={{ background: "var(--secondary)" }}>
                <tr>
                  {["SKU", "Bodega", "Cliente Final", "Cantidad", "Estado"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left"
                      style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredBodega.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
                      {search ? `Sin resultados para "${search}"` : "Sin items en bodega"}
                    </td>
                  </tr>
                ) : filteredBodega.map((item: any, i: number) => {
                  const estado = item.estado ?? "ok";
                  const cfg = ESTADO_STYLE[estado] ?? ESTADO_STYLE.ok;
                  return (
                    <tr key={item.id ?? i}
                      style={{ borderBottom: "1px solid var(--border)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                      <td className="px-4 py-3 text-sm font-medium">{item.nombre ?? item.sku ?? "—"}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>{item.bodega_nombre ?? "—"}</td>
                      <td className="px-4 py-3 text-sm">{item.cliente_final ?? item.cliente ?? "—"}</td>
                      <td className="px-4 py-3 text-sm font-bold">{item.cantidad_actual ?? item.stock ?? item.cantidad ?? 0}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase"
                          style={{ background: cfg.bg, color: cfg.color }}>
                          {estado}
                        </span>
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
                  {["SKU", "Tipo", "Cantidad", "Bodega", "Fecha"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left"
                      style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMov.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
                      {search ? `Sin resultados para "${search}"` : "Sin movimientos registrados"}
                    </td>
                  </tr>
                ) : filteredMov.map((m: any, i: number) => (
                  <tr key={m.id ?? i}
                    style={{ borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                    <td className="px-4 py-3 text-sm font-medium">{m.nombre ?? m.sku ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{
                          background: m.tipo === "entrada" ? "color-mix(in srgb, var(--success) 12%, transparent)" : "rgba(79,70,229,0.10)",
                          color: m.tipo === "entrada" ? "var(--success)" : "var(--primary)"
                        }}>
                        {m.tipo ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold">{m.cantidad ?? 0}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>{m.bodega_nombre ?? "—"}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>
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
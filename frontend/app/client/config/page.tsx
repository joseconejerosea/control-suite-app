"use client";
import { useState, useEffect } from "react";
import {
  Settings, Warehouse, Link2, Building2,
  Save, Trash2, Eye, EyeOff, Copy, RefreshCw,
} from "lucide-react";
import GmailConnect from "@/components/integrations/gmail-connect";
import AffiliationCode from "@/components/integrations/affiliation-code";
import AppShell from "@/components/layout/app-shell";

// NEXT_PUBLIC_API_URL NO incluye /api (contrato de lib/api.ts). El /api se agrega acá.
const API = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api`;

function getToken() {
  try { return localStorage.getItem("cs_token") ?? ""; } catch { return ""; }
}
function getUser() {
  try { return JSON.parse(localStorage.getItem("cs_user") ?? "{}"); } catch { return {}; }
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "cuenta",       label: "Cuenta",       icon: Building2 },
  { id: "operaciones",  label: "Operaciones",   icon: Warehouse },
  { id: "integraciones",label: "Integraciones", icon: Link2 },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function ConfigPage() {
  const [tab, setTab]       = useState("cuenta");
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState<string | null>(null);

  // Cuenta
  const [cuenta, setCuenta] = useState({ nombre: "", rut: "", plan: "", email_contacto: "" });

  // Operaciones
  const [bodegas, setBodegas]   = useState<any[]>([]);
  const [canales, setCanales]   = useState<any[]>([]);

  // Integraciones
  const [apiToken, setApiToken]   = useState("");
  const [showToken, setShowToken] = useState(false);

  const user = getUser();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Load data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = { Authorization: `Bearer ${getToken()}` };

    // Workspace context (nombre, plan, rut)
    fetch(`${API}/workspace/context`, { headers: h })
      .then(r => r.json())
      // Backend wraps responses as { data, timestamp, path }; unwrap defensively.
      .then(res => {
        const d = res?.data ?? res;
        if (d?.client) {
          setCuenta(prev => ({
            ...prev,
            nombre: d.client.nombre ?? "",
            rut:    d.client.rut    ?? "",
            plan:   d.client.plan   ?? "basic",
          }));
        }
      }).catch(() => {});

    // Bodegas
    fetch(`${API}/v1/app/bodegas`, { headers: h })
      .then(r => r.json())
      .then(res => { const d = res?.data ?? res; if (Array.isArray(d)) setBodegas(d); })
      .catch(() => {});

    // Canales
    fetch(`${API}/canal-entrada`, { headers: h })
      .then(r => r.json())
      .then(res => { const d = res?.data ?? res; if (Array.isArray(d)) setCanales(d); })
      .catch(() => {});
  }, []);

  // ── Save handlers ───────────────────────────────────────────────────────────
  const saveCuenta = async () => {
    setSaving(true);
    try {
      await fetch(`${API}/clients/${user.client_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ nombre: cuenta.nombre, rut: cuenta.rut }),
      });
      showToast("Cuenta actualizada ✓");
    } catch { showToast("Error al guardar"); }
    finally { setSaving(false); }
  };

  const deleteBodega = async (id: string) => {
    await fetch(`${API}/v1/app/bodegas/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getToken()}` },
    }).catch(() => {});
    setBodegas(prev => prev.filter(b => b.id !== id));
    showToast("Bodega eliminada");
  };

  const copyToken = () => {
    navigator.clipboard.writeText(apiToken).then(() => showToast("Token copiado ✓")).catch(() => {});
  };

  // ── Render helpers ──────────────────────────────────────────────────────────
  const card = (children: React.ReactNode) => (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "1.25rem" }}>
      {children}
    </div>
  );

  const sectionTitle = (t: string) => (
    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>{t}</div>
  );

  const input = (val: string, onChange: (v: string) => void, placeholder = "", type = "text") => (
    <input
      type={type}
      value={val}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: 13, boxSizing: "border-box" }}
    />
  );

  const badge = (text: string, color = "var(--success)", bg?: string) => (
    <span style={{ fontSize: 11, background: bg ?? `color-mix(in srgb, ${color} 12%, transparent)`, color, borderRadius: 99, padding: "2px 8px", fontWeight: 600 }}>{text}</span>
  );

  // ── Tabs content ────────────────────────────────────────────────────────────

  // CUENTA
  const tabCuenta = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {card(<>
        {sectionTitle("Información de la empresa")}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 4 }}>Nombre empresa</label>
            {input(cuenta.nombre, v => setCuenta(p => ({ ...p, nombre: v })), "Control Suite Agency")}
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 4 }}>RUT</label>
            {input(cuenta.rut, v => setCuenta(p => ({ ...p, rut: v })), "76.123.456-7")}
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, color: "var(--muted-foreground)", display: "block", marginBottom: 4 }}>Plan actual</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {badge(cuenta.plan || "basic", "var(--brand-accent)")}
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Contacta a soporte para cambiar de plan</span>
          </div>
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={saveCuenta} disabled={saving}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 7, background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            <Save size={14} /> {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </>)}
    </div>
  );

  // OPERACIONES
  const tabOperaciones = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {card(<>
        {sectionTitle("Bodegas")}
        {bodegas.length === 0
          ? <div style={{ color: "var(--muted-foreground)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>Sin bodegas. Créalas desde Inventario POP.</div>
          : bodegas.map(b => (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <Warehouse size={15} style={{ color: "var(--muted-foreground)" }} />
              <span style={{ flex: 1, fontSize: 13 }}>{b.nombre}</span>
              {badge(b.tipo ?? "almacen")}
              <button onClick={() => deleteBodega(b.id)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted-foreground)", padding: 4 }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))
        }
      </>)}

      {card(<>
        {sectionTitle("Canales de entrada activos")}
        {canales.length === 0
          ? <div style={{ color: "var(--muted-foreground)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>Sin canales configurados. El admin los configura en onboarding.</div>
          : canales.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ flex: 1, fontSize: 13 }}>{c.nombre}</span>
              {badge(c.tipo, c.tipo === "whatsapp" ? "var(--success)" : "var(--brand-accent)")}
              {badge(c.is_active ? "activo" : "inactivo", c.is_active ? "var(--success)" : "var(--danger)")}
            </div>
          ))
        }
      </>)}

      {card(<>
        {sectionTitle("Diccionario OCR (equivalencias)")}
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Gestiona las equivalencias OCR desde la sección{" "}
          <a href="/client/equivalencias" style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 500 }}>Equivalencias OCR →</a>
        </div>
      </>)}

    </div>
  );

  // INTEGRACIONES
  const tabIntegraciones = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <GmailConnect onToast={showToast} />

      {/* Solo Manager (admin_cliente) o super_admin. El backend igual devuelve 403
          al resto; la card lo maneja mostrando un mensaje suave sin romper. */}
      {(user.role === "admin_cliente" || user.role === "super_admin") && (
        <AffiliationCode onToast={showToast} />
      )}

      {card(<>
        {sectionTitle("Google Sheets — destino de exportación")}
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Las exportaciones de F1, F2 y F5 se envían a la hoja definida en el canal de
          entrada del cliente (se configura en el onboarding). Requiere tener Gmail
          conectado arriba — se usa el mismo permiso para escribir en la hoja.
        </div>
      </>)}

      {card(<>
        {sectionTitle("API Token — acceso REST")}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, fontFamily: "monospace", fontSize: 12, padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {showToken ? (apiToken || "— genera un token primero —") : "••••••••••••••••••••••••••••••••"}
          </div>
          <button onClick={() => setShowToken(p => !p)}
            style={{ padding: 8, borderRadius: 7, border: "1px solid var(--border)", background: "none", cursor: "pointer", color: "var(--muted-foreground)" }}>
            {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button onClick={copyToken}
            style={{ padding: 8, borderRadius: 7, border: "1px solid var(--border)", background: "none", cursor: "pointer", color: "var(--muted-foreground)" }}>
            <Copy size={14} />
          </button>
          <button onClick={() => { const t = crypto.randomUUID().replace(/-/g,""); setApiToken(t); setShowToken(true); showToast("Token generado ✓"); }}
            style={{ padding: 8, borderRadius: 7, border: "1px solid var(--border)", background: "none", cursor: "pointer", color: "var(--muted-foreground)" }}>
            <RefreshCw size={14} />
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6 }}>
          Úsalo en el header <code style={{ background: "var(--secondary)", padding: "1px 5px", borderRadius: 4 }}>Authorization: Bearer &lt;token&gt;</code> para llamadas REST.
        </div>
      </>)}

      {card(<>
        {sectionTitle("Branding — reporte cliente F5")}
        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          El logo y colores del reporte de cliente se toman del perfil de empresa. Actualiza el nombre y RUT en la pestaña <b>Cuenta</b> para que aparezcan en el reporte.
        </div>
      </>)}
    </div>
  );

  const tabContent: Record<string, React.ReactNode> = {
    cuenta:        tabCuenta,
    operaciones:   tabOperaciones,
    integraciones: tabIntegraciones,
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <AppShell>
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <Settings size={20} />
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Configuración</h1>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {TABS.map(t => {
          const Icon    = t.icon;
          const active  = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: "7px 7px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 400,
                background: active ? "var(--card)" : "none",
                color:      active ? "var(--foreground)" : "var(--muted-foreground)",
                borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
              }}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tabContent[tab]}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: "var(--ink)", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
          {toast}
        </div>
      )}
    </div>
    </AppShell>
  );
}

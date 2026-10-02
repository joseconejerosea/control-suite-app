"use client";
import { useCallback, useEffect, useState } from "react";
import { Mail, Check, Loader2, Unplug } from "lucide-react";

// NEXT_PUBLIC_API_URL NO incluye /api (contrato de lib/api.ts, que hace
// `${BASE}/api${path}`). El /api se agrega acá — si se asume que la env ya lo
// trae, en dev/prod se pierde y todo da 404.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const API = `${BASE}/api`;

function getToken() {
  try { return localStorage.getItem("cs_token") ?? ""; } catch { return ""; }
}

type MailStatus = { connected: boolean; accounts: string[] };

export type MailProviderId = "gmail" | "outlook";

const PROVIDERS: Record<MailProviderId, { label: string; title: string; hint: string; perms: string }> = {
  gmail: {
    label: "Gmail",
    title: "Gmail — captura de comprobantes",
    hint: "Conectá la casilla para importar comprobantes y exportar a Sheets automáticamente.",
    perms: "Permisos: lectura de Gmail + escritura en Google Sheets. El consentimiento es único.",
  },
  outlook: {
    label: "Outlook",
    title: "Outlook — captura de comprobantes",
    hint: "Conectá la casilla de Outlook/Microsoft 365 para importar comprobantes por correo.",
    perms: "Permisos: lectura de correo (Mail.Read). No se pide acceso de escritura.",
  },
};

/**
 * Conexión OAuth de una casilla de correo (Gmail u Outlook) para el tenant del
 * usuario logueado.
 *
 * IMPORTANTE: el backend liga la conexión al `client_id` del JWT (nunca a un
 * tenant arbitrario). Por eso este componente solo es correcto cuando quien lo
 * usa ES el admin del cliente cuya casilla se conecta (p.ej. /client/config).
 */
export default function MailboxConnect({
  provider,
  onToast,
}: {
  provider: MailProviderId;
  onToast?: (msg: string) => void;
}) {
  const meta = PROVIDERS[provider];
  const [status, setStatus]   = useState<MailStatus>({ connected: false, accounts: [] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/auth/${provider}/status`, { headers: authHeader() });
      const d = await r.json();
      setStatus({
        connected: !!d?.connected,
        accounts: Array.isArray(d?.accounts) ? d.accounts : [],
      });
    } catch { /* silencioso — el status es best-effort */ }
    finally { setLoading(false); }
  }, [provider]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const connect = async () => {
    setWorking(true);
    try {
      const r = await fetch(`${API}/auth/${provider}/connect`, { headers: authHeader() });
      const d = await r.json();
      // Si el backend explica el motivo (p.ej. proveedor no configurado en el entorno),
      // mostramos ESE mensaje en vez del genérico — así se distingue config de bug.
      if (!d?.url) {
        onToast?.(d?.error?.message ?? d?.message ?? "No se pudo iniciar la conexión");
        setWorking(false);
        return;
      }
      const popup = window.open(d.url, `${provider}-oauth`, "width=520,height=660");
      // El callback del backend se muestra en el popup y guarda los tokens server-side.
      // Detectamos el cierre del popup y refrescamos el estado.
      const timer = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(timer);
          setWorking(false);
          loadStatus();
        }
      }, 700);
    } catch {
      onToast?.("Error al iniciar la conexión");
      setWorking(false);
    }
  };

  const disconnect = async () => {
    setWorking(true);
    try {
      await fetch(`${API}/auth/${provider}/disconnect`, { method: "DELETE", headers: authHeader() });
      onToast?.(`${meta.label} desconectado`);
      await loadStatus();
    } catch {
      onToast?.("Error al desconectar");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Mail size={15} style={{ color: "var(--muted-foreground)" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {meta.title}
        </span>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted-foreground)", fontSize: 13 }}>
          <Loader2 size={14} className="animate-spin" /> Cargando estado…
        </div>
      ) : status.connected ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)", borderRadius: 99, padding: "3px 9px", fontWeight: 600 }}>
              <Check size={12} /> Conectado
            </span>
            <span style={{ fontSize: 13, color: "var(--foreground)" }}>
              {status.accounts.join(", ") || "cuenta conectada"}
            </span>
          </div>
          <button onClick={disconnect} disabled={working}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 7, background: "none", color: "var(--muted-foreground)", border: "1px solid var(--border)", cursor: working ? "default" : "pointer", fontSize: 13, fontWeight: 500, opacity: working ? 0.6 : 1 }}>
            {working ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />} Desconectar
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
            {meta.hint}
          </span>
          <button onClick={connect} disabled={working}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 7, background: "var(--primary)", color: "#fff", border: "none", cursor: working ? "default" : "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", opacity: working ? 0.7 : 1 }}>
            {working ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Conectar {meta.label}
          </button>
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
        {meta.perms}
      </div>
    </div>
  );
}

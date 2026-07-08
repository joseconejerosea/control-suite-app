"use client";
import { useCallback, useEffect, useState } from "react";
import { Mail, Check, Loader2, Unplug } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

function getToken() {
  try { return localStorage.getItem("cs_token") ?? ""; } catch { return ""; }
}

type GmailStatus = { connected: boolean; accounts: string[] };

/**
 * Conexión OAuth de Gmail para el tenant del usuario logueado.
 *
 * IMPORTANTE: el backend liga la conexión al `client_id` del JWT (nunca a un
 * tenant arbitrario). Por eso este componente solo es correcto cuando quien lo
 * usa ES el admin del cliente cuya casilla se conecta (p.ej. /client/config).
 * Un mismo consentimiento cubre Gmail (lectura) + Sheets (exportación).
 */
export default function GmailConnect({ onToast }: { onToast?: (msg: string) => void }) {
  const [status, setStatus]   = useState<GmailStatus>({ connected: false, accounts: [] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/auth/gmail/status`, { headers: authHeader() });
      const d = await r.json();
      setStatus({
        connected: !!d?.connected,
        accounts: Array.isArray(d?.accounts) ? d.accounts : [],
      });
    } catch { /* silencioso — el status es best-effort */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const connect = async () => {
    setWorking(true);
    try {
      const r = await fetch(`${API}/auth/gmail/connect`, { headers: authHeader() });
      const d = await r.json();
      if (!d?.url) { onToast?.("No se pudo iniciar la conexión"); setWorking(false); return; }
      const popup = window.open(d.url, "gmail-oauth", "width=520,height=660");
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
      await fetch(`${API}/auth/gmail/disconnect`, { method: "DELETE", headers: authHeader() });
      onToast?.("Gmail desconectado");
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
          Gmail — captura de comprobantes
        </span>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted-foreground)", fontSize: 13 }}>
          <Loader2 size={14} className="animate-spin" /> Cargando estado…
        </div>
      ) : status.connected ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, background: "#2a9d5c22", color: "#2a9d5c", borderRadius: 99, padding: "3px 9px", fontWeight: 600 }}>
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
            Conectá la casilla para importar comprobantes y exportar a Sheets automáticamente.
          </span>
          <button onClick={connect} disabled={working}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 7, background: "var(--red, #C8202C)", color: "#fff", border: "none", cursor: working ? "default" : "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", opacity: working ? 0.7 : 1 }}>
            {working ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Conectar Gmail
          </button>
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
        Permisos: lectura de Gmail + escritura en Google Sheets. El consentimiento es único.
      </div>
    </div>
  );
}

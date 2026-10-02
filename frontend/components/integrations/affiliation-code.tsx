"use client";
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Copy, RefreshCw, Loader2, AlertTriangle, MessageCircle } from "lucide-react";
import { api } from "@/lib/api";
import { WHATSAPP_NUMBER, WHATSAPP_WA_ME } from "@/lib/whatsapp";

type AffiliationCodeResponse = { affiliation_code: string };
// The backend wraps success responses as { data: <payload>, timestamp, path }.
// Unwrap defensively (fall back to a flat shape) — same convention as lib/api's refresh.
type Enveloped = { data?: AffiliationCodeResponse } & Partial<AffiliationCodeResponse>;
function pickCode(res: Enveloped | undefined): string {
  return res?.data?.affiliation_code ?? res?.affiliation_code ?? "";
}

/**
 * Código de afiliación WhatsApp del tenant del usuario logueado.
 *
 * Es el código que promotores/anfitrionas escriben por WhatsApp para afiliarse
 * a esta agencia. Solo Manager (role="admin_cliente") o super_admin pueden
 * verlo/rotarlo; el backend liga el código al `client_id` del JWT y devuelve
 * 403 al resto. Si un operador llegara a ver la card, el GET falla y mostramos
 * un mensaje suave en lugar de romper la página.
 */
export default function AffiliationCode({ onToast }: { onToast?: (msg: string) => void }) {
  const [code, setCode]       = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.get<Enveloped>("/workspace/affiliation-code");
      setCode(pickCode(d));
    } catch {
      // 403 (no es Manager/admin) u otro error → mensaje suave, sin romper.
      setError("No tenés permisos para ver el código de afiliación, o no se pudo cargar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const copy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code)
      .then(() => onToast?.("Código copiado ✓"))
      .catch(() => onToast?.("No se pudo copiar"));
  };

  const doRotate = async () => {
    setRotating(true);
    try {
      const d = await api.post<Enveloped>("/workspace/affiliation-code/rotate");
      setCode(pickCode(d));
      onToast?.("Código rotado ✓");
      setShowConfirm(false);
    } catch {
      onToast?.("No se pudo rotar el código");
    } finally {
      setRotating(false);
    }
  };

  return (
    <>
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <KeyRound size={15} style={{ color: "var(--muted-foreground)" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Código de afiliación
        </span>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted-foreground)", fontSize: 13 }}>
          <Loader2 size={14} className="animate-spin" /> Cargando código…
        </div>
      ) : error ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted-foreground)", fontSize: 13 }}>
          <AlertTriangle size={14} style={{ color: "var(--warning, var(--muted-foreground))" }} /> {error}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, fontFamily: "monospace", fontSize: 16, fontWeight: 600, letterSpacing: "0.08em", padding: "10px 14px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {code || "— sin código —"}
            </div>
            <button onClick={copy} disabled={!code} title="Copiar"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "none", cursor: code ? "pointer" : "default", color: "var(--muted-foreground)", fontSize: 13, fontWeight: 500, opacity: code ? 1 : 0.5 }}>
              <Copy size={14} /> Copiar
            </button>
            <button onClick={() => setShowConfirm(true)} disabled={rotating} title="Rotar código"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "none", cursor: rotating ? "default" : "pointer", color: "var(--muted-foreground)", fontSize: 13, fontWeight: 500, opacity: rotating ? 0.6 : 1 }}>
              {rotating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Rotar código
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "10px 14px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--secondary)" }}>
            <MessageCircle size={15} style={{ color: "var(--success)", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Tu staff le escribe a</span>
            <a href={WHATSAPP_WA_ME} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", textDecoration: "none" }}>
              {WHATSAPP_NUMBER}
            </a>
          </div>

          <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
            Es el código que promotores y anfitrionas escriben por WhatsApp (al número de arriba) para afiliarse a esta agencia. Compartilo solo con tu staff. Al rotarlo, el código anterior deja de funcionar.
          </div>
        </>
      )}
    </div>

    {showConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => !rotating && setShowConfirm(false)}>
        <div className="rounded-2xl border p-6 w-full max-w-sm" style={{ background: "var(--card)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <RefreshCw size={16} style={{ color: "var(--foreground)" }} />
            <h3 style={{ fontWeight: 700, color: "var(--foreground)", margin: 0 }}>Rotar código de afiliación</h3>
          </div>
          <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5, margin: 0 }}>
            El código actual (<span style={{ fontFamily: "monospace", fontWeight: 600 }}>{code || "—"}</span>) dejará de funcionar. El staff que aún no se afilió deberá usar el código nuevo. Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-2" style={{ marginTop: 18 }}>
            <button onClick={() => setShowConfirm(false)} disabled={rotating}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: rotating ? "default" : "pointer", fontWeight: 500 }}>
              Cancelar
            </button>
            <button onClick={doRotate} disabled={rotating}
              style={{ flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 10, borderRadius: 8, border: "none", background: "var(--danger, #dc2626)", color: "#fff", cursor: rotating ? "default" : "pointer", fontWeight: 600, opacity: rotating ? 0.7 : 1 }}>
              {rotating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Rotar código
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

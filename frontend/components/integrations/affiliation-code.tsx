"use client";
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Copy, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

type AffiliationCodeResponse = { affiliation_code: string };

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.get<AffiliationCodeResponse>("/workspace/affiliation-code");
      setCode(d?.affiliation_code ?? "");
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

  const rotate = async () => {
    const ok = window.confirm(
      "Rotar el código INVALIDA el código anterior. El staff que aún no se afilió deberá usar el nuevo código. ¿Continuar?",
    );
    if (!ok) return;
    setRotating(true);
    try {
      const d = await api.post<AffiliationCodeResponse>("/workspace/affiliation-code/rotate");
      setCode(d?.affiliation_code ?? "");
      onToast?.("Código rotado ✓");
    } catch {
      onToast?.("No se pudo rotar el código");
    } finally {
      setRotating(false);
    }
  };

  return (
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
            <button onClick={rotate} disabled={rotating} title="Rotar código"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "none", cursor: rotating ? "default" : "pointer", color: "var(--muted-foreground)", fontSize: 13, fontWeight: 500, opacity: rotating ? 0.6 : 1 }}>
              {rotating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Rotar código
            </button>
          </div>

          <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
            Es el código que promotores y anfitrionas escriben por WhatsApp para afiliarse a esta agencia. Compartilo solo con tu staff. Al rotarlo, el código anterior deja de funcionar.
          </div>
        </>
      )}
    </div>
  );
}

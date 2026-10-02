"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";

/**
 * T2 · Aviso "sin activación activa".
 *
 * Una agencia sin activaciones agendadas parece "desconectada": el bot de terreno
 * responde "no veo activación" a las fotos de material/evidencia, sin que el Manager
 * entienda por qué. Este aviso lo hace explícito y accionable.
 *
 * CRITERIO ESPEJADO del gate del bot en
 * `backend/src/modules/whatsapp/evidence-intake.service.ts` (y material-intake):
 * `status IN ('scheduled','in_progress') AND estado_f5 IS DISTINCT FROM 'cerrada'`,
 * SIN filtro de fecha. Fuente de verdad = ese servicio; si el gate cambia allá, hay
 * que actualizar `isActive` acá o el aviso miente. Se cuenta client-side sobre el
 * endpoint existente `/activations` para no agregar superficie de backend.
 */
function isActive(a: { status?: string; estado_f5?: string | null }): boolean {
  const status = String(a?.status ?? "");
  // `!== 'cerrada'` refleja `IS DISTINCT FROM 'cerrada'`: un estado_f5 null/undefined
  // cuenta como activo en ambos lados.
  return (
    (status === "scheduled" || status === "in_progress") &&
    a?.estado_f5 !== "cerrada"
  );
}

export default function NoActiveActivationBanner() {
  const [activeCount, setActiveCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<unknown>("/activations")
      .then((r) => {
        const list = Array.isArray(r)
          ? r
          : ((r as { data?: unknown })?.data ?? []);
        if (alive) {
          setActiveCount(Array.isArray(list) ? list.filter(isActive).length : 0);
        }
      })
      .catch(() => {
        /* fail-silent: un fetch fallido nunca debe romper el dashboard */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Oculto mientras carga (null) o si hay al menos una activación activa.
  if (activeCount === null || activeCount > 0) return null;

  return (
    <div
      className="flex items-start gap-3 rounded-xl p-4 mb-5 flex-wrap"
      style={{
        background: "color-mix(in srgb, var(--warning) 10%, transparent)",
        border: "1px solid color-mix(in srgb, var(--warning) 40%, var(--border))",
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "color-mix(in srgb, var(--warning) 18%, transparent)" }}
      >
        <Activity size={16} style={{ color: "var(--warning)" }} />
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          No tenés activaciones activas ahora
        </div>
        <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
          El bot de terreno (material y evidencia por WhatsApp) no va a reconocer los
          envíos de tu staff hasta que tengas una activación agendada y en curso.
        </div>
      </div>
      <Link
        href="/client/activaciones"
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium shrink-0"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--foreground)",
          textDecoration: "none",
        }}
      >
        Gestionar activaciones <ArrowRight size={13} />
      </Link>
    </div>
  );
}

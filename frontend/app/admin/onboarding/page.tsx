"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { WHATSAPP_NUMBER, WHATSAPP_WA_ME } from "@/lib/whatsapp";
import { CheckCircle, Building2, UserPlus, Rocket, ArrowRight, ArrowLeft, MessageCircle } from "lucide-react";

type StepData = { client?: Record<string, string>; admin?: Record<string, string> };

// Single global WhatsApp number model: onboarding no longer configures channels.
// WhatsApp works automatically (the client hands out its affiliation code); email is
// connected later by the Manager in Configuración (Gmail). So the flow is just:
//   1. Create client (gets an affiliation code)  2. Create admin  3. Activate.
const STEPS = [
  { id: 1, label: "Cliente", icon: Building2, title: "Crear Cliente",    sub: "Configura el workspace de la empresa" },
  { id: 2, label: "Admin",   icon: UserPlus,  title: "Crear Admin",      sub: "Primer administrador del cliente" },
  { id: 3, label: "Listo",   icon: Rocket,    title: "Activar Cliente",  sub: "El cliente entra en produccion" },
];

function Field({ label, type = "text", placeholder, value, onChange, required, hint }: {
  label: string; type?: string; placeholder?: string;
  value: string; onChange: (v: string) => void; required?: boolean; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>{label}{required && " *"}</label>
      <input type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
        style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
      {hint && <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>{hint}</p>}
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
        style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export default function OnboardingPage() {
  const [step, setStep]       = useState(1);
  const [data, setData]       = useState<StepData>({});
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const router = useRouter();

  const [client, setClient] = useState({ nombre: "", plan: "basic", rut: "" });
  const [admin, setAdmin]   = useState({ email: "", password: "", full_name: "" });

  const run = async (action: () => Promise<void>) => {
    setError(""); setLoading(true);
    try { await action(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  };

  const step1 = () => run(async () => {
    const res = await api.post<any>("/clients", {
      nombre: client.nombre, plan: client.plan, rut: client.rut || undefined,
    });
    setData((d) => ({ ...d, client: res?.data ?? res }));
    setStep(2);
  });

  const step2 = () => run(async () => {
    const clientId = data.client?.id;
    const res = await api.post<any>(`/onboarding/${clientId}/create-admin`, {
      email: admin.email, password: admin.password, full_name: admin.full_name || undefined,
    });
    setData((d) => ({ ...d, admin: res?.data ?? res }));
    setStep(3);
  });

  const step3 = () => run(async () => {
    await api.post(`/onboarding/${data.client?.id}/complete`, {});
    router.push("/admin/dashboard");
  });

  const Btn = ({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) => (
    <button onClick={onClick} disabled={disabled || loading}
      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 transition-all"
      style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 4px 14px rgba(79,70,229,0.3)" }}>
      {loading
        ? <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
        : children}
    </button>
  );

  return (
    <AppShell>
      <div className="max-w-xl mx-auto">

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-0 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5" style={{ width: 72 }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                  style={{
                    border:     `2px solid ${step > s.id ? "var(--success)" : step === s.id ? "var(--primary)" : "var(--border)"}`,
                    background: step > s.id ? "color-mix(in srgb, var(--success) 12%, transparent)" : step === s.id ? "rgba(79,70,229,0.10)" : "transparent",
                    color:      step > s.id ? "var(--success)" : step === s.id ? "var(--primary)" : "var(--muted-foreground)",
                  }}>
                  {step > s.id ? <CheckCircle size={16} /> : <s.icon size={14} />}
                </div>
                <span className="text-center leading-tight" style={{
                  fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px",
                  color: step === s.id ? "var(--foreground)" : "var(--muted-foreground)",
                }}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ width: 32, height: 2, marginBottom: 18, background: step > s.id ? "var(--success)" : "var(--border)", transition: "background 0.3s" }} />
              )}
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-7 border animate-fade-up" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="mb-6">
            <h2 className="text-lg font-bold mb-1">{STEPS[step - 1].title}</h2>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>{STEPS[step - 1].sub}</p>
          </div>

          {error && (
            <div className="mb-4 text-xs px-3 py-2 rounded-lg" style={{ background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" }}>
              {error}
            </div>
          )}

          {/* Step 1 — Create client */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Field label="Nombre empresa" required value={client.nombre} onChange={(v) => setClient((c) => ({ ...c, nombre: v }))} placeholder="Acme Corp" />
              <Field label="RUT" value={client.rut} onChange={(v) => setClient((c) => ({ ...c, rut: v }))} placeholder="76.123.456-7" />
              <SelectField label="Plan" value={client.plan} onChange={(v) => setClient((c) => ({ ...c, plan: v }))} options={[
                { value: "basic", label: "Basic" },
                { value: "pro", label: "Pro" },
                { value: "enterprise", label: "Enterprise" },
              ]} />
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                WhatsApp queda listo automáticamente: el staff del cliente le escribe al número{" "}
                <strong style={{ color: "var(--foreground)" }}>{WHATSAPP_NUMBER}</strong> con el código de afiliación. El correo se conecta después desde Configuración (Gmail).
              </p>
              <Btn onClick={step1} disabled={!client.nombre}><span>Crear cliente</span><ArrowRight size={14} /></Btn>
            </div>
          )}

          {/* Step 2 — Create admin */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <Field label="Nombre completo" value={admin.full_name} onChange={(v) => setAdmin((a) => ({ ...a, full_name: v }))} placeholder="Jane Smith" />
              <Field label="Email" type="email" required value={admin.email} onChange={(v) => setAdmin((a) => ({ ...a, email: v }))} placeholder="admin@empresa.com" />
              <Field label="Password" type="password" required value={admin.password} onChange={(v) => setAdmin((a) => ({ ...a, password: v }))} placeholder="Minimo 8 caracteres" />
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm"
                  style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>
                  <ArrowLeft size={13} /> Atras
                </button>
                <Btn onClick={step2} disabled={!admin.email || !admin.password}>
                  <UserPlus size={14} /><span>Crear admin</span>
                </Btn>
              </div>
            </div>
          )}

          {/* Step 3 — Activate */}
          {step === 3 && (
            <div className="flex flex-col items-center gap-5 text-center py-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "color-mix(in srgb, var(--success) 12%, transparent)", border: "2px solid var(--success)" }}>
                <CheckCircle size={32} style={{ color: "var(--success)" }} />
              </div>
              <div>
                <h3 className="font-bold text-base mb-2">Configuracion completa</h3>
                <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                  <strong style={{ color: "var(--foreground)" }}>{data.client?.nombre}</strong> esta configurado.<br />
                  Admin <strong style={{ color: "var(--foreground)" }}>{data.admin?.email}</strong> creado.
                </p>
              </div>
              <div className="w-full rounded-xl p-4 flex flex-col items-center gap-1.5"
                style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
                <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  El staff del cliente le escribe por WhatsApp a
                </span>
                <a href={WHATSAPP_WA_ME} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-base font-semibold"
                  style={{ color: "var(--foreground)", textDecoration: "none" }}>
                  <MessageCircle size={16} style={{ color: "var(--success)" }} />
                  {WHATSAPP_NUMBER}
                </a>
                <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                  con su código de afiliación.
                </span>
              </div>
              <Btn onClick={step3}><Rocket size={14} /><span>Activar cliente</span></Btn>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

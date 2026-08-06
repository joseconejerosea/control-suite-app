"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/app-shell";
import { api } from "@/lib/api";
import { CheckCircle, Building2, Radio, ShieldCheck, UserPlus, Rocket, ArrowRight, ArrowLeft, Sheet, Phone } from "lucide-react";

type StepData = { client?: Record<string, string>; channel?: Record<string, string>; admin?: Record<string, string> };

const STEPS = [
  { id: 1, label: "Client",  icon: Building2,  title: "Crear Cliente",    sub: "Configura el workspace de la empresa" },
  { id: 2, label: "Canal",   icon: Radio,       title: "Configurar Canal", sub: "Canal de entrada y Google Sheet" },
  { id: 3, label: "Verify",  icon: ShieldCheck, title: "Verificar Canal",  sub: "Confirmar que el canal esta activo" },
  { id: 4, label: "Admin",   icon: UserPlus,    title: "Crear Admin",      sub: "Primer administrador del cliente" },
  { id: 5, label: "Listo",   icon: Rocket,      title: "Activar Cliente",  sub: "El cliente entra en produccion" },
];

const COUNTRY_CODES = [
  { cc: "54",  flag: "AR", name: "Argentina" },
  { cc: "591", flag: "BO", name: "Bolivia" },
  { cc: "55",  flag: "BR", name: "Brazil" },
  { cc: "56",  flag: "CL", name: "Chile" },
  { cc: "57",  flag: "CO", name: "Colombia" },
  { cc: "506", flag: "CR", name: "Costa Rica" },
  { cc: "53",  flag: "CU", name: "Cuba" },
  { cc: "593", flag: "EC", name: "Ecuador" },
  { cc: "503", flag: "SV", name: "El Salvador" },
  { cc: "502", flag: "GT", name: "Guatemala" },
  { cc: "504", flag: "HN", name: "Honduras" },
  { cc: "52",  flag: "MX", name: "Mexico" },
  { cc: "505", flag: "NI", name: "Nicaragua" },
  { cc: "507", flag: "PA", name: "Panama" },
  { cc: "595", flag: "PY", name: "Paraguay" },
  { cc: "51",  flag: "PE", name: "Peru" },
  { cc: "1787",flag: "PR", name: "Puerto Rico" },
  { cc: "1",   flag: "US", name: "United States" },
  { cc: "44",  flag: "GB", name: "United Kingdom" },
  { cc: "34",  flag: "ES", name: "Spain" },
  { cc: "598", flag: "UY", name: "Uruguay" },
  { cc: "58",  flag: "VE", name: "Venezuela" },
  { cc: "92",  flag: "PK", name: "Pakistan" },
  { cc: "91",  flag: "IN", name: "India" },
  { cc: "62",  flag: "ID", name: "Indonesia" },
  { cc: "212", flag: "MA", name: "Morocco" },
  { cc: "234", flag: "NG", name: "Nigeria" },
  { cc: "27",  flag: "ZA", name: "South Africa" },
  { cc: "20",  flag: "EG", name: "Egypt" },
  { cc: "49",  flag: "DE", name: "Germany" },
  { cc: "33",  flag: "FR", name: "France" },
  { cc: "39",  flag: "IT", name: "Italy" },
  { cc: "31",  flag: "NL", name: "Netherlands" },
  { cc: "351", flag: "PT", name: "Portugal" },
  { cc: "7",   flag: "RU", name: "Russia" },
  { cc: "86",  flag: "CN", name: "China" },
  { cc: "81",  flag: "JP", name: "Japan" },
  { cc: "82",  flag: "KR", name: "South Korea" },
  { cc: "966", flag: "SA", name: "Saudi Arabia" },
  { cc: "971", flag: "AE", name: "UAE" },
  { cc: "972", flag: "IL", name: "Israel" },
  { cc: "90",  flag: "TR", name: "Turkey" },
  { cc: "380", flag: "UA", name: "Ukraine" },
  { cc: "61",  flag: "AU", name: "Australia" },
  { cc: "64",  flag: "NZ", name: "New Zealand" },
  { cc: "63",  flag: "PH", name: "Philippines" },
  { cc: "66",  flag: "TH", name: "Thailand" },
  { cc: "84",  flag: "VN", name: "Vietnam" },
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

function genSecret() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function extractSheetId(input: string): string {
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : input.trim();
}

export default function OnboardingPage() {
  const [step, setStep]       = useState(1);
  const [data, setData]       = useState<StepData>({});
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const router = useRouter();

  const [client, setClient] = useState({ nombre: "", plan: "basic", rut: "" });
  const [channel, setChan]  = useState({ nombre: "", tipo: "email", sheets_url: "" });
  const [admin, setAdmin]   = useState({ email: "", password: "", full_name: "" });

  const [waForm, setWaForm] = useState({ cc: "56", phone_number: "", verified_name: "" });
  const [otp, setOtp]       = useState("");
  const [waStep, setWaStep] = useState<"provision" | "verify">("provision");

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
    const sheetsId = extractSheetId(channel.sheets_url);
    const res = await api.post<any>(`/onboarding/${clientId}/configure-channel`, {
      nombre: channel.nombre,
      tipo:   channel.tipo,
      config: { webhook_secret: genSecret(), sheets_id: sheetsId || undefined },
    });
    setData((d) => ({ ...d, channel: res?.data ?? res }));
    setWaStep("provision");
    setStep(3);
  });

  const stepWaProvision = () => run(async () => {
    const clientId  = data.client?.id;
    const channelId = data.channel?.id;
    await api.post(`/onboarding/${clientId}/provision-whatsapp/${channelId}`, {
      cc:            waForm.cc,
      phone_number:  waForm.phone_number,
      verified_name: waForm.verified_name,
      code_method:   "SMS",
    });
    setWaStep("verify");
  });

  const stepWaVerify = () => run(async () => {
    const clientId  = data.client?.id;
    const channelId = data.channel?.id;
    await api.post(`/onboarding/${clientId}/verify-whatsapp-otp/${channelId}`, { code: otp });
    setStep(4);
  });

  const stepVerify = () => run(async () => {
    const clientId  = data.client?.id;
    const channelId = data.channel?.id;
    await api.post(`/onboarding/${clientId}/verify-channel/${channelId}`, {});
    setStep(4);
  });

  const step4 = () => run(async () => {
    const clientId = data.client?.id;
    const res = await api.post<any>(`/onboarding/${clientId}/create-admin`, {
      email: admin.email, password: admin.password, full_name: admin.full_name || undefined,
    });
    setData((d) => ({ ...d, admin: res?.data ?? res }));
    setStep(5);
  });

  const step5 = () => run(async () => {
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

  const isWA = channel.tipo === "whatsapp";

  const selectedCountry = COUNTRY_CODES.find(c => c.cc === waForm.cc);

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

          {/* Step 1 */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Field label="Nombre empresa" required value={client.nombre} onChange={(v) => setClient((c) => ({ ...c, nombre: v }))} placeholder="Acme Corp" />
              <Field label="RUT" value={client.rut} onChange={(v) => setClient((c) => ({ ...c, rut: v }))} placeholder="76.123.456-7" />
              <SelectField label="Plan" value={client.plan} onChange={(v) => setClient((c) => ({ ...c, plan: v }))} options={[
                { value: "basic", label: "Basic" },
                { value: "pro", label: "Pro" },
                { value: "enterprise", label: "Enterprise" },
              ]} />
              <Btn onClick={step1} disabled={!client.nombre}><span>Crear cliente</span><ArrowRight size={14} /></Btn>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <Field label="Nombre del canal" required value={channel.nombre} onChange={(v) => setChan((c) => ({ ...c, nombre: v }))} placeholder="Canal principal" />
              <SelectField label="Tipo" value={channel.tipo} onChange={(v) => setChan((c) => ({ ...c, tipo: v }))} options={[
                { value: "email",    label: "Email" },
                { value: "whatsapp", label: "WhatsApp" },
                { value: "generic",  label: "Generic" },
              ]} />
              <div className="rounded-xl p-4 border" style={{ borderColor: "var(--border)", background: "var(--secondary)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <Sheet size={14} style={{ color: "var(--muted-foreground)" }} />
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Google Sheet (opcional)</span>
                </div>
                <Field label="URL o ID de la hoja" value={channel.sheets_url}
                  onChange={(v) => setChan((c) => ({ ...c, sheets_url: v }))}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  hint="Las facturas procesadas se exportaran automaticamente a esta hoja." />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm"
                  style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>
                  <ArrowLeft size={13} /> Atras
                </button>
                <Btn onClick={step2} disabled={!channel.nombre}><span>Configurar</span><ArrowRight size={14} /></Btn>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              <div className="p-4 rounded-xl text-sm" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
                <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Canal configurado</div>
                <div style={{ color: "var(--muted-foreground)" }}>Nombre: <span style={{ color: "var(--foreground)" }}>{data.channel?.nombre}</span></div>
                <div style={{ color: "var(--muted-foreground)" }}>Tipo: <span style={{ color: "var(--foreground)" }}>{data.channel?.tipo}</span></div>
              </div>

              {isWA ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 pb-2" style={{ borderBottom: "1px solid var(--border)" }}>
                    <Phone size={14} style={{ color: "var(--primary)" }} />
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
                      {waStep === "provision" ? "Registrar numero WhatsApp" : "Verificar OTP"}
                    </span>
                  </div>

                  {waStep === "provision" && (
                    <>
                      {/* Country code dropdown */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>Pais *</label>
                        <select
                          value={waForm.cc}
                          onChange={(e) => setWaForm((f) => ({ ...f, cc: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                          style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                          {COUNTRY_CODES.map((c) => (
                            <option key={c.cc + c.flag} value={c.cc}>
                              {c.name} (+{c.cc})
                            </option>
                          ))}
                        </select>
                        {selectedCountry && (
                          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                            Codigo: +{selectedCountry.cc}
                          </p>
                        )}
                      </div>

                      <Field label="Numero de telefono *" required value={waForm.phone_number}
                        onChange={(v) => setWaForm((f) => ({ ...f, phone_number: v }))}
                        placeholder="912345678"
                        hint={`Sin codigo de pais. Numero completo: +${waForm.cc}${waForm.phone_number || "XXXXXXXXX"}`} />

                      <Field label="Nombre verificado *" required value={waForm.verified_name}
                        onChange={(v) => setWaForm((f) => ({ ...f, verified_name: v }))}
                        placeholder="Acme Corp BTL"
                        hint="Nombre que aparecera en WhatsApp Business. Debe coincidir con el nombre en Meta." />

                      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                        Se enviara un codigo OTP via SMS al numero ingresado para verificar con Meta WhatsApp Business API.
                      </p>

                      <div className="flex gap-3">
                        <button onClick={() => setStep(2)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm"
                          style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>
                          <ArrowLeft size={13} /> Atras
                        </button>
                        <Btn onClick={stepWaProvision} disabled={!waForm.phone_number || !waForm.verified_name}>
                          <span>Enviar OTP</span><ArrowRight size={14} />
                        </Btn>
                      </div>
                    </>
                  )}

                  {waStep === "verify" && (
                    <>
                      <div className="p-3 rounded-lg text-xs"
                        style={{ background: "color-mix(in srgb, var(--success) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--success) 20%, transparent)", color: "var(--success)" }}>
                        Codigo OTP enviado a +{waForm.cc} {waForm.phone_number}. Revisa tus mensajes SMS.
                      </div>
                      <Field label="Codigo OTP *" required value={otp} onChange={setOtp}
                        placeholder="123456" hint="Codigo de 6 digitos recibido por SMS de Meta." />
                      <div className="flex gap-3">
                        <button onClick={() => setWaStep("provision")} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm"
                          style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>
                          <ArrowLeft size={13} /> Reenviar
                        </button>
                        <Btn onClick={stepWaVerify} disabled={otp.length !== 6}>
                          <ShieldCheck size={14} /><span>Verificar numero</span>
                        </Btn>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                    Verifica que el canal este correctamente configurado.
                  </p>
                  <div className="flex gap-3">
                    <button onClick={() => setStep(2)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm"
                      style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>
                      <ArrowLeft size={13} /> Atras
                    </button>
                    <Btn onClick={stepVerify}><ShieldCheck size={14} /><span>Verificar canal</span></Btn>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <div className="flex flex-col gap-4">
              <Field label="Nombre completo" value={admin.full_name} onChange={(v) => setAdmin((a) => ({ ...a, full_name: v }))} placeholder="Jane Smith" />
              <Field label="Email" type="email" required value={admin.email} onChange={(v) => setAdmin((a) => ({ ...a, email: v }))} placeholder="admin@empresa.com" />
              <Field label="Password" type="password" required value={admin.password} onChange={(v) => setAdmin((a) => ({ ...a, password: v }))} placeholder="Minimo 8 caracteres" />
              <div className="flex gap-3">
                <button onClick={() => setStep(3)} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm"
                  style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>
                  <ArrowLeft size={13} /> Atras
                </button>
                <Btn onClick={step4} disabled={!admin.email || !admin.password}>
                  <UserPlus size={14} /><span>Crear admin</span>
                </Btn>
              </div>
            </div>
          )}

          {/* Step 5 */}
          {step === 5 && (
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
              <Btn onClick={step5}><Rocket size={14} /><span>Activar cliente</span></Btn>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
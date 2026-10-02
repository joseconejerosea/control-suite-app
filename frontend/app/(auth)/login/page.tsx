"use client";

import { useState } from "react";
import { api, saveAuth } from "@/lib/api";
import { Zap, Eye, EyeOff } from "lucide-react";

function parseJwt(token: string) {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPass]     = useState("");
  const [show, setShow]         = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post<any>("/auth/login", { email, password });
      const token = res?.data?.accessToken ?? res?.access_token ?? res?.accessToken;
      const refresh = res?.data?.refreshToken ?? res?.refresh_token ?? res?.refreshToken;
      if (!token) throw new Error("No token received");

      const payload = parseJwt(token);
      const user = {
        id: payload?.sub ?? "",
        email: payload?.email ?? email,
        role: payload?.role ?? "user",
        client_id: payload?.client_id ?? "",
      };

      saveAuth(token, refresh ?? null, user);

      window.location.href = user.role === "super_admin" ? "/admin/dashboard" : "/client/dashboard";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2.5 rounded-lg text-sm bg-white border border-slate-200 outline-none transition-colors focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/10";
  const labelClass =
    "block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5";

  return (
    <div className="min-h-screen flex" style={{ background: "var(--paper)" }}>
      {/* Left — brand gradient panel */}
      <div className="hidden lg:flex w-1/2 p-12 flex-col justify-between text-white relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-500 to-cyan-500">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2 mb-12">
            <div className="w-9 h-9 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center">
              <Zap size={20} strokeWidth={2.5} />
            </div>
            <span className="font-semibold tracking-tight">Control Suite BTL</span>
          </div>
          <h1 className="display-font text-5xl leading-tight mb-4">
            La operación BTL,<br />
            <em>sin fricción</em>.
          </h1>
          <p className="text-white/80 text-sm leading-relaxed max-w-md">
            Plataforma multi-tenant para agencias BTL. Documentos, rendiciones,
            inventario POP, activaciones y monitoreo en terreno — orquestado por IA
            agéntica desde WhatsApp y correo.
          </p>
        </div>
        <div className="relative grid grid-cols-3 gap-6 text-xs">
          <div>
            <div className="text-2xl font-semibold mb-1">5</div>
            <div className="text-white/70">flujos integrados<br />F1·F2·F3·F4·F5</div>
          </div>
          <div>
            <div className="text-2xl font-semibold mb-1">3</div>
            <div className="text-white/70">canales de entrada<br />WhatsApp · Mail · Manual</div>
          </div>
          <div>
            <div className="text-2xl font-semibold mb-1">100%</div>
            <div className="text-white/70">trazabilidad<br />multi-tenant</div>
          </div>
        </div>
      </div>

      {/* Right — sign-in form */}
      <div className="w-full lg:w-1/2 p-8 lg:p-12 flex items-center justify-center">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-indigo-600 to-cyan-500">
              <Zap size={18} color="#fff" strokeWidth={2.5} />
            </div>
            <span className="font-semibold tracking-tight">Control Suite BTL</span>
          </div>

          <h2 className="display-font text-3xl mb-2">Bienvenido</h2>
          <p className="text-sm text-slate-500 mb-8">Inicia sesión para continuar</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelClass}>Correo</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@empresa.cl"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Contraseña</label>
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="••••••••••"
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="rounded"
                />
                Recordarme
              </label>
              <a className="text-indigo-600 hover:text-indigo-700 cursor-pointer">
                ¿Olvidaste tu contraseña?
              </a>
            </div>

            {error && (
              <div
                className="text-xs px-3 py-2 rounded-lg"
                style={{ background: "rgba(239,68,68,0.12)", color: "var(--danger)" }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <span
                  className="w-4 h-4 border-2 rounded-full animate-spin"
                  style={{ borderColor: "rgba(255,255,255,0.35)", borderTopColor: "#fff" }}
                />
              ) : (
                <>Entrar a la plataforma →</>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

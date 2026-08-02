"use client";

import { useState } from "react";
import { api, saveAuth } from "@/lib/api";
import { Zap, Eye, EyeOff, ArrowRight } from "lucide-react";

function parseJwt(token: string) {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const [email, setEmail]     = useState("");
  const [password, setPass]   = useState("");
  const [show, setShow]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post<any>("/auth/login", { email, password });
      const token = res?.data?.accessToken ?? res?.access_token ?? res?.accessToken;
      const refresh = res?.data?.refreshToken ?? res?.refresh_token ?? res?.refreshToken;
      if (!token) throw new Error("No token received");

      // Decode user from JWT payload
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

  return (
    <div className="min-h-screen flex" style={{ background: "var(--background)" }}>
      <div className="flex-1 hidden lg:flex flex-col justify-center px-16 border-r" style={{ borderColor: "var(--border)", background: "var(--navy)" }}>
        <div className="absolute inset-0 opacity-30" style={{
          backgroundImage: "linear-gradient(oklch(1 0 0 / 4%) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0 / 4%) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          pointerEvents: "none",
        }} />
        <div className="relative">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--red)", boxShadow: "0 6px 20px rgba(200,32,44,0.4)" }}>
              <Zap size={20} color="#fff" strokeWidth={2.5} />
            </div>
            <span className="text-lg font-bold">Control Suite</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">
            Operations.<br />
            <span style={{ color: "var(--red)" }}>Unified.</span>
          </h1>
          <p className="text-sm leading-relaxed mb-10" style={{ color: "var(--muted-foreground)", maxWidth: 340 }}>
            Complete platform for campaigns, activations, promoters, and AI-powered field operations.
          </p>
          {["Client isolation & role-based access", "AI-powered document ingestion", "Real-time KPI dashboard"].map((f) => (
            <div key={f} className="flex items-center gap-2.5 mb-3 text-sm" style={{ color: "var(--muted-foreground)" }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--green)" }} />
              {f}
            </div>
          ))}
        </div>
      </div>

      <div className="w-full lg:w-96 flex items-center justify-center px-8" style={{ background: "var(--card)" }}>
        <div className="w-full max-w-sm animate-fade-up">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--red)" }}>
              <Zap size={16} color="#fff" />
            </div>
            <span className="font-bold">Control Suite</span>
          </div>

          <h2 className="text-xl font-bold mb-1">Sign in</h2>
          <p className="text-sm mb-7" style={{ color: "var(--muted-foreground)" }}>Enter your credentials to continue</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>Email</label>
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors"
                style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>Password</label>
              <div className="relative">
                <input
                  type={show ? "text" : "password"} required value={password}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 pr-10 rounded-lg text-sm outline-none transition-colors"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}
                />
                <button type="button" onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--muted-foreground)", background: "none", border: "none", cursor: "pointer" }}>
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "var(--red-dim)", color: "var(--red-light)" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold mt-1 transition-opacity disabled:opacity-50"
              style={{ background: "var(--red)", color: "#fff", boxShadow: "0 4px 16px rgba(200,32,44,0.3)", border: "none", cursor: "pointer" }}>
              {loading ? (
                <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
              ) : (
                <> Sign in <ArrowRight size={14} /></>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
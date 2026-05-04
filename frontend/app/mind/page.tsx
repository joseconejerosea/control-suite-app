'use client';

import { useEffect, useState, useRef } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const token = () => (typeof window !== 'undefined' ? localStorage.getItem('access_token') : '');
const apiFetch = async (path: string, opts?: RequestInit) => {
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...opts?.headers },
  });
  return r.json();
};

interface Propuesta {
  id: string;
  titulo: string;
  descripcion: string;
  severidad: 'critica' | 'alta' | 'media' | 'baja';
  estado: 'abierta' | 'aprobada' | 'rechazada' | 'expirada';
  tipo: string;
  accion_propuesta: unknown;
  created_at: string;
}

interface ChatMsg { role: 'user' | 'assistant'; mensaje: string; ts: string; }

const SEV_CONFIG: Record<string, { color: string; icon: string }> = {
  critica: { color: 'border-red-400 bg-red-50', icon: '🔴' },
  alta:    { color: 'border-orange-400 bg-orange-50', icon: '🟠' },
  media:   { color: 'border-amber-300 bg-amber-50', icon: '🟡' },
  baja:    { color: 'border-slate-200 bg-slate-50', icon: '⚪' },
};

const SUGERIDAS = ['Resumen del día', '¿Cuánto llevamos gastado este mes?', 'Manda recordatorio a quienes deben rendir'];

export default function MindPage() {
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<'propuestas' | 'chat'>('propuestas');
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      apiFetch('/v1/app/mind/propuestas'),
      apiFetch('/v1/app/mind/propuestas/dashboard'),
      apiFetch('/v1/app/mind/chat/history?limit=30'),
    ]).then(([p, d, h]) => {
      setPropuestas(p.data ?? p);
      setDashboard(d.data ?? d);
      setHistory((h.data ?? h).reverse());
    });
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [history]);

  const sendMessage = async (msg?: string) => {
    const texto = msg ?? input.trim();
    if (!texto || sending) return;
    setInput('');
    setSending(true);

    const userMsg: ChatMsg = { role: 'user', mensaje: texto, ts: new Date().toISOString() };
    setHistory((h) => [...h, userMsg]);

    try {
      const res = await apiFetch('/v1/app/mind/chat', {
        method: 'POST',
        body: JSON.stringify({ mensaje: texto }),
      });
      const reply = res.data?.reply ?? res.reply ?? '...';
      setHistory((h) => [...h, { role: 'assistant', mensaje: reply, ts: new Date().toISOString() }]);
    } catch {
      setHistory((h) => [...h, { role: 'assistant', mensaje: 'Error al procesar tu mensaje.', ts: new Date().toISOString() }]);
    }
    setSending(false);
  };

  const aprobar = async (id: string) => {
    await apiFetch(`/v1/app/mind/propuestas/${id}/aprobar`, { method: 'POST', body: JSON.stringify({}) });
    setPropuestas((p) => p.map((x) => x.id === id ? { ...x, estado: 'aprobada' } : x));
  };

  const rechazar = async (id: string) => {
    await apiFetch(`/v1/app/mind/propuestas/${id}/rechazar`, { method: 'POST', body: JSON.stringify({ motivo: 'Descartado por el usuario' }) });
    setPropuestas((p) => p.filter((x) => x.id !== id));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-500 flex items-center justify-center text-white text-lg">🧠</div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Control Mind</h1>
          <p className="text-sm text-slate-500">Asistente IA · 3 perfiles: Proactivo · Ejecutor · Analista</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full font-medium">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Agente activo
        </div>
      </div>

      {/* Dashboard Banner */}
      {dashboard && parseInt(dashboard.total_abiertas) > 0 && (
        <div className="mb-6 bg-gradient-to-r from-indigo-600 to-cyan-500 rounded-2xl p-5 text-white">
          <div className="flex items-center gap-2 font-semibold">
            <span>🧠</span>
            Control Mind detectó {dashboard.total_abiertas} propuesta(s) que necesitan atención
          </div>
          <div className="flex flex-wrap gap-3 mt-3">
            {parseInt(dashboard.criticas) > 0 && <span className="text-xs bg-white/20 px-2 py-1 rounded-full">🔴 {dashboard.criticas} crítica(s)</span>}
            {parseInt(dashboard.altas) > 0 && <span className="text-xs bg-white/20 px-2 py-1 rounded-full">🟠 {dashboard.altas} alta(s)</span>}
            {parseInt(dashboard.aprobadas_hoy) > 0 && <span className="text-xs bg-white/20 px-2 py-1 rounded-full">✅ {dashboard.aprobadas_hoy} aprobada(s) hoy</span>}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6">
        {[
          { key: 'propuestas', label: `Propuestas activas (${propuestas.filter((p) => p.estado === 'abierta').length})` },
          { key: 'chat', label: 'Chat · Ejecutor' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-all ${
              tab === t.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB PROPUESTAS ─────────────────────────────────────────── */}
      {tab === 'propuestas' && (
        <div className="space-y-3">
          {propuestas.filter((p) => p.estado === 'abierta').length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <div className="text-4xl mb-3">✅</div>
              <p>Sin propuestas pendientes. Control Mind está monitoreando en background.</p>
            </div>
          ) : (
            propuestas
              .filter((p) => p.estado === 'abierta')
              .sort((a, b) => {
                const order = { critica: 0, alta: 1, media: 2, baja: 3 };
                return (order[a.severidad] ?? 9) - (order[b.severidad] ?? 9);
              })
              .map((p) => {
                const cfg = SEV_CONFIG[p.severidad] ?? SEV_CONFIG.baja;
                return (
                  <div key={p.id} className={`border rounded-xl p-5 ${cfg.color}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span>{cfg.icon}</span>
                          <span className="font-semibold text-slate-900">{p.titulo}</span>
                          <span className="text-xs text-slate-400 capitalize px-2 py-0.5 bg-white/60 rounded">{p.tipo}</span>
                        </div>
                        {p.descripcion && (
                          <p className="text-sm text-slate-600 mt-1.5">{p.descripcion}</p>
                        )}
                        <div className="text-xs text-slate-400 mt-2">
                          {new Date(p.created_at).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => aprobar(p.id)}
                          className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                          Aprobar
                        </button>
                        <button
                          onClick={() => rechazar(p.id)}
                          className="px-3 py-1.5 bg-white/70 text-slate-600 text-xs font-medium rounded-lg hover:bg-white transition-colors border border-slate-200"
                        >
                          Más tarde
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      )}

      {/* ── TAB CHAT ───────────────────────────────────────────────── */}
      {tab === 'chat' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col" style={{ height: '65vh' }}>
          {/* Mensajes */}
          <div ref={chatRef} className="flex-1 overflow-y-auto p-5 space-y-4">
            {history.length === 0 && (
              <div className="text-center py-10 text-slate-400">
                <div className="text-3xl mb-2">🧠</div>
                <p className="text-sm">Hola. Soy Control Mind. Puedo consultar datos, enviar recordatorios y analizar tu plataforma. ¿En qué te ayudo?</p>
              </div>
            )}
            {history.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-600 to-cyan-500 flex items-center justify-center text-white text-xs mr-2 shrink-0 mt-0.5">🧠</div>
                )}
                <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                }`}>
                  {msg.mensaje}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-600 to-cyan-500 flex items-center justify-center text-white text-xs mr-2">🧠</div>
                <div className="bg-slate-100 px-4 py-2.5 rounded-2xl rounded-bl-sm">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((n) => (
                      <span key={n} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${n * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Pills sugeridas */}
          {history.length === 0 && (
            <div className="px-5 pb-2 flex flex-wrap gap-2">
              {SUGERIDAS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-xs px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-slate-200 p-4 flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Escribe algo... ej: ¿cuánto llevamos en Falabella?"
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:bg-white transition-colors"
              disabled={sending}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || sending}
              className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-cyan-500 text-white rounded-xl text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { ChatMarkdown } from './ChatMarkdown';

interface ChatMsg { role: 'user' | 'assistant'; mensaje: string; }
interface Propuesta { id: string; titulo: string; descripcion: string; severidad: string; }

const SUGERIDAS = ['Resumen del día', '¿Cuánto gastamos este mes?', 'Personas con rendiciones pendientes'];

export function MindFloatingChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      api.get<any>('/v1/app/mind/propuestas').then((r) => setPropuestas((r.data ?? r).slice(0, 3))).catch(() => {});
      api.get<any>('/v1/app/mind/chat/history?limit=20').then((r) => setMsgs((r.data ?? r).reverse())).catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open]);

  const send = async (msg?: string) => {
    const texto = msg ?? input.trim();
    if (!texto || sending) return;
    setInput('');
    setSending(true);
    setMsgs((m) => [...m, { role: 'user', mensaje: texto }]);
    try {
      const res = await api.post<any>('/v1/app/mind/chat', { mensaje: texto });
      setMsgs((m) => [...m, { role: 'assistant', mensaje: res.data?.reply ?? res.reply ?? '...' }]);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', mensaje: 'Error al conectar con Control Mind.' }]);
    }
    setSending(false);
  };

  const aprobar = async (id: string) => {
    await api.post(`/v1/app/mind/propuestas/${id}/aprobar`, {});
    setPropuestas((p) => p.filter((x) => x.id !== id));
  };

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 transition-transform hover:scale-105"
          style={{ background: 'var(--ai-gradient)' }}
          title="Control Mind"
        >
          <span className="text-xl">🧠</span>
          {propuestas.length > 0 && open === false && (
            <span className="absolute -top-1 -right-1 w-5 h-5 text-white text-[10px] font-bold rounded-full flex items-center justify-center" style={{ background: 'var(--danger)' }}>
              {propuestas.length}
            </span>
          )}
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-6 right-6 z-50 w-[420px] h-[640px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          style={{ animation: 'slideUp 0.25s ease-out' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100"
               style={{ background: 'var(--ai-gradient)' }}>
            <div className="flex items-center gap-2 text-white">
              <span>🧠</span>
              <span className="font-semibold text-sm">Control Mind</span>
              <span className="flex items-center gap-1 text-[11px] bg-white/20 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" /> activo
              </span>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white text-lg">✕</button>
          </div>

          {/* Body */}
          <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Propuestas */}
            {propuestas.length > 0 && (
              <div className="bg-indigo-50 rounded-xl p-3 space-y-2">
                <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">Detecté esto hoy</div>
                {propuestas.map((p) => (
                  <div key={p.id} className="bg-white rounded-lg p-3 border border-indigo-100">
                    <div className="text-sm font-medium text-slate-800">{p.titulo}</div>
                    {p.descripcion && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{p.descripcion}</div>}
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => aprobar(p.id)} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700">Sí, aprobar</button>
                      <button onClick={() => setPropuestas((x) => x.filter((q) => q.id !== p.id))} className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Más tarde</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Chat history */}
            {msgs.length === 0 && propuestas.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">
                <div className="text-2xl mb-2">🧠</div>
                <p>¿En qué te ayudo?</p>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] mr-1.5 shrink-0 mt-0.5"
                       style={{ background: 'var(--ai-gradient)' }}>🧠</div>
                )}
                <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                  m.role === 'user' ? 'text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                }`} style={m.role === 'user' ? { background: 'var(--ai-gradient)' } : {}}>
                  {m.role === 'assistant' ? <ChatMarkdown content={m.mensaje} /> : m.mensaje}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex items-center gap-1 ml-8">
                {[0, 1, 2].map((n) => (
                  <span key={n} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${n * 0.15}s` }} />
                ))}
              </div>
            )}
          </div>

          {/* Pills */}
          {msgs.length === 0 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {SUGERIDAS.map((s) => (
                <button key={s} onClick={() => send(s)} className="text-[11px] px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-slate-100 p-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Escribe algo..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:bg-white"
              disabled={sending}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || sending}
              className="px-3 py-2 text-white rounded-xl text-sm disabled:opacity-40"
              style={{ background: 'var(--ai-gradient)' }}
            >→</button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}

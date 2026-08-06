'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Rendicion {
  id: string;
  persona_id: string;
  project_name: string;
  periodo: string;
  estado: 'borrador' | 'enviada' | 'aprobada' | 'pagada' | 'rechazada';
  monto_total: string;
  porcentaje_presupuesto: string | null;
  aprobada_auto: boolean;
  num_items: number;
  requiere_admin: boolean;
  excede_por_clp: string | null;
}

interface Kpis {
  borrador: string; enviada: string; aprobada: string;
  pagada: string; rechazada: string; monto_aprobado_total: string;
}

const ESTADO_CONFIG: Record<string, { label: string; color: string }> = {
  borrador:  { label: 'Borrador',  color: 'bg-slate-100 text-slate-600' },
  enviada:   { label: 'Enviada',   color: 'bg-blue-100 text-blue-700' },
  aprobada:  { label: 'Aprobada',  color: 'bg-[color:color-mix(in_srgb,var(--success)_12%,transparent)] text-[color:var(--success)]' },
  pagada:    { label: 'Pagada',    color: 'bg-[color:color-mix(in_srgb,var(--success)_12%,transparent)] text-[color:var(--success)]' },
  rechazada: { label: 'Rechazada', color: 'bg-[color:color-mix(in_srgb,var(--danger)_10%,transparent)] text-[color:var(--danger)]' },
};

export default function RendicionesPage() {
  const [rendiciones, setRendiciones] = useState<Rendicion[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Rendicion & { items: unknown[] } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = filtroEstado ? `?estado=${filtroEstado}` : '';
      const [data, k] = await Promise.all([
        api.get<any>(`/rendiciones${params}`),
        api.get<any>('/rendiciones/kpis'),
      ]);
      setRendiciones(data.data ?? data);
      setKpis(k.data ?? k);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [filtroEstado]);

  const openDetalle = async (id: string) => {
    setSelectedId(id);
    const d = await api.get<any>(`/rendiciones/${id}`);
    setDetalle(d.data ?? d);
  };

  const cerrar = async (id: string) => {
    setActionLoading(id);
    try {
      await api.patch(`/rendiciones/${id}/cerrar`);
      await fetchData();
    } finally { setActionLoading(null); }
  };

  const aprobar = async (id: string) => {
    setActionLoading(id);
    try {
      await api.patch(`/rendiciones/${id}/aprobar`);
      await fetchData();
      if (selectedId === id) {
        const d = await api.get<any>(`/rendiciones/${id}`);
        setDetalle(d.data ?? d);
      }
    } finally { setActionLoading(null); }
  };

  const rechazar = async (id: string) => {
    setActionLoading(id);
    try {
      await api.patch(`/rendiciones/${id}/rechazar`, {});
      await fetchData();
      setSelectedId(null);
      setDetalle(null);
    } finally { setActionLoading(null); }
  };

  const marcarPagada = async (id: string) => {
    setActionLoading(id);
    try {
      await api.patch(`/rendiciones/${id}/marcar-pagada`, {});
      await fetchData();
      setSelectedId(null);
      setDetalle(null);
    } finally { setActionLoading(null); }
  };

  const fmtCLP = (v: string | number | null) =>
    v == null ? '—' : `$${parseFloat(String(v)).toLocaleString('es-CL')}`;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rendiciones</h1>
          <p className="text-sm text-slate-500 mt-1">Agrupación automática de gastos por persona, proyecto y semana</p>
        </div>
      </div>

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {['borrador', 'enviada', 'aprobada', 'pagada', 'rechazada'].map((estado) => (
            <button key={estado} onClick={() => setFiltroEstado(filtroEstado === estado ? '' : estado)}
              className={`rounded-xl border p-4 text-left transition-all ${filtroEstado === estado ? 'border-indigo-500 bg-indigo-50' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
              <div className="text-2xl font-bold text-slate-900">{(kpis as any)[estado]}</div>
              <div className="text-xs text-slate-500 capitalize mt-1">{ESTADO_CONFIG[estado].label}</div>
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Persona', 'Proyecto', 'Período', 'Items', 'Monto', '% Presupuesto', 'Estado', 'Acciones'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400">Cargando...</td></tr>
            ) : rendiciones.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400">No hay rendiciones</td></tr>
            ) : rendiciones.map((r) => {
              const cfg = ESTADO_CONFIG[r.estado];
              const pct = r.porcentaje_presupuesto ? parseFloat(r.porcentaje_presupuesto) : null;
              const busy = actionLoading === r.id;
              return (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.persona_id.slice(0,8)}…</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{r.project_name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{r.periodo}</td>
                  <td className="px-4 py-3 text-slate-600">{r.num_items}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{fmtCLP(r.monto_total)}</td>
                  <td className="px-4 py-3">
                    {pct != null ? (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct > 100 ? 'bg-[color:var(--danger)]' : pct > 80 ? 'bg-amber-400' : 'bg-[color:var(--success)]'}`} style={{ width: `${Math.min(pct,100)}%` }} />
                        </div>
                        <span className={`text-xs font-medium ${pct > 100 ? 'text-[color:var(--danger)]' : 'text-slate-600'}`}>{pct.toFixed(0)}%</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                      {cfg.label}{r.aprobada_auto && <span className="ml-1 text-[10px] opacity-70">(auto)</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openDetalle(r.id)} className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded">Ver</button>
                      {r.estado === 'borrador' && <button disabled={busy} onClick={() => cerrar(r.id)} className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded disabled:opacity-40">{busy ? '...' : 'Cerrar'}</button>}
                      {r.estado === 'enviada' && <>
                        <button disabled={busy} onClick={() => aprobar(r.id)} className="px-2 py-1 text-xs text-[color:var(--success)] hover:bg-[color:color-mix(in_srgb,var(--success)_10%,transparent)] rounded disabled:opacity-40">{busy ? '...' : 'Aprobar'}</button>
                        <button disabled={busy} onClick={() => rechazar(r.id)} className="px-2 py-1 text-xs text-[color:var(--danger)] hover:bg-[color:color-mix(in_srgb,var(--danger)_10%,transparent)] rounded disabled:opacity-40">{busy ? '...' : 'Rechazar'}</button>
                      </>}
                      {r.estado === 'aprobada' && (
                        <button disabled={busy} onClick={() => marcarPagada(r.id)} className="px-3 py-1 text-xs bg-indigo-600 text-white rounded font-semibold hover:bg-indigo-700 disabled:opacity-40">
                          {busy ? '...' : 'Marcar Pagada'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedId && detalle && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { setSelectedId(null); setDetalle(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Detalle Rendición</h2>
                <p className="text-sm text-slate-500">{detalle.project_name} · {detalle.periodo}</p>
              </div>
              <div className="flex items-center gap-2">
                {detalle.estado === 'aprobada' && (
                  <button disabled={actionLoading === detalle.id} onClick={() => marcarPagada(detalle.id)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40">
                    {actionLoading === detalle.id ? 'Procesando...' : 'Marcar Pagada'}
                  </button>
                )}
                {detalle.estado === 'enviada' && <>
                  <button disabled={actionLoading === detalle.id} onClick={() => aprobar(detalle.id)} className="px-4 py-2 bg-[color:var(--success)] text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40">{actionLoading === detalle.id ? '...' : 'Aprobar'}</button>
                  <button disabled={actionLoading === detalle.id} onClick={() => rechazar(detalle.id)} className="px-4 py-2 bg-[color:color-mix(in_srgb,var(--danger)_10%,transparent)] text-[color:var(--danger)] rounded-lg text-sm font-semibold hover:bg-[color:color-mix(in_srgb,var(--danger)_18%,transparent)] disabled:opacity-40">{actionLoading === detalle.id ? '...' : 'Rechazar'}</button>
                </>}
                <button onClick={() => { setSelectedId(null); setDetalle(null); }} className="text-slate-400 hover:text-slate-600 text-xl ml-2">✕</button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500">Monto Total</div>
                  <div className="text-xl font-bold text-slate-900">{fmtCLP(detalle.monto_total)}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500">Estado</div>
                  <div className="mt-1"><span className={`px-2 py-0.5 rounded text-xs font-medium ${ESTADO_CONFIG[detalle.estado]?.color}`}>{ESTADO_CONFIG[detalle.estado]?.label}</span></div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500">Boletas</div>
                  <div className="text-xl font-bold text-slate-900">{detalle.items?.length ?? 0}</div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Boletas incluidas</h3>
                <div className="space-y-2">
                  {(detalle.items ?? []).map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <div className="text-sm font-medium text-slate-800">{item.vendor_name ?? 'Sin nombre'}</div>
                        <div className="text-xs text-slate-500">{item.invoice_date} · {item.category}</div>
                      </div>
                      <div className="font-semibold text-slate-900">{fmtCLP(item.monto)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
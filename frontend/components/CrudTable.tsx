"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Plus, Search, X, Pencil } from "lucide-react";

export type ColDef = {
  key: string;
  label: string;
  render?: (val: unknown, row: Record<string, unknown>) => React.ReactNode;
};

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "date" | "tel" | "textarea" | "select";
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
};

interface CrudTableProps {
  title: string;
  subtitle?: string;
  endpoint: string;
  columns: ColDef[];
  fields: FieldDef[];
  defaultForm: Record<string, unknown>;
  emptyText?: string;
  dataKey?: string;
}

function Badge({ value, map }: { value: string; map: Record<string, { bg: string; color: string }> }) {
  const style = map[value] ?? { bg: "var(--secondary)", color: "var(--muted-foreground)" };
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide"
      style={{ background: style.bg, color: style.color }}>{value}</span>
  );
}

export const StatusBadge = (v: unknown) => {
  const val = String(v ?? "");
  const map: Record<string, { bg: string; color: string }> = {
    active:       { bg: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)" },
    paused:       { bg: "rgba(245,158,11,0.15)",   color: "#f59e0b" },
    archived:     { bg: "var(--secondary)",        color: "var(--muted-foreground)" },
    draft:        { bg: "rgba(79,70,229,0.12)",     color: "var(--primary)" },
    ended:        { bg: "var(--secondary)",        color: "var(--muted-foreground)" },
    inactive:     { bg: "var(--secondary)",        color: "var(--muted-foreground)" },
    uploaded:     { bg: "rgba(79,70,229,0.15)",    color: "var(--primary)" },
    processing:   { bg: "rgba(79,70,229,0.12)",     color: "var(--primary)" },
    parsed:       { bg: "rgba(245,158,11,0.15)",   color: "#fcd34d" },
    populated:    { bg: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)" },
    error:        { bg: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" },
    observer:     { bg: "rgba(79,70,229,0.12)",    color: "var(--primary)" },
    supervisor:   { bg: "rgba(245,158,11,0.12)",   color: "#f59e0b" },
    coordinator:  { bg: "rgba(79,70,229,0.12)",     color: "var(--primary)" },
    brand_manager:{ bg: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)" },
  };
  return <Badge value={val} map={map} />;
};

export const DateFmt = (v: unknown) =>
  v ? <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{new Date(String(v)).toLocaleDateString()}</span>
    : <span style={{ color: "var(--muted-foreground)" }}>—</span>;

export const MoneyFmt = (v: unknown) =>
  v ? <span>${Number(v).toLocaleString()}</span>
    : <span style={{ color: "var(--muted-foreground)" }}>—</span>;

function Modal({ title, onClose, onSave, loading, fields, form, setForm }: {
  title: string; onClose: () => void; onSave: () => void; loading: boolean;
  fields: FieldDef[]; form: Record<string, string>; setForm: (f: Record<string, string>) => void;
}) {
  const set = (key: string, val: string) => setForm({ ...form, [key]: val });
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-2xl border flex flex-col animate-fade-up"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)" }}>
          <h3 className="font-semibold text-base">{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted-foreground)", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-6 py-4">
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                {f.label}{f.required && " *"}
              </label>
              {f.type === "select" ? (
                <select value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                  <option value="">Select…</option>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === "textarea" ? (
                <textarea value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}
                  rows={3} placeholder={f.placeholder}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
              ) : (
                <input type={f.type ?? "text"} value={form[f.key] ?? ""} placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-3 px-6 py-4 border-t flex-shrink-0" style={{ borderColor: "var(--border)" }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm"
            style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={onSave} disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer" }}>
            {loading
              ? <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
              : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CrudTable({ title, subtitle, endpoint, columns, fields, defaultForm, emptyText, dataKey }: CrudTableProps) {
  const [items, setItems]   = useState<Record<string, unknown>[]>([]);
  const [loading, setLoad]  = useState(true);
  const [saving, setSave]   = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal]   = useState<"create" | "edit" | null>(null);
  const [form, setForm]     = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    Object.entries(defaultForm).forEach(([k, v]) => { f[k] = String(v ?? ""); });
    return f;
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [toast, setToast]   = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoad(true);
    try {
      const res = await api.get<unknown>(endpoint);
      const raw = (res as Record<string, unknown>);
      const arr = dataKey ? raw[dataKey] : (raw.data ?? res);
      setItems(Array.isArray(arr) ? arr as Record<string, unknown>[] : []);
    } catch { setItems([]); } finally { setLoad(false); }
  }, [endpoint, dataKey]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    const f: Record<string, string> = {};
    Object.entries(defaultForm).forEach(([k, v]) => { f[k] = String(v ?? ""); });
    setForm(f); setEditId(null); setModal("create");
  };

  const openEdit = (item: Record<string, unknown>) => {
    const f: Record<string, string> = {};
    fields.forEach((field) => { f[field.key] = String(item[field.key] ?? ""); });
    setForm(f); setEditId(String(item.id)); setModal("edit");
  };

  const handleSave = async () => {
    setSave(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      fields.forEach((f) => {
        if (f.type === "number" && payload[f.key] !== "") {
          payload[f.key] = parseFloat(String(payload[f.key])) || 0;
        }
      });
      if (modal === "create") await api.post(endpoint, payload);
      else await api.patch(`${endpoint}/${editId}`, payload);
      showToast(modal === "create" ? "Created successfully" : "Updated successfully", true);
      setModal(null);
      load();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Operation failed", false);
    } finally { setSave(false); }
  };

  const filtered = items.filter((item) =>
    Object.values(item).some((v) => String(v ?? "").toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="animate-fade-up">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl"
          style={{ background: toast.ok ? "var(--success)" : "var(--danger)", color: "#fff" }}>
          {toast.msg}
        </div>
      )}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{subtitle}</p>}
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "var(--primary)", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 4px 14px rgba(79,70,229,0.3)" }}>
          <Plus size={14} /> New {title.replace(/s$/, "")}
        </button>
      </div>

      <div className="relative mb-5" style={{ maxWidth: 300 }}>
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
          className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }} />
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "var(--secondary)" }}>
                {columns.map((c) => (
                  <th key={c.key} className="px-4 py-3 text-left"
                    style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                    {c.label}
                  </th>
                ))}
                <th className="px-4 py-3 text-left"
                  style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(4).fill(0).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    {[...columns, { key: "_act" }].map((c) => (
                      <td key={c.key} className="px-4 py-3.5">
                        <div className="h-3.5 rounded animate-pulse" style={{ width: "70%", background: "var(--secondary)" }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="px-4 py-14 text-center text-sm"
                    style={{ color: "var(--muted-foreground)" }}>
                    {emptyText ?? `No ${title.toLowerCase()} found.`}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={String(item.id)} className="transition-colors"
                    style={{ borderBottom: "1px solid var(--border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--secondary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-3.5 text-sm">
                        {c.render ? c.render(item[c.key], item) : (
                          <span style={{ color: item[c.key] != null ? "var(--foreground)" : "var(--muted-foreground)" }}>
                            {String(item[c.key] ?? "—")}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3.5">
                      <button onClick={() => openEdit(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
                        style={{ background: "var(--secondary)", color: "var(--muted-foreground)", border: "none", cursor: "pointer" }}>
                        <Pencil size={11} /> Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          title={modal === "create" ? `New ${title.replace(/s$/, "")}` : `Edit ${title.replace(/s$/, "")}`}
          onClose={() => setModal(null)}
          onSave={handleSave}
          loading={saving}
          fields={fields}
          form={form}
          setForm={setForm}
        />
      )}
    </div>
  );
}
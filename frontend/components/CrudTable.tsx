"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
  type?:
    | "text"
    | "email"
    | "password"
    | "number"
    | "date"
    | "tel"
    | "textarea"
    | "select";
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  // Dynamic select: fetch options from an endpoint on mount.
  optionsEndpoint?: string; // GET this; response is an array (or { data: [...] })
  optionsValueKey?: string; // default "id"
  optionsLabelKey?: string; // simple label field, e.g. "name"
  optionsLabel?: (row: Record<string, unknown>) => string; // composed label (takes precedence)
  optionsDataKey?: string; // if response wraps the array under a key
  // Dependent (cascading) select: fetch options from an endpoint that depends on
  // another field's value. `optionsEndpointFrom` receives the current form plus the
  // raw fetched rows of every endpoint-backed field (keyed by field.key) and returns
  // the endpoint to GET — or null to show empty options (and clear/disable the field).
  // Refetched whenever the resolved endpoint changes. Kept separate from the static
  // `optionsEndpoint` path so existing fetch-once-on-mount fields are unaffected.
  optionsEndpointFrom?: (
    form: Record<string, string>,
    rows: Record<string, Record<string, unknown>[]>,
  ) => string | null;
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
  // Open the create modal (pre-filled from defaultForm) automatically on mount.
  autoOpenCreate?: boolean;
  // Called after a record is successfully CREATED (not on edit).
  onCreated?: () => void;
  // When provided, clicking a data row calls this (e.g. navigate to a detail page).
  onRowClick?: (row: Record<string, unknown>) => void;
}

function Badge({
  value,
  map,
}: {
  value: string;
  map: Record<string, { bg: string; color: string }>;
}) {
  const style = map[value] ?? {
    bg: "var(--secondary)",
    color: "var(--muted-foreground)",
  };
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide"
      style={{ background: style.bg, color: style.color }}
    >
      {value}
    </span>
  );
}

export const StatusBadge = (v: unknown) => {
  const val = String(v ?? "");
  const map: Record<string, { bg: string; color: string }> = {
    active: {
      bg: "color-mix(in srgb, var(--success) 12%, transparent)",
      color: "var(--success)",
    },
    paused: { bg: "rgba(245,158,11,0.15)", color: "#f59e0b" },
    archived: { bg: "var(--secondary)", color: "var(--muted-foreground)" },
    draft: { bg: "rgba(79,70,229,0.12)", color: "var(--primary)" },
    ended: { bg: "var(--secondary)", color: "var(--muted-foreground)" },
    inactive: { bg: "var(--secondary)", color: "var(--muted-foreground)" },
    uploaded: { bg: "rgba(79,70,229,0.15)", color: "var(--primary)" },
    processing: { bg: "rgba(79,70,229,0.12)", color: "var(--primary)" },
    parsed: { bg: "rgba(245,158,11,0.15)", color: "#fcd34d" },
    populated: {
      bg: "color-mix(in srgb, var(--success) 12%, transparent)",
      color: "var(--success)",
    },
    error: {
      bg: "color-mix(in srgb, var(--danger) 12%, transparent)",
      color: "var(--danger)",
    },
    observer: { bg: "rgba(79,70,229,0.12)", color: "var(--primary)" },
    supervisor: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
    coordinator: { bg: "rgba(79,70,229,0.12)", color: "var(--primary)" },
    brand_manager: {
      bg: "color-mix(in srgb, var(--success) 12%, transparent)",
      color: "var(--success)",
    },
    scheduled: { bg: "rgba(79,70,229,0.12)", color: "var(--primary)" },
    in_progress: { bg: "rgba(245,158,11,0.15)", color: "#f59e0b" },
    completed: {
      bg: "color-mix(in srgb, var(--success) 12%, transparent)",
      color: "var(--success)",
    },
    cancelled: {
      bg: "color-mix(in srgb, var(--danger) 12%, transparent)",
      color: "var(--danger)",
    },
    pending: { bg: "var(--secondary)", color: "var(--muted-foreground)" },
  };
  return <Badge value={val} map={map} />;
};

// Anexo · "fecha un día antes": una fecha date-only 'YYYY-MM-DD' con new Date(s) se
// interpreta como UTC-medianoche → toLocaleDateString la corre a hora local (Chile, UTC-3/4)
// → muestra el día ANTERIOR. Si es date-only, la parseamos como fecha LOCAL (sin drift). Un
// timestamp con hora ('...T...') es un instante y se muestra tal cual.
export function toLocalDate(v: unknown): Date {
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}

export const DateFmt = (v: unknown) => {
  if (!v) return <span style={{ color: "var(--muted-foreground)" }}>—</span>;
  const d = toLocalDate(v);
  return (
    <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
      {isNaN(d.getTime()) ? String(v) : d.toLocaleDateString()}
    </span>
  );
};

export const MoneyFmt = (v: unknown) =>
  v ? (
    <span>${Number(v).toLocaleString()}</span>
  ) : (
    <span style={{ color: "var(--muted-foreground)" }}>—</span>
  );

function Modal({
  title,
  onClose,
  onSave,
  loading,
  fields,
  form,
  setForm,
}: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  loading: boolean;
  fields: FieldDef[];
  form: Record<string, string>;
  setForm: (f: Record<string, string>) => void;
}) {
  const set = (key: string, val: string) => setForm({ ...form, [key]: val });
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl border flex flex-col animate-fade-up"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <h3 className="font-semibold text-base">{title}</h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--muted-foreground)",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-6 py-4">
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label
                className="text-xs font-medium"
                style={{ color: "var(--muted-foreground)" }}
              >
                {f.label}
                {f.required && " *"}
              </label>
              {f.type === "select" ? (
                <select
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{
                    background: "var(--secondary)",
                    border: "1px solid var(--border)",
                    color: "var(--foreground)",
                  }}
                >
                  <option value="">Select…</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  rows={3}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                  style={{
                    background: "var(--secondary)",
                    border: "1px solid var(--border)",
                    color: "var(--foreground)",
                  }}
                />
              ) : (
                <input
                  type={f.type ?? "text"}
                  value={form[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{
                    background: "var(--secondary)",
                    border: "1px solid var(--border)",
                    color: "var(--foreground)",
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <div
          className="flex gap-3 px-6 py-4 border-t flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm"
            style={{
              background: "var(--secondary)",
              color: "var(--foreground)",
              border: "none",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{
              background: "var(--primary)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            {loading ? (
              <span
                className="w-4 h-4 border-2 rounded-full animate-spin"
                style={{
                  borderColor: "rgba(255,255,255,0.3)",
                  borderTopColor: "#fff",
                }}
              />
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CrudTable({
  title,
  subtitle,
  endpoint,
  columns,
  fields,
  defaultForm,
  emptyText,
  dataKey,
  autoOpenCreate,
  onCreated,
  onRowClick,
}: CrudTableProps) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [dynOpts, setDynOpts] = useState<
    Record<string, { value: string; label: string }[]>
  >({});
  // Raw fetched rows per endpoint-backed field key, used by dependent-select
  // resolvers (e.g. campaign_id → its project_id) to compute the child endpoint.
  const [dynRows, setDynRows] = useState<
    Record<string, Record<string, unknown>[]>
  >({});
  const [loading, setLoad] = useState(true);
  const [saving, setSave] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    Object.entries(defaultForm).forEach(([k, v]) => {
      f[k] = String(v ?? "");
    });
    return f;
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Mirror of `form` so async dependent-fetch callbacks can read the latest child
  // value without nesting state setters. Kept in sync on every render.
  const formRef = useRef(form);
  formRef.current = form;

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoad(true);
    try {
      const res = await api.get<unknown>(endpoint);
      const raw = res as Record<string, unknown>;
      const arr = dataKey ? raw[dataKey] : (raw.data ?? res);
      setItems(Array.isArray(arr) ? (arr as Record<string, unknown>[]) : []);
    } catch {
      setItems([]);
    } finally {
      setLoad(false);
    }
  }, [endpoint, dataKey]);

  useEffect(() => {
    load();
  }, [load]);

  // Fetch dynamic select options once on mount for fields with optionsEndpoint.
  useEffect(() => {
    let cancelled = false;
    fields.forEach((field) => {
      if (!field.optionsEndpoint) return;
      api
        .get<unknown>(field.optionsEndpoint)
        .then((res) => {
          const raw = res as Record<string, unknown>;
          const arr = field.optionsDataKey
            ? raw[field.optionsDataKey]
            : (raw.data ?? res);
          const rows = Array.isArray(arr)
            ? (arr as Record<string, unknown>[])
            : [];
          const opts = rows.map((row) => ({
            value: String(row[field.optionsValueKey ?? "id"]),
            label: field.optionsLabel
              ? field.optionsLabel(row)
              : String(row[field.optionsLabelKey ?? "name"] ?? ""),
          }));
          if (!cancelled) {
            setDynOpts((prev) => ({ ...prev, [field.key]: opts }));
            // Only dependent resolvers consume dynRows; skip this write entirely on
            // pages without any optionsEndpointFrom field (zero behavior change).
            if (hasDependentFields) {
              setDynRows((prev) => ({ ...prev, [field.key]: rows }));
            }
          }
        })
        .catch(() => {
          if (!cancelled) setDynOpts((prev) => ({ ...prev, [field.key]: [] }));
        });
    });
    return () => {
      cancelled = true;
    };
    // fields is a stable prop for a given page; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // At least one field is a dependent (cascading) select. Computed once from the
  // stable `fields` prop; gates dependent-only bookkeeping (e.g. storing dynRows)
  // so existing optionsEndpoint-only pages keep zero behavior change.
  const hasDependentFields = useMemo(
    () => fields.some((f) => f.optionsEndpointFrom),
    [fields],
  );

  // Dependent (cascading) selects: refetch options whenever the resolved endpoint
  // changes. We serialize the resolved endpoint per dependent field into a stable
  // key; the effect only re-runs when that serialization changes, so it will not
  // loop on unrelated state updates (dynOpts/dynRows writes don't change the key
  // unless they change a resolved endpoint). When the resolver returns null (e.g.
  // no parent selected), we clear the options instead of fetching.
  // Memoized so the resolvers (which read `form` + `dynRows`) aren't re-run on
  // unrelated renders (e.g. dynOpts/toast/loading updates). Behavior identical.
  const dependentKey = useMemo(() => {
    const dependentEndpoints: Record<string, string | null> = {};
    fields.forEach((field) => {
      if (field.optionsEndpointFrom) {
        dependentEndpoints[field.key] = field.optionsEndpointFrom(form, dynRows);
      }
    });
    return JSON.stringify(dependentEndpoints);
  }, [fields, form, dynRows]);

  // Tracks the last resolved endpoint per dependent field. Used to distinguish an
  // ACTIVE parent change (endpoint went from one non-empty value to a DIFFERENT
  // one → prune the stale child) from an initial load / edit-open / same parent
  // (endpoint appears for the first time → PRESERVE the child even if the fetched
  // active-only options don't include it, so an activation's location on an
  // now-inactive PDV is never silently blanked). JD-001.
  const prevDependentUrl = useRef<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    const resolved: Record<string, string | null> = JSON.parse(dependentKey);
    Object.entries(resolved).forEach(([fieldKey, url]) => {
      const field = fields.find((f) => f.key === fieldKey);
      if (!field) return;
      // Did the parent actively change? True only when we previously had a
      // non-empty endpoint and it is now a DIFFERENT non-empty endpoint. First
      // resolution (prev undefined) and a return to null are NOT active changes.
      const prevUrl = prevDependentUrl.current[fieldKey];
      const parentChanged = !!prevUrl && !!url && prevUrl !== url;
      prevDependentUrl.current[fieldKey] = url;
      if (!url) {
        // No endpoint resolvable (e.g. parent unselected) → empty options.
        setDynOpts((prev) => ({ ...prev, [fieldKey]: [] }));
        return;
      }
      api
        .get<unknown>(url)
        .then((res) => {
          const raw = res as Record<string, unknown>;
          const arr = field.optionsDataKey
            ? raw[field.optionsDataKey]
            : (raw.data ?? res);
          const rows = Array.isArray(arr)
            ? (arr as Record<string, unknown>[])
            : [];
          const opts = rows.map((row) => ({
            value: String(row[field.optionsValueKey ?? "id"]),
            label: field.optionsLabel
              ? field.optionsLabel(row)
              : String(row[field.optionsLabelKey ?? "name"] ?? ""),
          }));
          if (!cancelled) {
            const cur = formRef.current[fieldKey];
            const present = !!cur && opts.some((o) => o.value === cur);
            if (parentChanged && cur && !present) {
              // Parent actively changed and the old child value is no longer
              // offered → prune it (prevents sending a value that belongs to a
              // different parent). Functional update guards against a race.
              setDynOpts((prev) => ({ ...prev, [fieldKey]: opts }));
              setForm((prev) =>
                prev[fieldKey] === cur ? { ...prev, [fieldKey]: "" } : prev,
              );
            } else if (cur && !present) {
              // Preserve a still-selected value the active-only endpoint no longer
              // returns (e.g. a since-deactivated PDV on edit-open, same parent) by
              // injecting a synthetic option so the select still DISPLAYS it — the
              // value is never blanked. Prefer the row's own <field>_name; else
              // "(actual)". JD-001: saving without touching the parent never blanks.
              const nameKey = fieldKey.replace(/_id$/, "_name");
              const row = items.find((it) => String(it.id) === editId);
              const label =
                (row && typeof row[nameKey] === "string"
                  ? (row[nameKey] as string)
                  : "") || "(actual)";
              setDynOpts((prev) => ({
                ...prev,
                [fieldKey]: [...opts, { value: cur, label }],
              }));
            } else {
              setDynOpts((prev) => ({ ...prev, [fieldKey]: opts }));
            }
          }
        })
        .catch(() => {
          if (!cancelled) setDynOpts((prev) => ({ ...prev, [fieldKey]: [] }));
        });
    });
    return () => {
      cancelled = true;
    };
    // Re-run only when a resolved dependent endpoint changes. `fields` is a stable
    // prop for a given page, so it is intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependentKey]);

  // Resolve fields: dynamic-options fields become selects with fetched options.
  const resolvedFields: FieldDef[] = fields.map((f) =>
    f.optionsEndpoint || f.optionsEndpointFrom
      ? { ...f, type: "select", options: dynOpts[f.key] ?? [] }
      : f,
  );

  const openCreate = () => {
    const f: Record<string, string> = {};
    Object.entries(defaultForm).forEach(([k, v]) => {
      f[k] = String(v ?? "");
    });
    // Reset the dependent-endpoint baseline so the modal's first resolution is
    // treated as "initial" (never a parent change), preventing a spurious prune
    // from a prior modal session on the same mounted component. JD-001.
    prevDependentUrl.current = {};
    setForm(f);
    setEditId(null);
    setModal("create");
  };

  const openEdit = (item: Record<string, unknown>) => {
    const f: Record<string, string> = {};
    fields.forEach((field) => {
      f[field.key] = String(item[field.key] ?? "");
    });
    // Reset the dependent-endpoint baseline: opening an edit is an "initial" load,
    // so the preset child value must be PRESERVED even if the active-only options
    // don't include it (e.g. a since-deactivated PDV). JD-001.
    prevDependentUrl.current = {};
    setForm(f);
    setEditId(String(item.id));
    setModal("edit");
  };

  const handleSave = async () => {
    setSave(true);
    const wasCreate = modal === "create";
    try {
      const payload: Record<string, unknown> = { ...form };
      const TEXT_LIKE = ["text", "email", "tel", "password", "textarea"];
      fields.forEach((f) => {
        const isEmpty = payload[f.key] === "" || payload[f.key] == null;
        // Omit empty non-required NON-text fields (selects, numbers, dates, endpoint-backed
        // selects). Backend @IsUUID/@IsDateString/@IsNumber reject "" even under @IsOptional.
        // Free-text keeps "" so clearing a text field on edit still works (JD B-001/A-003).
        if (isEmpty && !f.required && (f.optionsEndpoint || f.optionsEndpointFrom || !TEXT_LIKE.includes(f.type ?? "text"))) {
          delete payload[f.key];
          return;
        }
        if (f.type === "number" && payload[f.key] !== "") {
          payload[f.key] = parseFloat(String(payload[f.key])) || 0;
        }
      });
      if (wasCreate) await api.post(endpoint, payload);
      else await api.patch(`${endpoint}/${editId}`, payload);
      showToast(
        wasCreate ? "Created successfully" : "Updated successfully",
        true,
      );
      setModal(null);
      load();
      // Only after a real creation — lets callers finalize side effects
      // (e.g. mark a pending_staff row 'agregado') so canceling loses nothing.
      if (wasCreate) onCreated?.();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Operation failed", false);
    } finally {
      setSave(false);
    }
  };

  // Auto-open the create modal once when requested (pre-filled from defaultForm).
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (!autoOpenCreate || autoOpened) return;
    setAutoOpened(true);
    const t = setTimeout(() => openCreate(), 0);
    return () => clearTimeout(t);
    // openCreate reads only stable setters + defaultForm; run once when requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenCreate, autoOpened]);

  const filtered = items.filter((item) =>
    Object.values(item).some((v) =>
      String(v ?? "")
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
  );

  return (
    <div className="animate-fade-up">
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl"
          style={{
            background: toast.ok ? "var(--success)" : "var(--danger)",
            color: "#fff",
          }}
        >
          {toast.msg}
        </div>
      )}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          {subtitle && (
            <p
              className="text-xs mt-0.5"
              style={{ color: "var(--muted-foreground)" }}
            >
              {subtitle}
            </p>
          )}
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
          style={{
            background: "var(--primary)",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(79,70,229,0.3)",
          }}
        >
          <Plus size={14} /> New {title.replace(/s$/, "")}
        </button>
      </div>

      <div className="relative mb-5" style={{ maxWidth: 300 }}>
        <Search
          size={13}
          className="absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: "var(--muted-foreground)" }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
          className="w-full pl-8 pr-3 py-2 rounded-lg text-sm outline-none"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--foreground)",
          }}
        />
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: "var(--secondary)" }}>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="px-4 py-3 text-left"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      color: "var(--muted-foreground)",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {c.label}
                  </th>
                ))}
                <th
                  className="px-4 py-3 text-left"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--muted-foreground)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(4)
                  .fill(0)
                  .map((_, i) => (
                    <tr
                      key={i}
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      {[...columns, { key: "_act" }].map((c) => (
                        <td key={c.key} className="px-4 py-3.5">
                          <div
                            className="h-3.5 rounded animate-pulse"
                            style={{
                              width: "70%",
                              background: "var(--secondary)",
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="px-4 py-14 text-center text-sm"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {emptyText ?? `No ${title.toLowerCase()} found.`}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr
                    key={String(item.id)}
                    className="transition-colors"
                    onClick={
                      onRowClick ? () => onRowClick(item) : undefined
                    }
                    style={{
                      borderBottom: "1px solid var(--border)",
                      cursor: onRowClick ? "pointer" : undefined,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--secondary)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "")
                    }
                  >
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-3.5 text-sm">
                        {c.render ? (
                          c.render(item[c.key], item)
                        ) : (
                          <span
                            style={{
                              color:
                                item[c.key] != null
                                  ? "var(--foreground)"
                                  : "var(--muted-foreground)",
                            }}
                          >
                            {String(item[c.key] ?? "—")}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(item);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
                        style={{
                          background: "var(--secondary)",
                          color: "var(--muted-foreground)",
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
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
          title={
            modal === "create"
              ? `New ${title.replace(/s$/, "")}`
              : `Edit ${title.replace(/s$/, "")}`
          }
          onClose={() => setModal(null)}
          onSave={handleSave}
          loading={saving}
          fields={resolvedFields}
          form={form}
          setForm={setForm}
        />
      )}
    </div>
  );
}

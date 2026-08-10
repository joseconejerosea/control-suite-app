"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string;
  read_at: string | null;
  created_at: string;
}

// The backend ResponseInterceptor wraps every response as { data: <payload> }.
// The notifications controller returns { data: Notification[], unreadCount }.
// Raw HTTP body shape: { data: { data: Notification[], unreadCount: number } }.
interface NotificationsEnvelope {
  data: {
    data: Notification[];
    unreadCount: number;
  };
}

// ---------------------------------------------------------------------------
// Helper: relative time
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch notifications — same useCallback + useEffect pattern as CrudTable
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get<NotificationsEnvelope>("/notifications?unread=true");
      setItems(res?.data?.data ?? []);
      setUnreadCount(res?.data?.unreadCount ?? 0);
    } catch {
      // Non-fatal: keep previous state on network error
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(fetchNotifications, 0);
    return () => clearTimeout(t);
  }, [fetchNotifications]);

  // 30-second poll (matches terreno POLL_INTERVAL precedent in this codebase)
  useEffect(() => {
    const id = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      fetchNotifications();
    }
  };

  const markAllRead = async () => {
    try {
      await api.post("/notifications/read-all");
      setItems((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })));
      setUnreadCount(0);
    } catch {
      fetchNotifications();
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificaciones"
        className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors"
        style={{ border: "none", cursor: "pointer", color: "var(--muted-foreground)" }}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span
            className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] rounded-full border-2 border-white flex items-center justify-center text-[9px] font-bold text-white"
            style={{ background: "var(--danger)", lineHeight: 1, paddingLeft: 2, paddingRight: 2 }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 mt-1 w-80 rounded-xl border shadow-lg z-50 flex flex-col overflow-hidden"
          style={{ background: "var(--card)", borderColor: "var(--border)", top: "100%" }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-2.5 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Notificaciones
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-medium hover:underline"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)" }}
              >
                Marcar todas
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
            {items.length === 0 ? (
              <div
                className="px-4 py-6 text-center text-sm"
                style={{ color: "var(--muted-foreground)" }}
              >
                Sin notificaciones
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className="w-full text-left px-4 py-3 flex flex-col gap-0.5 hover:bg-slate-50 transition-colors"
                  style={{
                    background: n.read_at
                      ? "transparent"
                      : "color-mix(in srgb, var(--primary) 5%, transparent)",
                    borderColor: "var(--border)",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="text-sm font-medium leading-snug"
                      style={{ color: "var(--foreground)" }}
                    >
                      {n.title}
                    </span>
                    <span
                      className="text-[10px] shrink-0 mt-0.5"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {relativeTime(n.created_at)}
                    </span>
                  </div>
                  {n.body && (
                    <span
                      className="text-xs leading-snug line-clamp-2"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {n.body}
                    </span>
                  )}
                  {!n.read_at && (
                    <span
                      className="mt-1 w-1.5 h-1.5 rounded-full self-end"
                      style={{ background: "var(--primary)" }}
                    />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

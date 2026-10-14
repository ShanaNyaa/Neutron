import { useQueryClient } from "@tanstack/react-query";
import { Bell, CarFront, CheckCheck, ShieldAlert, Wrench } from "lucide-react";
import { useState } from "react";

import { api, type Notice } from "../api.ts";
import { dateTime } from "../format.ts";
import { useNotices } from "../hooks.ts";

const ICONS = { command: CarFront, security: ShieldAlert, service: Wrench } as const;
type Filter = "all" | "unread";

export function InboxView() {
  const notices = useNotices();
  const client = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const markRead = (ids: string[]) => {
    if (!ids.length) return;
    // Optimistic: Proton's read state only matters to this list.
    client.setQueryData<Notice[]>(["notices"], (list) => list?.map((n) => (ids.includes(n.id) ? { ...n, isRead: true } : n)));
    Promise.all(ids.map((id) => api.markRead(id))).catch(() => client.invalidateQueries({ queryKey: ["notices"] }));
  };

  const list = notices.data ?? [];
  const unread = list.filter((n) => !n.isRead);
  const shown = filter === "unread" ? unread : list;

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <h1 className="desktop-title">Inbox</h1>
        <span className="spacer" />
        <div className="segmented" role="tablist" aria-label="Show">
          {(["all", "unread"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : `Unread${unread.length ? ` (${unread.length})` : ""}`}
            </button>
          ))}
        </div>
        {unread.length > 0 && (
          <button className="btn small" onClick={() => markRead(unread.map((n) => n.id))}>
            <CheckCheck size={16} /> Mark all read
          </button>
        )}
      </div>

      {notices.error && <p className="error">{(notices.error as Error).message}</p>}
      {notices.isLoading && <div className="skeleton" style={{ minHeight: 300 }} />}
      {notices.data && !shown.length && (
        <div className="card empty">
          <Bell size={28} />
          {filter === "unread" ? "No unread messages." : "No messages from Proton yet."}
        </div>
      )}
      {shown.length > 0 && (
        <section className="card" style={{ padding: "4px 12px" }}>
          <ul className="list">
            {shown.map((n) => {
              const Icon = (n.kind && ICONS[n.kind]) || Bell;
              const expanded = open === n.id;
              return (
                <li key={n.id}>
                  <button
                    className="list-row"
                    aria-expanded={expanded}
                    onClick={() => {
                      setOpen(expanded ? null : n.id);
                      if (!n.isRead) markRead([n.id]);
                    }}
                  >
                    <span className={`list-icon ${n.isRead ? "" : "accent"}`}><Icon size={18} /></span>
                    <span className="list-body">
                      <strong>{n.title}</strong>
                      {n.body && (
                        <span className="small" style={expanded ? undefined : { overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          {n.body}
                        </span>
                      )}
                      <span className="muted tiny">{dateTime(n.createdAt)}</span>
                    </span>
                    {!n.isRead && <span className="unread-dot" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

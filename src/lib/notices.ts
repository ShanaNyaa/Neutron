import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { IconName } from "@/components/ui";
import { persistStorage } from "@/core/secure-kv";
import type { Notice, NoticeKind } from "@/core/types";

/** Connection ids whose inbox section is collapsed. */
const useFolded = create<{ folded: string[] }>()(persist((): { folded: string[] } => ({ folded: [] }), { name: "pref.inboxFolded", storage: persistStorage }));

export const useFoldedInbox = () => useFolded((s) => s.folded);

export function toggleInboxFold(connectionId: string) {
  const { folded } = useFolded.getState();
  useFolded.setState({ folded: folded.includes(connectionId) ? folded.filter((id) => id !== connectionId) : [...folded, connectionId] });
}

const ICONS: Record<NoticeKind, IconName> = { security: "shield-outline", service: "construct-outline", command: "radio-outline" };

export const iconFor = (n: Notice): IconName => (n.kind ? ICONS[n.kind] : "notifications-outline");

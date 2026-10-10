import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import { Text } from "@/components/text";
import { BrandGlyph } from "@/components/brand";
import { Group, Inset, PanelRow } from "@/components/panel";
import { Empty, Icon, Loading, Page } from "@/components/ui";
import { useAllNotices, useMarkNoticesRead } from "@/hooks/queries";
import { usePullToRefresh, useRefreshOnFocus } from "@/lib/refresh";
import type { Notice } from "@/core/types";
import { ago } from "@/lib/format";
import { iconFor, toggleInboxFold, useFoldedInbox } from "@/lib/notices";
import { getProvider } from "@/providers";

/** Messages shown per connection at first, and added per "Load more". */
const PAGE = 5;

export default function Inbox() {
  const { notices, isLoading, refetch } = useAllNotices();
  const pull = usePullToRefresh(refetch);
  useRefreshOnFocus(["notices"]);
  const folded = useFoldedInbox();
  const [limits, setLimits] = useState<Record<string, number>>({});
  const loadMore = (id: string) => setLimits((l) => ({ ...l, [id]: (l[id] ?? PAGE) + PAGE }));

  const groups: { connection: (typeof notices)[number]["connection"]; items: typeof notices }[] = [];
  for (const n of notices) {
    const g = groups.find((x) => x.connection.id === n.connection.id);
    if (g) g.items.push(n);
    else groups.push({ connection: n.connection, items: [n] });
  }

  return (
    <Page title="Inbox" refresh={pull}>
      {isLoading ? (
        <Loading />
      ) : notices.length === 0 ? (
        <Empty icon="notifications-off-outline" title="All caught up" body="Alerts and messages from your cars show up here." />
      ) : (
        groups.map(({ connection, items }, i) => {
          const provider = getProvider(connection.providerId);
          const unread = items.filter((n) => !n.isRead).length;
          const open = !folded.includes(connection.id);
          const limit = limits[connection.id] ?? PAGE;
          const shown = items.slice(0, limit);
          const hidden = items.length - shown.length;
          return (
            <Animated.View key={connection.id} layout={LinearTransition.duration(250)} className={`gap-3 ${i > 0 ? "mt-3" : ""}`}>
              <Pressable
                onPress={() => toggleInboxFold(connection.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityHint={open ? "Hides these messages" : "Shows these messages"}
                className="flex-row items-center gap-2 px-1 active:opacity-60"
              >
                <BrandGlyph provider={provider} size={18} />
                <Text className="text-foreground text-base font-semibold shrink" numberOfLines={1}>
                  {connection.label || provider?.name}
                </Text>
                <Icon name={open ? "chevron-down" : "chevron-forward"} size={14} colorClassName="accent-muted" />
                <Text className="text-muted text-sm flex-1" numberOfLines={1}>
                  {open ? "" : unread ? `${unread} unread` : `${items.length}`}
                </Text>
                {unread ? <MarkAllRead connectionId={connection.id} notices={items.filter((n) => !n.isRead)} /> : null}
              </Pressable>
              {open ? (
                <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
                  <Group>
                    {shown.map((n) => (
                      <NoticeRow key={n.id} notice={n} connectionId={connection.id} />
                    ))}
                    {hidden > 0 ? (
                      <PanelRow
                        icon="chevron-down-circle-outline"
                        label="Load More"
                        value={`${hidden} left`}
                        isChevronVisible={false}
                        onPress={() => loadMore(connection.id)}
                      />
                    ) : null}
                  </Group>
                </Animated.View>
              ) : null}
            </Animated.View>
          );
        })
      )}
    </Page>
  );
}

function NoticeRow({ notice: n, connectionId }: { notice: Notice; connectionId: string }) {
  const [open, setOpen] = useState(false);
  const markRead = useMarkNoticesRead(connectionId);
  const body = n.body;
  const onPress = () => {
    if (!n.isRead) markRead.mutate([n]);
    if (body) setOpen((o) => !o);
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={!body && n.isRead}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityHint={body ? (open ? "Collapses the message" : "Shows the full message") : undefined}
      className="active:opacity-70"
    >
      <Inset className="flex-row gap-3">
        <Icon name={iconFor(n)} size={20} colorClassName={n.isRead ? "accent-muted" : "accent-foreground"} style={{ marginTop: 1 }} />
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text
              className={`text-base flex-1 ${n.isRead ? "text-muted font-normal" : "text-foreground font-semibold"}`}
              numberOfLines={1}
              accessibilityLabel={n.isRead ? n.title : `Unread, ${n.title}`}
            >
              {n.title}
            </Text>
            <Text className="text-muted text-xs">{ago(n.createdAt)}</Text>
          </View>
          {body ? (
            <Text className={`text-sm leading-5 ${n.isRead ? "text-muted/70" : "text-foreground/80"}`} numberOfLines={open ? undefined : 2}>
              {open ? body : body.replace(/\s*\n\s*/g, " ")}
            </Text>
          ) : null}
        </View>
      </Inset>
    </Pressable>
  );
}

function MarkAllRead({ connectionId, notices }: { connectionId: string; notices: Notice[] }) {
  const markRead = useMarkNoticesRead(connectionId);
  return (
    <Pressable
      onPress={() => markRead.mutate(notices)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Mark ${notices.length} as read`}
      className="active:opacity-60"
    >
      <Text className="text-muted text-sm font-medium">Mark All Read</Text>
    </Pressable>
  );
}

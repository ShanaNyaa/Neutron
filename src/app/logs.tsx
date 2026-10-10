import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { Sheet } from "@/components/sheet";
import { Text } from "@/components/text";
import { Button, Empty, Icon, PageHeader } from "@/components/ui";
import { clearLogs, exportLogs, useLogs, type LogCategory, type LogEntry } from "@/lib/log";

type Filter = "all" | LogCategory | "errors";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "http", label: "HTTP" },
  { id: "push", label: "Push" },
  { id: "command", label: "Commands" },
  { id: "data", label: "Data" },
  { id: "errors", label: "Errors" },
];

const CATEGORY_LABEL: Record<LogCategory, string> = { http: "HTTP", push: "Push", command: "Command", data: "Data", app: "App" };

export default function Logs() {
  const entries = useLogs();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const insets = useSafeAreaInsets();

  const shown = useMemo(
    () =>
      entries
        .filter((e) => (filter === "all" ? true : filter === "errors" ? e.level !== "info" : e.category === filter))
        .slice()
        .reverse(),
    [entries, filter],
  );

  // Same round buttons as the Connections tab's "+".
  const actions = (
    <View className="flex-row items-center gap-2">
      <Pressable
        onPress={() => setExporting(true)}
        accessibilityRole="button"
        accessibilityLabel="Export Logs"
        className="size-10 rounded-full bg-inset items-center justify-center active:opacity-60"
      >
        <Icon name="share-outline" size={20} colorClassName="accent-foreground" />
      </Pressable>
      <Pressable
        onPress={() => setClearing(true)}
        accessibilityRole="button"
        accessibilityLabel="Clear Logs"
        className="size-10 rounded-full bg-inset items-center justify-center active:opacity-60"
      >
        <Icon name="trash-outline" size={19} colorClassName="accent-foreground" />
      </Pressable>
    </View>
  );

  return (
    <>
      <FlatList
        className="flex-1 bg-background"
        contentContainerClassName="px-4 pb-16 gap-2"
        contentContainerStyle={{ paddingTop: insets.top + 20 }}
        data={shown}
        keyExtractor={(e) => String(e.id)}
        ListHeaderComponent={
          <View>
            <PageHeader title="Debug Logs" right={actions} isBackVisible />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4 mb-2" contentContainerClassName="px-4 gap-2 py-3">
              {FILTERS.map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => setFilter(f.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: filter === f.id }}
                  className={`rounded-full px-4 py-2 active:opacity-70 ${filter === f.id ? "bg-foreground/15" : "bg-inset"}`}
                >
                  <Text className={`text-sm font-medium ${filter === f.id ? "text-foreground" : "text-muted"}`}>{f.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={<Empty icon="document-text-outline" title="Nothing logged yet" body="Requests, push messages and commands show up here as the app runs." />}
        renderItem={({ item }) => <Row entry={item} isOpen={open === item.id} onPress={() => setOpen((o) => (o === item.id ? null : item.id))} />}
      />
      <Sheet isVisible={exporting} onClose={() => setExporting(false)} title="Export Logs">
        <ExportLogs count={entries.length} onDone={() => setExporting(false)} />
      </Sheet>
      <ConfirmSheet
        isVisible={clearing}
        title="Clear Debug Logs?"
        message="This removes every entry."
        action="Clear"
        pendingAction="Clearing…"
        onConfirm={async () => clearLogs()}
        onClose={() => setClearing(false)}
      />
    </>
  );
}

function ExportLogs({ count, onDone }: { count: number; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(exportLogs());
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(onDone, 700);
  };

  return (
    <>
      <Text className="text-muted text-sm">
        {count === 1 ? "1 entry" : `${count} entries`}. Passwords, tokens, PINs and phone numbers are removed; VINs are cut to the last 4.
      </Text>
      <Button
        title={copied ? "Copied" : "Copy to Clipboard"}
        icon={copied ? "checkmark" : "copy-outline"}
        onPress={copied ? undefined : copy}
        isDisabled={!count}
      />
    </>
  );
}

function Row({ entry: e, isOpen: open, onPress }: { entry: LogEntry; isOpen: boolean; onPress: () => void }) {
  const tone = e.level === "error" ? "text-danger" : e.level === "warn" ? "text-warning" : "text-foreground";
  return (
    <Pressable onPress={onPress} disabled={!e.detail} className="rounded-2xl bg-inset p-3 gap-1 active:opacity-70">
      <View className="flex-row items-center gap-2">
        <Text className="text-muted text-xs" style={{ fontVariant: ["tabular-nums"] }}>
          {new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </Text>
        <Text className="text-muted text-xs font-semibold">{CATEGORY_LABEL[e.category]}</Text>
        <View className="flex-1" />
        {e.detail ? <Icon name={open ? "chevron-up" : "chevron-down"} size={14} colorClassName="accent-muted" /> : null}
      </View>
      <Text className={`text-sm ${tone}`} numberOfLines={open ? undefined : 2} selectable={open}>
        {e.message}
      </Text>
      {open && e.detail ? (
        <Text className="text-muted text-xs mt-1" style={{ fontFamily: "Menlo" }} selectable>
          {e.detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

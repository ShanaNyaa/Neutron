import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, useWindowDimensions, View } from "react-native";
import { withUniwind } from "uniwind";

import { Text } from "@/components/text";
import type { CommandDefinition, CommandId, VehicleStatus } from "@/core/types";
import { confirmWithBiometrics, SENSITIVE, useConfirmMode } from "@/lib/confirm";
import { HOLD_MS, HoldProgress, useHoldProgress } from "@/components/hold-progress";
import { Readouts } from "@/components/readouts";
import { Stepper } from "@/components/stepper";
import { Sheet, SHEET_CLOSE_MS } from "@/components/sheet";
import { Group, PanelRow } from "@/components/panel";
import { Button, Icon, Section, SHADOW, type IconName } from "@/components/ui";
import { MAX_TILES, type TileId } from "@/lib/top-controls";

const Spinner = withUniwind(ActivityIndicator);

type Send = (c: CommandDefinition, params?: Record<string, string | number>, confirmed?: boolean) => void;
type Tone = "default" | "warn" | "active";

/** `safe` is sent when the state is unknown. */
type Toggle = {
  /** The tile's name, e.g. "Doors". */
  name: string;
  /** e.g. ["Locked", "Unlocked"]: shown when the state is on / off. */
  states: [string, string];
  on: CommandId;
  off: CommandId;
  safe: CommandId;
  isOn: (s: VehicleStatus) => boolean | undefined;
  tone: (on: boolean) => Tone;
  /** Shown instead of `states`, with `tone`, when the car reports a state other than the toggle's. */
  shown?: (s: VehicleStatus) => { state: string; tone: Tone } | undefined;
  onIcon: IconName;
  offIcon: IconName;
};

const WINDOWS = ["frontLeft", "frontRight", "rearLeft", "rearRight"] as const;

const TOGGLES = {
  lock: {
    name: "Doors",
    states: ["Locked", "Unlocked"],
    on: "lock",
    off: "unlock",
    safe: "lock",
    isOn: (s) => (s.lock === "locked" ? true : s.lock === "unlocked" ? false : undefined),
    tone: (locked) => (locked ? "default" : "warn"),
    onIcon: "lock-closed-outline",
    offIcon: "lock-open-outline",
  },
  engine: {
    name: "Engine",
    states: ["Running", "Off"],
    on: "engine_start",
    off: "engine_stop",
    safe: "engine_start",
    isOn: (s) => s.isEngineOn,
    tone: (running) => (running ? "active" : "default"),
    onIcon: "power-outline",
    offIcon: "power-outline",
  },
  windows: {
    name: "Windows",
    states: ["Open", "Closed"],
    on: "windows_open",
    off: "windows_close",
    safe: "windows_close",
    isOn: (s) => {
      const known = WINDOWS.filter((k) => s.windows?.[k] === "open" || s.windows?.[k] === "closed");
      return known.length ? known.some((k) => s.windows?.[k] === "open") : undefined;
    },
    tone: (open) => (open ? "warn" : "default"),
    onIcon: "expand-outline",
    offIcon: "contract-outline",
  },
  charge: {
    name: "Charging",
    states: ["Charging", "Not charging"],
    on: "charge_start",
    off: "charge_stop",
    safe: "charge_start",
    isOn: (s) => s.isCharging,
    tone: (charging) => (charging ? "active" : "default"),
    onIcon: "flash-outline",
    offIcon: "flash-off-outline",
  },
  trunk: {
    name: "Trunk",
    states: ["Locked", "Unlocked"],
    on: "trunk_lock",
    off: "trunk_open",
    safe: "trunk_lock",
    isOn: (s) => s.isTrunkLocked,
    // Unlocked usually just means the doors are unlocked (the trunk follows central locking), and
    // the Doors tile already warns about that.
    tone: () => "default",
    // The car reports whether the trunk is open (trunkOpenStatus) far more reliably than its lock.
    shown: (s) => (s.doors?.trunk === "open" ? { state: "Open", tone: "warn" } : s.doors?.trunk === "closed" ? { state: "Closed", tone: "default" } : undefined),
    onIcon: "car-outline",
    offIcon: "car-outline",
  },
} satisfies Record<string, Toggle>;

/** One or two words, so tile captions and round buttons never truncate. */
const SHORT: Partial<Record<CommandId, string>> = {
  lock: "Lock",
  unlock: "Unlock",
  engine_start: "Start",
  engine_stop: "Stop",
  horn_lights: "Honk",
  lights: "Flash",
  trunk_open: "Unlock Trunk",
  trunk_lock: "Lock Trunk",
  windows_open: "Open Windows",
  windows_close: "Close Windows",
  sunroof_close: "Close Roof",
  charge_start: "Charge",
  charge_stop: "Stop Charge",
  defrost_on: "Defrost",
};

function outline(icon: string): IconName {
  const o = `${icon}-outline`;
  return (o in Ionicons.glyphMap ? o : icon) as IconName;
}

/** The round button's diameter (size-16). */
const BUTTON = 64;

const fmt = (t: number) => `${t % 1 ? t.toFixed(1) : t}°`;

type TileProps = {
  icon: IconName;
  name: string;
  /** The state or reading, e.g. "Locked" or "31°". */
  value: string;
  /** The action, e.g. "Unlock"; the hold hint while it shows. */
  caption: string;
  a11y: string;
  tone: Tone;
  isLoading?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

/** The toggles' names and which of their commands they cover, for the top-row editor. */
const TOGGLE_IDS = Object.keys(TOGGLES) as (keyof typeof TOGGLES)[];
const isToggle = (id: TileId): id is keyof typeof TOGGLES => id in TOGGLES;

export function ControlDeck({
  commands,
  status = {},
  pending,
  isClimateOpen: openClimate,
  tiles: tileIds,
  onTilesChange,
  onCommand,
}: {
  commands: CommandDefinition[];
  status?: VehicleStatus;
  pending?: CommandId;
  isClimateOpen?: boolean;
  /** The top row, in order (lib/top-controls.ts). */
  tiles: TileId[];
  onTilesChange: (tiles: TileId[]) => void;
  onCommand: Send;
}) {
  const byId = (id: CommandId) => commands.find((c) => c.id === id);
  const busy = pending != null;
  // Buttons are centred in quarter-width cells; bleeding the grid out by the cell margin lines the first and
  // last buttons up with the heading text, which sits 4pt inside the page padding (Heading's px-1).
  // Solved from 4 cells of (56 + 2m) spanning the content plus 2m.
  const { width } = useWindowDimensions();
  const bleed = Math.max(0, (width - 32 - 8 - 4 * BUTTON) / 6);

  const bio = useConfirmMode() === "biometric";
  const [holdHint, setHoldHint] = useState<CommandId>();
  const needsHold = (c: CommandDefinition) => SENSITIVE.has(c.id);
  const confirmThen = (c: CommandDefinition, params?: Record<string, string | number>) => {
    if (!bio) return onCommand(c, params);
    confirmWithBiometrics(c.label).then((ok) => ok && onCommand(c, params, true));
  };
  const tap = (c: CommandDefinition, params?: Record<string, string | number>) => {
    if (!needsHold(c)) return onCommand(c, params);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setHoldHint(c.id);
    setTimeout(() => setHoldHint((h) => (h === c.id ? undefined : h)), 2000);
  };
  const holdFor = (c: CommandDefinition) =>
    needsHold(c)
      ? () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          confirmThen(c);
        }
      : undefined;
  const labelFor = (c: CommandDefinition, label: string) => (holdHint === c.id ? `Hold to ${label}` : label);
  // The tile's next action, e.g. "Unlock"; a tap on a hold-only command swaps in "Hold to Unlock" for a moment.
  const actionFor = (c: CommandDefinition) => {
    const label = SHORT[c.id] ?? c.label;
    return holdHint === c.id ? `Hold to ${label}` : label;
  };
  const [sheet, setSheet] = useState<"climate" | "more" | "edit" | null>(openClimate ? "climate" : null);

  const climateOn = byId("climate_on");
  const climateOff = byId("climate_off");
  const tempParam = climateOn?.params?.find((x) => x.type === "number");
  const target = status.climate?.targetTempC ?? Number(tempParam?.default ?? 22);
  const running = !!status.climate?.isOn;
  const cabin = status.climate?.cabinTempC;
  const outside = status.climate?.outsideTempC;
  // The cabin reading when the car reports one; the caption says what it is and what climate is doing.
  const climateValue = cabin != null ? fmt(cabin) : running ? "On" : "Off";
  const climateCaption =
    cabin != null ? (running ? `Inside, set to ${fmt(target)}` : "Inside, climate off") : running ? `Set to ${fmt(target)}` : "Tap to Set";
  const climateCmd = running && climateOff ? climateOff : climateOn;
  const climateBusy = pending === "climate_on" || pending === "climate_off";
  const sendClimate = (temp: number) => {
    if (!climateCmd) return;
    onCommand(climateCmd, climateCmd === climateOn && tempParam ? { [tempParam.key]: temp } : undefined);
  };

  const resolve = (t: Toggle) => {
    if (!byId(t.on) && !byId(t.off)) return null;
    const on = t.isOn(status);
    const next = byId(on == null ? t.safe : on ? t.off : t.on) ?? byId(t.on) ?? byId(t.off)!;
    const shown = t.shown?.(status);
    return {
      next,
      name: t.name,
      state: shown?.state ?? (on == null ? "Unknown" : t.states[on ? 0 : 1]),
      icon: next.id === t.on ? t.onIcon : t.offIcon,
      tone: shown?.tone ?? (on == null ? ("default" as Tone) : t.tone(on)),
      loading: pending === t.on || pending === t.off,
    };
  };

  // What a tile shows and does, by its id; null when this car can't do it.
  const tileFor = (id: TileId): TileProps | null => {
    if (isToggle(id)) {
      const t = resolve(TOGGLES[id]);
      if (!t) return null;
      return {
        icon: t.icon,
        name: t.name,
        value: t.state,
        caption: actionFor(t.next),
        a11y: `${t.name} ${t.state.toLowerCase()}. ${t.next.label}`,
        tone: t.tone,
        isLoading: t.loading,
        onPress: () => tap(t.next),
        onLongPress: holdFor(t.next),
      };
    }
    if (id === "climate") {
      if (!climateCmd) return null;
      return {
        icon: "snow-outline",
        name: "Climate",
        value: climateValue,
        caption: climateCaption,
        a11y: [`Climate ${running ? "on" : "off"}`, fmt(target), cabin != null ? `inside ${fmt(cabin)}` : null, outside != null ? `outside ${fmt(outside)}` : null]
          .filter(Boolean)
          .join(", "),
        tone: running ? "active" : "default",
        isLoading: climateBusy,
        onPress: () => setSheet("climate"),
      };
    }
    const c = byId(id);
    if (!c) return null;
    const short = SHORT[c.id] ?? c.label;
    return {
      icon: outline(c.icon),
      name: c.label,
      value: short,
      caption: holdHint === c.id ? `Hold to ${short}` : `${needsHold(c) ? "Hold" : "Tap"} to ${short}`,
      a11y: c.label,
      tone: "default",
      isLoading: pending === c.id,
      onPress: () => tap(c),
      onLongPress: holdFor(c),
    };
  };

  const top = tileIds.map((id) => ({ id, tile: tileFor(id) })).filter((x): x is { id: TileId; tile: TileProps } => !!x.tile);
  const onTop = new Set(top.map((x) => x.id));

  // Everything a tile on the top row already covers stays off the rows below.
  const covered = new Set<CommandId>();
  for (const id of onTop) {
    if (isToggle(id)) covered.add(TOGGLES[id].on).add(TOGGLES[id].off);
    else if (id === "climate") covered.add("climate_on").add("climate_off");
    else covered.add(id);
  }
  const moreToggles = TOGGLE_IDS.filter((k) => !onTop.has(k))
    .map((k) => resolve(TOGGLES[k]))
    .filter((x) => x != null);
  const climateInMore = !onTop.has("climate") && !!climateCmd;
  const shown = new Set<CommandId>([...covered, ...TOGGLE_IDS.flatMap((k) => [TOGGLES[k].on, TOGGLES[k].off]), "climate_on", "climate_off"]);
  const moreActions = commands.filter((c) => !shown.has(c.id));
  const moreIds = new Set<CommandId>([...moreToggles.map((t) => t.next.id), ...moreActions.map((c) => c.id)]);

  // Tiles this car could put on the top row: each toggle, climate, and any command a toggle doesn't cover.
  const toggleCommands = new Set<CommandId>([...TOGGLE_IDS.flatMap((k) => [TOGGLES[k].on, TOGGLES[k].off]), "climate_on", "climate_off"]);
  const options: { id: TileId; label: string }[] = [
    ...TOGGLE_IDS.filter((k) => resolve(TOGGLES[k])).map((k) => ({ id: k as TileId, label: TOGGLES[k].name })),
    ...(climateCmd ? [{ id: "climate" as TileId, label: "Climate" }] : []),
    ...commands.filter((c) => !toggleCommands.has(c.id)).map((c) => ({ id: c.id as TileId, label: c.label })),
  ];

  // Close the sheet before sending so a PIN sheet can open cleanly after it.
  const fromSheet = (fn: () => void) => {
    setSheet(null);
    setTimeout(fn, SHEET_CLOSE_MS + 50);
  };

  return (
    <>
      {/* The user's picks, then More; everything else is in the More sheet. Four to a row, like a keypad. */}
      <Section title="Controls" className="mt-3">
        <View className="flex-row flex-wrap gap-y-5" style={{ marginHorizontal: 4 - bleed }}>
          {top.map(({ id, tile }) => (
            <IconAction
              key={id}
              icon={tile.icon}
              label={id === "climate" ? "Climate" : tile.caption}
              a11y={`${tile.a11y}. ${tile.value}`}
              isActive={tile.tone === "active"}
              isWarning={tile.tone === "warn"}
              isLoading={tile.isLoading}
              isDisabled={busy}
              onPress={tile.onPress}
              onLongPress={tile.onLongPress}
            />
          ))}
          <IconAction
            icon="ellipsis-horizontal"
            label="More"
            a11y="More controls"
            isLoading={pending != null && moreIds.has(pending)}
            onPress={() => setSheet("more")}
          />
        </View>
      </Section>

      {climateOn ? (
        <Sheet isVisible={sheet === "climate"} onClose={() => setSheet(null)} title="Climate">
          <ClimateSettings
            param={tempParam}
            initial={target}
            isRunning={running}
            cabin={cabin}
            outside={outside}
            isLoading={climateBusy}
            onToggle={(temp) => fromSheet(() => sendClimate(temp))}
          />
        </Sheet>
      ) : null}

      <Sheet isVisible={sheet === "more"} onClose={() => setSheet(null)} title="More Controls">
        <View className="gap-2">
          {moreToggles.map((t) => (
            <SheetRow
              key={t.next.id}
              icon={t.icon}
              label={labelFor(t.next, t.next.label)}
              isWarning={t.tone === "warn"}
              isDisabled={busy}
              onPress={() => (needsHold(t.next) ? tap(t.next) : fromSheet(() => onCommand(t.next)))}
              onLongPress={needsHold(t.next) ? () => fromSheet(() => confirmThen(t.next)) : undefined}
            />
          ))}
          {climateInMore ? <SheetRow icon="snow-outline" label="Climate" onPress={() => fromSheet(() => setSheet("climate"))} /> : null}
          {moreActions.map((c) => (
            <SheetRow
              key={c.id}
              icon={outline(c.icon)}
              label={labelFor(c, c.label)}
              isDanger={c.isDestructive}
              isDisabled={busy}
              onPress={() => (needsHold(c) ? tap(c) : fromSheet(() => onCommand(c)))}
              onLongPress={needsHold(c) ? () => fromSheet(() => confirmThen(c)) : undefined}
            />
          ))}
          <SheetRow icon="options-outline" label="Arrange Controls" onPress={() => fromSheet(() => setSheet("edit"))} />
        </View>
      </Sheet>

      <Sheet isScrollable isLarge isVisible={sheet === "edit"} onClose={() => setSheet(null)} title="Arrange Controls">
        <TileEditor options={options} selected={tileIds.filter((id) => options.some((o) => o.id === id))} onChange={onTilesChange} />
      </Sheet>
    </>
  );
}

/** Pick up to MAX_TILES controls for the grid and order them. */
function TileEditor({ options, selected, onChange }: { options: { id: TileId; label: string }[]; selected: TileId[]; onChange: (ids: TileId[]) => void }) {
  const labelOf = (id: TileId) => options.find((o) => o.id === id)?.label ?? id;
  const move = (i: number, by: -1 | 1) => {
    const next = [...selected];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item);
    Haptics.selectionAsync();
    onChange(next);
  };
  const remove = (id: TileId) => selected.length > 1 && onChange(selected.filter((x) => x !== id));
  const add = (id: TileId) => selected.length < MAX_TILES && onChange([...selected, id]);
  const available = options.filter((o) => !selected.includes(o.id));
  const arrow = (label: string, isDisabled: boolean, onPress: () => void): ReactNode => (
    <Pressable onPress={onPress} disabled={isDisabled} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} className={isDisabled ? "opacity-25" : "active:opacity-60"}>
      <Icon name={label.startsWith("Move up") ? "chevron-up" : "chevron-down"} size={20} colorClassName="accent-foreground" />
    </Pressable>
  );

  return (
    <View className="gap-5">
      <Text className="text-muted text-sm">Up to {MAX_TILES} controls, in this order; the rest stay under More. Tap one to remove it.</Text>
      {/* Plain headings, flush with the sheet padding like its title; Section's heading carries a page-style inset. */}
      <View className="gap-3">
        <Text className="text-foreground text-base font-semibold">In the Grid</Text>
        <Group>
          {selected.map((id, i) => (
            <PanelRow
              key={id}
              icon="remove-circle-outline"
              iconTone={selected.length > 1 ? "bad" : "default"}
              label={labelOf(id)}
              isChevronVisible={false}
              onPress={selected.length > 1 ? () => remove(id) : undefined}
              trailing={
                <View className="flex-row items-center gap-4">
                  {arrow(`Move up ${labelOf(id)}`, i === 0, () => move(i, -1))}
                  {arrow(`Move down ${labelOf(id)}`, i === selected.length - 1, () => move(i, 1))}
                </View>
              }
            />
          ))}
        </Group>
      </View>
      {available.length ? (
        <View className="gap-3">
          <Text className="text-foreground text-base font-semibold">Under More</Text>
          <Group>
            {available.map((o) => (
              <PanelRow
                key={o.id}
                icon="add-circle-outline"
                label={o.label}
                detail={selected.length >= MAX_TILES ? "Remove one above first" : undefined}
                isChevronVisible={false}
                onPress={selected.length < MAX_TILES ? () => add(o.id) : undefined}
              />
            ))}
          </Group>
        </View>
      ) : null}
    </View>
  );
}

function IconAction({
  icon,
  label,
  a11y,
  isActive: active,
  isWarning: warn,
  isLoading: loading,
  isDisabled: disabled,
  onPress,
  onLongPress,
}: {
  icon: IconName;
  label: string;
  a11y: string;
  /** Running (engine, climate, charging): the circle fills. */
  isActive?: boolean;
  isWarning?: boolean;
  isLoading?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
  /** Set when this action must be held to confirm. */
  onLongPress?: () => void;
}) {
  const hold = useHoldProgress(!!onLongPress);
  const ink = active ? "accent-background" : warn ? "accent-warning" : "accent-foreground";
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={HOLD_MS}
      onPressIn={hold.onPressIn}
      onPressOut={hold.onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      className="w-1/4 items-center gap-2 active:opacity-60"
    >
      <View className={`size-16 rounded-full items-center justify-center ${active ? "bg-foreground" : "bg-inset"}`} style={SHADOW}>
        {loading ? <Spinner size="small" colorClassName={active ? "accent-background" : "accent-muted"} /> : <Icon name={icon} size={27} colorClassName={ink} />}
        {onLongPress ? <HoldProgress progress={hold.progress} radius={32} isInverted={active} /> : null}
      </View>
      <Text className={`text-[13px] leading-4 font-medium text-center ${warn ? "text-warning" : active ? "text-foreground" : "text-muted"}`} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function SheetRow({
  icon,
  label,
  isWarning: warn,
  isDanger: danger,
  isDisabled: disabled,
  onPress,
  onLongPress,
}: {
  icon: IconName;
  label: string;
  isWarning?: boolean;
  isDanger?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
  /** Set when this action must be held to confirm. */
  onLongPress?: () => void;
}) {
  const hold = useHoldProgress(!!onLongPress);
  const text = danger ? "text-danger" : warn ? "text-warning" : "text-foreground";
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={HOLD_MS}
      onPressIn={hold.onPressIn}
      onPressOut={hold.onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      className="flex-row items-center gap-3 rounded-2xl bg-inset px-4 py-3.5 active:opacity-70"
    >
      <Icon name={icon} size={20} colorClassName={danger ? "accent-danger" : warn ? "accent-warning" : "accent-foreground"} />
      <Text className={`text-base font-medium ${text}`}>{label}</Text>
      {onLongPress ? <HoldProgress progress={hold.progress} radius={16} /> : null}
    </Pressable>
  );
}

function ClimateSettings({
  param,
  initial,
  isRunning: running,
  cabin,
  outside,
  isLoading: loading,
  onToggle,
}: {
  param?: NonNullable<CommandDefinition["params"]>[number];
  initial: number;
  isRunning: boolean;
  cabin?: number;
  outside?: number;
  isLoading?: boolean;
  onToggle: (target: number) => void;
}) {
  const [target, setTarget] = useState(initial);
  return (
    <View className="gap-6">
      <View className="items-center gap-1">
        {param ? (
          <Stepper
            value={target}
            unit="°"
            min={param.min ?? 16}
            max={param.max ?? 30}
            step={param.step ?? 0.5}
            decreaseLabel="Cooler"
            increaseLabel="Warmer"
            onChange={setTarget}
          />
        ) : null}
        <Readouts
          className="mt-3"
          items={[
            ...(cabin != null ? [["Inside", fmt(cabin)] as [string, string]] : []),
            ...(outside != null ? [["Outside", fmt(outside)] as [string, string]] : []),
          ]}
        />
      </View>
      <Button
        title={running ? "Turn Off Climate" : param ? `Start at ${fmt(target)}` : "Start Climate"}
        variant={running ? "secondary" : "primary"}
        isLoading={loading}
        onPress={() => onToggle(target)}
      />
    </View>
  );
}

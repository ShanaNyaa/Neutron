import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Children, createContext, isValidElement, useContext, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { Icon, SHADOW, type IconName } from "@/components/ui";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <View className={`gap-3 ${className}`}>{children}</View>;
}

/** Inside a Group, renders as a plain row on the group's card. */
export function Inset({ children, className = "" }: { children: ReactNode; className?: string }) {
  const grouped = useContext(GroupContext);
  return (
    <View className={`${grouped ? "" : "rounded-2xl bg-inset"} p-4 ${className}`} style={grouped ? undefined : SHADOW}>
      {children}
    </View>
  );
}

const GroupContext = createContext(false);

/** Dividers start after the row icon (16 padding + 20 icon + 12 gap). */
export function Group({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <GroupContext.Provider value>
      <View className="rounded-2xl bg-inset overflow-hidden" style={SHADOW}>
        {items.map((child, i) => (
          <View key={child.key ?? i}>
            {i > 0 ? <View className="h-px bg-border ml-12" /> : null}
            {child}
          </View>
        ))}
      </View>
    </GroupContext.Provider>
  );
}

type Tone = "default" | "good" | "warn" | "bad";
const TEXT: Record<Tone, string> = { default: "text-foreground", good: "text-success", warn: "text-warning", bad: "text-danger" };
const BAR: Record<Tone, string> = { default: "bg-foreground", good: "bg-success", warn: "bg-warning", bad: "bg-danger" };

export function Metric({ label, value, unit, icon, tone = "default" }: { label: string; value?: string | number | null; unit?: string; icon?: IconName; tone?: Tone }) {
  return (
    <Inset className="flex-1 gap-1.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-muted text-sm" numberOfLines={1}>
          {label}
        </Text>
        {icon ? <Icon name={icon} size={16} colorClassName="accent-muted" /> : null}
      </View>
      <Text className={`text-2xl font-semibold tracking-tight ${TEXT[tone]}`} numberOfLines={1}>
        {value ?? "—"}
        {value != null && unit ? <Text className="text-sm font-normal"> {unit}</Text> : null}
      </Text>
    </Inset>
  );
}

export function Gauge({
  title,
  subtitle,
  value,
  unit,
  percent,
  tone = "good",
  footer,
}: {
  title: string;
  subtitle?: string;
  value: string;
  unit?: string;
  percent?: number;
  tone?: Tone;
  footer?: ReactNode;
}) {
  return (
    <Inset className="gap-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-foreground text-lg font-semibold">{title}</Text>
          {subtitle ? <Text className="text-muted text-sm">{subtitle}</Text> : null}
        </View>
        <Text className={`text-4xl font-semibold tracking-tight ${TEXT[tone]}`}>
          {value}
          {unit ? <Text className="text-xl font-medium">{unit}</Text> : null}
        </Text>
      </View>
      {percent != null ? (
        <View className="h-2 rounded-full bg-foreground/10 overflow-hidden">
          <View className={`h-full rounded-full ${BAR[tone]}`} style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
        </View>
      ) : null}
      {footer}
    </Inset>
  );
}

const ICON: Record<Tone, string> = { default: "accent-foreground", good: "accent-success", warn: "accent-warning", bad: "accent-danger" };

export function PanelRow({
  icon,
  leading,
  isLeadingFilled: leadingFill,
  label,
  detail,
  value,
  tone = "default",
  iconTone = "default",
  trailing,
  isDestructive: destructive,
  onPress,
  isChevronVisible: chevron = !!onPress && !destructive,
}: {
  icon: IconName;
  /** Replaces `icon`. */
  leading?: ReactNode;
  /** Centre `leading` on the title and detail together, not the title line. */
  isLeadingFilled?: boolean;
  label: string;
  detail?: string;
  value?: string;
  tone?: Tone;
  iconTone?: Tone;
  /** Shown instead of `value`. */
  trailing?: ReactNode;
  isDestructive?: boolean;
  onPress?: () => void;
  isChevronVisible?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} className="active:opacity-60">
      <Inset className="flex-row items-center gap-3">
        {/* With a detail line, pin the icon to the title's 24pt line rather than the block's middle. */}
        <View className={detail && !leadingFill ? "self-start h-6 justify-center" : ""}>
          {leading ?? <Icon name={icon} size={20} colorClassName={destructive ? "accent-danger" : ICON[iconTone]} />}
        </View>
        <View className="flex-1">
          <Text className={`text-base font-medium ${destructive ? "text-danger" : "text-foreground"}`} numberOfLines={1}>
            {label}
          </Text>
          {detail ? (
            <Text className="text-muted text-sm" numberOfLines={onPress ? 2 : undefined}>
              {detail}
            </Text>
          ) : null}
        </View>
        {trailing ? <View className={detail ? "self-start h-6 justify-center" : ""}>{trailing}</View> : null}
        {!trailing && value ? (
          <Text className={`text-base font-medium shrink ${TEXT[tone]}`} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {/* The glyph has ~2pt of empty space on its right. */}
        {chevron ? (
          <View className="-mr-0.5">
            <Icon name="chevron-forward" size={18} colorClassName="accent-muted" />
          </View>
        ) : null}
      </Inset>
    </Pressable>
  );
}

/** A row with a thin bar under its detail, e.g. how much of a data plan is used. `fraction` is 0..1. */
export function MeterRow({ icon, label, detail, fraction, isLow: low }: { icon: IconName; label: string; detail: string; fraction: number; isLow?: boolean }) {
  const pct = Math.max(2, Math.min(100, fraction * 100));
  return (
    // A little more below: the text line carries ~4pt of leading above the glyphs, the bar has none under it.
    <Inset className="flex-row items-center gap-3 pb-5">
      <View className="self-start h-6 justify-center">
        <Icon name={icon} size={20} colorClassName="accent-foreground" />
      </View>
      <View className="flex-1 gap-1" accessible accessibilityLabel={`${label}, ${detail}`}>
        <View className="flex-row items-baseline justify-between gap-3">
          <Text className="text-foreground text-base font-medium" numberOfLines={1}>
            {label}
          </Text>
          <Text className={`text-sm shrink ${low ? "text-danger" : "text-muted"}`} numberOfLines={1}>
            {detail}
          </Text>
        </View>
        <View className="h-1 rounded-full bg-foreground/15 overflow-hidden">
          <View className={`h-full rounded-full ${low ? "bg-danger" : "bg-foreground"}`} style={{ width: `${pct}%` }} />
        </View>
      </View>
    </Inset>
  );
}

export function SecretRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <Inset className="flex-row items-center gap-3">
      <Icon name={icon} size={20} colorClassName="accent-foreground" />
      <View className="flex-1">
        <Text className="text-foreground text-base font-medium">{label}</Text>
        <Text className="text-muted text-sm tracking-wider" numberOfLines={1} selectable={shown}>
          {shown ? value : "•".repeat(value.length)}
        </Text>
      </View>
      <Pressable
        onPress={() => setShown((v) => !v)}
        // Tap area from hitSlop, not padding, so the icon lines up with other rows' values.
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel={shown ? `Hide ${label}` : `Show ${label}`}
        className="active:opacity-60"
      >
        <Icon name={shown ? "eye-off-outline" : "eye-outline"} size={20} colorClassName="accent-muted" />
      </Pressable>
    </Inset>
  );
}

export function TempSlider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [width, setWidth] = useState(0);
  const last = useRef(value);
  const THUMB = 28;
  const frac = (value - min) / (max - min || 1);

  const set = (x: number) => {
    if (!width) return;
    const f = Math.min(1, Math.max(0, (x - THUMB / 2) / (width - THUMB)));
    const v = Math.round((min + f * (max - min)) / step) * step;
    if (v !== last.current) {
      last.current = v;
      Haptics.selectionAsync();
      onChange(v);
    }
  };

  return (
    <View
      className="flex-1 h-11 justify-center"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => set(e.nativeEvent.locationX)}
      onResponderMove={(e) => set(e.nativeEvent.locationX)}
      accessibilityRole="adjustable"
      accessibilityValue={{ min, max, now: value }}
    >
      <View pointerEvents="none" className="h-1.5 rounded-full overflow-hidden bg-foreground/10">
        <LinearGradient
          colors={["#6d8bff", "rgba(128,128,128,0.15)", "rgba(128,128,128,0.15)", "#f5a54a"]}
          locations={[0, 0.3, 0.7, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View
        pointerEvents="none"
        className="absolute rounded-full bg-white border border-black/10 shadow"
        style={{ width: THUMB, height: THUMB, left: frac * Math.max(0, width - THUMB) }}
      />
    </View>
  );
}

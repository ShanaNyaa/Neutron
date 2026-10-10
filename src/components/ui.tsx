import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, type ComponentProps, type ReactNode, type Ref } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View, type ScrollViewProps, type TextInputInstance } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames, withUniwind } from "uniwind";
import { Text, TextInput } from "@/components/text";
import { BackIcon } from "@/components/icons";

export const Icon = withUniwind(Ionicons);

// boxShadow follows CSS rules, so it isn't clipped by the same view's overflow: hidden.
export const SHADOW = { boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06), 0 6px 16px rgba(0, 0, 0, 0.08)" } as const;
export type IconName = ComponentProps<typeof Ionicons>["name"];
const Spinner = withUniwind(ActivityIndicator);

/** Controlled: moves only when `value` does, so a change that needs confirming can wait. */
export function Toggle({
  isOn: value,
  onValueChange,
  isDisabled: disabled,
  accessibilityLabel,
}: {
  isOn: boolean;
  onValueChange: (next: boolean) => void;
  isDisabled?: boolean;
  accessibilityLabel?: string;
}) {
  const on = useResolveClassNames("bg-foreground").backgroundColor as string;
  const off = useResolveClassNames("bg-foreground/15").backgroundColor as string;
  const t = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    t.set(withTiming(value ? 1 : 0, { duration: 200 }));
  }, [value, t]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(t.get(), [0, 1], [off, on]) }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: t.get() * 20 }] }));
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onValueChange(!value);
      }}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      className={disabled ? "opacity-40" : "active:opacity-80"}
    >
      <Animated.View className="rounded-full p-0.5" style={[{ width: 51, height: 31 }, track]}>
        <Animated.View className="rounded-full bg-background" style={[{ width: 27, height: 27 }, SHADOW, knob]} />
      </Animated.View>
    </Pressable>
  );
}

export function Glass({ children, className = "" }: { children?: ReactNode; className?: string; intensity?: number }) {
  return <View className={`overflow-hidden rounded-xl border border-white/10 bg-card ${className}`}>{children}</View>;
}

/** For tab roots, which have no native header. */
/** Pops the stack; a deep link that opened over the tabs goes home instead. */
export function BackButton() {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      className="size-10 rounded-full bg-foreground/10 items-center justify-center active:opacity-60"
    >
      {/* Optical centring. */}
      <BackIcon size={22} strokeWidth={2.25} colorClassName="accent-foreground" style={{ transform: [{ translateX: -1 }] }} />
    </Pressable>
  );
}

type PageHeaderProps = { title: string; description?: string; right?: ReactNode; isBackVisible?: boolean };

/** The native stack header is hidden everywhere; screens draw this instead. */
export function PageHeader({ title, description, right, isBackVisible: back }: PageHeaderProps) {
  return (
    <View className={`flex-row justify-between mb-2 gap-3 ${back ? "items-center" : "items-start"}`}>
      {back ? <BackButton /> : null}
      <View className="flex-1">
        <Text className={`text-foreground font-bold tracking-tight ${back ? "text-2xl" : "text-4xl"}`} numberOfLines={1}>
          {title}
        </Text>
        {description ? <Text className="text-muted text-sm mt-1">{description}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Page({
  title,
  description,
  right,
  isBackVisible,
  refresh,
  children,
  ...rest
}: Partial<PageHeaderProps> & {
  /** From `usePullToRefresh`. The spinner is offset below the status bar, since there's no native header above it. */
  refresh?: { refreshing: boolean; onRefresh: () => void };
  children: ReactNode;
} & ScrollViewProps) {
  const insets = useSafeAreaInsets();
  const tint = useResolveClassNames("text-muted").color as string;
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 pb-40 gap-4"
      contentContainerStyle={{ paddingTop: title ? insets.top + 20 : 12 }}
      refreshControl={
        refresh ? <RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} progressViewOffset={insets.top} tintColor={tint} colors={[tint]} /> : undefined
      }
      {...rest}
    >
      {title ? <PageHeader title={title} description={description} right={right} isBackVisible={isBackVisible} /> : null}
      {children}
    </ScrollView>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Glass className={`p-4 ${className}`}>{children}</Glass>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text className="text-foreground text-base font-semibold px-1">{children}</Text>;
}

export function Section({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <View className={`gap-3 ${className}`}>
      {title ? <Heading>{title}</Heading> : null}
      {children}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View className="flex-row items-center justify-between mt-2 px-1">
      <Text className="text-muted text-xs font-semibold uppercase tracking-widest">{children}</Text>
      {action}
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  isLoading?: boolean;
  isDisabled?: boolean;
  className?: string;
};

export function Button({ title, onPress, icon, variant = "primary", isLoading: loading, isDisabled: disabled, className = "" }: ButtonProps) {
  const styles = {
    primary: ["bg-foreground", "text-background", "accent-background"],
    secondary: ["bg-inset", "text-foreground", "accent-foreground"],
    danger: ["bg-danger/10", "text-danger", "accent-danger"],
    ghost: ["bg-transparent", "text-accent", "accent-accent"],
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      className={`h-12 rounded-2xl flex-row items-center justify-center gap-2 px-5 active:opacity-70 ${styles[0]} ${
        disabled ? "opacity-40" : ""
      } ${className}`}
    >
      {loading ? (
        <Spinner colorClassName={styles[2]} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} colorClassName={styles[2]} /> : null}
          <Text className={`text-base font-semibold ${styles[1]}`}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/** A Field's look for a value that can't be edited here, e.g. a setting chosen on the previous sheet. */
export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    // Outlined, not filled like an input: it reads as a summary, not something to type in.
    <View
      className="h-12 flex-row items-center justify-between rounded-2xl border border-border px-4"
      accessible
      accessibilityLabel={`${label}, ${value}`}
    >
      <Text className="text-muted text-[15px]">{label}</Text>
      <Text className="text-foreground text-[16px] font-medium">{value}</Text>
    </View>
  );
}

export function Field({
  label,
  help,
  error,
  ...input
}: {
  /** When omitted, pass accessibilityLabel instead. */
  label?: string;
  help?: string;
  error?: string;
  ref?: Ref<TextInputInstance>;
} & ComponentProps<typeof TextInput>) {
  return (
    <View className="gap-1.5">
      {label ? <Text className="text-foreground text-sm font-medium px-1">{label}</Text> : null}
      {/* text-[16px], not text-base: a line height pushes TextInput text below centre on iOS. */}
      <TextInput
        accessibilityLabel={label}
        textAlignVertical="center"
        cursorColorClassName="accent-foreground"
        selectionColorClassName="accent-foreground/30"
        className="h-12 rounded-2xl bg-inset px-4 py-0 text-[16px] text-foreground"
        placeholderTextColorClassName="accent-muted"
        autoCapitalize="none"
        autoCorrect={false}
        {...input}
      />
      {error ? (
        <Text className="text-danger text-xs px-1">{error}</Text>
      ) : help ? (
        <Text className="text-muted text-xs px-1">{help}</Text>
      ) : null}
    </View>
  );
}

export function Stat({
  icon,
  label,
  value,
  unit,
  tone = "default",
}: {
  icon: IconName;
  label: string;
  value?: string | number | null;
  unit?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls = { default: "accent-muted", good: "accent-success", warn: "accent-warning", bad: "accent-danger" }[tone];
  return (
    <Glass className="flex-1 min-w-[45%] p-4 gap-3">
      <View className="flex-row items-center gap-2">
        <Icon name={icon} size={16} colorClassName={toneCls} />
        <Text className="text-muted text-xs font-medium">{label}</Text>
      </View>
      <Text className="text-foreground text-2xl font-semibold tracking-tight">
        {value ?? "—"}
        {value != null && unit ? <Text className="text-muted text-base font-normal"> {unit}</Text> : null}
      </Text>
    </Glass>
  );
}

export function ListRow({
  icon,
  iconColor,
  leading,
  title,
  subtitle,
  right,
  onPress,
  isChevronVisible: chevron = !!onPress,
}: {
  icon?: IconName;
  iconColor?: string;
  /** Overrides `icon`. */
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  isChevronVisible?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} className="flex-row items-center gap-3 py-3 active:opacity-60">
      {leading ??
        (icon ? (
          <View className="size-10 rounded-lg items-center justify-center" style={{ backgroundColor: `${iconColor ?? "#64748b"}22` }}>
            <Ionicons name={icon} size={20} color={iconColor ?? "#64748b"} />
          </View>
        ) : null)}
      <View className="flex-1">
        <Text className="text-foreground text-base font-medium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-muted text-sm" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <Icon name="chevron-forward" size={18} colorClassName="accent-muted" /> : null}
    </Pressable>
  );
}

export function Divider() {
  return <View className="h-px bg-border" />;
}

export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <View className="items-center gap-3 py-12 px-6">
      <Glass className="size-16 items-center justify-center">
        <Icon name={icon} size={30} colorClassName="accent-muted" />
      </Glass>
      <Text className="text-foreground text-lg font-semibold text-center">{title}</Text>
      {body ? <Text className="text-muted text-sm text-center leading-5">{body}</Text> : null}
      {action}
    </View>
  );
}

export function Banner({ tone = "bad", children, onPress }: { tone?: "bad" | "warn"; children: ReactNode; onPress?: () => void }) {
  const cls = tone === "bad" ? "bg-danger/10 border-danger/30" : "bg-warning/10 border-warning/30";
  const icn = tone === "bad" ? "accent-danger" : "accent-warning";
  return (
    <Pressable onPress={onPress} disabled={!onPress} className={`flex-row gap-3 items-center rounded-lg border p-3 ${cls}`}>
      <Icon name={tone === "bad" ? "alert-circle" : "warning"} size={20} colorClassName={icn} />
      <Text className="text-foreground text-sm flex-1">{children}</Text>
      {onPress ? <Icon name="chevron-forward" size={16} colorClassName="accent-muted" /> : null}
    </Pressable>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View className="items-center justify-center py-16 gap-3">
      <Spinner colorClassName="accent-muted" />
      {label ? <Text className="text-muted text-sm">{label}</Text> : null}
    </View>
  );
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "good" | "warn" | "bad" | "accent" }) {
  const cls = {
    default: "bg-surface-2 text-muted",
    good: "bg-success/15 text-success",
    warn: "bg-warning/15 text-warning",
    bad: "bg-danger/15 text-danger",
    accent: "bg-accent/15 text-accent",
  }[tone];
  return <Text className={`self-start overflow-hidden rounded-md px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</Text>;
}

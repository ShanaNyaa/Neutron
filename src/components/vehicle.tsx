import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Link, router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { withUniwind } from "uniwind";

import { Text } from "@/components/text";
import type { Connection } from "@/core/connections";
import { useSavedPin, useSendCommand, useVehicleStatus } from "@/hooks/queries";
import type { CommandDefinition, Vehicle, VehicleStatus } from "@/core/types";
import { confirmWithBiometrics, SENSITIVE, useConfirmMode } from "@/lib/confirm";
import { paintHex, tintFade } from "@/lib/paint";
import { getProvider } from "@/providers";
import { AlertIcon, ClimateIcon, LockIcon, LockOpenIcon, ParkIcon, PowerIcon } from "@/components/icons";
import { BrandGlyph } from "@/components/brand";
import { HOLD_MS, HoldProgress, useHoldProgress } from "@/components/hold-progress";
import { Icon, SHADOW, type IconName } from "@/components/ui";
import { useState, type ComponentType } from "react";

const StyledImage = withUniwind(Image);
const Spinner = withUniwind(ActivityIndicator);

const CHIP_TONE = {
  good: ["bg-success/15", "text-success", "accent-success"],
  warn: ["bg-warning/15", "text-warning", "accent-warning"],
  accent: ["bg-accent/15", "text-accent", "accent-accent"],
  bad: ["bg-danger/15", "text-danger", "accent-danger"],
  default: ["bg-surface-2", "text-muted", "accent-muted"],
} as const;

/** A status in a tinted box: the icon alone, or with a short label when it needs words. */
function StatusChip({
  icon: IconCmp,
  label,
  tone = "default",
  a11y,
}: {
  icon: ComponentType<{ size?: number; strokeWidth?: number; colorClassName?: string }>;
  label?: string;
  tone?: keyof typeof CHIP_TONE;
  a11y: string;
}) {
  const [bg, text, accent] = CHIP_TONE[tone];
  return (
    <View className={`h-7 flex-row items-center gap-1.5 rounded-lg ${label ? "pl-2 pr-2.5" : "w-7 justify-center"} ${bg}`} accessible accessibilityLabel={a11y}>
      <IconCmp size={15} strokeWidth={2.5} colorClassName={accent} />
      {label ? <Text className={`text-xs font-semibold ${text}`}>{label}</Text> : null}
    </View>
  );
}

export function VehicleHero({ vehicle, accent, height = 180 }: { vehicle: Vehicle; accent?: string; height?: number }) {
  const images = [vehicle.imageUrl, ...(vehicle.gallery ?? [])].filter((x): x is string => !!x);
  if (images.length === 0) {
    return (
      <View className="items-center justify-center rounded-xl bg-surface-2" style={{ height }}>
        <View className="absolute inset-x-10 bottom-8 h-6 rounded-full bg-foreground/5" />
        <Icon name="car-sport" size={height * 0.55} colorClassName="accent-muted/40" />
        {accent ? <View className="absolute top-4 left-4 size-2 rounded-full" style={{ backgroundColor: accent }} /> : null}
      </View>
    );
  }
  if (images.length === 1) {
    return <StyledImage source={images[0]} contentFit="contain" transition={200} className="w-full" style={{ height }} />;
  }
  return (
    <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} className="rounded-xl">
      {images.map((uri) => (
        <StyledImage key={uri} source={uri} contentFit="contain" transition={200} style={{ height, width: 340 }} />
      ))}
    </ScrollView>
  );
}

/**
 * `labels`: extra text on a chip, e.g. a remote start's countdown on the engine chip.
 * `alerts`: the car's warnings, as amber chips after the states.
 * `isQuiet`: only what's notable: skips locked and brake on, and folds the warnings into one chip.
 */
export function StatusIcons({
  status: s,
  labels,
  alerts = [],
  isQuiet: quiet,
  isCompact: compact,
}: {
  status?: VehicleStatus;
  labels?: { engine?: string; climate?: string };
  alerts?: string[];
  isQuiet?: boolean;
  /** Icons only (the tint carries "unlocked" and "brake off"); countdowns keep their text. Fits beside a title. */
  isCompact?: boolean;
}) {
  const shownAlerts = quiet && alerts.length > 1 ? [`${alerts[0]} +${alerts.length - 1}`] : alerts;
  const word = (label: string) => (compact ? undefined : label);
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {s?.isEngineOn ? <StatusChip icon={PowerIcon} tone="accent" label={labels?.engine} a11y={labels?.engine ? `Engine running, off in ${labels.engine}` : "Engine running"} /> : null}
      {s?.climate?.isOn ? <StatusChip icon={ClimateIcon} tone="accent" label={labels?.climate} a11y={labels?.climate ? `Climate on, off in ${labels.climate}` : "Climate on"} /> : null}
      {/* Brake off only matters while parked; off with the engine running is normal. Red like the dashboard lamp. */}
      {s?.isParkingBrakeOn === true && !quiet ? (
        <StatusChip icon={ParkIcon} tone="bad" a11y="Park brake on" />
      ) : s?.isParkingBrakeOn === false && !s.isEngineOn ? (
        <StatusChip icon={ParkIcon} tone="warn" label={word("Brake off")} a11y="Park brake off" />
      ) : null}
      {s?.lock === "locked" && !quiet ? (
        <StatusChip icon={LockIcon} tone="good" a11y="Locked" />
      ) : s?.lock === "unlocked" ? (
        <StatusChip icon={LockOpenIcon} tone="warn" label={word("Unlocked")} a11y="Unlocked" />
      ) : null}
      {shownAlerts.map((a) => (
        <StatusChip key={a} icon={AlertIcon} tone="warn" label={a} a11y={a} />
      ))}
    </View>
  );
}

export function VehicleCard({ connection, vehicle }: { connection: Connection; vehicle: Vehicle }) {
  const provider = getProvider(connection.providerId);
  const status = useVehicleStatus(connection.id, vehicle);
  const s = status.data;
  const litres = s?.fuelLitres;
  const tank = vehicle.fuelTankLitres;
  // Same rules as the vehicle screen.
  const energy = s?.batteryPercent ?? s?.fuelPercent ?? (litres != null && tank ? (litres / tank) * 100 : undefined);
  const low = energy != null ? energy < 15 : litres != null && litres < 5;
  const amount = s?.batteryPercent != null || s?.fuelPercent != null ? `${Math.round(energy!)}%` : litres != null ? `${Math.round(litres)} L` : null;
  const alerts = s?.warnings ?? [];
  const paint = paintHex(vehicle.color);

  return (
    <Link href={`/vehicle/${connection.id}/${encodeURIComponent(vehicle.id)}`} asChild>
      <Pressable className="active:opacity-80">
        <View className="overflow-hidden rounded-3xl bg-inset" style={SHADOW}>
          {paint ? <LinearGradient {...tintFade(paint, 0.14)} style={StyleSheet.absoluteFill} /> : null}

          <View className="gap-2.5 px-4 pt-4">
            <View className="flex-row items-center gap-2">
              <BrandGlyph provider={provider} size={24} />
              <Text className="text-foreground text-lg font-semibold tracking-tight shrink" numberOfLines={1}>
                {vehicle.name}
              </Text>
            </View>
            {/* Nothing notable, no strip: a parked, locked car stays clean. */}
            {s?.isEngineOn || s?.climate?.isOn || s?.lock === "unlocked" || (s?.isParkingBrakeOn === false && !s.isEngineOn) || alerts.length ? (
              <StatusIcons status={s} alerts={alerts} isQuiet />
            ) : null}
          </View>

          {/* Renders ship with transparent padding; crop it. */}
          <View pointerEvents="none" className="h-32 items-center justify-center overflow-hidden">
            <VehicleHero vehicle={vehicle} accent={provider?.color} height={190} />
          </View>

          <View className="gap-2 px-4 pb-3">
            <Text className="text-foreground text-2xl font-medium tracking-tight">
              {s?.rangeKm != null ? Math.round(s.rangeKm) : "—"}
              <Text className="text-base font-normal"> km</Text>
            </Text>
            {amount || s?.odometerKm != null ? (
              <View className="-mt-1 flex-row items-center justify-between gap-4">
                {amount ? (
                  <View className="flex-row items-center gap-2">
                    {energy != null ? (
                      <View className="h-[3px] w-20 rounded-full bg-foreground/15 overflow-hidden">
                        <View className={`h-full rounded-full ${low ? "bg-danger" : "bg-foreground"}`} style={{ width: `${Math.max(4, Math.min(100, energy))}%` }} />
                      </View>
                    ) : null}
                    <Text className={`text-xs font-semibold ${low ? "text-danger" : "text-muted"}`}>{amount}</Text>
                  </View>
                ) : (
                  <View />
                )}
                {s?.odometerKm != null ? (
                  <View className="flex-row items-center gap-1" accessible accessibilityLabel={`Mileage ${Math.round(s.odometerKm).toLocaleString()} km`}>
                    <Icon name="speedometer-outline" size={13} colorClassName="accent-muted" />
                    <Text className="text-muted text-xs">{Math.round(s.odometerKm).toLocaleString()} km</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          <QuickActions connection={connection} vehicle={vehicle} status={s} />
        </View>
      </Pressable>
    </Link>
  );
}

type Result = { id: string; isOk: boolean };

function QuickActions({ connection, vehicle, status: s }: { connection: Connection; vehicle: Vehicle; status?: VehicleStatus }) {
  const provider = getProvider(connection.providerId);
  const send = useSendCommand(connection.id, vehicle);
  const savedPin = useSavedPin(connection.id);
  const [result, setResult] = useState<Result>();
  const commands = (provider?.commands ?? [])
    .filter((c) => !vehicle.commands || vehicle.commands.includes(c.id))
    .map((c) => ({ ...c, isPinRequired: vehicle.isPinRequired ?? c.isPinRequired }));
  const byId = (id: string) => commands.find((c) => c.id === id);

  const lock = s?.lock === "locked" ? byId("unlock") : byId("lock");
  const running = !!s?.climate?.isOn;
  const climate = running ? byId("climate_off") : byId("climate_on");
  const honk = byId("horn_lights");

  // Same hold rule as the vehicle screen.
  const bio = useConfirmMode() === "biometric";
  const [holdHint, setHoldHint] = useState<string>();
  const needsHold = (c: CommandDefinition) => SENSITIVE.has(c.id);

  const tap = (c: CommandDefinition) => {
    if (!needsHold(c)) return run(c);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setHoldHint(c.id);
    setTimeout(() => setHoldHint((h) => (h === c.id ? undefined : h)), 2000);
  };
  const hold = (c: CommandDefinition) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!bio) return run(c);
    confirmWithBiometrics(c.label).then((ok) => {
      if (ok) run(c, true);
    });
  };

  const carScreen = `/vehicle/${connection.id}/${encodeURIComponent(vehicle.id)}` as const;
  // `confirmed`: Face ID already passed for this press, so it isn't asked again.
  const run = async (c: CommandDefinition, confirmed = false) => {
    Haptics.selectionAsync();
    if (c.id === "climate_on" || c.id === "climate_off") {
      router.push(`${carScreen}?action=climate`);
      return;
    }
    const needsParams = !!c.params?.some((p) => p.default == null);
    let pin: string | undefined;
    if (c.isPinRequired && bio && !needsParams) {
      const saved = await savedPin();
      if (saved && (confirmed || (await confirmWithBiometrics(c.label)))) pin = saved;
    }
    if ((c.isPinRequired && !pin) || needsParams) {
      router.push(carScreen);
      return;
    }
    const params = Object.fromEntries((c.params ?? []).map((p) => [p.key, p.default!]));
    const settle = (ok: boolean) => {
      Haptics.notificationAsync(ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
      setResult({ id: c.id, isOk: ok });
      setTimeout(() => setResult((r) => (r?.id === c.id ? undefined : r)), 2000);
    };
    send.mutate({ command: c.id, params, pin }, { onSuccess: (res) => settle(res.isOk), onError: () => settle(false) });
  };

  type Action = { c: CommandDefinition; icon: IconName; label: string; isWarning?: boolean; isActive?: boolean };
  const actions: Action[] = [];
  if (lock)
    actions.push({
      c: lock,
      icon: s?.lock === "locked" ? "lock-open-outline" : "lock-closed-outline",
      label: s?.lock === "locked" ? "Unlock" : "Lock",
      isWarning: s?.lock === "unlocked",
    });
  if (climate) actions.push({ c: climate, icon: "snow-outline", label: "Climate", isActive: running });
  if (honk) actions.push({ c: honk, icon: "megaphone-outline", label: "Honk" });
  if (!actions.length) return null;

  return (
    <View className="flex-row gap-2 px-4 pb-4">
      {actions.map(({ c, icon, label, isWarning: warn, isActive: active }) => (
        <QuickButton
          key={c.id}
          icon={icon}
          label={holdHint === c.id ? "Hold" : label}
          a11y={c.label}
          isWarning={warn}
          isActive={active}
          isPending={send.isPending && send.variables?.command === c.id}
          settled={result?.id === c.id ? result : undefined}
          isDisabled={send.isPending}
          onPress={() => tap(c)}
          onLongPress={needsHold(c) ? () => hold(c) : undefined}
        />
      ))}
    </View>
  );
}

function QuickButton({
  icon,
  label,
  a11y,
  isWarning: warn,
  isActive: active,
  isPending: pending,
  settled,
  isDisabled: disabled,
  onPress,
  onLongPress,
}: {
  icon: IconName;
  label: string;
  a11y: string;
  isWarning?: boolean;
  isActive?: boolean;
  isPending: boolean;
  settled?: Result;
  isDisabled: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const hold = useHoldProgress(!!onLongPress);
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
      accessibilityState={{ busy: pending, selected: active }}
      className={`flex-1 h-11 flex-row items-center justify-center gap-1.5 rounded-full active:opacity-70 ${active ? "bg-foreground" : "bg-foreground/10"}`}
    >
      {pending ? (
        <Spinner size="small" colorClassName={active ? "accent-background" : "accent-muted"} />
      ) : settled && !settled.isOk ? (
        // Only failures: there's no progress card on this screen to say so.
        <Icon name="alert-circle" size={18} colorClassName="accent-danger" />
      ) : (
        <Icon name={icon} size={16} colorClassName={active ? "accent-background" : warn ? "accent-warning" : "accent-foreground"} />
      )}
      <Text className={`text-sm font-medium ${active ? "text-background" : warn ? "text-warning" : "text-foreground"}`}>{label}</Text>
      {onLongPress ? <HoldProgress progress={hold.progress} radius={22} isInverted={active} /> : null}
    </Pressable>
  );
}

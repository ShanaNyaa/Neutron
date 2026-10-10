import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PanResponder, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  interpolate,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";

import { Text } from "@/components/text";
import { BrandGlyph } from "@/components/brand";
import { CommandProgress, type CommandProgressState } from "@/components/command-progress";
import { CommandSheet } from "@/components/command-sheet";
import { AlertIcon, AttentionIcon, CarFrontIcon, DoorClosedIcon, OkIcon, PencilIcon, TyreIcon } from "@/components/icons";
import { LocationMap, mapsAvailable } from "@/components/location-map";
import { NameDialog } from "@/components/name-dialog";
import { PaintPicker } from "@/components/paint-picker";
import { SceneView } from "@/components/scene";
import { DoorsDiagram, openingRows, OpeningsList, TyreDiagram, tyreFlagged } from "@/components/vehicle-diagrams";
import { ControlDeck } from "@/components/controls";
import { Inset, MeterRow, Metric, Panel, PanelRow, SecretRow } from "@/components/panel";
import { BackButton, Banner, Button, Empty, Icon, Loading, Page, Section, SHADOW } from "@/components/ui";
import { StatusIcons, VehicleHero } from "@/components/vehicle";
import { useDataUsage, useRenameVehicle, useSavedPin, useSendCommand, useVehicle, useVehicleLocation, useVehicleScene, useVehicleStatus } from "@/hooks/queries";
import { usePullToRefresh, useRefreshOnFocus } from "@/lib/refresh";
import type { CommandStage } from "@/core/provider";
import type { CommandDefinition, CommandId, OpenState, VehicleScene, VehicleStatus } from "@/core/types";
import { ago, formatBytes, humanize } from "@/lib/format";
import { paintHex, paintLabel, tintFade } from "@/lib/paint";
import { confirmWithBiometrics, SENSITIVE, useConfirmMode } from "@/lib/confirm";
import { askForResultNotifications } from "@/lib/notify";
import { endTimedActivity, rememberTimedActivity, startCommandActivity } from "@/widgets/activity";
import { commandSymbol } from "@/widgets/symbols";
import { formatCountdown, startCommandTimer, stopCommandTimer, timerMinutes, useCommandTimers } from "@/lib/command-timer";
import { setTopControls, useTopControls } from "@/lib/top-controls";


export default function VehicleScreen() {
  // `action` comes from widget/Garage deep links; climate ones open the climate sheet instead.
  const { connectionId, vehicleId, action } = useLocalSearchParams<{ connectionId: string; vehicleId: string; action?: string }>();
  const id = decodeURIComponent(vehicleId);
  const { vehicle, provider, connection, loading, query } = useVehicle(connectionId, id);
  const status = useVehicleStatus(connectionId, vehicle, { live: true });
  const location = useVehicleLocation(connectionId, vehicle);
  const pull = usePullToRefresh(() => Promise.all([status.refetch(), location.refetch()]));
  const scene = useVehicleScene(connectionId, vehicle);
  const data = useDataUsage(connectionId, vehicle);
  const send = useSendCommand(connectionId, vehicle);
  const rename = useRenameVehicle(connectionId, vehicle);
  useRefreshOnFocus();
  const insets = useSafeAreaInsets();
  const heroTop = useResolveClassNames("bg-hero").backgroundColor as string;
  const heroBottom = useResolveClassNames("bg-background").backgroundColor as string;
  const [sheet, setSheet] = useState<CommandDefinition | null>(null);
  const [sheetParams, setSheetParams] = useState<Record<string, string | number>>();
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [toast, setToast] = useState<string>();
  const [progress, setProgress] = useState<CommandProgressState | null>(null);
  const timers = useCommandTimers(connectionId, id);
  const topControls = useTopControls(`${connectionId}/${id}`);
  const timedCommand = (cmd: CommandId) => provider?.commands.find((c) => c.id === cmd);
  const endTimer = (cmd: CommandId) => {
    stopCommandTimer(connectionId, id, cmd);
    endTimedActivity(`${connectionId}/${id}/${cmd}`);
  };
  // Timers the car reports as already stopped. The 90s grace ignores status that still predates the start.
  const reportedStopped = timers
    .filter((t) => {
      const s = status.data;
      return !!s && timedCommand(t.command)?.timer?.isRunning?.(s) === false && (s.updatedAt ?? 0) > t.startedAt + 90_000;
    })
    .map((t) => t.command)
    .join(",");
  useEffect(() => {
    if (!reportedStopped) return;
    for (const cmd of reportedStopped.split(",")) {
      stopCommandTimer(connectionId, id, cmd);
      endTimedActivity(`${connectionId}/${id}/${cmd}`);
    }
  }, [reportedStopped, connectionId, id]);
  const bio = useConfirmMode() === "biometric";
  const savedPin = useSavedPin(connectionId);
  const [pendingAction, setPendingAction] = useState(action);
  const [lastAction, setLastAction] = useState(action);
  if (action !== lastAction) {
    setLastAction(action);
    setPendingAction(action);
  }
  // A deep link (widget, Shortcuts) asking for a command: same gate as an in-app hold, so a
  // sensitive one asks for Face ID before its sheet opens. Climate links open the climate sheet instead.
  useEffect(() => {
    if (!pendingAction || !vehicle || !provider) return;
    setPendingAction(undefined);
    const c = provider.commands.find((x) => x.id === pendingAction);
    if (!c || c.id === "climate_on" || (vehicle.commands && !vehicle.commands.includes(c.id))) return;
    const command = { ...c, isPinRequired: vehicle.isPinRequired ?? c.isPinRequired };
    const open = () => {
      setSheetParams(undefined);
      setSheet(command);
    };
    if (bio && SENSITIVE.has(c.id)) confirmWithBiometrics(c.label).then((ok) => ok && open());
    else open();
  }, [pendingAction, vehicle, provider, bio]);

  if (loading) return <Loading />;
  if (!connection || !provider) return <Redirect href="/" />;
  if (!vehicle)
    return (
      <Empty
        icon="car-outline"
        title="Car not available"
        body={(query.error as Error)?.message ?? "It’s no longer on this account."}
        action={<Button title="Back to Garage" variant="secondary" onPress={() => router.dismissTo("/")} className="mt-2" />}
      />
    );

  const s = status.data;
  const caps = new Set(provider.capabilities);
  const commands: CommandDefinition[] = caps.has("commands")
    ? provider.commands
        .filter((c) => !vehicle.commands || vehicle.commands.includes(c.id))
        .map((c) => ({ ...c, isPinRequired: vehicle.isPinRequired ?? c.isPinRequired }))
    : [];
  const settle = (next: CommandProgressState) => {
    setProgress(next);
    setTimeout(() => setProgress((p) => (p === next ? null : p)), 2500);
  };

  const run = async (c: CommandDefinition, input: { pin?: string; params?: Record<string, string | number> }) => {
    let reached: "phone" | CommandStage = "phone";
    setProgress({ label: c.label, stage: "phone" });
    const activity = startCommandActivity({ car: vehicle.name, label: c.label, symbol: commandSymbol(c.id), stage: "cloud" });
    try {
      const res = await send.mutateAsync({
        command: c.id,
        ...input,
        onProgress: (stage) => {
          reached = stage;
          setProgress((p) => (p ? { ...p, stage } : p));
          activity.update({ stage });
        },
      });
      // A refusal is the car's answer, so it fails at the car step (2).
      if (!res.isOk) {
        settle({ label: c.label, stage: "failed", message: res.message, failedAt: 2 });
        activity.end({ stage: "failed", message: res.message });
        throw new Error(res.message ?? "Command failed");
      }
      // Unconfirmed means only the cloud accepted it, not the car.
      settle({ label: c.label, stage: res.isConfirmed ? "done" : "queued" });
      const minutes = res.isConfirmed ? timerMinutes(c, input.params) : 0;
      if (minutes && c.timer) {
        const endsAt = Date.now() + minutes * 60_000;
        activity.hold({ stage: "done", timer: { startedAt: Date.now(), endsAt, running: c.timer.running, ended: c.timer.ended } }, endsAt);
        startCommandTimer(connectionId, vehicle.id, c.id, minutes);
        rememberTimedActivity(`${connectionId}/${vehicle.id}/${c.id}`, activity);
      } else activity.end({ stage: res.isConfirmed ? "done" : "queued" });
      provider.commands.filter((t) => t.timer?.stoppedBy === c.id).forEach((t) => endTimer(t.id));
    } catch (e) {
      activity.end({ stage: "failed", message: (e as Error).message });
      setProgress((p) =>
        p?.stage === "failed" ? p : { label: c.label, stage: "failed", message: (e as Error).message, failedAt: reached === "phone" ? 1 : 2 },
      );
      setTimeout(() => setProgress((p) => (p?.stage === "failed" ? null : p)), 3500);
      throw e;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    askForResultNotifications();
  };

  const onCommand = async (c: CommandDefinition, params?: Record<string, string | number>, confirmed = false) => {
    Haptics.selectionAsync();
    const needsParams = !params && !!c.params?.length;
    // Biometrics stand in for a saved PIN; cancelled or none saved falls through to the PIN sheet.
    if (c.isPinRequired && bio && !needsParams) {
      const pin = await savedPin();
      if (pin && (confirmed || (await confirmWithBiometrics(c.label)))) return run(c, { pin, params }).catch(() => {});
    }
    if (c.isPinRequired || needsParams) {
      setSheetParams(params);
      setSheet(c);
    }
    // Failures surface in the progress card.
    else run(c, { params }).catch(() => {});
  };

  const d = data.data;
  const dataText = d
    ? [d.remainingBytes != null ? `${formatBytes(d.remainingBytes)} left` : null, d.usedBytes != null ? `${formatBytes(d.usedBytes)} used` : null]
        .filter(Boolean)
        .join(", ")
    : undefined;
  // Share of the plan left; only when both halves are known.
  const dataLeft = d?.usedBytes != null && d.remainingBytes != null && d.usedBytes + d.remainingBytes > 0 ? d.remainingBytes / (d.usedBytes + d.remainingBytes) : undefined;
  const litres = s?.fuelLitres;
  const tank = vehicle.fuelTankLitres;
  const energy = s?.batteryPercent ?? s?.fuelPercent ?? (litres != null && tank ? (litres / tank) * 100 : undefined);
  const paint = paintHex(vehicle.color);
  const alerts = [...(s?.warnings ?? []), ...(s?.batteryVoltage != null && s.batteryVoltage < 11.8 ? [`12V low ${s.batteryVoltage.toFixed(1)}V`] : [])];
  // Maintenance is a row in More, not a warning: it isn't something the car needs right now.
  const service = (() => {
    const km = s?.serviceDueKm;
    const days = s?.serviceDueDays;
    if (km == null && days == null) return null;
    if ((km != null && km < 0) || (days != null && days < 0)) return { text: "Overdue", isDue: true };
    const parts = [km != null ? `${Math.round(km).toLocaleString()} km` : null, days != null ? `${Math.round(days)} days` : null].filter(Boolean);
    return { text: `Due in ${parts.join(" or ")}`, isDue: (km != null && km < 500) || (days != null && days < 14) };
  })();
  // Countdowns ride on the status chips: the engine chip shows "9:57" while a remote start runs.
  const countdown = (cmd: CommandId) => {
    const t = timers.find((x) => x.command === cmd);
    return t ? formatCountdown(t.remainingMs) : undefined;
  };
  const chipLabels = { engine: countdown("engine_start"), climate: countdown("climate_on") };
  const low = energy != null ? energy < 15 : litres != null && litres < 5;
  const energyTone = low ? { bar: "bg-danger", text: "text-danger" } : { bar: "bg-foreground", text: "text-muted" };
  const sideAngles = scene.data?.angles.filter((a) => a.id !== "top") ?? [];
  const sideScene = sideAngles.length ? { angles: sideAngles } : null;

  const carImage = sideScene ? (
    <SceneView scene={sideScene} status={s} height={200} />
  ) : vehicle.imageUrl || !scene.data ? (
    <VehicleHero vehicle={vehicle} accent={provider.color} height={210} />
  ) : null;
  const overview = (
    <View>
      <View className="gap-2">
        <View className="flex-row items-baseline justify-between gap-4">
          <Text className="text-foreground text-3xl font-medium tracking-tight">
            {s?.rangeKm != null ? Math.round(s.rangeKm) : "—"}
            <Text className="text-lg font-normal"> km</Text>
          </Text>
          {s?.odometerKm != null ? (
            <Text className="text-foreground text-sm font-semibold">{Math.round(s.odometerKm).toLocaleString()} km</Text>
          ) : null}
        </View>

        <View className="flex-row items-center justify-between gap-4 -mt-1">
          {energy != null || litres != null ? (
            <View className="flex-row items-center gap-2">
              {energy != null ? (
                <View className="h-0.75 w-24 rounded-full bg-foreground/15 overflow-hidden">
                  <View className={`h-full rounded-full ${energyTone.bar}`} style={{ width: `${Math.max(4, Math.min(100, energy))}%` }} />
                </View>
              ) : null}
              <Text className={`text-xs font-semibold ${energyTone.text}`}>
                {s?.batteryPercent != null ? `${Math.round(energy!)}%` : litres != null ? `${Math.round(litres)} L` : `${Math.round(energy!)}%`}
              </Text>
            </View>
          ) : (
            <View />
          )}
          {s?.odometerKm != null ? <Text className="text-muted text-xs">Mileage</Text> : null}
        </View>

        {alerts.length ? (
          <View className="mt-2 flex-row flex-wrap gap-2">
            {alerts.map((a) => (
              <View key={a} className="flex-row items-center gap-1.5 rounded-lg bg-warning/15 pl-2 pr-2.5 h-7">
                <AlertIcon size={14} strokeWidth={2.5} colorClassName="accent-warning" />
                <Text className="text-warning text-xs font-semibold">{a}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* Renders ship with transparent padding; this crops it. */}
      {carImage ? (
        <View pointerEvents="none" className="mt-4 h-32 items-center justify-center overflow-hidden">
          {carImage}
        </View>
      ) : null}
      {/* When the status was read; tapping it refreshes, as does pulling down. */}
      <Pressable
        onPress={() => Promise.all([status.refetch(), location.refetch()])}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Refresh"
        accessibilityHint="Refreshes the car's status"
        className="-mt-1 flex-row items-center justify-center gap-1.5 active:opacity-60"
      >
        <Text className="text-muted text-sm" numberOfLines={1}>
          {status.isFetching ? "Updating..." : s?.updatedAt ? `Last reported ${ago(s.updatedAt)}` : "Not reported yet"}
        </Text>
        <Icon name="refresh" size={12} colorClassName="accent-muted" />
      </Pressable>
    </View>
  );

  return (
    <>
      <Page contentInsetAdjustmentBehavior="never" refresh={pull}>
        <View className="-mx-4 -mt-3 px-4 pb-2" style={{ paddingTop: insets.top + 8 }}>
          {paint ? (
            <LinearGradient {...tintFade(paint, 0.2)} style={StyleSheet.absoluteFill} />
          ) : (
            <LinearGradient colors={[heroTop, heroBottom]} locations={[0, 1]} style={StyleSheet.absoluteFill} />
          )}
          <View className="flex-row items-center justify-between gap-3">
            <BackButton />
            <Pressable onPress={() => setRenaming(true)} className="flex-1 flex-row items-center gap-2 active:opacity-60">
              <Text className="text-foreground text-2xl font-semibold tracking-tight shrink" numberOfLines={1}>
                {vehicle.name}
              </Text>
              <PencilIcon size={14} strokeWidth={2.5} colorClassName="accent-muted" />
            </Pressable>
            <StatusIcons status={s} labels={chipLabels} isCompact />
          </View>

          <HeroCarousel
            status={s}
            scene={scene.data}
            car={overview}
            carState={alerts.length || service?.isDue ? "warn" : s ? "ok" : undefined}
          />
        </View>

        {toast ? <Banner onPress={() => setToast(undefined)}>{toast}</Banner> : null}
        {status.error ? <Banner>{(status.error as Error).message}</Banner> : null}

        {commands.length ? (
          <ControlDeck
            commands={commands}
            status={s}
            pending={send.isPending ? send.variables?.command : undefined}
            isClimateOpen={action === "climate" || action === "climate_on"}
            tiles={topControls}
            onTilesChange={(tiles) => setTopControls(`${connectionId}/${id}`, tiles)}
            onCommand={onCommand}
          />
        ) : null}

        {s?.avgFuelLPer100km != null || s?.avgSpeedKmh != null ? (
          <Section title="Driving" className="mt-3">
            <View className="flex-row gap-3">
              {s?.avgFuelLPer100km != null ? (
                <Metric label="Fuel economy" value={s.avgFuelLPer100km.toFixed(1)} unit="L/100 km" icon="water-outline" />
              ) : null}
              {s?.avgSpeedKmh != null ? <Metric label="Average speed" value={Math.round(s.avgSpeedKmh)} unit="km/h" icon="speedometer-outline" /> : null}
            </View>
          </Section>
        ) : null}

        {caps.has("location") ? (
          <Section title="Location" className="mt-3">
            {location.data ? (
              <LocationTile
                latitude={location.data.latitude}
                longitude={location.data.longitude}
                name={vehicle.name}
                address={location.data.address}
                updatedAt={location.data.updatedAt}
              />
            ) : (
              <PanelRow icon="location-outline" label={location.isLoading ? "Locating..." : "Location unavailable"} />
            )}
          </Section>
        ) : null}

        <Section title="More" className="mt-3">
          <Panel>
            {caps.has("trips") ? (
              <PanelRow icon="map-outline" label="Trips" onPress={() => router.push(`/vehicle/${connectionId}/${vehicleId}/trips`)} />
            ) : null}
            {dataText && dataLeft != null ? (
              <MeterRow icon="cellular-outline" label="Internet" detail={dataText} fraction={dataLeft} isLow={dataLeft < 0.1} />
            ) : dataText ? (
              <PanelRow icon="cellular-outline" label="Internet" detail={dataText} />
            ) : null}
            {service ? (
              <PanelRow icon="construct-outline" label="Service" detail={service.text} iconTone={service.isDue ? "warn" : "default"} tone={service.isDue ? "warn" : "default"} />
            ) : null}
            {vehicle.model ? <PanelRow icon="car-outline" label="Model" detail={vehicle.model} /> : null}
            {/* Code or name: which one is stored depends on the build that fetched the vehicle list. */}
            {vehicle.paintCode || vehicle.color ? (
              <PanelRow
                icon="color-palette-outline"
                label="Colour"
                detail={vehicle.color ? paintLabel(vehicle.color) : "Choose a colour"}
                onPress={() => setPicking(true)}
              />
            ) : null}
            {vehicle.vin ? <SecretRow icon="barcode-outline" label="VIN" value={vehicle.vin} /> : null}
            <PanelRow
              icon="person-circle-outline"
              leading={<BrandGlyph provider={provider} />}
              label={connection.label && connection.label !== provider.name ? connection.label : `${provider.name} account`}
              detail="Account and sign-in"
              onPress={() => router.push(`/connections/${connection.id}`)}
            />
          </Panel>
        </Section>
      </Page>

      {/* Not awaited: the car's reply can take 40s, and the progress card shows it. */}
      <CommandSheet
        command={sheet}
        params={sheetParams}
        onClose={() => setSheet(null)}
        onSubmit={async (input) => {
          const c = sheet!;
          setSheet(null);
          run(c, input).catch(() => {});
        }}
      />
      <CommandProgress state={progress} />
      <PaintPicker connectionId={connectionId} vehicle={vehicle} isVisible={picking} onClose={() => setPicking(false)} />
      <NameDialog
        isVisible={renaming}
        title="Rename Vehicle"
        label="Nickname"
        initial={vehicle.name}
        placeholder="e.g. Daily"
        onClose={() => setRenaming(false)}
        onSubmit={(name) => rename.mutateAsync(name).then(() => {})}
      />
    </>
  );
}

const pageState = (known: boolean, problem: boolean) => (problem ? "alert" : known ? "ok" : undefined);

function HeroCarousel({
  status: s,
  scene,
  car,
  carState,
}: {
  status?: VehicleStatus;
  scene?: VehicleScene | null;
  car: ReactNode;
  /** The Car tab's badge: a warning triangle for warnings or service due, not the red alert the Doors and Tyres pages use for faults. */
  carState?: "ok" | "warn";
}) {
  const { width } = useWindowDimensions();
  const ref = useAnimatedRef<Animated.ScrollView>();
  const x = useSharedValue(0);
  const [page, setPage] = useState(0);
  const [tabs, setTabs] = useState<{ x: number; width: number }[]>([]);
  const H = 250;
  const tyreWarn = tyreFlagged(s);
  const tyresKnown = Object.values(s?.tyres ?? {}).some((v) => v != null);
  // The top view is tall and narrow, so it takes the page's full height and overflows its column
  // sideways; the overflow is the render's transparent margin.
  const doorsSize = H - 10;
  const doorsColumn = (width - 32) * 0.5;

  const pages = [
    { key: "car", label: "Car", icon: CarFrontIcon, body: car, state: carState },
    {
      key: "doors",
      label: "Doors",
      icon: DoorClosedIcon,
      state: pageState(openingRows(s).some((r) => r.state !== "unknown"), hasOpen(s)),
      body: (
        <View className="flex-row items-center">
          <View className="items-center" style={{ width: doorsColumn, height: doorsSize }}>
            <DoorsDiagram scene={scene} status={s} size={doorsSize} />
          </View>
          <View className="flex-1 pl-3">
            <OpeningsList status={s} />
          </View>
        </View>
      ),
    },
    {
      key: "tyres",
      label: "Tyres",
      icon: TyreIcon,
      state: pageState(tyresKnown || tyreWarn, tyreWarn),
      body: (
        <View className="items-center gap-2">
          <TyreDiagram scene={scene} status={s} size={H - 30} isCompact />
          {/* Pulled up: the diagram's outer ring leaves empty space under the car. */}
          <Text className={`-mt-5 text-sm font-medium ${tyreWarn ? "text-danger" : tyresKnown ? "text-foreground" : "text-muted"}`}>
            {tyreWarn ? "Abnormal" : tyresKnown ? "Normal" : "Unknown"}
          </Text>
        </View>
      ),
    },
  ];

  const go = (i: number) => ref.current?.scrollTo({ x: i * width, animated: true });
  const settle = (i: number) => {
    Haptics.selectionAsync();
    setPage(i);
  };
  const onScroll = useAnimatedScrollHandler((e) => {
    x.set(e.contentOffset.x);
  });
  useAnimatedReaction(
    () => Math.round(x.get() / width),
    (i, prev) => {
      if (prev != null && i !== prev) scheduleOnRN(settle, i);
    },
  );
  const count = pages.length;
  // Finger x in the switcher track, or -1 while not dragging.
  const finger = useSharedValue(-1);
  // The carousel spans the screen, so the track's x is also its screen position.
  const trackLeft = useSharedValue(0);
  const lift = useDerivedValue(() => withTiming(finger.get() >= 0 ? 1 : 0, { duration: 150 }));
  const highlight = useAnimatedStyle(() => {
    if (tabs.length < count) return { opacity: 0 };
    const input = tabs.map((_, i) => i * width);
    return {
      opacity: 1,
      width: interpolate(x.get(), input, tabs.map((t) => t.width), "clamp"),
      transform: [{ translateX: interpolate(x.get(), input, tabs.map((t) => t.x), "clamp") }, { scale: 1 + lift.get() * 0.06 }],
    };
  });
  useAnimatedReaction(
    () => finger.get(),
    (f, prev) => {
      if (tabs.length < count) return;
      if (f >= 0) {
        const centers = tabs.map((t) => t.x + t.width / 2);
        const offset = interpolate(f, centers, centers.map((_, i) => i * width), "clamp");
        // Set directly too: a programmatic scroll isn't guaranteed to report back.
        x.set(offset);
        scrollTo(ref, offset, 0, false);
      } else if (prev != null && prev >= 0) {
        const offset = Math.round(x.get() / width) * width;
        x.set(withTiming(offset, { duration: 250 }));
        scrollTo(ref, offset, 0, true);
      }
    },
  );
  const scrub = useMemo(
    () =>
      PanResponder.create({
        // Capture so a sideways drag that starts on a tab scrubs instead of pressing it.
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => finger.set(g.moveX - trackLeft.get()),
        onPanResponderRelease: () => finger.set(-1),
        onPanResponderTerminate: () => finger.set(-1),
      }),
    [finger, trackLeft],
  );

  return (
    <View className="-mx-4 mt-2 gap-3">
      <Animated.ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
      >
        {pages.map((p, i) => (
          <View key={p.key} className="justify-center px-4" style={{ width, minHeight: H }}>
            <HeroPage x={x} index={i} width={width}>
              {p.body}
            </HeroPage>
          </View>
        ))}
      </Animated.ScrollView>
      <View
        {...scrub.panHandlers}
        onLayout={(e) => trackLeft.set(e.nativeEvent.layout.x)}
        className="self-center flex-row rounded-full bg-foreground/10 p-1"
        style={SHADOW}
      >
        <Animated.View className="absolute top-1 bottom-1 left-0 rounded-full bg-foreground/15" style={highlight} />
        {pages.map((p, i) => {
          const active = i === page;
          const I = p.icon;
          return (
            <Pressable
              key={p.key}
              onPress={() => go(i)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onLayout={(e) => {
                const { layout } = e.nativeEvent;
                setTabs((t) => {
                  const next = [...t];
                  next[i] = { x: layout.x, width: layout.width };
                  return next;
                });
              }}
              className="flex-row items-center gap-1.5 rounded-full px-4 py-2"
            >
              <I size={16} strokeWidth={2.25} colorClassName={active ? "accent-foreground" : "accent-muted"} />
              <Text className={`text-sm font-semibold ${active ? "text-foreground" : "text-muted"}`}>{p.label}</Text>
              {p.state === "ok" ? (
                <OkIcon size={15} strokeWidth={2.5} colorClassName={active ? "accent-foreground" : "accent-muted"} />
              ) : null}
              {p.state === "alert" ? (
                <AttentionIcon size={15} strokeWidth={2.5} colorClassName="accent-danger" />
              ) : null}
              {p.state === "warn" ? (
                <AlertIcon size={15} strokeWidth={2.5} colorClassName="accent-warning" />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function HeroPage({ x, index, width, children }: { x: SharedValue<number>; index: number; width: number; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), [(index - 1) * width, index * width, (index + 1) * width], [0, 1, 0], "clamp"),
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function LocationTile({
  latitude,
  longitude,
  name,
  address,
  updatedAt,
}: {
  latitude: number;
  longitude: number;
  name: string;
  address?: string;
  updatedAt?: number;
}) {
  const open = () =>
    Linking.openURL(
      Platform.OS === "ios"
        ? `https://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(name)}`
        : `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    );
  return (
    <Pressable onPress={open} className="active:opacity-80">
      <Inset className="p-0 overflow-hidden">
        {mapsAvailable ? (
          <View className="h-44" pointerEvents="none">
            <LocationMap latitude={latitude} longitude={longitude} title={name} />
          </View>
        ) : null}
        <View className="flex-row items-center gap-3 p-4">
          <Icon name="location-outline" size={20} colorClassName="accent-foreground" />
          <View className="flex-1">
            <Text className="text-foreground text-base font-medium" numberOfLines={1}>
              {address ?? "Last known location"}
            </Text>
            <Text className="text-muted text-sm" numberOfLines={1} selectable>
              {latitude.toFixed(5)}, {longitude.toFixed(5)}
            </Text>
            {updatedAt ? (
              <Text className="text-muted text-xs mt-0.5" numberOfLines={1}>
                Updated {ago(updatedAt)}
              </Text>
            ) : null}
          </View>
          <View accessible accessibilityLabel="Opens in Maps">
            <Icon name="open-outline" size={18} colorClassName="accent-muted" />
          </View>
        </View>
      </Inset>
    </Pressable>
  );
}

const openKeys = (rec?: Partial<Record<string, OpenState>>) =>
  Object.entries(rec ?? {})
    .filter(([, v]) => v === "open")
    .map(([k]) => humanize(k));

const hasOpen = (s?: VehicleStatus) => openKeys(s?.doors).length + openKeys(s?.windows).length > 0;

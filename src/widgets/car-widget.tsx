import { Button, Gauge, HStack, Image, Link, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  aspectRatio,
  background,
  buttonStyle,
  clipShape,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  monospacedDigit,
  offset,
  resizable,
  tint,
  widgetAccentedRenderingMode,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

/** Pre-formatted in sync.ts: widget code runs in an isolated runtime without app helpers, hooks or async. */
export type CarWidgetCar = {
  /** "<connection>/<vehicle>"; what the widget's car picker stores */
  id: string;
  /** Read by plugins/native/NeutronCore.swift */
  provider?: string;
  vin?: string;
  isPinRequired?: boolean;
  name: string;
  isDefault?: boolean;
  range?: string;
  energy?: string;
  /** null when the car doesn't report it */
  isLocked?: boolean | null;
  warning?: string;
  mileage?: string;
  doors?: string;
  /** A clock time, not relative, so it can't go stale between updates */
  updated?: string;
  url?: string;
  /** Number only, without units */
  rangeValue?: string;
  energyValue?: string;
  energyLabel?: string;
  /** File in the App Group container; widgets can't fetch images */
  image?: string;
  /** Remote start end time, ms since epoch */
  timerEndsAt?: number;
  /** 0 to 1 */
  energyFraction?: number;
  openings?: string;
  isAnyOpen?: boolean;
  /** kPa per wheel */
  tyres?: { fl?: string; fr?: string; rl?: string; rr?: string };
  isTyreWarning?: boolean;
  /** With `target`, runs in the background (plugins/native/CarControls.swift); otherwise opens `url`. */
  actions?: { id: string; symbol: string; label: string; url: string; target?: string }[];
};

export type CarWidgetProps = { cars?: CarWidgetCar[] };

/**
 * A car id ("<connection>/<vehicle>"), or "main" for the default car. The options are set at
 * runtime (syncCarChoices in ./sync.ts); a car that has since been removed falls back to the default.
 */
export type CarWidgetConfig = { car: string };

const CarWidget = (props: CarWidgetProps, environment: WidgetEnvironment<CarWidgetConfig>) => {
  "widget";
  // "carN" is the legacy position-based choice.
  const cars = props.cars ?? [];
  const choice = environment.configuration?.car ?? "main";
  const byDefault = cars.find((c) => c.isDefault) ?? cars[0];
  const legacy = /^car[1-9]$/.test(choice) ? cars[Number(choice.slice(3)) - 1] : undefined;
  const car = cars.find((c) => c.id === choice) ?? legacy ?? byDefault;
  const dark = environment.colorScheme === "dark";
  // Accented and vibrant rendering modes recolour everything and drop the background.
  const tinted = (environment.widgetRenderingMode ?? "fullColor") !== "fullColor";
  const fg = tinted ? "#ffffff" : dark ? "#f5f6f8" : "#0b0d12";
  const muted = tinted ? "#ffffff99" : dark ? "#9aa3b2" : "#6b7280";
  const warn = tinted ? "#ffffff" : dark ? "#fbbf24" : "#d97706";
  const bg = dark ? "#14161a" : "#ffffff";
  const family = environment.widgetFamily;

  if (!car) {
    return (
      <VStack modifiers={[containerBackground(bg, "widget")]}>
        <Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(muted)]}>
          Open Neutron to add your car
        </Text>
      </VStack>
    );
  }

  const timerClock =
    car.timerEndsAt && car.timerEndsAt > Date.now() ? (
      <HStack spacing={3}>
        <Image systemName="timer" size={10} color={fg} />
        <Text
          timerInterval={{ lower: new Date(), upper: new Date(car.timerEndsAt) }}
          countsDown
          modifiers={[font({ size: 11, weight: "semibold" }), monospacedDigit(), foregroundStyle(fg)]}
        />
      </HStack>
    ) : null;

  const lockIcon = car.isLocked === false ? "lock.open.fill" : "lock.fill";
  const lockColor = car.isLocked === false ? warn : muted;

  // WidgetKit requires a container background even on the Lock Screen ("Please adopt containerBackground API").
  const lockScreen = [containerBackground("clear", "widget"), ...(car.url ? [widgetURL(car.url)] : [])];

  if (family === "accessoryCircular") {
    const url = lockScreen;
    if (car.energyFraction == null) {
      return (
        <VStack spacing={1} modifiers={url}>
          <Image systemName="fuelpump.fill" size={12} />
          <Text modifiers={[font({ size: 15, weight: "semibold" })]}>{car.energyValue ?? "—"}</Text>
        </VStack>
      );
    }
    return (
      <Gauge
        value={car.energyFraction}
        currentValueLabel={<Text modifiers={[font({ size: 15, weight: "semibold" })]}>{car.energyValue ?? "—"}</Text>}
        modifiers={[gaugeStyle("circular"), ...url]}
      >
        <Image systemName={car.energyLabel?.startsWith("Battery") ? "bolt.fill" : "fuelpump.fill"} size={10} />
      </Gauge>
    );
  }

  if (family === "accessoryRectangular") {
    return (
      <VStack alignment="leading" spacing={2} modifiers={lockScreen}>
        <Text modifiers={[font({ size: 13, weight: "semibold" })]}>{car.name}</Text>
        <Text modifiers={[font({ size: 15, weight: "bold" })]}>{car.range ?? "—"}</Text>
        <Text modifiers={[font({ size: 12 })]}>
          {car.isLocked === false ? "Unlocked" : car.isLocked ? "Locked" : (car.energy ?? "")}
        </Text>
      </VStack>
    );
  }

  const shell = [
    frame({ maxWidth: 10000, maxHeight: 10000, alignment: "topLeading" }),
    containerBackground(bg, "widget"),
    ...(car.url ? [widgetURL(car.url)] : []),
  ];

  const actionCircle = tinted ? "#ffffff26" : dark ? "#2a2d33" : "#eef0f3";
  const actionButton = (a: NonNullable<CarWidgetCar["actions"]>[number], size: number, glyph: number) => {
    const icon = (
      <Image
        systemName={a.symbol as never}
        color={fg}
        modifiers={[font({ size: glyph, weight: "semibold" }), frame({ width: size, height: size }), background(actionCircle), clipShape("circle")]}
      />
    );
    return a.target ? (
      <Button key={a.id} target={a.target} modifiers={[buttonStyle("plain")]}>
        {icon}
      </Button>
    ) : (
      <Link key={a.id} destination={a.url}>
        {icon}
      </Link>
    );
  };

  if (family === "systemMedium") {
    const figure = (value: string | undefined, label: string) => (
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ size: 24, weight: "semibold" }), foregroundStyle(fg)]}>{value ?? "—"}</Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{label}</Text>
      </VStack>
    );
    return (
      <VStack alignment="leading" spacing={0} modifiers={shell}>
        <HStack spacing={6}>
          <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(fg)]}>{car.name}</Text>
          {timerClock ?? (car.updated ? <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{car.updated}</Text> : null)}
          <Spacer />
          {car.warning ? (
            <Image systemName="exclamationmark.triangle.fill" size={12} color={warn} />
          ) : car.isLocked == null ? null : (
            <Image systemName={lockIcon} size={12} color={lockColor} />
          )}
        </HStack>
        <Spacer />
        <HStack spacing={18}>
          {figure(car.rangeValue, "Range (km)")}
          {figure(car.energyValue, car.energyLabel ?? "Fuel (L)")}
          {car.image ? (
            <Image
              uiImage={car.image}
              modifiers={[
                resizable(),
                // Without this, accented mode draws the image as a flat silhouette.
                widgetAccentedRenderingMode("accentedDesaturated"),
                aspectRatio({ contentMode: "fit" }),
                frame({ maxWidth: 10000, maxHeight: 64, alignment: "trailing" }),
                // Proton's renders have transparent margins.
                offset({ x: 14 }),
              ]}
            />
          ) : (
            <Spacer />
          )}
        </HStack>
        <Spacer />
        {car.actions?.length ? (
          <HStack>
            {car.actions.flatMap((a, i) => [
              ...(i > 0 ? [<Spacer key={`${a.id}-gap`} />] : []),
              actionButton(a, 40, 16),
            ])}
          </HStack>
        ) : null}
      </VStack>
    );
  }

  const header = (
    <HStack spacing={6}>
      <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(fg)]}>{car.name}</Text>
      {timerClock ?? (car.updated ? <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{car.updated}</Text> : null)}
      <Spacer />
      {car.warning ? (
        <Image systemName="exclamationmark.triangle.fill" size={12} color={warn} />
      ) : car.isLocked == null ? null : (
        <Image systemName={lockIcon} size={12} color={lockColor} />
      )}
    </HStack>
  );
  const render = (height: number, bleed = 10) =>
    car.image ? (
      <Image
        uiImage={car.image}
        modifiers={[
          resizable(),
          widgetAccentedRenderingMode("accentedDesaturated"),
          aspectRatio({ contentMode: "fit" }),
          frame({ maxWidth: 10000, maxHeight: height, alignment: "trailing" }),
          offset({ x: bleed }),
        ]}
      />
    ) : null;
  const stat = (label: string, value: string | undefined, tone = fg) => (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{label}</Text>
      <Text modifiers={[font({ size: 14, weight: "medium" }), foregroundStyle(tone)]}>{value ?? "—"}</Text>
    </VStack>
  );

  if (family === "systemLarge") {
    const t = car.tyres;
    // Labelled buttons: the large family has room for a word under each circle.
    const labelled = (a: NonNullable<CarWidgetCar["actions"]>[number]) => (
      <VStack key={a.id} spacing={5}>
        {actionButton(a, 50, 18)}
        <Text modifiers={[font({ size: 11, weight: "medium" }), foregroundStyle(muted)]}>{a.label}</Text>
      </VStack>
    );
    const hero = car.image ? (
      <Image
        uiImage={car.image}
        modifiers={[
          resizable(),
          widgetAccentedRenderingMode("accentedDesaturated"),
          aspectRatio({ contentMode: "fit" }),
          frame({ maxWidth: 10000, maxHeight: 96, alignment: "trailing" }),
          // Proton's renders have transparent margins.
          offset({ x: 14 }),
        ]}
      />
    ) : null;
    const gauge =
      car.energyFraction != null ? (
        // linearCapacity fills with the tint, not the foreground style (that would leave it the system blue).
        <Gauge value={car.energyFraction} modifiers={[gaugeStyle("linearCapacity"), tint(fg), frame({ maxWidth: 10000 })]} />
      ) : null;
    return (
      <VStack alignment="leading" spacing={10} modifiers={shell}>
        {header}
        {/* The car sits to the right of the figures, as in the medium family, with the fuel bar under both. */}
        <HStack alignment="bottom" spacing={18}>
          <VStack alignment="leading" spacing={14}>
            <HStack alignment="bottom" spacing={18}>
              <VStack alignment="leading" spacing={2}>
                <Text modifiers={[font({ size: 34, weight: "semibold" }), foregroundStyle(fg)]}>{car.rangeValue ?? "—"}</Text>
                <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>Range (km)</Text>
              </VStack>
              <VStack alignment="leading" spacing={2}>
                <Text modifiers={[font({ size: 34, weight: "semibold" }), foregroundStyle(fg)]}>{car.energyValue ?? "—"}</Text>
                <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{car.energyLabel ?? "Fuel (L)"}</Text>
              </VStack>
            </HStack>
            {stat("Mileage", car.mileage)}
          </VStack>
          <Spacer />
          {hero}
        </HStack>
        {gauge}
        <HStack alignment="top" spacing={18}>
          {stat("Doors and windows", car.openings, car.isAnyOpen ? warn : fg)}
          <Spacer />
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>Tyres (kPa)</Text>
            {t ? (
              <VStack alignment="leading" spacing={1}>
                <Text modifiers={[font({ size: 14, weight: "medium" }), foregroundStyle(car.isTyreWarning ? warn : fg)]}>{`${t.fl ?? "—"}   ${t.fr ?? "—"}`}</Text>
                <Text modifiers={[font({ size: 14, weight: "medium" }), foregroundStyle(car.isTyreWarning ? warn : fg)]}>{`${t.rl ?? "—"}   ${t.rr ?? "—"}`}</Text>
              </VStack>
            ) : (
              <Text modifiers={[font({ size: 14, weight: "medium" }), foregroundStyle(fg)]}>—</Text>
            )}
          </VStack>
          <Spacer />
          {car.warning ? stat("Warning", car.warning, warn) : <Spacer />}
        </HStack>
        <Spacer />
        {car.actions?.length ? (
          <HStack alignment="top">
            {car.actions.flatMap((a, i) => [...(i > 0 ? [<Spacer key={`${a.id}-gap`} />] : []), labelled(a)])}
          </HStack>
        ) : null}
      </VStack>
    );
  }

  return (
    <VStack alignment="leading" spacing={0} modifiers={shell}>
      <HStack spacing={4}>
        <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(fg), frame({ maxWidth: 10000, alignment: "leading" })]}>
          {car.name}
        </Text>
        {car.warning ? (
          <Image systemName="exclamationmark.triangle.fill" size={11} color={warn} />
        ) : car.isLocked === false ? (
          <Image systemName="lock.open.fill" size={11} color={warn} />
        ) : null}
      </HStack>
      <Spacer />
      {render(60, 22)}
      <Text modifiers={[font({ size: 26, weight: "semibold" }), foregroundStyle(fg)]}>{car.range ?? "—"}</Text>
      {timerClock ?? (car.energy ? <Text modifiers={[font({ size: 12, weight: "medium" }), foregroundStyle(muted)]}>{car.energy}</Text> : null)}
    </VStack>
  );
};

export default createWidget<CarWidgetProps, CarWidgetConfig>("CarWidget", CarWidget);

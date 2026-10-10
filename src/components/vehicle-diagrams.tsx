import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useResolveClassNames } from "uniwind";

import { AttentionIcon, HelpIcon, OkIcon } from "@/components/icons";
import { Text } from "@/components/text";
import type { OpenState, TyrePosition, VehicleScene, VehicleStatus } from "@/core/types";
import { humanize } from "@/lib/format";
import { TopView, WHEELS } from "@/components/top-view";
import { Icon, SHADOW } from "@/components/ui";

/** Each tile sits level with its wheel, on the outside of it. */
const SPOTS: Record<TyrePosition, { y: number; side: "left" | "right" }> = {
  frontLeft: { y: WHEELS.frontY, side: "left" },
  frontRight: { y: WHEELS.frontY, side: "right" },
  rearLeft: { y: WHEELS.rearY, side: "left" },
  rearRight: { y: WHEELS.rearY, side: "right" },
};
const CAR = 0.75;
// Gap between a tile and its wheel, and the height of the band a tile is centred in.
const GAP = 8;
const BAND = 56;
const POSITIONS = Object.keys(SPOTS) as TyrePosition[];

export const tyreFlagged = (s?: VehicleStatus) => POSITIONS.some((p) => s?.tyreWarnings?.[p]);

// Drawn outermost first. A faint wash of the text colour, not the tile colour: that matched the
// top of the hero gradient, so only the rings' lower halves showed and the car looked off-centre.
const RINGS = [
  { r: 0.46, opacity: 0.025 },
  { r: 0.36, opacity: 0.035 },
  { r: 0.26, opacity: 0.045 },
];

export function TyreDiagram({ scene, status: s, size, isCompact: compact }: { scene?: VehicleScene | null; status?: VehicleStatus; size: number; isCompact?: boolean }) {
  const ring = useResolveClassNames("text-foreground").color as string;
  const carSize = size * CAR;
  const inset = (size - carSize) / 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: "absolute" }} pointerEvents="none">
        {RINGS.map(({ r, opacity }) => (
          <Circle key={r} cx={size / 2} cy={size / 2} r={size * r} fill={ring} fillOpacity={opacity} />
        ))}
      </Svg>
      {/* Inset so the pressure tiles, pinned to the edges, clear the mirrors. */}
      <View className="absolute" style={{ left: inset, top: inset }}>
        <TopView scene={scene} status={s} size={carSize} />
      </View>
      {POSITIONS.map((p) => {
        const value = s?.tyres?.[p];
        if (value == null) return null;
        const flagged = !!s?.tyreWarnings?.[p];
        const spot = SPOTS[p];
        // Centred on the wheel's line whatever the tile's height; its inner edge a fixed gap from the wheel.
        const centerY = inset + spot.y * carSize;
        const edge = spot.side === "left" ? inset + WHEELS.leftX * carSize : size - (inset + WHEELS.rightX * carSize);
        return (
          <View
            key={p}
            pointerEvents="box-none"
            className={`absolute justify-center ${spot.side === "left" ? "items-end" : "items-start"}`}
            style={{ top: centerY - BAND / 2, height: BAND, width: size, [spot.side === "left" ? "right" : "left"]: size - edge + GAP }}
          >
            <View
              className={`flex-row items-center gap-1 rounded-xl bg-inset ${compact ? "px-2.5 py-1.5" : "px-3 py-2"}`}
              style={SHADOW}
              accessible
              accessibilityLabel={`${humanize(p)} tyre, ${Math.round(value)} kPa${flagged ? ", check pressure" : ""}`}
            >
              {flagged ? <Icon name="alert-circle" size={compact ? 14 : 16} colorClassName="accent-danger" /> : null}
              <Text className={`${compact ? "text-lg" : "text-2xl"} font-medium tracking-tight ${flagged ? "text-danger" : "text-foreground"}`}>
                {Math.round(value)}
                <Text className={`${compact ? "text-[10px]" : "text-xs"} font-normal text-muted`}> kPa</Text>
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

type Callout = { text: string; style: Record<string, number>; align: "left" | "right" | "center" };

/**
 * Labels for what's open, in the render's transparent margin: beside the body for doors and
 * windows (one pill each, stacked), above it for the bonnet, below it for the trunk.
 */
function openCallouts(s: VehicleStatus | undefined, size: number): Callout[] {
  const out: Callout[] = [];
  const isOpen = (v?: OpenState) => v === "open";
  const side = (pos: (typeof SIDES)[number], y: number, align: "left" | "right") => {
    const open = [isOpen(s?.doors?.[pos]) && "Door", isOpen(s?.windows?.[pos]) && "Window"].filter((x): x is string => !!x);
    // Inner edge a fixed gap from the body, like the tyre tiles.
    const edge = align === "left" ? size * (1 - WHEELS.leftX) + GAP : size * WHEELS.rightX + GAP;
    open.forEach((text, i) => out.push({ text, align, style: { top: size * y - 11 + (i - (open.length - 1) / 2) * 24, [align === "left" ? "right" : "left"]: edge } }));
  };
  side("frontLeft", 0.36, "left");
  side("rearLeft", 0.62, "left");
  side("frontRight", 0.36, "right");
  side("rearRight", 0.62, "right");
  // The car spans about 6% to 94% of the frame (see Outline).
  if (isOpen(s?.doors?.hood)) out.push({ text: "Bonnet", align: "center", style: { bottom: size * 0.94 + 2 } });
  if (isOpen(s?.windows?.sunroof)) out.push({ text: "Sunroof", align: "center", style: { top: size * 0.45 } });
  if (isOpen(s?.doors?.trunk)) out.push({ text: "Trunk", align: "center", style: { top: size * 0.94 + 2 } });
  return out;
}

export function DoorsDiagram({ scene, status: s, size }: { scene?: VehicleScene | null; status?: VehicleStatus; size: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <TopView scene={scene} status={s} size={size} />
      {openCallouts(s, size).map((c) => (
        <View
          key={c.text + JSON.stringify(c.style)}
          pointerEvents="none"
          className={`absolute ${c.align === "center" ? "items-center" : c.align === "left" ? "items-end" : "items-start"}`}
          style={c.align === "center" ? { ...c.style, left: 0, right: 0 } : c.style}
        >
          <View className="rounded-full bg-danger/15 px-2 py-0.5">
            <Text className="text-danger text-[11px] font-semibold" numberOfLines={1}>
              {c.text}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export type OpeningRow = { label: string; state: "ok" | "open" | "unknown"; detail: string };

const SIDES = ["frontLeft", "frontRight", "rearLeft", "rearRight"] as const;

export function openingRows(s?: VehicleStatus): OpeningRow[] {
  const single = (label: string, v?: OpenState): OpeningRow =>
    v == null || v === "unknown"
      ? { label, state: "unknown", detail: "Unknown" }
      : { label, state: v === "open" ? "open" : "ok", detail: v === "open" ? "Open" : "Closed" };
  const group = (label: string, rec?: Partial<Record<string, OpenState>>): OpeningRow => {
    const known = SIDES.filter((k) => rec?.[k] != null && rec[k] !== "unknown");
    if (!known.length) return { label, state: "unknown", detail: "Unknown" };
    const open = known.filter((k) => rec?.[k] === "open");
    // Which ones is on the diagram; here just how many.
    return open.length ? { label, state: "open", detail: open.length === known.length ? "All open" : `${open.length} open` } : { label, state: "ok", detail: "Closed" };
  };
  return [
    single("Bonnet", s?.doors?.hood),
    group("Doors", s?.doors),
    group("Windows", s?.windows),
    single("Sunroof", s?.windows?.sunroof),
    single("Trunk", s?.doors?.trunk),
  ].filter((r) => r.state !== "unknown" || r.label === "Doors" || r.label === "Windows");
}

/** One line per opening: a status icon, the name, and any state text after it. The block is centred in its column, mirroring the car. */
export function OpeningsList({ status }: { status?: VehicleStatus }) {
  return (
    <View className="self-center gap-2.5">
      {openingRows(status).map((r) => (
        <View key={r.label} className="flex-row items-center gap-2" accessible accessibilityLabel={`${r.label}: ${r.detail}`}>
          {r.state === "ok" ? (
            <OkIcon size={15} strokeWidth={2.5} colorClassName="accent-success" />
          ) : r.state === "open" ? (
            <AttentionIcon size={15} strokeWidth={2.5} colorClassName="accent-danger" />
          ) : (
            <HelpIcon size={15} strokeWidth={2.5} colorClassName="accent-muted" />
          )}
          <Text className="shrink text-foreground text-sm font-medium" numberOfLines={1}>
            {r.label}
          </Text>
          {/* The check already says closed; only problems need words. */}
          {r.state !== "ok" ? (
            <Text className={`shrink text-sm ${r.state === "open" ? "text-danger font-medium" : "text-muted"}`} numberOfLines={1}>
              {r.detail}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

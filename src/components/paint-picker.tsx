import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

import { Text } from "@/components/text";
import { usePaints, useSetPaint } from "@/hooks/queries";
import type { Vehicle } from "@/core/types";
import { paintHex, paintLabel } from "@/lib/paint";
import { Sheet } from "@/components/sheet";

const Spinner = withUniwind(ActivityIndicator);

/** The choice is kept on this device; picking the factory paint clears it. */
export function PaintPicker({
  connectionId,
  vehicle,
  isVisible: visible,
  onClose,
}: {
  connectionId: string;
  vehicle: Vehicle;
  isVisible: boolean;
  onClose: () => void;
}) {
  const paints = usePaints(connectionId, vehicle, visible);
  const setPaint = useSetPaint(connectionId, vehicle);

  const choose = (code: string) => {
    if (vehicle.paintCode ? code === vehicle.paintCode : paints.data?.find((p) => p.code === code)?.name === vehicle.color) return onClose();
    Haptics.selectionAsync();
    setPaint.mutate(code === vehicle.factoryPaintCode ? null : code, { onSuccess: onClose });
  };

  return (
    <Sheet isVisible={visible} onClose={onClose} title="Colour">
      {paints.isLoading ? (
        <View className="items-center py-8">
          <Spinner colorClassName="accent-muted" />
        </View>
      ) : paints.data?.length ? (
        <View className="flex-row flex-wrap">
          {paints.data.map((p) => {
            const selected = vehicle.paintCode ? p.code === vehicle.paintCode : p.name === vehicle.color;
            const saving = setPaint.isPending && setPaint.variables === (p.code === vehicle.factoryPaintCode ? null : p.code);
            return (
              <Pressable
                key={p.code}
                onPress={() => choose(p.code)}
                disabled={setPaint.isPending}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${paintLabel(p.name)}${p.code === vehicle.factoryPaintCode ? ", factory colour" : ""}`}
                className="w-1/4 items-center gap-1.5 py-2 active:opacity-70"
              >
                <View className={`rounded-full p-0.5 border-2 ${selected ? "border-foreground" : "border-transparent"}`}>
                  <View className="size-12 rounded-full overflow-hidden items-center justify-center" style={{ backgroundColor: paintHex(p.name) ?? "#8a9099" }}>
                    {p.swatch ? <Image source={p.swatch} contentFit="cover" style={{ width: "100%", height: "100%" }} /> : null}
                    {saving ? (
                      <View className="absolute inset-0 items-center justify-center bg-black/30">
                        <Spinner size="small" colorClassName="accent-white" />
                      </View>
                    ) : null}
                  </View>
                </View>
                <Text className="text-foreground text-xs text-center px-1" numberOfLines={2}>
                  {paintLabel(p.name)}
                </Text>
                {p.code === vehicle.factoryPaintCode ? <Text className="text-muted text-[10px] -mt-1">Factory</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : paints.data === null ? (
        <Text className="text-muted text-sm text-center py-6">Colour choices need the latest app. Reload the app to see them.</Text>
      ) : paints.isError ? (
        <Text className="text-muted text-sm text-center py-6">Couldn’t load colours. Try again in a moment.</Text>
      ) : (
        <Text className="text-muted text-sm text-center py-6">No other colours are available for this model.</Text>
      )}
      <Text className="text-muted text-xs text-center">Changes how the car looks in this app only.</Text>
    </Sheet>
  );
}

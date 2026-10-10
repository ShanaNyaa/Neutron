import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import type { VehicleScene, VehicleStatus } from "@/core/types";

export function SceneView({ scene, status, height = 230 }: { scene: VehicleScene; status?: VehicleStatus; height?: number }) {
  const [active, setActive] = useState(0);
  const angle = scene.angles[Math.min(active, scene.angles.length - 1)];
  const s = status ?? {};
  const layers = angle.layers.filter((l) => !l.when || l.when(s));

  return (
    <View className="gap-3">
      <View style={{ height }} className="w-full items-center justify-center">
        <View style={{ height, aspectRatio: angle.aspectRatio }}>
          {layers.map((l, i) => (
            <Image
              key={l.uri}
              source={l.uri}
              contentFit="contain"
              transition={i === 0 ? 150 : 0}
              cachePolicy="disk"
              style={StyleSheet.absoluteFill}
            />
          ))}
        </View>
      </View>

      {scene.angles.length > 1 ? (
        <View className="flex-row justify-center gap-2">
          {scene.angles.map((a, i) => (
            <Pressable
              key={a.id}
              onPress={() => setActive(i)}
              className={`px-4 py-1.5 rounded-full ${i === active ? "bg-foreground/15" : "bg-surface-2"}`}
            >
              <Text className={i === active ? "text-foreground text-xs font-semibold" : "text-muted text-xs font-medium"}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

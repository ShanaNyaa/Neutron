import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { View } from "react-native";
import { useResolveClassNames } from "uniwind";

import type { ProviderDefinition } from "@/core/provider";

type Brand = Pick<ProviderDefinition, "logo" | "logoScale" | "icon" | "color"> | undefined;

export function BrandMark({ provider, size = 40, radius = 12 }: { provider: Brand; size?: number; radius?: number }) {
  const color = provider?.color ?? "#64748b";
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: `${color}22` }} className="items-center justify-center">
      {provider?.logo ? (
        <Image source={provider.logo} style={{ width: size * 0.62, height: size * 0.62, transform: [{ scale: provider.logoScale ?? 1 }] }} contentFit="contain" tintColor={color} />
      ) : (
        <Ionicons name={(provider?.icon as never) ?? "car"} size={size * 0.5} color={color} />
      )}
    </View>
  );
}

export function BrandGlyph({ provider, size = 20, isOriginal: original }: { provider: Brand; size?: number; isOriginal?: boolean }) {
  const tint = useResolveClassNames("text-foreground").color as string;
  if (!provider?.logo) return <Ionicons name={(provider?.icon as never) ?? "car"} size={size} color={tint} />;
  return <Image source={provider.logo} style={{ width: size, height: size, transform: [{ scale: provider.logoScale ?? 1 }] }} contentFit="contain" tintColor={original ? undefined : tint} />;
}

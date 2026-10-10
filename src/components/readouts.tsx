import { View } from "react-native";

import { Text } from "@/components/text";

/** "Inside 31°   Outside 33°": quiet labels with their values, spaced by layout, not a separator glyph. */
export function Readouts({ items, className = "" }: { items: [label: string, value: string][]; className?: string }) {
  if (!items.length) return null;
  return (
    <View className={`flex-row flex-wrap justify-center gap-x-5 gap-y-1 ${className}`}>
      {items.map(([label, value]) => (
        <Text key={label} className="text-muted text-[15px]">
          {label} <Text className="text-foreground font-medium">{value}</Text>
        </Text>
      ))}
    </View>
  );
}

import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import Animated, { FadeInLeft, FadeInRight } from "react-native-reanimated";

import { BrandGlyph } from "@/components/brand";
import { Group, PanelRow } from "@/components/panel";
import { Sheet, useRouteSheet } from "@/components/sheet";
import { SignInForm } from "@/components/sign-in-form";
import { Text, TextInput } from "@/components/text";
import { Icon } from "@/components/ui";
import type { ProviderDefinition } from "@/core/provider";
import { providers } from "@/providers";

export default function AddConnection() {
  const sheet = useRouteSheet();
  const [picked, setPicked] = useState<ProviderDefinition>();
  // The list only slides in when coming back from the sign-in form, not on first open.
  const [hasPicked, setHasPicked] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  // Description too, so a model name ("S70") finds its brand.
  const shown = q ? providers.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q)) : providers;

  return (
    <Sheet
      isScrollable
      isLarge
      isVisible={sheet.visible}
      onClose={() => sheet.close()}
      onClosed={sheet.onClosed}
      onBack={picked ? () => setPicked(undefined) : undefined}
      title={picked ? "New Connection" : "Add Connection"}
    >
      {picked ? (
        <Animated.View key="sign-in" entering={FadeInRight.duration(250)}>
          <SignInForm provider={picked} onDone={() => sheet.close(() => router.dismissTo("/"))} />
        </Animated.View>
      ) : (
        <Animated.View key="brands" entering={hasPicked ? FadeInLeft.duration(250) : undefined} className="gap-4">
          <Text className="text-muted text-sm">Choose the brand whose account you want to connect.</Text>

          <View className="h-12 flex-row items-center gap-3 rounded-2xl bg-inset px-4">
            <Icon name="search" size={18} colorClassName="accent-muted" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search brands or models"
              placeholderTextColorClassName="accent-muted"
              cursorColorClassName="accent-foreground"
              selectionColorClassName="accent-foreground/30"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              returnKeyType="search"
              accessibilityLabel="Search brands"
              className="flex-1 py-0 text-[16px] text-foreground"
            />
          </View>

          {shown.length ? (
            <Group>
              {shown.map((p) => (
                <View key={p.id} className={p.isComingSoon ? "opacity-50" : ""} accessibilityState={{ disabled: !!p.isComingSoon }}>
                  <PanelRow
                    icon="car-outline"
                    leading={<BrandGlyph provider={p} size={28} />}
                    label={p.name}
                    detail={p.description}
                    onPress={
                      p.isComingSoon
                        ? undefined
                        : () => {
                            setHasPicked(true);
                            setPicked(p);
                          }
                    }
                  />
                </View>
              ))}
            </Group>
          ) : (
            <Text className="text-muted text-sm text-center py-6">No brands match “{query.trim()}”.</Text>
          )}

          <Text className="text-muted text-xs leading-5">More brands will be added over time.</Text>
        </Animated.View>
      )}
    </Sheet>
  );
}

import { AccessoryWidgetBackground, Image, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import { containerBackground, font, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

import type { CarWidgetConfig, CarWidgetProps } from "@/widgets/car-widget";

const CarLockWidget = (props: CarWidgetProps, environment: WidgetEnvironment<CarWidgetConfig>) => {
  "widget";
  // "carN" is the legacy position-based choice.
  const cars = props.cars ?? [];
  const choice = environment.configuration?.car ?? "main";
  const byDefault = cars.find((c) => c.isDefault) ?? cars[0];
  const legacy = /^car[1-9]$/.test(choice) ? cars[Number(choice.slice(3)) - 1] : undefined;
  const car = cars.find((c) => c.id === choice) ?? legacy ?? byDefault;

  const locked = car?.isLocked;
  const word = !car ? "No car" : locked === false ? "Unlocked" : car.isAnyOpen ? "Open" : locked ? "Locked" : "—";
  return (
    // WidgetKit needs a declared container background, even on the Lock Screen.
    <ZStack modifiers={[containerBackground("clear", "widget"), ...(car?.url ? [widgetURL(car.url)] : [])]}>
      <AccessoryWidgetBackground />
      <VStack spacing={2}>
        <Image systemName={locked === false ? "lock.open.fill" : "lock.fill"} size={18} />
        <Text modifiers={[font({ size: 10, weight: "semibold" })]}>{word}</Text>
      </VStack>
    </ZStack>
  );
};

export default createWidget<CarWidgetProps, CarWidgetConfig>("CarLockWidget", CarLockWidget);

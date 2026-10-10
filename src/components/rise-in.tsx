import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing } from "react-native";

/** Translate and opacity only: scale re-renders the card's shadow and image every frame. */
export function RiseIn({ index = 0, children }: { index?: number; children: ReactNode }) {
  const [t] = useState(() => new Animated.Value(0));
  const [moving, setMoving] = useState(true);

  useEffect(() => {
    let anim: Animated.CompositeAnimation | undefined;
    const frame = requestAnimationFrame(() => {
      anim = Animated.timing(t, {
        toValue: 1,
        delay: index * 80,
        duration: 550,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      });
      anim.start(() => setMoving(false));
    });
    return () => {
      cancelAnimationFrame(frame);
      anim?.stop();
    };
  }, [t, index]);

  return (
    <Animated.View
      // Rasterized while moving: fading many layers is costly on iOS.
      shouldRasterizeIOS={moving}
      renderToHardwareTextureAndroid={moving}
      style={{
        opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] }),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

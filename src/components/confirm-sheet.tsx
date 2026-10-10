import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { HOLD_MS, HoldProgress, useHoldProgress } from "@/components/hold-progress";
import { Sheet } from "@/components/sheet";
import { Text } from "@/components/text";
import { Button } from "@/components/ui";

/** For destructive actions: the user has to press and hold to confirm, so a stray tap can't. */
export function ConfirmSheet({
  isVisible,
  title,
  message,
  action,
  pendingAction,
  onConfirm,
  onClose,
}: {
  isVisible: boolean;
  title: string;
  message: string;
  /** e.g. "Remove"; shown as "Hold to Remove". */
  action: string;
  /** Shown while `onConfirm` runs, e.g. "Removing…". */
  pendingAction: string;
  /** The sheet closes once it resolves; a thrown error is shown in the sheet. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Sheet isVisible={isVisible} onClose={onClose} title={title}>
      {/* Remounted each time it opens, so no busy or error state carries over. */}
      {isVisible ? <ConfirmBody message={message} action={action} pendingAction={pendingAction} onConfirm={onConfirm} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ConfirmBody({
  message,
  action,
  pendingAction,
  onConfirm,
  onClose,
}: {
  message: string;
  action: string;
  pendingAction: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const hold = useHoldProgress(!isBusy);

  const confirm = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setIsBusy(true);
    setError(undefined);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setIsBusy(false);
    }
  };

  return (
    <View className="gap-5">
      <Text className="text-muted text-base">{message}</Text>
      {error ? <Text className="text-danger text-sm">{error}</Text> : null}
      <View className="gap-2">
        <Pressable
          onPressIn={hold.onPressIn}
          onPressOut={hold.onPressOut}
          onLongPress={confirm}
          delayLongPress={HOLD_MS}
          disabled={isBusy}
          accessibilityRole="button"
          accessibilityLabel={action}
          accessibilityHint="This can’t be undone."
          // VoiceOver can't press and hold; its double tap confirms instead.
          accessibilityActions={[{ name: "activate" }]}
          onAccessibilityAction={(e) => e.nativeEvent.actionName === "activate" && confirm()}
          className={`h-12 rounded-2xl items-center justify-center bg-danger/10 ${isBusy ? "opacity-40" : ""}`}
        >
          <Text className="text-danger text-base font-semibold">{isBusy ? pendingAction : `Hold to ${action}`}</Text>
          <HoldProgress progress={hold.progress} radius={16} isDanger />
        </Pressable>
        <Button title="Cancel" variant="secondary" onPress={onClose} isDisabled={isBusy} />
      </View>
    </View>
  );
}

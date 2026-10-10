import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, View, type TextInputInstance } from "react-native";

import { Text } from "@/components/text";
import type { CommandDefinition } from "@/core/types";
import { Sheet, useSheetFocus } from "@/components/sheet";
import { formatStep, Stepper } from "@/components/stepper";
import { Button, Field, ReadOnlyField } from "@/components/ui";

type Props = {
  command: CommandDefinition | null;
  /** Chosen elsewhere (e.g. the Climate sheet): shown as a summary instead of asked again. */
  params?: Record<string, string | number>;
  onClose: () => void;
  onSubmit: (input: { pin?: string; params?: Record<string, string | number> }) => Promise<void>;
};

export function CommandSheet({ command, params, onClose, onSubmit }: Props) {
  // Kept while the sheet slides away.
  const [shown, setShown] = useState({ command, params });
  if (command && command !== shown.command) setShown({ command, params });

  return (
    <Sheet isVisible={!!command} onClose={onClose} title={shown.command?.label ?? ""}>
      {shown.command ? <CommandForm command={shown.command} params={shown.params} onClose={onClose} onSubmit={onSubmit} /> : null}
    </Sheet>
  );
}

function CommandForm({ command, params: preset, onClose, onSubmit }: Props & { command: CommandDefinition }) {
  const [pin, setPin] = useState("");
  const [params, setParams] = useState<Record<string, string | number>>(
    () => preset ?? Object.fromEntries((command.params ?? []).map((p) => [p.key, p.default ?? p.min ?? ""])),
  );
  const summary: [string, string][] = preset
    ? (command.params ?? []).flatMap((p): [string, string][] => {
        const v = preset[p.key];
        if (v == null) return [];
        return [[p.label, p.type === "number" ? formatStep(Number(v), p.unit) : (p.options?.find((o) => o.value === v)?.label ?? String(v))]];
      })
    : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pinInput = useSheetFocus<TextInputInstance>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit({ pin: command.isPinRequired ? pin : undefined, params });
      onClose();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-5">
      {summary.map(([label, value]) => (
        <ReadOnlyField key={label} label={label} value={value} />
      ))}

      {preset
        ? null
        : command.params?.map((p) =>
            p.type === "number" ? (
              <View key={p.key} className="gap-3">
                <Text className="text-muted text-sm font-medium text-center">{p.label}</Text>
                <Stepper
                  value={Number(params[p.key])}
                  unit={p.unit}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  onChange={(v) => setParams((s) => ({ ...s, [p.key]: v }))}
                />
              </View>
            ) : (
              <View key={p.key} className="gap-3">
                <Text className="text-muted text-sm font-medium px-1">{p.label}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {p.options?.map((o) => (
                    <Pressable
                      key={String(o.value)}
                      onPress={() => setParams((s) => ({ ...s, [p.key]: o.value }))}
                      className={`px-4 py-2.5 rounded-2xl active:opacity-70 ${params[p.key] === o.value ? "bg-foreground/15" : "bg-inset"}`}
                    >
                      <Text className={params[p.key] === o.value ? "text-foreground font-semibold" : "text-muted"}>{o.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ),
          )}

      {command.isPinRequired ? (
        <Field
          ref={pinInput}
          label="Vehicle PIN"
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={8}
          placeholder="••••"
        />
      ) : null}

      {error ? <Text className="text-danger text-sm">{error}</Text> : null}

      <Button
        title={`Send ${command.label}`}
        onPress={submit}
        isLoading={busy}
        isDisabled={command.isPinRequired ? pin.length < 4 : false}
        variant={command.isDestructive ? "danger" : "primary"}
      />
    </View>
  );
}

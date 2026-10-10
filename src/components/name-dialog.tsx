import { useState } from "react";
import type { TextInputInstance } from "react-native";

import { Sheet, useSheetFocus } from "@/components/sheet";
import { Button, Field } from "@/components/ui";

type Props = {
  isVisible: boolean;
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
};

export function NameDialog({ isVisible: visible, title, onClose, ...form }: Props) {
  return (
    <Sheet isVisible={visible} onClose={onClose} title={title}>
      <NameForm onClose={onClose} {...form} />
    </Sheet>
  );
}

/** Mounted each time the sheet opens, so it starts from the current name. */
function NameForm({ label, initial = "", placeholder, onClose, onSubmit }: Omit<Props, "isVisible" | "title">) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useSheetFocus<TextInputInstance>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Field ref={input} accessibilityLabel={label} value={value} onChangeText={setValue} placeholder={placeholder} error={error} maxLength={40} />
      <Button title="Save" onPress={submit} isLoading={busy} isDisabled={!value.trim()} />
    </>
  );
}

import { router, useLocalSearchParams } from "expo-router";

import { Sheet, useRouteSheet } from "@/components/sheet";
import { SignInForm } from "@/components/sign-in-form";
import { Empty } from "@/components/ui";
import { useConnections } from "@/core/connections";
import { getProvider } from "@/providers";

export default function NewConnection() {
  const { providerId, reauth } = useLocalSearchParams<{ providerId: string; reauth?: string }>();
  const provider = getProvider(providerId);
  const connections = useConnections((s) => s.connections);
  const existing = reauth ? connections.find((c) => c.id === reauth) : undefined;
  const sheet = useRouteSheet();

  return (
    <Sheet
      isScrollable
      isLarge
      isVisible={sheet.visible}
      onClose={() => sheet.close()}
      onClosed={sheet.onClosed}
      title={existing ? "Re-authenticate" : "New Connection"}
    >
      {provider ? (
        <SignInForm provider={provider} existing={existing} onDone={() => sheet.close(() => router.dismissTo("/"))} />
      ) : (
        <Empty icon="alert-circle-outline" title="Unknown provider" />
      )}
    </Sheet>
  );
}

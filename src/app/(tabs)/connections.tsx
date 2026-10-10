import { router } from "expo-router";
import { Pressable } from "react-native";

import { BrandGlyph } from "@/components/brand";
import { Group, PanelRow } from "@/components/panel";
import { Button, Empty, Icon, Page } from "@/components/ui";
import { useConnections } from "@/core/connections";
import { getProvider } from "@/providers";

export default function Connections() {
  const connections = useConnections((s) => s.connections);

  return (
    <Page
      title="Connections"
      right={
        <Pressable
          onPress={() => router.push("/connections/add")}
          accessibilityRole="button"
          accessibilityLabel="Add connection"
          className="size-10 rounded-full bg-inset items-center justify-center active:opacity-60"
        >
          <Icon name="add" size={22} colorClassName="accent-foreground" />
        </Pressable>
      }
    >
      {connections.length === 0 ? (
        <Empty
          icon="link-outline"
          title="Connect a car account"
          body="Sign in to your car brand's account to pull in your vehicles, status and remote controls."
          action={<Button title="Add Connection" icon="add" onPress={() => router.push("/connections/add")} className="mt-2" />}
        />
      ) : (
        <Group>
          {connections.map((c) => {
            const p = getProvider(c.providerId);
            return (
              <PanelRow
                key={c.id}
                icon="link-outline"
                leading={<BrandGlyph provider={p} size={40} />}
                isLeadingFilled
                label={c.label}
                detail={p?.name ?? c.providerId}
                value={c.isReauthRequired ? "Signed out" : undefined}
                tone={c.isReauthRequired ? "warn" : "default"}
                onPress={() => router.push(`/connections/${c.id}`)}
              />
            );
          })}
        </Group>
      )}
    </Page>
  );
}

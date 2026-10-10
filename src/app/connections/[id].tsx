import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { BrandGlyph } from "@/components/brand";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { Group, Panel, PanelRow, SecretRow } from "@/components/panel";
import { Empty, Field, Icon, Page, Section, type IconName } from "@/components/ui";
import { useConnections } from "@/core/connections";
import type { ProviderClient } from "@/core/provider";
import { useVehicle } from "@/hooks/queries";
import { getProvider } from "@/providers";

const CAPS = {
  status: { label: "Live status", icon: "pulse-outline" },
  location: { label: "Location", icon: "location-outline" },
  commands: { label: "Remote controls", icon: "options-outline" },
  trips: { label: "Trips", icon: "map-outline" },
  notices: { label: "Notifications", icon: "notifications-outline" },
  imagery: { label: "Vehicle renders", icon: "image-outline" },
} as const satisfies Record<string, { label: string; icon: IconName }>;

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

async function loadSessionInfo(client: ProviderClient) {
  const info = (await client.sessionInfo?.()) ?? {};
  return { ...info, soon: !!info.validUntil && info.validUntil - Date.now() < 7 * 86_400_000 };
}

export default function ManageConnection() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { connections, updateConnection, removeConnection, getClient } = useConnections(
    useShallow((s) => ({
      connections: s.connections,
      updateConnection: s.updateConnection,
      removeConnection: s.removeConnection,
      getClient: s.getClient,
    })),
  );
  const conn = connections.find((c) => c.id === id);
  const { query } = useVehicle(id, "");
  const qc = useQueryClient();
  const [label, setLabel] = useState(conn?.label ?? "");
  const [isRemoving, setIsRemoving] = useState(false);
  const session = useQuery({
    queryKey: ["session", id, conn?.isReauthRequired],
    queryFn: async () => loadSessionInfo(await getClient(id)),
    enabled: !!conn && !conn.isReauthRequired,
  });
  const validUntil = session.data?.validUntil;

  if (!conn)
    return (
      <Page title="Connection" isBackVisible>
        <Empty icon="unlink" title="Connection removed" />
      </Page>
    );
  const provider = getProvider(conn.providerId);

  const remove = async () => {
    await removeConnection(conn.id);
    qc.removeQueries({ queryKey: ["vehicles", conn.id] });
    router.dismissAll();
  };

  return (
    <>
      <Page title={conn.label} isBackVisible>
        <Section title="Name">
          <Field
            accessibilityLabel="Connection name"
            value={label}
            onChangeText={setLabel}
            onEndEditing={() => label.trim() && updateConnection(conn.id, { label: label.trim() })}
          />
        </Section>

        <Section title="Account" className="mt-3">
          <Group>
            <PanelRow
              icon="person-circle-outline"
              leading={<BrandGlyph provider={provider} />}
              label={provider?.name ?? conn.providerId}
              value={conn.isReauthRequired ? "Signed out" : undefined}
              tone={conn.isReauthRequired ? "warn" : "default"}
              trailing={
                conn.isReauthRequired ? undefined : (
                  <View accessible accessibilityLabel="Signed in">
                    <Icon name="checkmark-circle" size={20} colorClassName="accent-success" />
                  </View>
                )
              }
            />
            {conn.accountLabel ? <SecretRow icon="person-circle-outline" label="Account" value={conn.accountLabel} /> : null}
            <PanelRow
              icon="calendar-outline"
              label="Added"
              value={new Date(conn.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            />
            {/* Not every brand reports an expiry, hence the sign-in date fallback. */}
            {conn.isReauthRequired ? null : validUntil ? (
              <PanelRow icon="time-outline" label="Valid till" value={fmtDate(validUntil)} tone={session.data?.soon ? "warn" : "default"} />
            ) : session.data?.signedInAt ? (
              <PanelRow icon="time-outline" label="Signed in" value={fmtDate(session.data.signedInAt)} />
            ) : null}
            <PanelRow
              icon="refresh"
              label="Re-authenticate"
              onPress={() => router.push(`/connections/new/${conn.providerId}?reauth=${conn.id}`)}
            />
          </Group>
        </Section>

        <Section title="Vehicles" className="mt-3">
          <Panel>
            {query.isLoading ? (
              <PanelRow icon="car-outline" label="Loading..." />
            ) : query.error ? (
              <PanelRow icon="alert-circle-outline" iconTone="bad" label={(query.error as Error).message} />
            ) : query.data?.length ? (
              query.data.map((v) => (
                <PanelRow
                  key={v.id}
                  icon="car-outline"
                  label={v.name}
                  detail={v.model}
                  onPress={() => router.push(`/vehicle/${conn.id}/${encodeURIComponent(v.id)}`)}
                />
              ))
            ) : (
              <PanelRow icon="car-outline" label="No vehicles on this account" />
            )}
          </Panel>
        </Section>

        {provider ? (
          <Section title="Capabilities" className="mt-3">
            <Group>
              {provider.capabilities.map((c) => (
                <PanelRow key={c} icon={CAPS[c].icon} label={CAPS[c].label} />
              ))}
            </Group>
          </Section>
        ) : null}

        <Section title="Danger Zone" className="mt-3">
          <Group>
            <PanelRow icon="trash-outline" label="Remove Connection" isDestructive onPress={() => setIsRemoving(true)} />
          </Group>
        </Section>
      </Page>
      <ConfirmSheet
        isVisible={isRemoving}
        title={`Remove ${conn.label}?`}
        message="Its sign-in, saved PIN and cars are deleted from this device. You can add it again later."
        action="Remove"
        pendingAction="Removing…"
        onConfirm={remove}
        onClose={() => setIsRemoving(false)}
      />
    </>
  );
}

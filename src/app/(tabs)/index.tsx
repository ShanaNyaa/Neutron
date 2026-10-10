import { router } from "expo-router";
import { View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { Group, PanelRow } from "@/components/panel";
import { Banner, Button, Empty, Loading, Page, Section } from "@/components/ui";
import { RiseIn } from "@/components/rise-in";
import { VehicleCard } from "@/components/vehicle";
import { useConnections } from "@/core/connections";
import { useAllNotices, useGarage } from "@/hooks/queries";
import { usePullToRefresh, useRefreshOnFocus } from "@/lib/refresh";
import { ago } from "@/lib/format";
import { iconFor } from "@/lib/notices";

export default function Garage() {
  const { connections, ready } = useConnections(useShallow((s) => ({ connections: s.connections, ready: s.isReady })));
  const garage = useGarage();
  const pull = usePullToRefresh(garage.refetch);
  useRefreshOnFocus();
  const stale = connections.filter((c) => c.isReauthRequired);
  const { notices } = useAllNotices();
  const latest = notices[0]?.isRead ? undefined : notices[0];

  return (
    <Page title="Garage" refresh={pull}>
      {stale.map((c) => (
        <Banner key={c.id} tone="warn" onPress={() => router.push(`/connections/new/${c.providerId}?reauth=${c.id}`)}>
          {c.label} needs you to sign in again.
        </Banner>
      ))}
      {garage.errors.map(({ connection, error }) => (
        <Banner key={connection.id} onPress={() => router.push(`/connections/${connection.id}`)}>
          {connection.label}: {error.message}
        </Banner>
      ))}

      {!ready || (garage.isLoading && garage.vehicles.length === 0) ? (
        <Loading label="Finding your vehicles" />
      ) : connections.length === 0 ? (
        <Empty
          icon="car-sport-outline"
          title="No vehicles yet"
          body="Add a connection to your car brand's account and your vehicles will show up here."
          action={<Button title="Add Connection" icon="add" onPress={() => router.push("/connections/add")} className="mt-2" />}
        />
      ) : garage.vehicles.length === 0 ? (
        <Empty icon="search" title="No vehicles found" body="Your connected accounts don't have any vehicles bound to them." />
      ) : (
        <View className="gap-4">
          {garage.vehicles.map(({ connection, vehicle }, i) => (
            <RiseIn key={`${connection.id}:${vehicle.id}`} index={i}>
              <VehicleCard connection={connection} vehicle={vehicle} />
            </RiseIn>
          ))}
        </View>
      )}

      {latest ? (
        <Section title="Latest" className="mt-3">
          <Group>
            <PanelRow
              icon={iconFor(latest)}
              label={latest.title}
              detail={latest.body ? latest.body.replace(/\s*\n\s*/g, " ") : ago(latest.createdAt)}
              onPress={() => router.push("/inbox")}
            />
          </Group>
        </Section>
      ) : null}
    </Page>
  );
}

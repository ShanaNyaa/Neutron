import { Redirect, useLocalSearchParams } from "expo-router";

import { Empty } from "@/components/ui";
import * as store from "@/core/store";

/** Target of the Control Center / Lock Screen controls: mottokar://control/<command>. */
export default function ControlAction() {
  const { action } = useLocalSearchParams<{ action: string }>();
  const cars = store.allVehicles();
  const car = cars.find((c) => c.vehicle.isDefault) ?? cars[0];
  if (!car) return <Empty icon="car-outline" title="No car yet" body="Add a connection to use this control." />;
  return (
    <Redirect
      href={{
        pathname: "/vehicle/[connectionId]/[vehicleId]",
        params: { connectionId: car.connId, vehicleId: car.vehicle.id, action },
      }}
    />
  );
}

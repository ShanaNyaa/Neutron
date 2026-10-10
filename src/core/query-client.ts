import { onlineManager, QueryCache, QueryClient } from "@tanstack/react-query";
import * as Network from "expo-network";

import { logError } from "@/lib/log";

// https://tanstack.com/query/latest/docs/framework/react/react-native

onlineManager.setEventListener((setOnline) => {
  let initialised = false;
  const sub = Network.addNetworkStateListener((state) => {
    initialised = true;
    setOnline(!!state.isConnected);
  });
  Network.getNetworkStateAsync()
    .then((state) => {
      if (!initialised) setOnline(!!state.isConnected);
    })
    .catch(() => {});
  return sub.remove;
});

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
    queryCache: new QueryCache({
      onError: (error, query) => logError("data", `Load failed: ${(error as Error).message}`, { queryKey: query.queryKey }),
    }),
  });

import { focusManager, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

/** AppState stands in for the browser's window focus events. */
export function useAppStateFocus() {
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      focusManager.setFocused(status === "active");
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);
}

/** Refetch stale active queries when a screen regains focus (skips the initial mount). */
export function useRefreshOnFocus(queryKey?: QueryKey) {
  const queryClient = useQueryClient();
  const first = useRef(true);
  // Callers usually pass an inline array; keep it out of the deps so the effect only fires on focus.
  const key = useRef(queryKey);
  useEffect(() => {
    key.current = queryKey;
  });
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      queryClient.refetchQueries({ queryKey: key.current, stale: true, type: "active" });
    }, [queryClient]),
  );
}

/** Not `isRefetching`: that spins for background refetches, and on iOS setting `refreshing` programmatically shifts the scroll view. */
export function usePullToRefresh(refresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);
  return { refreshing, onRefresh };
}

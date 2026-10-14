import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./styles.css";
import { applyStoredTheme } from "./theme.ts";

// Settings saved before the rename from Mottokar keep working: copy them across once.
try {
  for (const old of ["theme", "prefs", "vin", "engineRun"]) {
    const value = localStorage.getItem(`mottokar.${old}`);
    if (value !== null && localStorage.getItem(`neutron.${old}`) === null) localStorage.setItem(`neutron.${old}`, value);
    localStorage.removeItem(`mottokar.${old}`);
  }
} catch {
  // storage unavailable; nothing to move
}

// Before the first render, so a chosen theme doesn't flash the default colours first.
applyStoredTheme();

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

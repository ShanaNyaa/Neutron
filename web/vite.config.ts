import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // The Node server runs beside Vite in the same container (see compose.yaml).
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

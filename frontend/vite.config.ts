import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Same-origin like prod: the browser only talks to Vite, which proxies /api to FastAPI.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:8000", changeOrigin: true },
    },
    watch: { usePolling: !!process.env.CHOKIDAR_USEPOLLING },
  },
});

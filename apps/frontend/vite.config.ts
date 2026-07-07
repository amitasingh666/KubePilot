import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy the API in dev so the SPA calls /trpc same-origin — the session
    // cookie flows without CORS/cross-site cookie complications.
    proxy: {
      "/trpc": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});

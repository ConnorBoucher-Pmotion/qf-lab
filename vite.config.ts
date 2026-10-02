import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5190,
    strictPort: true,
    host: true,
    // Tunnel hostnames (trycloudflare.com and similar) must be accepted or Vite refuses the page.
    allowedHosts: true,
  },
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the page comes from Vite and calls to the API and the feeds are passed to the server.
const SERVER = process.env.SMARTERNEWS_SERVER ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": SERVER, "/rss": SERVER } },
  // Nothing is inlined as a data: URI. The page's Content-Security-Policy allows fonts and images from this
  // origin only, and an inlined font would be blocked.
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
});

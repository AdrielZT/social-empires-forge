import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  build: {
    assetsDir: "bundle"
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5050",
      "/assets": "http://127.0.0.1:5050"
    }
  }
});

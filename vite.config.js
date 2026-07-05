import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api para o backend real durante o desenvolvimento.
// Ajuste o "target" para o endereco do seu backend (Node/Express, FastAPI, etc.).
export default defineConfig({
  plugins: [react()],
  // mqtt.js (no navegador) espera a variavel global "global"
  define: {
    global: "globalThis",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});

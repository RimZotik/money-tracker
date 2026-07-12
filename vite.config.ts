import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Без явного хоста Vite на этой машине слушает только IPv6 ([::1]:1420),
    // а Tauri стучится по IPv4 — и dev-сервер «не находится».
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      // Выписки и таблицы тоже исключаем: OneDrive держит их залоченными и
      // watcher падает с EBUSY, утаскивая за собой весь dev-сервер.
      ignored: ["**/src-tauri/**", "**/*.pdf", "**/*.xlsx", "**/*.csv", "**/tools/**"],
    },
  },
}));

import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
  plugins: [
    vue(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: { external: ["node:sqlite"] },
          },
        },
      },
      preload: { input: "electron/preload.ts" },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@reviewflow/domain": fileURLToPath(new URL("../../packages/domain/src/index.ts", import.meta.url)),
    },
  },
});

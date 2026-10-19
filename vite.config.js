import { defineConfig } from "vite";

// Builds the web app into www/, which Capacitor packs into the Android APK.
export default defineConfig({
  base: "./",
  build: {
    outDir: "www",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 6000,
  },
  worker: { format: "es" },
});

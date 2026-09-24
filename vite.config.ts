import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";

const view = process.env.QUIETLINK_VIEW ?? "popover";

export default defineConfig({
  plugins: [svelte({ configFile: path.join(import.meta.dirname, "svelte.config.js") })],
  root: path.join(import.meta.dirname, "src/views", view),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/views", view),
    emptyOutDir: true,
  },
});

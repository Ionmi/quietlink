import type { ElectrobunConfig } from "electrobun";

export default {
  app: { name: "Quietlink", identifier: "dev.quietlink.app", version: "0.1.0" },
  runtime: { exitOnLastWindowClosed: false },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/main/index.ts", version: "1.4.2" },
    views: {
      popover: { entrypoint: "src/views/popover/bridge-entry.ts" },
      settings: { entrypoint: "src/views/settings/bridge-entry.ts" },
    },
    copy: {
      "dist/views/popover/index.html": "views/popover/index.html",
      "dist/views/popover/assets": "views/popover/assets",
      "dist/views/settings/index.html": "views/settings/index.html",
      "dist/views/settings/assets": "views/settings/assets",
      "build/helper/quietlink-helper": "helper/quietlink-helper",
      "build/tray": "views/tray",
      "src/shared/presets.json": "presets.json",
    },
    buildFolder: "build/electrobun",
    artifactFolder: "build/electrobun-artifacts",
    mac: { bundleCEF: false, icons: "build/icon.iconset", createDmg: false },
  },
} satisfies ElectrobunConfig;

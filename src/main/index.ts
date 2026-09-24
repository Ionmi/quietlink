import Electrobun, { BrowserView, Tray, Utils } from "electrobun/main";
import { join } from "node:path";
import { configureWindows, setQuitting, togglePopover, showSettings } from "./windows";

Utils.setDockIconVisible(false);
const helperPath = join(import.meta.dir, "..", "helper", "quietlink-helper");

const rpc = BrowserView.defineRPC<any>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      invoke: ({ method }: { method: string; args: unknown[] }) => {
        if (method === "ping") return "pong";
        if (method === "openSettings") return showSettings();
        throw new Error(`unknown method ${method}`);
      },
    },
    messages: {},
  },
});
configureWindows(rpc);

const tray = new Tray({ image: "views://tray/tray-idle.png", template: true, width: 18, height: 18 });
tray.on("tray-clicked", (event: any) => {
  console.log("tray-clicked", JSON.stringify(event?.data ?? null));
  const out = Bun.spawnSync([helperPath, "--screens"]).stdout.toString();
  togglePopover(tray.getBounds(), JSON.parse(out).screens);
});

Electrobun.events.on("before-quit", () => {
  setQuitting();
});

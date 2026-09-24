import Electrobun, { Utils } from "electrobun/main";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { Controller } from "../app/controller";
import { buildReport } from "../app/export";
import { safeUninstall } from "../app/uninstall";
import { startCliServer } from "../app/cli-server";
import { HelperClient } from "../adapters/helper-client";
import { WardenClient, wardenPid } from "../adapters/warden-client";
import { SettingsStore } from "../adapters/settings-store";
import { TelemetryStore } from "../adapters/telemetry-store";
import { acquireInstanceLock } from "../adapters/instance-lock";
import { LogStream } from "../adapters/log-stream";
import * as privilege from "../adapters/privilege";
import { WARDEN_LABEL, LOGIN_LABEL, agentInstalled, installAgent, loginPlist, removeAgent, wardenPlist } from "../adapters/launch-agents";
import { appSupport, cliSock, dbPath, ensureAppSupport, helperBinary, instanceLockPath, keyPath, settingsPath } from "../adapters/paths";
import { configureWindows, broadcast, hidePopover, setPopoverHeight, setQuitting, showSettings, togglePopover } from "./windows";
import { trayState } from "./tray-state";
import { trayImageSpec } from "../domain/menubar";
import { dispatch, type Api } from "./rpc-api";
import pkg from "../../package.json";

Utils.setDockIconVisible(false);
ensureAppSupport();

const lock = acquireInstanceLock(instanceLockPath);
if (!lock) {
  console.log("Quietlink is already running");
  Utils.quit(0);
}

const appBundle = resolve(import.meta.dir, "../../../..");
const helperPath = helperBinary();
const macos = Bun.spawnSync(["/usr/bin/sw_vers", "-productVersion"]).stdout.toString().trim();
const lang = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("es") ? "es" : "en";

function gatewayKey(): Uint8Array {
  if (existsSync(keyPath)) return new Uint8Array(readFileSync(keyPath));
  const key = crypto.getRandomValues(new Uint8Array(32));
  writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

const settings = new SettingsStore(settingsPath, lang);
const telemetry = new TelemetryStore(dbPath, { autoFlushMs: 5000 });
const helper = new HelperClient({ argv: [helperPath, "--sensor"] });
const warden = new WardenClient();
const key = gatewayKey();

const controller = new Controller({
  helper, warden, settings, telemetry,
  notify: (title, body) => Utils.showNotification({ title, body }),
  gatewayKey: key,
  wardenPid: () => wardenPid(WARDEN_LABEL),
  macosMajor: Number(macos.split(".")[0]) || 0,
  installLoginAgent: (on) => (on ? installAgent(LOGIN_LABEL, loginPlist(appBundle)) : removeAgent(LOGIN_LABEL)),
  startLogStream: (onEvent) => {
    const s = new LogStream(Number(macos.split(".")[0]) || 0);
    s.start(onEvent);
    return s;
  },
});

/** Keeps the warden LaunchAgent pointing at this app's helper whenever the rule is installed. */
async function ensureWarden() {
  if (!(await privilege.hasPrivilege())) return false;
  const want = wardenPlist(helperPath);
  const path = join(homedir(), "Library/LaunchAgents", `${WARDEN_LABEL}.plist`);
  if (!agentInstalled(WARDEN_LABEL) || readFileSync(path, "utf8") !== want) await installAgent(WARDEN_LABEL, want);
  return true;
}

async function installCli() {
  try {
    const dir = join(homedir(), ".local/bin");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "quietlink");
    const bun = join(appBundle, "Contents/MacOS/bun");
    const script = join(import.meta.dir, "..", "bin", "quietlink");
    writeFileSync(target, `#!/bin/sh\nexec "${bun}" "${script}" "$@"\n`);
    chmodSync(target, 0o755);
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}

const api: Api = {
  view: () => controller.view(),
  manual: (on, durationMs) => controller.manual(on, durationMs),
  emergency: () => controller.emergency(),
  reenable: () => controller.reenable(),
  airdropBreak: () => controller.airdropBreak(),
  pause: () => controller.pause(),
  resume: () => controller.resume(),
  startQuietTest: () => controller.startQuietTest(),
  cancelQuietTest: () => controller.cancelQuietTest(),
  reconnectWifi: () => controller.reconnectWifi(),
  getSettings: () => settings.get(),
  updateSettings: (p) => controller.updateSettings(p),
  installPrivilege: async () => {
    const r = await privilege.install();
    if (r.ok) await ensureWarden();
    return r;
  },
  uninstallPrivilege: () =>
    safeUninstall({
      suppress: () => controller.emergency(),
      reenable: () => controller.reenable(),
      restoreNow: async () => { await warden.request({ op: "restore-now" }); },
      status: async () => {
        const r = await warden.request({ op: "status" });
        return r.ok && r.status ? r.status : null;
      },
      removeAgent: () => removeAgent(WARDEN_LABEL),
      uninstallRule: () => privilege.uninstall(),
    }),
  privilegeStatus: async () => ({ installed: await privilege.hasPrivilege(), wardenRunning: (await wardenPid(WARDEN_LABEL)) !== null }),
  listRunningApps: async () => controller.runningApps(),
  exportDiagnostics: async (includeIdentifiers) => {
    const v = controller.view();
    const md = buildReport(v, telemetry.seconds("gw", Date.now() - 24 * 3_600_000), {
      username: userInfo().username, home: homedir(), macos, version: pkg.version,
      gatewayIds: [],
    }, includeIdentifiers, telemetry.events(Date.now() - 24 * 3_600_000));
    const file = join(homedir(), "Downloads", `quietlink-diagnostics-${new Date().toISOString().slice(0, 19).replaceAll(":", "")}.md`);
    writeFileSync(file, md);
    Utils.showItemInFolder(file);
    return file;
  },
  clearData: () => controller.clearData(),
  installCli,
  openSettings: () => showSettings(),
  closePopover: () => hidePopover(),
  popoverHeight: (px) => setPopoverHeight(px),
  quit: () => void finish(),
};
configureWindows((method, args) => dispatch(api, method, args));


// The menu-bar item is a native NSStatusItem owned by the helper (template image,
// tinted by macOS). The app only sends what to show and receives clicks.
let lastSpec = "";
helper.on((e) => {
  if (e.type === "tray-clicked") togglePopover({ x: e.x, y: e.y, width: e.width, height: e.height }, e.screens);
});
helper.onRestart(() => {
  lastSpec = "";
  renderTray(controller.view());
});
function renderTray(v: ReturnType<typeof controller.view>) {
  const spec = trayImageSpec(trayState(v, v.because.length > 0), v.ping.gw, v.traffic, { ping: v.settings.showPingInMenuBar, traffic: v.settings.showTrafficInMenuBar });
  const key = JSON.stringify(spec);
  if (key === lastSpec) return;
  lastSpec = key;
  helper.send({ v: 1, cmd: "render-tray", ...spec });
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
controller.onChange((v) => {
  renderTray(v);
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    broadcast(controller.view());
  }, 250);
});

const cli = startCliServer(cliSock, {
  status: () => controller.view(),
  on: (minutes) => controller.manual(true, minutes ? minutes * 60_000 : undefined),
  off: () => controller.manual(false),
  pause: () => void controller.pause(),
  resume: () => void controller.resume(),
  test: () => controller.startQuietTest(),
  settings: () => showSettings(),
});

await ensureWarden().catch((e) => console.error("warden:", e));
await controller.start();
console.log(`Quietlink ${pkg.version} running (support dir ${appSupport})`);

let quitting = false;
async function finish() {
  if (quitting) return;
  quitting = true;
  setQuitting();
  await controller.stop().catch(() => {});
  cli.stop();
  telemetry.close();
  lock?.release();
  Utils.quit(0);
}
Electrobun.events.on("before-quit", (event: any) => {
  if (!quitting) {
    event.response = { allow: false };
    void finish();
  }
});

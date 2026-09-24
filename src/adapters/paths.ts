import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const appSupport = process.env.QUIETLINK_SUPPORT_DIR ?? join(homedir(), "Library/Application Support/Quietlink");
export const wardenSock = join(appSupport, "warden.sock");
export const cliSock = join(appSupport, "cli.sock");
export const dbPath = join(appSupport, "telemetry.sqlite");
export const settingsPath = join(appSupport, "settings.json");
export const keyPath = join(appSupport, "gateway.key");
export const instanceLockPath = join(appSupport, "instance.lock");
export const launchAgentsDir = join(homedir(), "Library/LaunchAgents");

/** Creates the support dir 0700 and refuses to use it if another user owns it. */
export function ensureAppSupport(dir = appSupport): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = statSync(dir);
  if (st.uid !== process.getuid!()) throw new Error(`${dir} is not owned by the current user`);
  if ((st.mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
  return dir;
}

/** Helper binary inside the app bundle, or the dev build. */
export function helperBinary(): string {
  const bundled = join(import.meta.dir, "..", "helper", "quietlink-helper");
  if (existsSync(bundled)) return bundled;
  return join(import.meta.dir, "../../build/helper/quietlink-helper");
}

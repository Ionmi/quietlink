import type { Controller } from "../app/controller";
import type { Settings } from "../adapters/settings-store";

/** Only these methods are reachable from the views. */
export type Api = {
  view(): unknown;
  manual(on: boolean, durationMs?: number): void;
  emergency(): void;
  reenable(): void;
  airdropBreak(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  startQuietTest(): void;
  cancelQuietTest(): void;
  reconnectWifi(): Promise<{ ok: boolean; error?: string }>;
  getSettings(): Settings;
  updateSettings(p: Partial<Settings>): Promise<Settings>;
  installPrivilege(): Promise<{ ok: boolean; error?: string }>;
  uninstallPrivilege(): Promise<{ ok: boolean; error?: string }>;
  privilegeStatus(): Promise<{ installed: boolean; wardenRunning: boolean }>;
  listRunningApps(): Promise<{ name: string; path: string; bundle: string }[]>;
  exportDiagnostics(includeIdentifiers: boolean): Promise<string>;
  clearData(): void;
  installCli(): Promise<{ ok: boolean; path?: string; error?: string }>;
  openSettings(): void;
  closePopover(): void;
  quit(): void;
};

export function dispatch(api: Api, method: string, args: unknown[]) {
  if (!Object.hasOwn(api, method)) throw new Error(`unknown method ${method}`);
  return (api as any)[method](...args);
}

export type { Controller };

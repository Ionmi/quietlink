// Wire protocol between the app, the sensor helper and the warden. Field names
// are mirrored verbatim in helper/*.swift; change both sides together.
export const PROTOCOL_VERSION = 1;

export type Band = "2.4" | "5" | "6";

export type ProcInfo = { pid: number; start: number; path: string; bundleId: string | null };

export type WifiEvent = {
  v: 1; type: "wifi"; ts: number;
  iface: string | null; band: Band | null; channel: number | null; widthMHz: number | null;
  rssi: number | null; noise: number | null; phyRateMbps: number | null; powerOn: boolean | null;
};

export type ScreenFrame = { x: number; y: number; width: number; height: number };

export type HelperEvent =
  | { v: 1; type: "heartbeat"; ts: number }
  | WifiEvent
  | { v: 1; type: "router"; ts: number; iface: string | null; ipv4: string | null; mac: string | null }
  | { v: 1; type: "power"; ts: number; state: "will-sleep" | "did-wake" }
  | { v: 1; type: "net-change"; ts: number }
  | { v: 1; type: "traffic"; ts: number; iface: string; rxBytes: number; txBytes: number }
  | { v: 1; type: "tray-image"; ts: number; path: string; width: number; height: number }
  | { v: 1; type: "tray-clicked"; ts: number; x: number; y: number; width: number; height: number; screens: ScreenFrame[] }
  | { v: 1; type: "mouse-down"; ts: number; x: number; y: number }
  | { v: 1; type: "procs"; ts: number; procs: ProcInfo[] }
  | ({ v: 1; type: "proc-launch" | "proc-exit"; ts: number } & ProcInfo)
  | { v: 1; type: "input-active"; ts: number; active: boolean | null }
  | { v: 1; type: "probe-sent"; ts: number; target: string; id: number; seq: number }
  | { v: 1; type: "probe-result"; ts: number; target: string; id: number; seq: number; outcome: "reply" | "lost" | "error"; rttMs?: number; error?: string }
  | { v: 1; type: "probe-late"; ts: number; target: string; id: number; seq: number; rttMs: number }
  | { v: 1; type: "probe-send-failed"; ts: number; target: string; error: string };

export type HelperCommand =
  | { v: 1; cmd: "probe-start"; target: string; iface: string; intervalMs: number }
  | { v: 1; cmd: "probe-stop"; target: string }
  | { v: 1; cmd: "snapshot" }
  | { v: 1; cmd: "watch-clicks"; on: boolean }
  | { v: 1; cmd: "render-tray"; path?: string; state: "idle" | "quiet" | "warn"; ping?: string; up?: string; down?: string };

export type WardenStatus = {
  awdlUp: boolean | null; holding: boolean; tookDown: boolean; recovering: boolean;
  privilege: boolean; lastError: string | null; wifiPending: boolean; restoredByWarden: number;
};

export type WardenRequest =
  | { v: 1; id: number; op: "ping" }
  | { v: 1; id: number; op: "hold"; ttlMs: number }
  | { v: 1; id: number; op: "renew"; token: number }
  | { v: 1; id: number; op: "release"; token: number }
  | { v: 1; id: number; op: "restore-now" }
  | { v: 1; id: number; op: "reconnect-wifi"; iface: string }
  | { v: 1; id: number; op: "status" };

export type WardenError = "lease-expired" | "recovering" | "no-privilege" | "busy" | "bad-request" | "command-failed";

export type WardenResponse =
  | { v: 1; id: number; ok: true; token?: number; status?: WardenStatus }
  | { v: 1; id: number; ok: false; error: WardenError; detail?: string };

import type { AppView } from "../app/controller";

export type TrayState = "idle" | "quiet" | "warn";

export function trayState(v: Pick<AppView, "phase" | "privilege" | "wardenHealthy" | "suppressed">, wantsQuiet: boolean): TrayState {
  if (v.phase === "fault" || v.suppressed || (wantsQuiet && (!v.privilege || !v.wardenHealthy))) return "warn";
  if (v.phase === "activating" || v.phase === "active" || v.phase === "grace") return "quiet";
  return "idle";
}


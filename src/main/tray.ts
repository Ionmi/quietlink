import { Tray } from "electrobun/main";
import type { AppView } from "../app/controller";

export type TrayState = "idle" | "quiet" | "warn";

export function trayState(v: Pick<AppView, "phase" | "privilege" | "wardenHealthy" | "suppressed">, wantsQuiet: boolean): TrayState {
  if (v.phase === "fault" || v.suppressed || (wantsQuiet && (!v.privilege || !v.wardenHealthy))) return "warn";
  if (v.phase === "activating" || v.phase === "active" || v.phase === "grace") return "quiet";
  return "idle";
}

export class TrayController {
  private tray: Tray;
  private state: TrayState = "idle";
  private title = "";

  constructor(onClick: (bounds: { x: number; y: number; width: number; height: number }) => void) {
    this.tray = new Tray({ image: "views://tray/tray-idle.png", template: true, width: 18, height: 18 });
    this.tray.on("tray-clicked", () => onClick(this.tray.getBounds()));
  }

  update(state: TrayState, title: string) {
    if (state !== this.state) {
      this.state = state;
      this.tray.setImage(`views://tray/tray-${state}.png`);
    }
    if (title !== this.title) {
      this.title = title;
      this.tray.setTitle(title);
    }
  }

  remove() {
    this.tray.remove();
  }
}

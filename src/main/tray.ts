import { Tray } from "electrobun/main";
import type { TrayState } from "./tray-state";
export { trayState, type TrayState } from "./tray-state";

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

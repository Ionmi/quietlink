import { Tray } from "electrobun/main";
export { trayState, type TrayState } from "./tray-state";

type Bounds = { x: number; y: number; width: number; height: number };

/**
 * The menu-bar item is a single rendered template image (crescent, ping, stacked
 * rates). Its width only changes when the displayed fields change in Settings.
 */
export class TrayController {
  private tray: Tray;
  private width = 18;

  constructor(private onClick: (bounds: Bounds) => void) {
    this.tray = this.create("views://tray/tray-idle.png", 18);
  }

  private create(image: string, width: number) {
    const tray = new Tray({ image, template: true, width, height: 22 });
    tray.on("tray-clicked", () => this.onClick(tray.getBounds()));
    return tray;
  }

  showImage(path: string, width: number) {
    const w = Math.round(width);
    if (w !== this.width) {
      this.tray.remove();
      this.tray = this.create(path, w);
      this.width = w;
    } else {
      this.tray.setImage(path);
    }
  }

  remove() {
    this.tray.remove();
  }
}

import { BrowserWindow } from "electrobun/main";
import { popoverFrame, type Rect, type Screen } from "./geometry";
const POPOVER = { width: 340, height: 460 };

let popover: BrowserWindow<any> | null = null;
let settings: BrowserWindow<any> | null = null;
let rpc: any;
let quitting = false;
let shownAt = 0;

export function configureWindows(bridge: any) {
  rpc = bridge;
}

export function setQuitting() {
  quitting = true;
}

function createPopover() {
  if (popover) return popover;
  const win = new BrowserWindow({
    title: "Quietlink",
    url: "views://popover/index.html",
    preload: "views://popover/index.js",
    renderer: "native",
    titleBarStyle: "hidden",
    frame: { width: POPOVER.width, height: POPOVER.height },
    hidden: true,
    rpc,
  });
  // The status-item click can steal focus back right after show(); ignore blurs
  // in that short window so the popover doesn't close itself on open.
  win.on("blur", () => {
    if (Date.now() - shownAt > 400) win.hide();
  });
  win.on("will-close", (event: any) => {
    if (!quitting) {
      event.response = { allow: false };
      win.hide();
    }
  });
  win.on("close", () => {
    popover = null;
  });
  popover = win;
  return win;
}

export function togglePopover(tray: Rect, screens: Screen[]) {
  const win = createPopover();
  const f = popoverFrame(tray, screens, POPOVER);
  win.setFrame(f.x, f.y, f.width, f.height);
  win.setAlwaysOnTop(true);
  win.setVisibleOnAllWorkspaces(true);
  shownAt = Date.now();
  win.show();
  win.activate();
}

export function hidePopover() {
  popover?.hide();
}

export function showSettings() {
  if (!settings) {
    settings = new BrowserWindow({
      title: "Quietlink Settings",
      url: "views://settings/index.html",
      preload: "views://settings/index.js",
      renderer: "native",
      titleBarStyle: "hiddenInset",
      frame: { width: 760, height: 620 },
      rpc,
    });
    settings.on("will-close", (event: any) => {
      if (!quitting) {
        event.response = { allow: false };
        settings?.hide();
      }
    });
    settings.on("close", () => {
      settings = null;
    });
  }
  settings.show();
  settings.activate();
}

import { BrowserView, BrowserWindow, Utils } from "electrobun/main";
import { popoverFrame, type Rect, type Screen } from "./geometry";

const POPOVER = { width: 368, height: 460 };
let popoverHeight = POPOVER.height;
let lastFrame: { x: number; y: number } | null = null;

type Invoke = (method: string, args: unknown[]) => unknown;

let popover: BrowserWindow<any> | null = null;
let settings: BrowserWindow<any> | null = null;
const rpcs = new Set<any>();
let invoke: Invoke = () => { throw new Error("not configured"); };
let quitting = false;
let shownAt = 0;
let hiddenAt = 0;

export function configureWindows(fn: Invoke) {
  invoke = fn;
}

export function setQuitting() {
  quitting = true;
}

/** One RPC per window: an RPC object has a single transport. */
function makeRpc() {
  const rpc = BrowserView.defineRPC<any>({
    maxRequestTime: 120_000,
    handlers: {
      requests: { invoke: ({ method, args }: { method: string; args: unknown[] }) => invoke(method, args ?? []) },
      messages: {},
    },
  });
  rpcs.add(rpc);
  return rpc;
}

/** Pushes the latest app view to every open window. */
export function broadcast(view: unknown) {
  for (const rpc of rpcs) {
    try {
      rpc.send?.["view-changed"]?.(view);
    } catch {
      /* window closing */
    }
  }
}

function createPopover() {
  if (popover) return popover;
  const rpc = makeRpc();
  const win = new BrowserWindow({
    title: "Quietlink",
    url: "views://popover/index.html",
    preload: "views://popover/index.js",
    renderer: "native",
    titleBarStyle: "hidden",
    transparent: true,
    frame: { width: POPOVER.width, height: POPOVER.height },
    hidden: true,
    rpc,
  });
  // The status-item click can steal focus back right after show(); ignore blurs
  // in that short window so the popover doesn't close itself on open.
  win.on("blur", () => {
    if (Date.now() - shownAt > 400) {
      win.hide();
      hiddenAt = Date.now();
    }
  });
  win.on("will-close", (event: any) => {
    if (!quitting) {
      event.response = { allow: false };
      win.hide();
    }
  });
  win.on("close", () => {
    rpcs.delete(rpc);
    popover = null;
  });
  popover = win;
  return win;
}

export function togglePopover(tray: Rect, screens: Screen[]) {
  // Clicking the item while the popover is open first blurs (hides) it; don't reopen.
  if (Date.now() - hiddenAt < 300) return;
  const win = createPopover();
  const f = popoverFrame(tray, screens, { width: POPOVER.width, height: popoverHeight });
  lastFrame = { x: f.x, y: f.y };
  win.setFrame(f.x, f.y, f.width, f.height);
  win.setAlwaysOnTop(true);
  win.setVisibleOnAllWorkspaces(true);
  shownAt = Date.now();
  win.show();
  win.activate();
}

/** The view reports its content height; the window follows (top edge fixed). */
export function setPopoverHeight(px: number) {
  const h = Math.round(Math.min(Math.max(px, 200), 900));
  if (h === popoverHeight) return;
  popoverHeight = h;
  if (popover && lastFrame) popover.setFrame(lastFrame.x, lastFrame.y, POPOVER.width, h);
}

export function hidePopover() {
  popover?.hide();
}

export function showSettings() {
  hidePopover();
  if (!settings) {
    const rpc = makeRpc();
    settings = new BrowserWindow({
      title: "Quietlink Settings",
      url: "views://settings/index.html",
      preload: "views://settings/index.js",
      renderer: "native",
      titleBarStyle: "hiddenInset",
      frame: { width: 780, height: 640 },
      rpc,
    });
    settings.on("will-close", (event: any) => {
      if (!quitting) {
        event.response = { allow: false };
        settings?.hide();
        Utils.setDockIconVisible(false); // back to a menu-bar-only app
      }
    });
    settings.on("close", () => {
      rpcs.delete(rpc);
      settings = null;
    });
  }
  Utils.setDockIconVisible(true); // visible only while Settings is open
  settings.show();
  settings.activate();
}

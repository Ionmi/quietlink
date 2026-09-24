import type { AppView } from "../../app/controller";
import { t as translate, type Key } from "../../shared/strings";

export const app = $state<{ view: AppView | null }>({ view: null });

export const call = <T = unknown>(method: string, ...args: unknown[]) => window.quietlink.call<T>(method, ...args);

export function tr(key: Key, vars?: Record<string, string | number>) {
  return translate(app.view?.settings.lang ?? "en", key, vars);
}

/** Pushed updates plus a slow poll as a fallback if a push is missed. */
export function connect() {
  const refresh = () => call<AppView>("view").then((v) => (app.view = v)).catch(() => {});
  window.addEventListener("quietlink:view", (e) => (app.view = (e as CustomEvent<AppView>).detail));
  void refresh();
  const timer = setInterval(refresh, 2000);
  return () => clearInterval(timer);
}

export const fmt = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "—" : v.toFixed(digits));

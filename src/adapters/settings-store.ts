import { readFileSync, renameSync, writeFileSync } from "node:fs";
import presets from "../shared/presets.json";
import { loadPresets, type TriggerRule } from "../domain/triggers";
import type { BandHistory } from "../domain/band";
import type { Lang } from "../shared/strings";

export type Settings = {
  lang: Lang;
  graceMs: number;
  externalTarget: string | null;
  extraTargets: string[];
  showPingInMenuBar: boolean;
  showTrafficInMenuBar: boolean;
  rules: TriggerRule[];
  inputTrigger: boolean;
  explainCuts: boolean;
  launchAtLogin: boolean;
  paused: boolean;
  checkForUpdates: boolean;
  bandHistory: BandHistory;
};

export function defaults(lang: Lang = "en"): Settings {
  return {
    lang, graceMs: 10_000, externalTarget: "1.1.1.1", extraTargets: [], showPingInMenuBar: true, showTrafficInMenuBar: true,
    rules: loadPresets(presets), inputTrigger: false, explainCuts: false, launchAtLogin: false,
    paused: false, checkForUpdates: true, bandHistory: {},
  };
}

/** Shipped presets win on everything except the user's enabled toggle; custom rules are kept. */
function mergeRules(stored: TriggerRule[] | undefined): TriggerRule[] {
  const shipped = loadPresets(presets);
  const byId = new Map((stored ?? []).map((r) => [r.id, r]));
  // A stored "disabled" only counts as the user's choice if the preset was already verified then.
  const merged = shipped.map((p) => {
    const st = byId.get(p.id);
    if (!st || (p.verified && st.verified === false)) return p;
    return { ...p, enabled: !!st.enabled };
  });
  const custom = (stored ?? []).filter((r) => r.id.startsWith("custom:") && r.match && typeof r.label === "string");
  return [...merged, ...custom];
}

export class SettingsStore {
  private value: Settings;

  constructor(private path: string, defaultLang: Lang = "en") {
    const base = defaults(defaultLang);
    let stored: Partial<Settings> = {};
    try { stored = JSON.parse(readFileSync(path, "utf8")); } catch { /* first run or corrupt */ }
    const picked = Object.fromEntries(Object.keys(base).filter((k) => k in stored).map((k) => [k, (stored as any)[k]]));
    this.value = { ...base, ...picked, rules: mergeRules(stored.rules) } as Settings;
  }

  get(): Settings {
    return this.value;
  }

  update(p: Partial<Settings>): Settings {
    this.value = { ...this.value, ...p, rules: p.rules ? mergeRules(p.rules) : this.value.rules };
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.value, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
    return this.value;
  }
}

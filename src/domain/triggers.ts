import type { ProcInfo } from "../shared/protocol";

export type TriggerRule = {
  id: string;
  label: string;
  kind: "game" | "call";
  /** executable: path suffix at a "/" boundary; bundlePrefix: any process inside that .app; bundleId: exact. */
  match: { executable?: string; bundlePrefix?: string; bundleId?: string };
  /** Path substrings never matched (e.g. launchers and clients). */
  exclude?: string[];
  /** Only while an input device is active (heuristic for call apps). */
  requireInput?: boolean;
  enabled: boolean;
  verified: boolean;
};

export type TriggerMatch = { ruleId: string; label: string; kind: "game" | "call"; key: string };

const endsAtBoundary = (path: string, suffix: string) => path === suffix || path.endsWith("/" + suffix);

function matches(rule: TriggerRule, p: ProcInfo): boolean {
  if (rule.exclude?.some((x) => p.path.includes(x))) return false;
  const m = rule.match;
  if (m.executable && endsAtBoundary(p.path, m.executable)) return true;
  if (m.bundlePrefix && p.path.startsWith(m.bundlePrefix.replace(/\/$/, "") + "/")) return true;
  if (m.bundleId && p.bundleId === m.bundleId) return true;
  return false;
}

export function matchRules(rules: TriggerRule[], procs: ProcInfo[], inputActive: boolean | null): TriggerMatch[] {
  const out: TriggerMatch[] = [];
  for (const p of procs) {
    const rule = rules.find((r) => r.enabled && (!r.requireInput || inputActive === true) && matches(r, p));
    if (rule) out.push({ ruleId: rule.id, label: rule.label, kind: rule.kind, key: `${rule.id}:${p.pid}:${p.start}` });
  }
  return out;
}

export function loadPresets(json: unknown): TriggerRule[] {
  const j = json as { version?: number; rules?: TriggerRule[] };
  if (j?.version !== 1 || !Array.isArray(j.rules)) throw new Error(`unsupported presets version ${j?.version}`);
  // Unverified presets ship disabled until checked against the real app.
  return j.rules.map((r) => ({ ...r, match: { ...r.match }, enabled: r.enabled && r.verified }));
}

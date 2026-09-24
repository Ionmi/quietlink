// Pure quiet-mode state machine. It only decides; the warden executes.
export type Phase = "inactive" | "activating" | "active" | "airdrop-break" | "grace" | "restoring" | "fault" | "suppressed";

export type ModeState = {
  phase: Phase;
  generation: number;
  token: number | null;
  leases: number;
  graceUntil: number | null;
  breakUntil: number | null;
  faultRetryAt: number | null;
  faultCount: number;
  lastError: string | null;
};

export type ModeInput =
  | { kind: "leases-changed"; activeCount: number; now: number }
  | { kind: "tick"; now: number }
  | { kind: "hold-ok"; generation: number; token: number }
  | { kind: "hold-failed"; generation: number; error: string; now: number }
  | { kind: "lease-expired"; generation: number }
  | { kind: "released"; generation: number }
  | { kind: "emergency" }
  | { kind: "reenable" }
  | { kind: "airdrop-break"; now: number; ms: number }
  | { kind: "sleep" }
  | { kind: "wake"; now: number };

export type Effect =
  | { kind: "hold"; generation: number }
  | { kind: "renew"; token: number }
  | { kind: "release"; token: number | null; generation: number }
  | { kind: "restore-now" }
  | { kind: "rebuild-leases" };

export const initialMode: ModeState = {
  phase: "inactive", generation: 0, token: null, leases: 0,
  graceUntil: null, breakUntil: null, faultRetryAt: null, faultCount: 0, lastError: null,
};

const BACKOFF = [1000, 2000, 5000, 10_000];

type Out = { state: ModeState; effects: Effect[] };

function activate(s: ModeState): Out {
  const generation = s.generation + 1;
  return { state: { ...s, phase: "activating", generation, token: null, graceUntil: null, breakUntil: null }, effects: [{ kind: "hold", generation }] };
}

function release(s: ModeState, phase: Phase = "restoring"): Out {
  return {
    state: { ...s, phase, graceUntil: null },
    effects: [{ kind: "release", token: s.token, generation: s.generation }],
  };
}

const idle = (s: ModeState): ModeState => ({ ...s, phase: "inactive", token: null, graceUntil: null, breakUntil: null, faultRetryAt: null });

export function reduce(s: ModeState, i: ModeInput, cfg: { graceMs: number }): Out {
  const none: Out = { state: s, effects: [] };

  if (s.phase === "suppressed") {
    if (i.kind === "reenable") return { state: { ...idle(s), faultCount: 0 }, effects: [{ kind: "rebuild-leases" }] };
    if (i.kind === "leases-changed") return { state: { ...s, leases: i.activeCount }, effects: [] };
    return none;
  }

  switch (i.kind) {
    case "leases-changed": {
      const st = { ...s, leases: i.activeCount };
      if (i.activeCount > 0) {
        if (s.phase === "inactive") return activate(st);
        if (s.phase === "grace") return { state: { ...st, phase: "active", graceUntil: null }, effects: [] };
        return { state: st, effects: [] };
      }
      if (s.phase === "active") return { state: { ...st, phase: "grace", graceUntil: i.now + cfg.graceMs }, effects: [] };
      if (s.phase === "activating") return release(st);
      if (s.phase === "fault") return { state: { ...idle(st), faultCount: 0 }, effects: [] };
      return { state: st, effects: [] };
    }

    case "tick": {
      if (s.phase === "active") return s.token === null ? none : { state: s, effects: [{ kind: "renew", token: s.token }] };
      if (s.phase === "grace") {
        if (s.graceUntil !== null && i.now >= s.graceUntil) return release(s);
        return s.token === null ? none : { state: s, effects: [{ kind: "renew", token: s.token }] };
      }
      if (s.phase === "fault" && s.faultRetryAt !== null && i.now >= s.faultRetryAt) {
        return s.leases > 0 ? activate(s) : { state: idle(s), effects: [] };
      }
      if (s.phase === "airdrop-break" && s.breakUntil !== null && i.now >= s.breakUntil) {
        return s.leases > 0 ? activate(s) : { state: idle(s), effects: [] };
      }
      return none;
    }

    case "hold-ok":
      if (s.phase !== "activating" || i.generation !== s.generation) return none;
      return { state: { ...s, phase: "active", token: i.token, faultCount: 0, faultRetryAt: null, lastError: null }, effects: [] };

    case "hold-failed": {
      if (s.phase !== "activating" || i.generation !== s.generation) return none;
      const delay = BACKOFF[Math.min(s.faultCount, BACKOFF.length - 1)];
      return { state: { ...s, phase: "fault", token: null, faultCount: s.faultCount + 1, faultRetryAt: i.now + delay, lastError: i.error }, effects: [] };
    }

    case "lease-expired":
      if (i.generation !== s.generation) return none;
      return { state: idle(s), effects: [{ kind: "rebuild-leases" }] };

    case "released":
      if (i.generation !== s.generation) return none;
      if (s.phase === "airdrop-break") return { state: { ...s, token: null }, effects: [] };
      if (s.phase === "restoring") return { state: idle(s), effects: [] };
      return none;

    case "emergency":
      return { state: { ...s, phase: "suppressed", token: null, graceUntil: null, breakUntil: null, faultRetryAt: null }, effects: [{ kind: "restore-now" }] };

    case "reenable":
      return none;

    case "airdrop-break":
      if (s.phase !== "active" && s.phase !== "grace") return none;
      return { state: { ...s, phase: "airdrop-break", graceUntil: null, breakUntil: i.now + i.ms }, effects: [{ kind: "release", token: s.token, generation: s.generation }] };

    case "sleep":
      if (s.phase === "inactive") return none;
      return { state: idle(s), effects: [{ kind: "release", token: s.token, generation: s.generation }] };

    case "wake":
      return { state: idle(s), effects: [{ kind: "rebuild-leases" }] };
  }
}

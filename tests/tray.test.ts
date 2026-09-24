import { expect, test } from "bun:test";
import { trayState } from "../src/main/tray";

const base = { phase: "inactive" as const, privilege: true, wardenHealthy: true, suppressed: false };
test("tray state by phase and health", () => {
  expect(trayState(base, false)).toBe("idle");
  expect(trayState({ ...base, phase: "active" }, true)).toBe("quiet");
  expect(trayState({ ...base, phase: "grace" }, true)).toBe("quiet");
  expect(trayState({ ...base, phase: "fault" }, true)).toBe("warn");
  expect(trayState({ ...base, suppressed: true, phase: "suppressed" }, false)).toBe("warn");
  expect(trayState({ ...base, privilege: false }, true)).toBe("warn");
  expect(trayState({ ...base, privilege: false }, false)).toBe("idle");
});

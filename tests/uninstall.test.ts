import { expect, test } from "bun:test";
import { safeUninstall } from "../src/app/uninstall";

const deps = (statuses: any[], calls: string[]) => ({
  suppress: () => calls.push("suppress"),
  reenable: () => calls.push("reenable"),
  restoreNow: async () => { calls.push("restore-now"); },
  status: async () => statuses.length > 1 ? statuses.shift() : statuses[0],
  removeAgent: async () => { calls.push("remove-agent"); },
  uninstallRule: async () => { calls.push("uninstall-rule"); return { ok: true }; },
  pollMs: 1, timeoutMs: 50,
});

test("[final] uninstall waits for confirmed restore before removing warden and rule", async () => {
  const calls: string[] = [];
  const r = await safeUninstall(deps([{ awdlUp: false, tookDown: true, wifiPending: false }, { awdlUp: true, tookDown: false, wifiPending: false }], calls));
  expect(r).toEqual({ ok: true });
  expect(calls).toEqual(["suppress", "restore-now", "remove-agent", "uninstall-rule", "reenable"]);
});

test("[final] uninstall aborts and keeps privileges when restore is not confirmed", async () => {
  const calls: string[] = [];
  const r = await safeUninstall(deps([{ awdlUp: false, tookDown: true, wifiPending: false }], calls));
  expect(r.ok).toBe(false);
  expect(calls).not.toContain("remove-agent");
  expect(calls).not.toContain("uninstall-rule");
  expect(calls.at(-1)).toBe("reenable");
});

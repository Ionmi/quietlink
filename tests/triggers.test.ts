import { expect, test } from "bun:test";
import { matchRules, loadPresets, type TriggerRule } from "../src/domain/triggers";
import presets from "../src/shared/presets.json";

const rules = loadPresets(presets).map((r) => ({ ...r, enabled: true }));
const P = (pid: number, path: string, bundleId: string | null = null) => ({ pid, start: 100, path, bundleId });
const game = "/Applications/League of Legends.app/Contents/LoL/Game/League of Legends.app/Contents/MacOS/League of Legends";

test("league match triggers", () => {
  expect(matchRules(rules, [P(1, game)], null).map((m) => m.ruleId)).toEqual(["lol"]);
});

test("league client alone does not trigger", () => {
  expect(
    matchRules(rules, [
      P(2, "/Applications/League of Legends.app/Contents/LoL/LeagueClient.app/Contents/MacOS/LeagueClient"),
      P(3, "/Applications/League of Legends.app/Contents/LoL/LeagueClient.app/Contents/Frameworks/LeagueClientUx.app/Contents/MacOS/LeagueClientUx"),
      P(4, "/Users/x/Applications/Riot Client.app/Contents/MacOS/Riot Client"),
    ], null),
  ).toEqual([]);
});

test("call app needs active input", () => {
  const d = P(4, "/Applications/Discord.app/Contents/MacOS/Discord", "com.hnc.Discord");
  expect(matchRules(rules, [d], false)).toEqual([]);
  expect(matchRules(rules, [d], null)).toEqual([]);
  expect(matchRules(rules, [d], true).map((m) => m.ruleId)).toEqual(["discord"]);
});

test("disabled rules never match", () => {
  expect(matchRules(loadPresets(presets), [P(4, "/Applications/Discord.app/Contents/MacOS/Discord", "com.hnc.Discord")], true)).toEqual([]);
});

test("key uses pid and start time", () => {
  expect(matchRules(rules, [P(1, game)], null)[0].key).toBe("lol:1:100");
});

test("one match per process even if several rules match", () => {
  const dup: TriggerRule[] = [...rules, { id: "lol2", label: "dup", kind: "game", match: { executable: "MacOS/League of Legends" }, enabled: true, verified: true }];
  expect(matchRules(dup, [P(1, game)], null)).toHaveLength(1);
});

test("bad preset version throws", () => {
  expect(() => loadPresets({ version: 2, rules: [] })).toThrow();
});

test("whole-application rule matches helper processes inside bundle", () => {
  const r: TriggerRule[] = [{ id: "x", label: "X", kind: "game", match: { bundlePrefix: "/Applications/Foo.app" }, enabled: true, verified: true }];
  expect(matchRules(r, [P(9, "/Applications/Foo.app/Contents/Helpers/Foo Helper.app/Contents/MacOS/Foo Helper")], null)).toHaveLength(1);
  expect(matchRules(r, [P(9, "/Applications/Foo.appendix/x")], null)).toHaveLength(0);
});

test("executable match requires a path boundary", () => {
  const r: TriggerRule[] = [{ id: "x", label: "X", kind: "game", match: { executable: "MacOS/Game" }, enabled: true, verified: true }];
  expect(matchRules(r, [P(1, "/A.app/Contents/MacOS/Game")], null)).toHaveLength(1);
  expect(matchRules(r, [P(1, "/A.app/Contents/NotMacOS/Game")], null)).toHaveLength(0);
});

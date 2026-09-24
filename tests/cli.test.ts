import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCliServer } from "../src/app/cli-server";

async function ask(path: string, cmd: object) {
  let buf = "";
  let resolve!: (v: any) => void;
  const done = new Promise((r) => (resolve = r));
  const s = await Bun.connect({ unix: path, socket: { data(_s, d) { buf += d.toString(); if (buf.includes("\n")) resolve(JSON.parse(buf)); } } });
  s.write(JSON.stringify(cmd) + "\n");
  const r = await done;
  s.end();
  return r;
}

test("cli server answers status and forwards commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-"));
  chmodSync(dir, 0o700);
  const calls: string[] = [];
  const srv = startCliServer(join(dir, "cli.sock"), {
    status: () => ({ phase: "inactive", because: [] }),
    on: (min?: number) => calls.push(`on:${min ?? ""}`), off: () => calls.push("off"),
    pause: () => calls.push("pause"), resume: () => calls.push("resume"), test: () => calls.push("test"),
  });
  expect(statSync(join(dir, "cli.sock")).mode & 0o777).toBe(0o600);
  expect(await ask(join(dir, "cli.sock"), { cmd: "status" })).toMatchObject({ ok: true, status: { phase: "inactive" } });
  expect(await ask(join(dir, "cli.sock"), { cmd: "on", minutes: 30 })).toMatchObject({ ok: true });
  expect(await ask(join(dir, "cli.sock"), { cmd: "rm -rf" })).toMatchObject({ ok: false, error: "unknown command" });
  expect(calls).toEqual(["on:30"]);
  srv.stop();
});

test("cli server refuses a directory with wrong mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-"));
  chmodSync(dir, 0o755);
  expect(() => startCliServer(join(dir, "cli.sock"), {} as any)).toThrow("0700");
});

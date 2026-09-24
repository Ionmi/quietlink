// Dry-run integration check for the warden (no sudo): protocol, expiry restore,
// crash recovery, SIGTERM restore, hang watchdog. Run: bun tests/integration/warden-dryrun.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "qlw-"));
const bin = join(import.meta.dir, "../../build/helper/quietlink-helper");
const env = { ...process.env, QUIETLINK_DRY_RUN: "1", QUIETLINK_SUPPORT_DIR: dir };
let log = "";
let failed = false;
const check = (ok: boolean, name: string) => { console.log(`${ok ? "ok" : "FAIL"} ${name}`); if (!ok) failed = true; };

function start() {
  const p = Bun.spawn([bin, "--warden"], { env, stderr: "pipe", stdout: "ignore" });
  (async () => { for await (const c of p.stderr) log += new TextDecoder().decode(c); })();
  return p;
}
async function until(cond: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await Bun.sleep(100); }
  return false;
}
async function request(o: object): Promise<any> {
  let buf = "";
  let resolve!: (v: any) => void;
  const done = new Promise((r) => (resolve = r));
  const s = await Bun.connect({ unix: join(dir, "warden.sock"), socket: { data(_s, d) { buf += d.toString(); if (buf.includes("\n")) resolve(JSON.parse(buf)); } } });
  s.write(JSON.stringify({ v: 1, id: 1, ...o }) + "\n");
  const r = await done;
  s.end();
  return r;
}
const state = () => JSON.parse(readFileSync(join(dir, "warden-state.json"), "utf8"));

let w = start();
check(await until(() => log.includes("warden ready"), 15_000), "recovers and becomes ready");
let r = await request({ op: "hold", ttlMs: 2000 });
check(r.ok && r.token === 1 && state().tookDown === true, "hold persists tookDown before down");
check(await until(() => state().tookDown === false, 5000), "lease expiry restores AWDL");
check((await request({ op: "renew", token: 1 })).error === "lease-expired", "stale token rejected");
r = await request({ op: "hold", ttlMs: 4000 });
w.kill(9);
await w.exited;
log = "";
w = start();
check(await until(() => /awdl0 up/.test(log), 12_000), "restart after SIGKILL restores AWDL");
check(await until(() => log.includes("warden ready"), 15_000), "ready again after recovery");
r = await request({ op: "hold", ttlMs: 4000 });
w.kill("SIGTERM");
check((await w.exited) === 0 && state().tookDown === false, "SIGTERM restores and exits 0");
log = "";
w = start();
await until(() => log.includes("warden ready"), 15_000);
void request({ op: "test-stall" }).catch(() => {});
const code = await Promise.race([w.exited, Bun.sleep(15_000).then(() => "timeout")]);
check(code === 2, `hang watchdog exits with code 2 (got ${code})`);
if (code === "timeout") w.kill(9);
process.exit(failed ? 1 : 0);

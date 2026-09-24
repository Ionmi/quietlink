import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WardenClient } from "../src/adapters/warden-client";

async function server(handler: (req: any) => object | null) {
  const path = join(mkdtempSync(join(tmpdir(), "wc-")), "w.sock");
  const srv = Bun.listen({
    unix: path,
    socket: {
      data(s, d) {
        for (const line of d.toString().trim().split("\n")) {
          const req = JSON.parse(line);
          const r = handler(req);
          if (r) s.write(JSON.stringify({ v: 1, id: req.id, ...r }) + "\n");
        }
      },
    },
  });
  return { path, stop: () => srv.stop(true) };
}

test("request/response correlation by id", async () => {
  const s = await server((r) => (r.op === "hold" ? { ok: true, token: 5 } : { ok: true }));
  const c = new WardenClient({ path: s.path });
  const [a, b] = await Promise.all([c.request({ op: "ping" }), c.request({ op: "hold", ttlMs: 4000 })]);
  expect(a.ok).toBe(true);
  expect(b).toMatchObject({ ok: true, token: 5 });
  c.close();
  s.stop();
});

test("timeout rejects", async () => {
  const s = await server(() => null);
  const c = new WardenClient({ path: s.path });
  await expect(c.request({ op: "ping" }, 100)).rejects.toThrow("timeout");
  c.close();
  s.stop();
});

test("unreachable socket rejects", async () => {
  const c = new WardenClient({ path: "/tmp/does-not-exist.sock" });
  await expect(c.request({ op: "ping" }, 200)).rejects.toThrow();
});

test("supervision kills an unresponsive warden after 3 s", async () => {
  const s = await server(() => null);
  let now = 0;
  const killed: [number, number][] = [];
  const c = new WardenClient({ path: s.path, now: () => now, kill: (pid, sig) => killed.push([pid, sig]) });
  expect(await c.superviseTick(async () => 77, 50)).toBe("unreachable");
  now = 3100;
  expect(await c.superviseTick(async () => 77, 50)).toBe("killed");
  expect(killed).toEqual([[77, 9]]);
  c.close();
  s.stop();
});

test("healthy ping resets supervision", async () => {
  const s = await server(() => ({ ok: true, status: { recovering: true } }));
  let now = 0;
  const c = new WardenClient({ path: s.path, now: () => now, kill: () => { throw new Error("must not kill"); } });
  now = 10_000;
  expect(await c.superviseTick(async () => 77)).toBe("ok");
  expect(c.lastStatus?.recovering).toBe(true);
  c.close();
  s.stop();
});

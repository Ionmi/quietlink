import { expect, test } from "bun:test";
import { HelperClient, type ChildLike } from "../src/adapters/helper-client";

function fakeChild() {
  let push!: (c: Uint8Array | null) => void;
  const chunks: (Uint8Array | null)[] = [];
  let wake: (() => void) | null = null;
  push = (c) => { chunks.push(c); wake?.(); };
  let resolveExit!: (n: number) => void;
  const child: ChildLike & { written: string[]; killed: number[] } = {
    pid: 42,
    written: [],
    killed: [],
    stdin: { write(s: string) { child.written.push(s); } },
    stdout: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (!chunks.length) await new Promise<void>((r) => (wake = r));
          const c = chunks.shift()!;
          if (c === null) return;
          yield c;
        }
      },
    },
    kill(sig?: number) { child.killed.push(sig ?? 15); push(null); resolveExit(0); },
    exited: new Promise<number>((r) => (resolveExit = r)),
  };
  return { child, push: (s: string) => push(new TextEncoder().encode(s)), end: () => { push(null); resolveExit(1); } };
}

test("parses JSON lines split across chunks, ignores malformed and wrong versions", async () => {
  const f = fakeChild();
  const c = new HelperClient({ spawn: () => f.child, now: () => 0 });
  const got: string[] = [];
  c.on((e) => got.push(e.type));
  c.start();
  f.push('{"v":1,"type":"heart');
  f.push('beat","ts":1}\nnot json\n{"v":2,"type":"heartbeat","ts":2}\n{"v":1,"type":"net-change","ts":3}\n');
  await Bun.sleep(10);
  expect(got).toEqual(["heartbeat", "net-change"]);
  c.stop();
});

test("send writes versioned JSON lines", () => {
  const f = fakeChild();
  const c = new HelperClient({ spawn: () => f.child, now: () => 0 });
  c.start();
  c.send({ v: 1, cmd: "snapshot" });
  expect(f.child.written).toEqual(['{"v":1,"cmd":"snapshot"}\n']);
  c.stop();
});

test("hung helper is killed and restarted with backoff; onRestart fires", async () => {
  let now = 0;
  const kids = [fakeChild(), fakeChild()];
  let n = 0;
  const c = new HelperClient({ spawn: () => kids[n++].child, now: () => now, hungMs: 3000, backoffMs: [0] });
  let restarts = 0;
  c.onRestart(() => restarts++);
  c.start();
  now = 3500;
  c.checkHealth();
  expect(kids[0].child.killed).toEqual([9]);
  await Bun.sleep(20);
  expect(n).toBe(2);
  expect(restarts).toBe(1);
  c.stop();
});

test("unexpected exit restarts", async () => {
  const kids = [fakeChild(), fakeChild()];
  let n = 0;
  const c = new HelperClient({ spawn: () => kids[n++].child, now: () => 0, backoffMs: [0] });
  c.start();
  kids[0].end();
  await Bun.sleep(20);
  expect(n).toBe(2);
  c.stop();
});

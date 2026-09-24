import type { HelperCommand, HelperEvent } from "../shared/protocol";
import { PROTOCOL_VERSION } from "../shared/protocol";

export type ChildLike = {
  pid: number;
  stdout: AsyncIterable<Uint8Array>;
  stdin: { write(s: string): void };
  kill(sig?: number): void;
  exited: Promise<number>;
};

type Opts = {
  spawn?: (argv: string[]) => ChildLike;
  argv?: string[];
  now?: () => number;
  hungMs?: number;
  backoffMs?: number[];
};

function bunSpawn(argv: string[]): ChildLike {
  const p = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  return {
    pid: p.pid,
    stdout: p.stdout,
    stdin: { write: (s: string) => { p.stdin.write(s); p.stdin.flush(); } },
    kill: (sig?: number) => p.kill(sig),
    exited: p.exited,
  };
}

// QUIETLINK_TRACE=<file> appends every raw helper line (debugging only).
const trace = process.env.QUIETLINK_TRACE ? Bun.file(process.env.QUIETLINK_TRACE).writer() : null;

/** Supervises the sensor helper: JSON Lines in, commands out, restart on exit or hang. */
export class HelperClient {
  private child: ChildLike | null = null;
  private listeners = new Set<(e: HelperEvent) => void>();
  private restartListeners = new Set<() => void>();
  private stopped = true;
  private attempts = 0;
  private lastAt = 0;
  private started = false;
  private readonly now: () => number;

  constructor(private opts: Opts = {}) {
    this.now = opts.now ?? (() => performance.now());
  }

  on(fn: (e: HelperEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onRestart(fn: () => void) {
    this.restartListeners.add(fn);
    return () => this.restartListeners.delete(fn);
  }

  lastEventAt() {
    return this.lastAt;
  }

  start() {
    this.stopped = false;
    this.spawnChild();
  }

  stop() {
    this.stopped = true;
    this.child?.kill(15);
    this.child = null;
  }

  send(cmd: HelperCommand) {
    this.child?.stdin.write(JSON.stringify(cmd) + "\n");
  }

  /** Called every second by the controller: a helper silent for hungMs is killed. */
  checkHealth() {
    if (this.child && this.now() - this.lastAt > (this.opts.hungMs ?? 3000)) this.child.kill(9);
  }

  private spawnChild() {
    const child = (this.opts.spawn ?? bunSpawn)(this.opts.argv ?? []);
    this.child = child;
    this.lastAt = this.now();
    if (this.started) for (const fn of this.restartListeners) fn();
    this.started = true;
    void this.read(child);
    void child.exited.then(() => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopped) return;
      const backoff = this.opts.backoffMs ?? [500, 1000, 2000, 5000];
      const delay = backoff[Math.min(this.attempts++, backoff.length - 1)];
      setTimeout(() => { if (!this.stopped) this.spawnChild(); }, delay);
    });
  }

  private async read(child: ChildLike) {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of child.stdout) {
      buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        if (trace) trace.write(line + "\n");
        let e: HelperEvent;
        try { e = JSON.parse(line); } catch { continue; }
        if ((e as { v?: number }).v !== PROTOCOL_VERSION) continue;
        this.lastAt = this.now();
        this.attempts = 0;
        for (const fn of this.listeners) fn(e);
      }
    }
  }
}

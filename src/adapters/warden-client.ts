import type { WardenRequest, WardenResponse, WardenStatus } from "../shared/protocol";
import { wardenSock } from "./paths";

type Req = WardenRequest extends infer R ? (R extends { id: number; v: 1 } ? Omit<R, "id" | "v"> : never) : never;

type Opts = { path?: string; now?: () => number; kill?: (pid: number, sig: number) => void };

/** Line-delimited JSON client for the warden socket, plus external supervision. */
export class WardenClient {
  private sock: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private connecting: Promise<void> | null = null;
  private pending = new Map<number, { resolve: (r: WardenResponse) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private buf = "";
  private lastOk: number;
  lastStatus: WardenStatus | null = null;
  private readonly now: () => number;

  constructor(private opts: Opts = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.lastOk = this.now();
  }

  private fail(err: Error) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.sock = null;
    this.buf = "";
  }

  private connect(): Promise<void> {
    if (this.sock) return Promise.resolve();
    this.connecting ??= Bun.connect({
      unix: this.opts.path ?? wardenSock,
      socket: {
        data: (_s, d) => {
          this.buf += d.toString();
          let i: number;
          while ((i = this.buf.indexOf("\n")) >= 0) {
            const line = this.buf.slice(0, i);
            this.buf = this.buf.slice(i + 1);
            let r: WardenResponse;
            try { r = JSON.parse(line); } catch { continue; }
            if ("status" in r && r.status) this.lastStatus = r.status;
            this.pending.get(r.id)?.resolve(r);
            this.pending.delete(r.id);
          }
        },
        close: () => this.fail(new Error("warden connection closed")),
        error: (_s, e) => this.fail(e),
      },
    })
      .then((s) => { this.sock = s; })
      .finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async request(req: Req, timeoutMs = 2000): Promise<WardenResponse> {
    await this.connect();
    const id = this.nextId++;
    return new Promise<WardenResponse>((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("timeout"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(t); resolve(r); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.sock!.write(JSON.stringify({ v: 1, id, ...req }) + "\n");
    });
  }

  /**
   * Pings the warden. A warden that has not answered for 3 s (e.g. suspended)
   * is SIGKILLed so launchd restarts it and its recovery runs.
   */
  async superviseTick(getPid: () => Promise<number | null>, timeoutMs = 1000): Promise<"ok" | "killed" | "unreachable"> {
    try {
      const r = await this.request({ op: "ping" }, timeoutMs);
      if (r.ok) {
        this.lastOk = this.now();
        return "ok";
      }
    } catch {
      /* fall through */
    }
    if (this.now() - this.lastOk < 3000) return "unreachable";
    const pid = await getPid();
    this.lastOk = this.now();
    if (pid === null) return "unreachable";
    (this.opts.kill ?? ((p, s) => process.kill(p, s)))(pid, 9);
    this.fail(new Error("warden killed"));
    return "killed";
  }

  close() {
    this.sock?.end();
    this.sock = null;
  }
}

/** PID of the warden from launchd, or null when not loaded. */
export async function wardenPid(label = "dev.quietlink.warden"): Promise<number | null> {
  const p = Bun.spawn(["/bin/launchctl", "print", `gui/${process.getuid!()}/${label}`], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  const m = /\bpid = (\d+)/.exec(out);
  return m ? Number(m[1]) : null;
}

import { chmodSync, existsSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export type CliHandlers = {
  status(): unknown;
  on(minutes?: number): void;
  off(): void;
  pause(): void;
  resume(): void;
  test(): void;
  settings?(): void;
  update?(): void;
};

/**
 * Local control socket. The directory must be 0700 and owned by this user, so only
 * the same user (and root) can connect; no peer check is needed on top of that.
 */
export function startCliServer(path: string, h: CliHandlers) {
  const dir = statSync(dirname(path));
  if ((dir.mode & 0o777) !== 0o700 || dir.uid !== process.getuid!()) throw new Error(`${dirname(path)} must be 0700 and owned by the current user`);
  if (existsSync(path)) unlinkSync(path);
  const reply = (o: object) => JSON.stringify(o) + "\n";
  // Bun's socket.write may accept only part of a large payload; the rest is queued
  // per socket and flushed on "drain".
  const pending = new Map<unknown, Uint8Array>();
  const flush = (s: { write(b: Uint8Array): number }) => {
    const rest = pending.get(s);
    if (!rest) return;
    const n = s.write(rest);
    if (n >= rest.length) pending.delete(s);
    else pending.set(s, rest.subarray(Math.max(0, n)));
  };
  const server = Bun.listen({
    unix: path,
    socket: {
      drain(s) {
        flush(s);
      },
      close(s) {
        pending.delete(s);
      },
      data(raw, d) {
        const s = { write: (text: string) => { const prev = pending.get(raw); const bytes = new TextEncoder().encode(text); pending.set(raw, prev ? new Uint8Array([...prev, ...bytes]) : bytes); flush(raw); } };
        let msg: { cmd?: string; minutes?: number };
        try { msg = JSON.parse(d.toString()); } catch { s.write(reply({ ok: false, error: "bad json" })); return; }
        try {
          switch (msg.cmd) {
            case "status": s.write(reply({ ok: true, status: h.status() })); return;
            case "on": h.on(typeof msg.minutes === "number" && msg.minutes > 0 ? Math.min(msg.minutes, 24 * 60) : undefined); break;
            case "off": h.off(); break;
            case "pause": h.pause(); break;
            case "resume": h.resume(); break;
            case "test": h.test(); break;
            case "settings": h.settings?.(); break;
            case "update": h.update?.(); break;
            default: s.write(reply({ ok: false, error: "unknown command" })); return;
          }
          s.write(reply({ ok: true }));
        } catch (e) {
          s.write(reply({ ok: false, error: String((e as Error).message) }));
        }
      },
    },
  });
  chmodSync(path, 0o600);
  return { stop: () => { server.stop(true); if (existsSync(path)) unlinkSync(path); } };
}

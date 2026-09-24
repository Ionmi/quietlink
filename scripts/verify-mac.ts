// Integration checks on a real Mac with the privilege installed and the app built.
// Usage: bun scripts/verify-mac.ts [--wifi]   (--wifi also tests reconnect recovery; drops Wi-Fi briefly)
import { statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const APP = join(import.meta.dir, "../build/electrobun/dev-macos-arm64/Quietlink-dev.app");
const LAUNCHER = join(APP, "Contents/MacOS/launcher");
const CLI = join(import.meta.dir, "../bin/quietlink");
const uid = process.getuid!();
let failed = 0;

const sh = (argv: string[]) => {
  const p = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
const check = (ok: boolean, name: string, evidence = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${evidence ? ` — ${evidence}` : ""}`);
  if (!ok) failed++;
};
const awdlUp = () => /<UP[,>]/.test(sh(["/sbin/ifconfig", "awdl0"]).out);
const until = async (cond: () => boolean, ms: number) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return Date.now() - t0; await Bun.sleep(100); }
  return -1;
};
const cli = (...a: string[]) => sh(["bun", CLI, ...a]);
const appPid = () => Number(sh(["/usr/bin/pgrep", "-f", "Quietlink-dev.app/Contents/MacOS/bun"]).out.trim().split("\n")[0]) || null;
const wardenPid = () => Number(/pid = (\d+)/.exec(sh(["/bin/launchctl", "print", `gui/${uid}/dev.quietlink.warden`]).out)?.[1]) || null;
const startApp = async () => {
  Bun.spawn([LAUNCHER], { cwd: join(APP, "Contents/MacOS"), stdout: "ignore", stderr: "ignore" });
  return until(() => cli("status").code === 0, 20_000);
};

if (sh(["/usr/bin/pgrep", "-f", "ifconfig awdl0 down; sleep 1"]).code === 0) {
  console.error("A manual 'juego' loop is holding AWDL down. Stop it first (Ctrl+C in its terminal).");
  process.exit(2);
}

// 1. privilege
const list = sh(["/usr/bin/sudo", "-n", "-l"]).out;
check(list.includes("/sbin/ifconfig awdl0 down") && list.includes("/sbin/ifconfig awdl0 up"), "sudo rule allows exactly the two commands");
const rule = `/etc/sudoers.d/quietlink-${userInfo().username}`;
try {
  const st = statSync(rule);
  check((st.mode & 0o777) === 0o440 && st.uid === 0, "sudoers file is root-owned 0440", rule);
} catch { check(false, "sudoers file exists", rule); }
check(wardenPid() !== null, "warden LaunchAgent is running");

if (!appPid()) await startApp();
check(appPid() !== null, "app is running");

// 2. manual quiet, macOS re-enable, release after grace
check(awdlUp(), "AWDL up before test");
cli("on");
let ms = await until(() => !awdlUp(), 3000);
check(ms >= 0, "manual quiet brings AWDL down", `${ms} ms`);
sh(["/usr/bin/sudo", "-n", "/sbin/ifconfig", "awdl0", "up"]);
ms = await until(() => !awdlUp(), 3000);
check(ms >= 0, "warden re-applies down after macOS re-enables AWDL", `${ms} ms`);
cli("off");
ms = await until(() => awdlUp(), 15_000);
check(ms >= 0, "quiet off restores AWDL after grace", `${ms} ms`);

// 3. app crash
cli("on");
await until(() => !awdlUp(), 3000);
process.kill(appPid()!, 9);
ms = await until(() => awdlUp(), 8000);
check(ms >= 0 && ms <= 7000, "kill -9 app → warden restores AWDL", `${ms} ms`);

// 4. app suspended, then resumed
await startApp();
cli("on");
await until(() => !awdlUp(), 3000);
const pid = appPid()!;
process.kill(pid, "SIGSTOP");
ms = await until(() => awdlUp(), 8000);
check(ms >= 0, "SIGSTOP app → warden restores AWDL", `${ms} ms`);
process.kill(pid, "SIGCONT");
await Bun.sleep(3000);
cli("off");
await until(() => awdlUp(), 15_000);

// 5. warden suspended → app kills it, launchd restarts it
cli("on");
await until(() => !awdlUp(), 3000);
const w1 = wardenPid()!;
process.kill(w1, "SIGSTOP");
ms = await until(() => { const w = wardenPid(); return w !== null && w !== w1; }, 20_000);
check(ms >= 0, "SIGSTOP warden → app SIGKILLs it and launchd restarts it", `${ms} ms`);
cli("off");
await until(() => awdlUp(), 20_000);
check(awdlUp(), "AWDL up after warden restart and quiet off");

// 6. both killed
cli("on");
await until(() => !awdlUp(), 3000);
process.kill(appPid()!, 9);
process.kill(wardenPid()!, 9);
ms = await until(() => awdlUp(), 20_000);
check(ms >= 0 && ms <= 16_000, "kill -9 app and warden → AWDL restored", `${ms} ms`);

// 7. single instance
await startApp();
const before = appPid();
Bun.spawn([LAUNCHER], { cwd: join(APP, "Contents/MacOS"), stdout: "ignore", stderr: "ignore" });
await Bun.sleep(6000);
const pids = sh(["/usr/bin/pgrep", "-f", "Quietlink-dev.app/Contents/MacOS/bun"]).out.trim().split("\n").filter(Boolean);
check(pids.length === 1 && Number(pids[0]) === before, "second launch exits; one instance", pids.join(","));

// 8. Wi-Fi reconnect recovery (opt-in)
if (process.argv.includes("--wifi")) {
  const iface = /Wi-Fi\nDevice: (\w+)/.exec(sh(["/usr/sbin/networksetup", "-listallhardwareports"]).out)?.[1] ?? "en0";
  const power = () => sh(["/usr/sbin/networksetup", "-getairportpower", iface]).out.includes("On");
  const sock = join(homedir(), "Library/Application Support/Quietlink/warden.sock");
  const s = await Bun.connect({ unix: sock, socket: { data() {} } });
  s.write(JSON.stringify({ v: 1, id: 1, op: "reconnect-wifi", iface }) + "\n");
  await until(() => !power(), 3000);
  process.kill(wardenPid()!, 9);
  ms = await until(() => power(), 20_000);
  check(ms >= 0, "warden killed between Wi-Fi off and on → Wi-Fi back on", `${ms} ms`);
}

console.log(failed ? `${failed} check(s) FAILED` : "all checks passed");
process.exit(failed ? 1 : 0);

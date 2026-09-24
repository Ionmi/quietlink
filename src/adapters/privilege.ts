import { userInfo } from "node:os";

const COMMANDS = "/sbin/ifconfig awdl0 down, /sbin/ifconfig awdl0 up";
const RESERVED = new Set(["all", "root"]);

export function validUsername(u: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(u) && !RESERVED.has(u.toLowerCase());
}

function checked(user: string) {
  if (!validUsername(user)) throw new Error(`invalid username ${JSON.stringify(user)}`);
  return user;
}

export function sudoersContent(user: string): string {
  return `${checked(user)} ALL=(root) NOPASSWD: ${COMMANDS}\n`;
}

export const sudoersPath = (user: string) => `/etc/sudoers.d/quietlink-${checked(user)}`;

/** Root script run once via the macOS administrator prompt. Constant except the username. */
export function installScript(user: string): string {
  const u = checked(user);
  return `set -eu
umask 077
TARGET="/etc/sudoers.d/quietlink-${u}"
/usr/bin/grep -Eq '^[#@]includedir /private/etc/sudoers.d' /etc/sudoers || { echo "sudoers.d is not included" >&2; exit 3; }
[ -L "$TARGET" ] && { echo "refusing symlink" >&2; exit 4; }
if [ -e "$TARGET" ] && ! /usr/bin/grep -q '${COMMANDS}' "$TARGET"; then echo "foreign file at target" >&2; exit 5; fi
DIR=$(/usr/bin/mktemp -d /private/var/root/quietlink.XXXXXX)
TMP="$DIR/rule"
/usr/bin/printf '%s ALL=(root) NOPASSWD: ${COMMANDS}\\n' '${u}' > "$TMP"
/usr/sbin/visudo -cf "$TMP" >/dev/null
[ -e "$TARGET" ] && /bin/cp -p "$TARGET" "$DIR/backup"
/usr/sbin/chown root:wheel "$TMP"
/bin/chmod 0440 "$TMP"
/bin/mv -f "$TMP" "$TARGET"
if ! /usr/sbin/visudo -c >/dev/null; then
  if [ -e "$DIR/backup" ]; then /bin/mv -f "$DIR/backup" "$TARGET"; else /bin/rm -f "$TARGET"; fi
  /bin/rm -rf "$DIR"
  exit 6
fi
/bin/rm -rf "$DIR"
`;
}

export function uninstallScript(user: string): string {
  const u = checked(user);
  return `set -eu
TARGET="/etc/sudoers.d/quietlink-${u}"
[ -L "$TARGET" ] && { echo "refusing symlink" >&2; exit 4; }
rm -f "/etc/sudoers.d/quietlink-${u}"
/usr/sbin/visudo -c >/dev/null
`;
}

export function appleScriptString(s: string): string {
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function runAsAdmin(script: string): Promise<{ ok: boolean; error?: string }> {
  const as = `do shell script ${appleScriptString(script)} with administrator privileges`;
  const p = Bun.spawn(["/usr/bin/osascript", "-e", as], { stdout: "pipe", stderr: "pipe" });
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  if (code === 0) return { ok: true };
  return { ok: false, error: /User canceled|-128/.test(err) ? "cancelled" : err.trim() || `exit ${code}` };
}

/** The account is derived from the running process, never from input. */
export function currentUser(): string {
  return checked(userInfo().username);
}

export const install = () => runAsAdmin(installScript(currentUser()));
export const uninstall = () => runAsAdmin(uninstallScript(currentUser()));

export async function hasPrivilege(): Promise<boolean> {
  const p = Bun.spawn(["/usr/bin/sudo", "-n", "-l"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.includes("/sbin/ifconfig awdl0 down") && out.includes("/sbin/ifconfig awdl0 up");
}

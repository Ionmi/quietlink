import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchAgentsDir } from "./paths";

export const WARDEN_LABEL = "dev.quietlink.warden";
export const LOGIN_LABEL = "dev.quietlink.login";

const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function plist(label: string, args: string[], extra: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
${extra}</dict></plist>
`;
}

export function wardenPlist(helperPath: string): string {
  return plist(WARDEN_LABEL, [helperPath, "--warden"], `  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>ThrottleInterval</key><integer>5</integer>
`);
}

export function loginPlist(appPath: string): string {
  return plist(LOGIN_LABEL, ["/usr/bin/open", "-a", appPath], `  <key>RunAtLoad</key><true/>
`);
}

const uid = () => process.getuid!();
const plistPath = (label: string) => join(launchAgentsDir, `${label}.plist`);

async function launchctl(...args: string[]) {
  const p = Bun.spawn(["/bin/launchctl", ...args], { stdout: "ignore", stderr: "pipe" });
  const code = await p.exited;
  return { code, err: await new Response(p.stderr).text() };
}

/** Writes the plist and (re)loads it in the user's GUI domain. */
export async function installAgent(label: string, content: string): Promise<void> {
  mkdirSync(launchAgentsDir, { recursive: true });
  await launchctl("bootout", `gui/${uid()}/${label}`);
  writeFileSync(plistPath(label), content, { mode: 0o644 });
  const r = await launchctl("bootstrap", `gui/${uid()}`, plistPath(label));
  if (r.code !== 0) throw new Error(`launchctl bootstrap ${label}: ${r.err.trim()}`);
}

export async function removeAgent(label: string): Promise<void> {
  await launchctl("bootout", `gui/${uid()}/${label}`);
  if (existsSync(plistPath(label))) rmSync(plistPath(label));
}

export const agentInstalled = (label: string) => existsSync(plistPath(label));

import { expect, test } from "bun:test";
import { validUsername, sudoersContent, installScript, uninstallScript, appleScriptString } from "../src/adapters/privilege";
import { wardenPlist, loginPlist } from "../src/adapters/launch-agents";

test("sudoers content is exactly two literal commands", () => {
  expect(sudoersContent("alex")).toBe("alex ALL=(root) NOPASSWD: /sbin/ifconfig awdl0 down, /sbin/ifconfig awdl0 up\n");
});

test("username validation", () => {
  expect(validUsername("alex")).toBe(true);
  expect(validUsername("_svc-1")).toBe(true);
  for (const bad of ["", "a b", "x;rm", "-x", "ALL", "all", "a\n", "$(id)", "root", "a".repeat(65)]) expect(validUsername(bad)).toBe(false);
});

test("install script is constant except username and validates before and after", () => {
  const s = installScript("alex");
  expect(s).toContain("/usr/sbin/visudo -cf");
  expect(s).toContain("/usr/sbin/visudo -c ");
  expect(s).toContain("/etc/sudoers.d/quietlink-alex");
  expect(s).toContain("chmod 0440");
  expect(s).toContain("[ -L");
  expect(s).toContain("includedir");
  expect(installScript("bob").replaceAll("bob", "alex")).toBe(s);
  expect(() => installScript("x;y")).toThrow();
});

test("uninstall removes only this user's file and validates", () => {
  const s = uninstallScript("alex");
  expect(s).toContain('rm -f "/etc/sudoers.d/quietlink-alex"');
  expect(s).toContain("/usr/sbin/visudo -c");
  expect(s).not.toContain("*");
  expect(() => uninstallScript("../x")).toThrow();
});

test("applescript string escapes backslashes and quotes", () => {
  expect(appleScriptString('a"b\\c')).toBe('"a\\"b\\\\c"');
});

test("warden plist keeps alive and runs --warden", () => {
  const p = wardenPlist("/Applications/Quietlink.app/Contents/Resources/app/helper/quietlink-helper");
  expect(p).toContain("<string>dev.quietlink.warden</string>");
  expect(p).toContain("<string>--warden</string>");
  expect(p).toContain("<key>KeepAlive</key><true/>");
  expect(p).toContain("<key>ProcessType</key><string>Interactive</string>");
});

test("plist escapes xml in paths", () => {
  expect(loginPlist("/Apps/A&B <x>.app")).toContain("/Apps/A&amp;B &lt;x&gt;.app");
});

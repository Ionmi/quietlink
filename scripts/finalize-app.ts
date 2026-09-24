// Adds the privacy strings macOS needs to ask for permissions, then re-signs ad hoc
// (editing Info.plist invalidates the existing signature).
import { Glob } from "bun";

const run = (argv: string[]) => {
  const p = Bun.spawnSync(argv, { stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) throw new Error(`${argv.join(" ")} failed`);
};
const apps = [...new Glob("build/electrobun/*/*.app").scanSync({ onlyFiles: false })];
if (!apps.length) throw new Error("no app bundle found; run electrobun build first");
for (const app of apps) {
  const plist = `${app}/Contents/Info.plist`;
  run(["/usr/bin/plutil", "-replace", "NSLocalNetworkUsageDescription", "-string",
    "Quietlink measures latency to your router and other devices on your network to show where Wi-Fi lag comes from.", plist]);
  run(["/usr/bin/plutil", "-replace", "LSUIElement", "-bool", "YES", plist]);
  run(["/usr/bin/codesign", "--force", "--deep", "--sign", "-", app]);
  console.log(`finalized ${app}`);
}

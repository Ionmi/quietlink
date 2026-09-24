// Adds the privacy strings macOS needs, then signs: with this Mac's "Quietlink Local"
// identity when building locally (stable permissions), ad hoc on CI.
import { Glob } from "bun";
import { ensureLocalIdentity, signApp } from "../src/adapters/local-identity";

const run = (argv: string[]) => {
  const p = Bun.spawnSync(argv, { stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) throw new Error(`${argv.join(" ")} failed`);
};
// Run by Electrobun's postBuild hook (before the stable build is compressed), or by hand.
const dir = process.env.ELECTROBUN_BUILD_DIR;
const only = process.argv[2];
const apps = dir
  ? [...new Glob("*.app").scanSync({ cwd: dir, onlyFiles: false })].map((a) => `${dir}/${a}`)
  : [...new Glob("build/electrobun/*/*.app").scanSync({ onlyFiles: false })].filter((a) => !only || a.includes(only));
if (!apps.length) throw new Error("no app bundle found; run electrobun build first");
const identity = process.env.CI ? null : ensureLocalIdentity();
for (const app of apps) {
  const plist = `${app}/Contents/Info.plist`;
  run(["/usr/bin/plutil", "-replace", "NSLocalNetworkUsageDescription", "-string",
    "Quietlink measures latency to your router and other devices on your network to show where Wi-Fi lag comes from.", plist]);
  run(["/usr/bin/plutil", "-replace", "LSUIElement", "-bool", "YES", plist]);
  if (identity) {
    if (!signApp(app, identity)) throw new Error(`signing ${app} failed`);
    console.log(`finalized ${app} (signed with Quietlink Local)`);
  } else {
    const helper = `${app}/Contents/Resources/app/helper/Quietlink Helper.app`;
    if (await Bun.file(`${helper}/Contents/Info.plist`).exists())
      run(["/usr/bin/codesign", "--force", "--sign", "-", "--identifier", "dev.quietlink.helper", helper]);
    run(["/usr/bin/codesign", "--force", "--sign", "-", app]);
    console.log(`finalized ${app} (ad hoc)`);
  }
}

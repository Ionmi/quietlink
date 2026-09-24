import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { Glob } from "bun";
import pkg from "../package.json";

// The helper ships as its own small app bundle so macOS can attribute (and ask
// for) the Local Network permission it needs to ping the router.
const bundle = "build/helper/Quietlink Helper.app";
const exe = `${bundle}/Contents/MacOS/quietlink-helper`;
rmSync(bundle, { recursive: true, force: true });
mkdirSync(`${bundle}/Contents/MacOS`, { recursive: true });

const files = [...new Glob("helper/*.swift").scanSync()].sort();
const arch = process.arch === "arm64" ? "arm64" : "x86_64";
const args = [
  "swiftc", "-O", "-swift-version", "5", "-target", `${arch}-apple-macos14.0`,
  "-framework", "AppKit", "-framework", "CoreWLAN", "-framework", "CoreAudio", "-framework", "SystemConfiguration",
  "-o", exe, ...files,
];
const p = Bun.spawnSync(args, { stdout: "inherit", stderr: "inherit" });
if (p.exitCode !== 0) process.exit(p.exitCode ?? 1);

writeFileSync(`${bundle}/Contents/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.quietlink.helper</string>
  <key>CFBundleName</key><string>Quietlink Helper</string>
  <key>CFBundleDisplayName</key><string>Quietlink</string>
  <key>CFBundleExecutable</key><string>quietlink-helper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>${pkg.version}</string>
  <key>CFBundleShortVersionString</key><string>${pkg.version}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSLocalNetworkUsageDescription</key><string>Quietlink measures latency to your router and other devices on your network to show where Wi-Fi lag comes from.</string>
</dict></plist>
`);
const sign = Bun.spawnSync(["/usr/bin/codesign", "--force", "--sign", "-", "--identifier", "dev.quietlink.helper", bundle], { stdout: "inherit", stderr: "inherit" });
if (sign.exitCode !== 0) process.exit(1);
// Plain path kept for tests and tools.
Bun.spawnSync(["/bin/ln", "-sf", "Quietlink Helper.app/Contents/MacOS/quietlink-helper", "build/helper/quietlink-helper"]);

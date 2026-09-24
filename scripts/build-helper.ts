import { mkdirSync } from "node:fs";
import { Glob } from "bun";

mkdirSync("build/helper", { recursive: true });
const files = [...new Glob("helper/*.swift").scanSync()].sort();
const arch = process.arch === "arm64" ? "arm64" : "x86_64";
const args = [
  "swiftc", "-O", "-swift-version", "5", "-target", `${arch}-apple-macos14.0`,
  "-framework", "AppKit", "-framework", "CoreWLAN", "-framework", "CoreAudio", "-framework", "SystemConfiguration",
  "-o", "build/helper/quietlink-helper", ...files,
];
const p = Bun.spawnSync(args, { stdout: "inherit", stderr: "inherit" });
if (p.exitCode !== 0) process.exit(p.exitCode ?? 1);

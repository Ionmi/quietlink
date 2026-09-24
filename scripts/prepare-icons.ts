// Renders icons/app-icon.svg into the app iconset using macOS sips.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const run = (args: string[]) => {
  const p = Bun.spawnSync(["/usr/bin/sips", ...args], { stdout: "ignore", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`sips ${args.join(" ")}: ${p.stderr.toString()}`);
};

const iconset = resolve(root, "build/icon.iconset");
mkdirSync(iconset, { recursive: true });

const master = resolve(root, "build/app-icon-1024.png");
run(["-s", "format", "png", resolve(root, "icons/app-icon.svg"), "--out", master]);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = String(size * scale);
    run(["-z", px, px, master, "--out", resolve(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`)]);
  }
}
console.log("icons ready");

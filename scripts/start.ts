import { dirname, resolve } from "node:path";

const launcher = resolve(import.meta.dirname, "../build/electrobun/dev-macos-arm64/Quietlink-dev.app/Contents/MacOS/launcher");
if (!(await Bun.file(launcher).exists())) throw new Error("Build first: bun run build");
const child = Bun.spawn([launcher], { cwd: dirname(launcher), stdout: "inherit", stderr: "inherit" });
process.exitCode = await child.exited;

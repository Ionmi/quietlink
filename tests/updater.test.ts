import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareUpdate, swapScript } from "../src/app/updater";

const zipBytes = new TextEncoder().encode("fake zip");
const sha = new Bun.CryptoHasher("sha256").update(zipBytes).digest("hex");
const update = { version: "0.2.0", page: "https://github.com/Ionmi/quietlink/releases/tag/v0.2.0", download: "https://github.com/Ionmi/quietlink/releases/download/v0.2.0/Quietlink-0.2.0-macos-arm64.zip" };

function deps(over: { shaText?: string; id?: string; version?: string; dittoCode?: number } = {}) {
  const calls: string[][] = [];
  return {
    calls,
    d: {
      fetch: (async (url: string) => {
        if (url.endsWith(".sha256")) return new Response(over.shaText ?? `${sha}  Quietlink-0.2.0-macos-arm64.zip\n`);
        return new Response(zipBytes);
      }) as unknown as typeof fetch,
      workDir: mkdtempSync(join(tmpdir(), "upd-")),
      exec: async (argv: string[]) => { calls.push(argv); return { code: argv[0].endsWith("ditto") ? (over.dittoCode ?? 0) : 0, out: "" }; },
      readBundle: async () => ({ id: over.id ?? "dev.quietlink.app", version: over.version ?? "0.2.0" }),
    },
  };
}

test("[update] verified download is staged", async () => {
  const { d, calls } = deps();
  const r = await prepareUpdate(update, d);
  expect(r).toEqual({ ok: true, staged: join(d.workDir, "extract/Quietlink.app") });
  expect(calls[0][0]).toBe("/usr/bin/ditto");
});

test("[update] checksum mismatch is refused", async () => {
  const { d } = deps({ shaText: "0".repeat(64) });
  expect(await prepareUpdate(update, d)).toEqual({ ok: false, error: "checksum" });
});

test("[update] wrong bundle or version is refused", async () => {
  expect(await prepareUpdate(update, deps({ id: "com.evil.app" }).d)).toEqual({ ok: false, error: "bundle" });
  expect(await prepareUpdate(update, deps({ version: "0.1.9" }).d)).toEqual({ ok: false, error: "bundle" });
});

test("[update] only downloads from this project's GitHub releases", async () => {
  const r = await prepareUpdate({ ...update, download: "https://example.com/Quietlink.zip" }, deps().d);
  expect(r).toEqual({ ok: false, error: "source" });
});

test("[update] swap script waits for the app, keeps the old version in the Trash and rolls back on failure", () => {
  const s = swapScript(4242, "/Applications/Quietlink.app", "/tmp/x/extract/Quietlink.app", "/Users/alex/.Trash/Quietlink 0.1.0.app");
  expect(s).toContain("kill -0 4242");
  expect(s).toContain(`mv "/Applications/Quietlink.app" "/Users/alex/.Trash/Quietlink 0.1.0.app"`);
  expect(s).toContain(`mv "/tmp/x/extract/Quietlink.app" "/Applications/Quietlink.app"`);
  expect(s).toContain(`|| mv "/Users/alex/.Trash/Quietlink 0.1.0.app" "/Applications/Quietlink.app"`);
  expect(s).toContain(`/usr/bin/open "/Applications/Quietlink.app"`);
  expect(() => swapScript(1, "/Applications/Quiet\"link.app", "/tmp/a.app", "/tmp/b.app")).toThrow();
  expect(() => swapScript(1, "/Applications/NotAnApp", "/tmp/a.app", "/tmp/b.app")).toThrow();
});

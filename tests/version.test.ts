import { expect, test } from "bun:test";
import { compareVersions, pickUpdate } from "../src/domain/version";

test("semantic version comparison", () => {
  expect(compareVersions("0.1.0", "0.1.1")).toBe(-1);
  expect(compareVersions("v0.2.0", "0.1.9")).toBe(1);
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("1.10.0", "1.9.3")).toBe(1);
  expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
});

test("pickUpdate returns the newer stable release with its download", () => {
  const rel = { tag_name: "v0.2.0", html_url: "https://github.com/Ionmi/quietlink/releases/tag/v0.2.0", draft: false, prerelease: false,
    assets: [{ name: "Quietlink-0.2.0-macos-arm64.zip", browser_download_url: "https://x/zip" }] };
  expect(pickUpdate("0.1.0", rel)).toEqual({ version: "0.2.0", page: rel.html_url, download: "https://x/zip" });
  expect(pickUpdate("0.2.0", rel)).toBeNull();
  expect(pickUpdate("0.1.0", { ...rel, prerelease: true })).toBeNull();
  expect(pickUpdate("0.1.0", { ...rel, draft: true })).toBeNull();
  expect(pickUpdate("0.1.0", { ...rel, assets: [] })).toEqual({ version: "0.2.0", page: rel.html_url, download: null });
  expect(pickUpdate("0.1.0", { nope: 1 } as any)).toBeNull();
});

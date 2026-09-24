import { lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Update } from "../domain/version";

const RELEASES = "https://github.com/Ionmi/quietlink/releases/download/";

type Deps = {
  fetch: typeof fetch;
  workDir: string;
  exec(argv: string[]): Promise<{ code: number; out: string }>;
  readBundle(appPath: string): Promise<{ id: string; version: string }>;
  /** Re-sign the verified bundle with this Mac's local identity (keeps permissions). */
  sign?(appPath: string): Promise<boolean>;
};

export type Prepared = { ok: true; staged: string } | { ok: false; error: "source" | "download" | "checksum" | "unpack" | "bundle" | "sign" };

/**
 * Downloads the release zip and its .sha256 from this project's GitHub releases,
 * checks the hash, unpacks it (self-extractor included) and checks the bundle id and version. Nothing is
 * replaced here; the swap happens after the app quits.
 */
export async function prepareUpdate(u: Update, d: Deps): Promise<Prepared> {
  if (!u.download || !u.download.startsWith(RELEASES) || !u.download.endsWith(".zip")) return { ok: false, error: "source" };
  let zip: Uint8Array, shaText: string;
  try {
    const [z, s] = await Promise.all([d.fetch(u.download), d.fetch(u.download + ".sha256")]);
    if (!z.ok || !s.ok) return { ok: false, error: "download" };
    zip = new Uint8Array(await z.arrayBuffer());
    shaText = await s.text();
  } catch {
    return { ok: false, error: "download" };
  }
  const expected = shaText.trim().split(/\s+/)[0]?.toLowerCase();
  const actual = new Bun.CryptoHasher("sha256").update(zip).digest("hex");
  if (!expected || expected !== actual) return { ok: false, error: "checksum" };
  const zipPath = join(d.workDir, "update.zip");
  const extract = join(d.workDir, "extract");
  await Bun.write(zipPath, zip);
  const unzip = await d.exec(["/usr/bin/ditto", "-x", "-k", zipPath, extract]);
  if (unzip.code !== 0) return { ok: false, error: "unpack" };
  const outer = join(extract, "Quietlink.app");
  // Release zips hold Electrobun's self-extractor, which shows its own installer panel on
  // first launch. Unpack the real app here so the relaunch opens Quietlink directly.
  const metaPath = join(outer, "Contents/Resources/metadata.json");
  const hasMeta = (() => {
    try {
      return !!lstatSync(metaPath);
    } catch (e) {
      return (e as NodeJS.ErrnoException).code !== "ENOENT";
    }
  })();
  let staged = outer;
  if (hasMeta) {
    const hash = await Bun.file(metaPath).json().then((m) => m?.hash, () => undefined);
    if (typeof hash !== "string" || !/^[a-z0-9]+$/.test(hash)) return { ok: false, error: "unpack" };
    const tar = join(d.workDir, "app.tar");
    const into = join(d.workDir, "app");
    try {
      await Bun.write(tar, Bun.zstdDecompressSync(await Bun.file(join(outer, `Contents/Resources/${hash}.tar.zst`)).bytes()));
      mkdirSync(into);
    } catch {
      return { ok: false, error: "unpack" };
    }
    if ((await d.exec(["/usr/bin/tar", "-xf", tar, "-C", into])).code !== 0) return { ok: false, error: "unpack" };
    staged = join(into, "Quietlink.app");
  }
  if (!lstatSync(staged, { throwIfNoEntry: false })?.isDirectory()) return { ok: false, error: "unpack" };
  const b = await d.readBundle(staged).catch(() => null);
  if (!b || b.id !== "dev.quietlink.app" || b.version !== u.version) return { ok: false, error: "bundle" };
  if (d.sign && !(await d.sign(staged))) return { ok: false, error: "sign" };
  return { ok: true, staged };
}

const safe = (p: string) => {
  if (!/^\/[^"$`\\]*\.app$/.test(p)) throw new Error(`unsafe path ${p}`);
  return `"${p}"`;
};

/** Shell script run after the app quits: swap bundles, keep the old one in the Trash, relaunch. */
export function swapScript(pid: number, current: string, staged: string, trashed: string): string {
  const [c, s, t] = [safe(current), safe(staged), safe(trashed)];
  return `for i in $(seq 1 60); do kill -0 ${pid} 2>/dev/null || break; sleep 0.5; done
mv ${c} ${t} || exit 1
mv ${s} ${c} || mv ${t} ${c}
/usr/bin/xattr -dr com.apple.quarantine ${c} 2>/dev/null
/usr/bin/open ${c}
`;
}

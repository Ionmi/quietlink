export type Update = { version: string; page: string; download: string | null };

const parse = (v: string) => {
  const [core, pre] = v.replace(/^v/, "").split("-", 2);
  return { nums: core.split(".").map((n) => Number(n) || 0), pre: pre ?? null };
};

/** -1 if a < b, 0 if equal, 1 if a > b. A pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const A = parse(a), B = parse(b);
  for (let i = 0; i < Math.max(A.nums.length, B.nums.length); i++) {
    const d = (A.nums[i] ?? 0) - (B.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (A.pre === B.pre) return 0;
  if (A.pre === null) return 1;
  if (B.pre === null) return -1;
  return A.pre < B.pre ? -1 : 1;
}

type Release = { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean; assets?: { name: string; browser_download_url: string }[] };

/** The GitHub "latest release" if it is a newer, published, stable version. */
export function pickUpdate(current: string, rel: Release): Update | null {
  if (!rel?.tag_name || !rel.html_url || rel.draft || rel.prerelease) return null;
  if (compareVersions(rel.tag_name, current) <= 0) return null;
  const zip = rel.assets?.find((a) => a.name.endsWith(".zip") && a.name.includes(process.arch === "arm64" ? "arm64" : "x64"));
  return { version: rel.tag_name.replace(/^v/, ""), page: rel.html_url, download: zip?.browser_download_url ?? null };
}

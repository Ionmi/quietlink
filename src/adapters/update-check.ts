import { pickUpdate, type Update } from "../domain/version";

const LATEST = "https://api.github.com/repos/Ionmi/quietlink/releases/latest";

/** One GET to GitHub's public API; nothing about this Mac is sent beyond the request itself. */
export async function checkForUpdate(current: string, fetcher: typeof fetch = fetch): Promise<Update | null> {
  const r = await fetcher(LATEST, { headers: { accept: "application/vnd.github+json", "user-agent": `Quietlink/${current}` }, signal: AbortSignal.timeout(10_000) });
  if (r.status === 404) return null; // no releases yet
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return pickUpdate(current, await r.json());
}

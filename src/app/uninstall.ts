type Status = { awdlUp: boolean | null; tookDown: boolean; wifiPending: boolean } | null;

/**
 * Removes Quietlink's privileges only after the warden has confirmed that AWDL and
 * Wi-Fi are restored. On failure the warden and the sudo rule stay installed, so
 * the warden keeps retrying and AirDrop is never stranded off.
 */
export async function safeUninstall(d: {
  suppress(): void;
  reenable(): void;
  restoreNow(): Promise<void>;
  status(): Promise<Status>;
  removeAgent(): Promise<void>;
  uninstallRule(): Promise<{ ok: boolean; error?: string }>;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<{ ok: boolean; error?: string }> {
  d.suppress();
  try {
    await d.restoreNow().catch(() => {});
    const deadline = Date.now() + (d.timeoutMs ?? 15_000);
    let restored = false;
    while (Date.now() < deadline) {
      const s = await d.status().catch(() => null);
      if (s && s.awdlUp === true && !s.tookDown && !s.wifiPending) { restored = true; break; }
      await Bun.sleep(d.pollMs ?? 500);
    }
    if (!restored) return { ok: false, error: "AirDrop could not be confirmed restored; permissions kept so Quietlink can keep retrying." };
    await d.removeAgent();
    return await d.uninstallRule();
  } finally {
    d.reenable();
  }
}

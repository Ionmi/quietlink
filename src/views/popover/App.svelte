<script lang="ts">
  import { app, call, connect, fmt, tr } from "../shared/state.svelte";
  import Sparkline from "./Sparkline.svelte";

  $effect(() => connect());

  const v = $derived(app.view);
  let reconnectState = $state<"" | "working" | "done" | string>("");
  let menuOpen = $state(false);

  const quiet = $derived(v ? ["activating", "active", "grace", "airdrop-break"].includes(v.phase) : false);
  const testing = $derived(v ? ["arming-A", "A", "arming-B", "B"].includes(v.test.phase) : false);

  const pill = $derived.by(() => {
    if (!v) return { text: "…", cls: "" };
    if (v.phase === "suppressed") return { text: tr("ui.suppressed"), cls: "warn" };
    if (v.phase === "fault") return { text: tr("ui.fault"), cls: "warn" };
    if (v.phase === "activating") return { text: tr("ui.activating"), cls: "on" };
    if (v.phase === "restoring") return { text: tr("ui.restoring"), cls: "" };
    if (v.phase === "airdrop-break") return { text: tr("ui.break"), cls: "on" };
    if (v.phase === "grace") return { text: tr("ui.grace"), cls: "on" };
    if (v.phase === "active") return { text: tr("ui.quiet"), cls: "on" };
    return { text: tr("ui.off"), cls: "" };
  });

  function quietFor(minutes: number | null) {
    menuOpen = false;
    void call("manual", true, minutes ? minutes * 60_000 : undefined);
  }

  async function reconnect() {
    if (!confirm(tr("ui.reconnectConfirm"))) return;
    reconnectState = "working";
    const r = await call<{ ok: boolean; error?: string }>("reconnectWifi");
    reconnectState = r.ok ? "done" : tr("set.failed", { error: r.error ?? "?" });
  }

  const testLine = $derived.by(() => {
    if (!v) return "";
    const q = v.test;
    const cond = (n: number) => (n % 2 === 0 ? tr("ui.testA") : tr("ui.testB"));
    if (q.phase === "A" || q.phase === "B") return tr("ui.testRunning", { n: q.block + 1, cond: cond(q.block) });
    if (q.phase === "arming-A" || q.phase === "arming-B") return tr("ui.testArming", { n: q.block + 1 });
    if (q.phase === "invalid") return tr("ui.testInvalid", { reason: q.reason ?? "?" });
    if (q.phase === "cancelled") return tr("ui.testCancelled");
    if (q.phase === "done") {
      const sum = (c: "A" | "B") => q.results.filter((r) => r.cond === c).reduce((a, r) => ({ spikes: a.spikes + r.spikes, sent: a.sent + r.sent }), { spikes: 0, sent: 0 });
      const a = sum("A");
      const b = sum("B");
      return tr("ui.testResult", { a: a.spikes, as: a.sent, b: b.spikes, bs: b.sent, ms: v.testSpikeMs });
    }
    return "";
  });

  const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
</script>

{#if v}
  <main>
    <header>
      <div class="title">
        <span class="pill {pill.cls}">{pill.text}</span>
        {#if v.because.length && quiet}<span class="because">{tr("quiet.because", { name: v.because.join(", ") })}</span>{/if}
      </div>
      <div class="actions">
        {#if v.phase === "suppressed"}
          <button class="primary" onclick={() => call("reenable")}>{tr("ui.reenable")}</button>
        {:else if quiet}
          {#if v.phase === "active" || v.phase === "grace"}<button onclick={() => call("airdropBreak")}>{tr("airdrop.break")}</button>{/if}
          <button onclick={() => call("manual", false)} disabled={!v.because.some((b) => b === "Manual" || b.startsWith("Timed") || b.startsWith("Temporizado"))}>{tr("ui.stop")}</button>
          <button class="danger" onclick={() => call("emergency")}>{tr("restore.airdrop")}</button>
        {:else}
          <div class="split">
            <button class="primary" onclick={() => quietFor(null)} disabled={testing || !v.privilege}>{tr("ui.quietNow")}</button>
            <button class="primary more" aria-label="Duration" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)} disabled={testing || !v.privilege}>▾</button>
            {#if menuOpen}
              <div class="menu" role="menu">
                {#each [[30, "ui.for30"], [60, "ui.for60"], [120, "ui.for120"]] as [m, k] (m)}
                  <button role="menuitem" onclick={() => quietFor(m as number)}>{tr(k as any)}</button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </header>

    {#if !v.privilege && !v.recovering}
      <div class="banner warn">
        {tr("ui.privilegeMissing")}
        <button onclick={() => call("openSettings")}>{tr("ui.installPrivilege")}</button>
      </div>
    {:else if !v.wardenHealthy}
      <div class="banner warn">{tr("ui.wardenDown")}</div>
    {:else if v.recovering}
      <div class="banner">{tr("ui.recovering")}</div>
    {/if}
    {#if v.probesBlocked}<div class="banner warn">{tr("ui.probesBlocked")}</div>{/if}
    {#if v.paused}<div class="banner">{tr("ui.paused")} <button onclick={() => call("resume")}>{tr("resume.automation")}</button></div>{/if}
    {#if v.lastError && (v.phase === "fault" || v.phase === "suppressed")}<div class="banner warn">{v.lastError}</div>{/if}

    <section class="stats">
      <div><span class="k">{tr("ui.router")}</span><span class="val">{fmt(v.ping.gw, 1)}<small> ms</small></span></div>
      <div><span class="k">{tr("ui.internet")}</span><span class="val">{fmt(v.ping.ext, 1)}<small> ms</small></span></div>
      <div><span class="k">{tr("ui.jitter")}</span><span class="val">{fmt(v.jitter, 1)}<small> ms</small></span></div>
      <div><span class="k">{tr("ui.loss")}</span><span class="val">{fmt(v.lossPct, 1)}<small> %</small></span></div>
    </section>
    <Sparkline points={v.sparkline} />
    {#if v.late > 0}<p class="muted small">{tr("ui.late", { n: v.late })}</p>{/if}

    <section>
      <h2>{tr("ui.wifi")}</h2>
      {#if v.wifi}
        <p class="wifi">
          <strong>{v.wifi.band ?? "—"} GHz</strong> · {tr("ui.channel", { n: v.wifi.channel ?? "—" })} · {v.wifi.widthMHz ?? "—"} MHz ·
          {fmt(v.wifi.rssi)} dBm · {tr("ui.phy", { n: fmt(v.wifi.phyRateMbps) })}
        </p>
        {#if v.advice.kind === "previously-6"}
          <div class="banner">
            {tr("notify.band.body")}
            <button onclick={reconnect} disabled={quiet || testing || reconnectState === "working"} title={quiet ? tr("ui.reconnectBlocked") : ""}>
              {reconnectState === "working" ? tr("ui.reconnecting") : tr("ui.reconnect")}
            </button>
          </div>
        {/if}
        {#if reconnectState && reconnectState !== "working"}<p class="muted small">{reconnectState === "done" ? tr("ui.reconnectDone") : reconnectState}</p>{/if}
      {:else}
        <p class="muted">{tr("ui.notConnected")}</p>
      {/if}
    </section>

    <section>
      <h2>{tr("ui.events")}</h2>
      {#if v.lastEvents.length}
        <ul class="events">
          {#each v.lastEvents.slice(0, 5) as e (e.ts + e.kind)}
            <li><span class="muted">{time(e.ts)}</span> {e.text}{#if e.resolutionMs} <span class="muted small">±{(e.resolutionMs / 1000).toFixed(1)} s</span>{/if}{#if e.note}<br /><span class="muted small">{e.note}</span>{/if}</li>
          {/each}
        </ul>
        <p class="muted small">{tr("ui.lastHour", { n: v.interruptionsLastHour })}</p>
      {:else}
        <p class="muted">{tr("ui.noEvents")}</p>
      {/if}
    </section>

    <section>
      <h2>{tr("ui.test")}</h2>
      {#if testing}
        <p>{testLine}</p>
        <p class="muted small">{tr("ui.testHint")}</p>
        <button onclick={() => call("cancelQuietTest")}>{tr("ui.testCancel")}</button>
      {:else}
        {#if testLine}<p>{testLine}</p>{/if}
        <button onclick={() => call("startQuietTest")} disabled={quiet || !v.wifi || !v.privilege}>{tr("ui.testStart")}</button>
      {/if}
    </section>

    <footer>
      {#if !v.paused}<button class="link" onclick={() => call("pause")}>{tr("pause.automation")}</button>{/if}
      <span class="spacer"></span>
      <button class="link" onclick={() => call("openSettings")}>{tr("ui.settings")}</button>
      <button class="link" onclick={() => call("quit")}>{tr("ui.quit")}</button>
    </footer>
  </main>
{/if}

<style>
  main { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  header { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
  .title { display: flex; flex-direction: column; gap: 4px; }
  .pill { align-self: flex-start; padding: 3px 10px; border-radius: 999px; background: var(--chip); font-weight: 600; }
  .pill.on { background: var(--accent); color: white; }
  .pill.warn { background: var(--warn); color: white; }
  .because { color: var(--muted); font-size: 12px; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .split { position: relative; display: flex; }
  .split .primary:first-child { border-radius: 6px 0 0 6px; }
  .more { border-radius: 0 6px 6px 0; padding: 0 8px; border-left: 1px solid rgba(255,255,255,.3); }
  .menu { position: absolute; top: 100%; left: 0; margin-top: 4px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; z-index: 2; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
  .menu button { background: none; text-align: left; }
  .menu button:hover { background: var(--chip); }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .stats div { background: var(--chip); border-radius: 8px; padding: 6px 8px; display: flex; flex-direction: column; }
  .k { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .val { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .val small { font-size: 10px; font-weight: 400; color: var(--muted); }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 0 0 4px; }
  section p { margin: 0 0 6px; }
  .wifi strong { font-weight: 600; }
  .events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  footer { display: flex; gap: 10px; border-top: 1px solid var(--line); padding-top: 8px; }
  .spacer { flex: 1; }
</style>

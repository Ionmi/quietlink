<script lang="ts">
  import { app, call, connect, fmt, tr } from "../shared/state.svelte";
  import Trace from "./Trace.svelte";
  import { formatRate } from "../../domain/menubar";

  $effect(() => connect());

  const v = $derived(app.view);
  let root = $state<HTMLElement>();
  let timedOpen = $state(false);
  let reconnectState = $state<"" | "working" | "done" | string>("");

  // The window follows the content height, like a native popover.
  $effect(() => {
    if (!root) return;
    const ro = new ResizeObserver(() => void call("popoverHeight", Math.ceil(root!.getBoundingClientRect().height) + 2));
    ro.observe(root);
    return () => ro.disconnect();
  });

  const quiet = $derived(v ? ["activating", "active", "grace", "airdrop-break"].includes(v.phase) : false);
  const testing = $derived(v ? ["arming-A", "A", "arming-B", "B"].includes(v.test.phase) : false);
  const manualOn = $derived(v ? v.because.some((b) => b === tr("lease.manual") || b.startsWith(tr("lease.timed", { min: "" }).split("(")[0])) : false);

  const state = $derived.by(() => {
    if (!v) return { word: "…", note: "" };
    switch (v.phase) {
      case "suppressed": return { word: tr("ui.off"), note: tr("ui.suppressed") };
      case "fault": return { word: tr("ui.fault"), note: v.lastError ?? "" };
      case "activating": return { word: tr("ui.quiet"), note: tr("ui.activating") };
      case "airdrop-break": return { word: tr("ui.break"), note: v.because.join(", ") };
      case "grace": return { word: tr("ui.quiet"), note: tr("ui.grace") };
      case "active": return { word: tr("ui.quiet"), note: v.because.join(", ") };
      case "restoring": return { word: tr("ui.off"), note: tr("ui.restoring") };
      default: return { word: tr("ui.off"), note: v.restore.pending ? tr("ui.restorePending") : v.paused ? tr("ui.paused") : tr("ui.offNote") };
    }
  });

  function toggle() {
    if (!v) return;
    timedOpen = false;
    if (v.phase === "suppressed") void call("reenable");
    else if (manualOn) void call("manual", false);
    else if (!quiet) void call("manual", true);
  }

  function quietFor(minutes: number) {
    timedOpen = false;
    void call("manual", true, minutes * 60_000);
  }

  let confirmReconnect = $state(false);
  async function reconnect() {
    if (!confirmReconnect) { confirmReconnect = true; setTimeout(() => (confirmReconnect = false), 4000); return; }
    confirmReconnect = false;
    reconnectState = "working";
    const r = await call<{ ok: boolean; band?: string | null; error?: string }>("reconnectWifi");
    reconnectState = r.ok
      ? tr("ui.reconnectedOn", { band: r.band ?? "—" })
      : r.error === "timeout" ? tr("ui.reconnectTimeout") : tr("set.failed", { error: r.error ?? "?" });
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

  const spikeCount = $derived(v ? v.sparkline.filter((p) => p.rtt !== null && p.rtt > v.testSpikeMs).length : 0);
  const lostCount = $derived(v ? v.sparkline.filter((p) => p.rtt === null).length : 0);
  const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const canToggle = $derived(!!v && !testing && (v.privilege || v.phase === "suppressed" || manualOn));
</script>

{#if v}
  <main bind:this={root} class:quiet>
    <header>
      <div class="state">
        <span class="word">{state.word}</span>
        {#if state.note}<span class="note">{state.note}</span>{/if}
      </div>
      <button class="switch" role="switch" aria-checked={quiet} aria-label={tr("ui.quietNow")} onclick={toggle} disabled={!canToggle || (quiet && !manualOn)}>
        <span class="knob"></span>
      </button>
    </header>

    {#if !quiet && v.privilege && !testing && v.phase !== "suppressed"}
      <div class="timed">
        {#if timedOpen}
          {#each [30, 60, 120] as m (m)}<button class="text" onclick={() => quietFor(m)}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>{/each}
        {:else}
          <button class="text" onclick={() => (timedOpen = true)}>{tr("ui.quietFor")}</button>
        {/if}
      </div>
    {/if}
    {#if quiet}
      <div class="timed">
        {#if v.phase === "active" || v.phase === "grace"}<button class="text" onclick={() => call("airdropBreak")}>{tr("airdrop.break")}</button>{/if}
        <button class="text amber" onclick={() => call("emergency")}>{tr("restore.airdrop")}</button>
      </div>
    {/if}

    {#if v.restore.pending}
      <p class="alert">{tr("ui.restorePending")}{#if v.restore.error} ({v.restore.error}){/if} <button class="text" onclick={() => call("emergency")}>{tr("restore.airdrop")}</button></p>
    {/if}
    {#if !v.privilege && !v.recovering}
      <p class="alert">{tr("ui.privilegeMissing")} <button class="text" onclick={() => call("openSettings")}>{tr("ui.installPrivilege")}</button></p>
    {:else if !v.wardenHealthy}
      <p class="alert">{tr("ui.wardenDown")}</p>
    {/if}
    {#if v.probesBlocked}<p class="alert">{tr("ui.probesBlocked")}</p>{/if}
    {#if v.paused}<p class="alert soft">{tr("ui.paused")} <button class="text" onclick={() => call("resume")}>{tr("resume.automation")}</button></p>{/if}

    <section class="hero">
      <div class="reading">
        <span class="ms">{fmt(v.ping.gw)}</span><span class="unit">ms</span>
        <span class="to">{tr("ui.toRouter")}</span>
      </div>
      <Trace points={v.sparkline} spikeMs={v.testSpikeMs} />
      <p class="facts">
        {tr("ui.factsLine", { spikes: spikeCount, lost: lostCount, ms: v.testSpikeMs })}
      </p>
    </section>

    <dl class="rows">
      <div><dt>{tr("ui.internet")}</dt><dd>{fmt(v.ping.ext)} ms</dd></div>
      <div><dt>{tr("ui.jitter")}</dt><dd>{fmt(v.jitter, 1)} ms</dd></div>
      <div><dt>{tr("ui.loss")}</dt><dd>{fmt(v.lossPct, 1)} %</dd></div>
      <div class="wide"><dt>{tr("ui.traffic")}</dt><dd>{#if v.traffic}↓{formatRate(v.traffic.down)}b/s ↑{formatRate(v.traffic.up)}b/s{:else}—{/if}</dd></div>
      <div class="wide">
        <dt>{tr("ui.wifi")}</dt>
        <dd>
          {#if v.wifi}{v.wifi.band ?? "—"} GHz, {tr("ui.channel", { n: v.wifi.channel ?? "—" })}, {fmt(v.wifi.rssi)} dBm{:else}{tr("ui.notConnected")}{/if}
        </dd>
      </div>
    </dl>

    {#if v.advice.kind === "previously-6"}
      <p class="alert soft">
        {tr("notify.band.body")}
        <button class="text" onclick={reconnect} disabled={quiet || testing || reconnectState === "working"}>
          {reconnectState === "working" ? tr("ui.reconnecting") : confirmReconnect ? tr("ui.reconnectConfirmShort") : tr("ui.reconnect")}
        </button>
      </p>
    {/if}
    {#if reconnectState && reconnectState !== "working"}<p class="muted">{reconnectState}</p>{/if}

    <section class="events">
      {#if v.lastEvents.length}
        {#each v.lastEvents.slice(0, 3) as e (e.ts + e.kind)}
          <p><span class="muted">{time(e.ts)}</span> {e.kind === "interruption" ? tr("ui.cutOf", { d: e.text }) : e.text}{#if e.note}<span class="muted"> {e.note}</span>{/if}</p>
        {/each}
      {:else}
        <p class="muted">{tr("ui.noEvents")}</p>
      {/if}
    </section>

    {#if testing || testLine}
      <section class="test">
        <p>{testLine}</p>
        {#if testing}<p class="muted">{tr("ui.testHint")}</p>{/if}
      </section>
    {/if}

    <footer>
      {#if testing}
        <button class="text" onclick={() => call("cancelQuietTest")}>{tr("ui.testCancel")}</button>
      {:else}
        <button class="text" onclick={() => call("startQuietTest")} disabled={quiet || !v.wifi || !v.privilege}>{tr("ui.test")}</button>
      {/if}
      {#if !v.paused}<button class="text" onclick={() => call("pause")}>{tr("ui.pauseShort")}</button>{/if}
      <span class="spacer"></span>
      <button class="text" onclick={() => call("openSettings")}>{tr("ui.settings")}</button>
      <button class="text" onclick={() => call("quit")}>{tr("ui.quit")}</button>
    </footer>
  </main>
{/if}

<style>
  :global(html), :global(body) { background: transparent !important; overflow: hidden; }
  main {
    --panel: #0f1d2b; --ink: #e6eef2; --dim: #8aa0ad; --hair: rgba(230, 238, 242, 0.12);
    --teal: #2bb5b0; --mint: #9ff3e6; --amber: #f2a541; --line-color: var(--dim);
    margin: 1px; padding: 14px 16px 10px; border-radius: 14px;
    background: var(--panel); color: var(--ink); border: 1px solid var(--hair);
    display: flex; flex-direction: column; gap: 12px;
    font: 13px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  }
  main.quiet { --line-color: var(--mint); }
  @media (prefers-color-scheme: light) {
    main { --panel: #f3f7f8; --ink: #11222f; --dim: #5d7280; --hair: rgba(17, 34, 47, 0.12); --teal: #0e7c86; --mint: #0e7c86; --amber: #c9761a; }
  }

  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .state { display: flex; flex-direction: column; min-width: 0; }
  .word { font: 600 22px/1.1 ui-rounded, "SF Pro Rounded", -apple-system, sans-serif; letter-spacing: -0.01em; }
  main.quiet .word { color: var(--mint); }
  .note { color: var(--dim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .switch { position: relative; flex: none; width: 46px; height: 28px; border-radius: 14px; border: 0; padding: 0; background: var(--hair); cursor: pointer; transition: background 0.18s; }
  .switch[aria-checked="true"] { background: var(--teal); }
  .knob { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); transition: transform 0.18s; }
  .switch[aria-checked="true"] .knob { transform: translateX(18px); }
  .switch:disabled { opacity: 0.4; cursor: default; }

  .timed { display: flex; gap: 14px; margin-top: -6px; }
  button.text { background: none; border: 0; padding: 0; font: inherit; color: var(--teal); cursor: pointer; }
  main.quiet button.text { color: var(--mint); }
  button.text.amber { color: var(--amber) !important; }
  button.text:disabled { color: var(--dim); opacity: 0.6; cursor: default; }
  button:focus-visible { outline: 2px solid var(--mint); outline-offset: 2px; border-radius: 4px; }

  .alert { margin: 0; font-size: 12px; color: var(--amber); }
  .alert.soft { color: var(--dim); }

  .hero { display: flex; flex-direction: column; gap: 4px; }
  .reading { display: flex; align-items: baseline; gap: 4px; }
  .ms { font: 600 44px/1 ui-rounded, "SF Pro Rounded", -apple-system, sans-serif; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .unit { color: var(--dim); font-size: 15px; }
  .to { margin-left: auto; color: var(--dim); font-size: 12px; }
  .facts { margin: 0; color: var(--dim); font-size: 12px; }

  .rows { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
  .rows div { display: flex; justify-content: space-between; gap: 8px; border-top: 1px solid var(--hair); padding-top: 6px; }

  .rows .wide { grid-column: 1 / -1; }
  dt { color: var(--dim); }
  dd { margin: 0; font-variant-numeric: tabular-nums; }

  .events p, .test p { margin: 0 0 3px; font-size: 12px; }
  .muted { color: var(--dim); }

  footer { display: flex; gap: 14px; border-top: 1px solid var(--hair); padding-top: 9px; font-size: 12px; }
  .spacer { flex: 1; }

  @media (prefers-reduced-motion: reduce) { .switch, .knob { transition: none; } }
</style>

<script lang="ts">
  import { app, call, tr } from "../../shared/state.svelte";

  let includeIds = $state(false);
  let message = $state("");

  async function exportIt() {
    message = tr("set.working");
    const path = await call<string>("exportDiagnostics", includeIds);
    message = tr("set.exported", { path });
  }

  async function cli() {
    const r = await call<{ ok: boolean; path?: string; error?: string }>("installCli");
    message = r.ok ? tr("set.cliDone", { path: r.path! }) : tr("set.failed", { error: r.error ?? "?" });
  }

  const sessions = $derived(app.view!.sessions);
</script>

<h1>{tr("set.data")}</h1>
<p class="muted">{tr("set.retention")}</p>

<h2>{tr("ui.sessions")}</h2>
{#if sessions.length}
  <ul class="list">
    {#each sessions as s (s.id)}
      <li>
        <span>{new Date(s.start).toLocaleString()} · {s.triggers.join(", ")}</span>
        <span class="muted small">{tr("ui.sessionLine", { dur: Math.max(1, Math.round((s.end - s.start) / 60_000)), p95: s.p95 ?? "—", cuts: s.interruptions, loss: s.lossPct })}</span>
      </li>
    {/each}
  </ul>
{:else}
  <p class="muted">{tr("ui.noSessions")}</p>
{/if}

<h2>{tr("set.export")}</h2>
<label class="row"><input type="checkbox" bind:checked={includeIds} /> {tr("set.includeIds")}</label>
<div class="row">
  <button onclick={exportIt}>{tr("set.export")}</button>
  <button onclick={cli}>{tr("set.cli")}</button>
  <button class="danger" onclick={() => { if (confirm(tr("set.clear") + "?")) { void call("clearData"); message = tr("set.cleared"); } }}>{tr("set.clear")}</button>
</div>
{#if message}<p class="muted" role="status">{message}</p>{/if}

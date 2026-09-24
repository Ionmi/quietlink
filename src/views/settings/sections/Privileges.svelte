<script lang="ts">
  import { call, tr } from "../../shared/state.svelte";
  import Group from "../ui/Group.svelte";
  import Row from "../ui/Row.svelte";

  let status = $state<{ installed: boolean; wardenRunning: boolean } | null>(null);
  let busy = $state(false);
  let message = $state("");
  let details = $state(false);

  const refresh = async () => (status = await call("privilegeStatus"));
  $effect(() => { void refresh(); });

  async function run(method: "installPrivilege" | "uninstallPrivilege") {
    busy = true;
    message = "";
    const r = await call<{ ok: boolean; error?: string }>(method);
    if (!r.ok) message = r.error === "cancelled" ? tr("s.cancelled") : tr("set.failed", { error: r.error ?? "?" });
    busy = false;
    await refresh();
  }
</script>

<h1 class="page-title">{tr("set.privileges")}</h1>
<p class="page-lede">{tr("s.privLede")}</p>

{#if status}
  <div class="hero" class:ok={status.installed}>
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
      {#if status.installed}
        <path d="M12 2.5 19.5 5.5v5.5c0 4.6-3.2 8.3-7.5 10-4.3-1.7-7.5-5.4-7.5-10V5.5zM8.5 12l2.4 2.4L15.8 9.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
      {:else}
        <path d="M12 2.5 19.5 5.5v5.5c0 4.6-3.2 8.3-7.5 10-4.3-1.7-7.5-5.4-7.5-10V5.5zM12 8v5M12 16.2h.01" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
      {/if}
    </svg>
    <div class="hero-text">
      <strong>{status.installed ? tr("s.privReady") : tr("s.privNeeded")}</strong>
      <span class="dim">{status.installed ? (status.wardenRunning ? tr("s.privReadyDetail") : tr("s.wardenStarting")) : tr("s.privNeededDetail")}</span>
    </div>
    {#if status.installed}
      <button class="btn danger" onclick={() => run("uninstallPrivilege")} disabled={busy}>{busy ? tr("set.working") : tr("s.remove")}</button>
    {:else}
      <button class="btn primary" onclick={() => run("installPrivilege")} disabled={busy}>{busy ? tr("set.working") : tr("s.allow")}</button>
    {/if}
  </div>
  {#if message}<p class="msg" role="status">{message}</p>{/if}
{/if}

<Group title={tr("s.allows")} note={tr("s.allowsNote")}>
  <Row title={tr("s.allowOff")} detail={tr("s.allowOffDetail")} />
  <Row title={tr("s.allowOn")} detail={tr("s.allowOnDetail")} />
  <Row title={tr("s.safety")} detail={tr("s.safetyDetail")} />
</Group>

<button class="link" onclick={() => (details = !details)} aria-expanded={details}>{details ? tr("s.hideDetails") : tr("s.showDetails")}</button>
{#if details}
  <p class="dim tech">{tr("s.techDetail")}</p>
  <p class="rule">&lt;you&gt; ALL=(root) NOPASSWD: /sbin/ifconfig awdl0 down, /sbin/ifconfig awdl0 up</p>
{/if}

<style>
  .hero { display: flex; align-items: center; gap: 14px; padding: 16px; margin-bottom: 22px; border-radius: 12px; background: var(--panel); border: 1px solid var(--hair); color: var(--amber); }
  .hero.ok { color: var(--mint); }
  .hero-text { flex: 1; display: flex; flex-direction: column; gap: 2px; color: var(--ink); }
  .hero-text strong { font-size: 15px; }
  .msg { margin: -12px 2px 18px; color: var(--amber); font-size: 12px; }
  .tech { margin: 10px 2px 6px; font-size: 12px; max-width: 60ch; }
  .rule { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--field); border: 1px solid var(--hair); font: 11px ui-monospace, "SF Mono", monospace; color: var(--dim); }
</style>

<script lang="ts">
  import { call, tr } from "../../shared/state.svelte";

  let status = $state<{ installed: boolean; wardenRunning: boolean } | null>(null);
  let busy = $state(false);
  let message = $state("");

  const refresh = async () => (status = await call("privilegeStatus"));
  $effect(() => { void refresh(); });

  async function run(method: "installPrivilege" | "uninstallPrivilege") {
    busy = true;
    message = tr("set.working");
    const r = await call<{ ok: boolean; error?: string }>(method);
    message = r.ok ? "" : tr("set.failed", { error: r.error ?? "?" });
    busy = false;
    await refresh();
  }
</script>

<h1>{tr("set.privileges")}</h1>
<p>{tr("set.privExplain")}</p>
<pre>{"<you> ALL=(root) NOPASSWD: /sbin/ifconfig awdl0 down, /sbin/ifconfig awdl0 up"}</pre>

<h2>{tr("set.privStatus")}</h2>
{#if status}
  <p><span class="badge" class:ok={status.installed}>{status.installed ? tr("set.privInstalled") : tr("set.privMissing")}</span>
    {#if status.wardenRunning} · {tr("set.wardenRunning")}{/if}</p>
{/if}
<div class="row">
  {#if status?.installed}
    <button onclick={() => run("uninstallPrivilege")} disabled={busy}>{tr("set.uninstall")}</button>
  {:else}
    <button class="primary" onclick={() => run("installPrivilege")} disabled={busy}>{tr("set.install")}</button>
  {/if}
</div>
{#if message}<p class="muted" role="status">{message}</p>{/if}

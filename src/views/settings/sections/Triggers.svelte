<script lang="ts">
  import { ruleFromApp, type TriggerRule } from "../../../domain/triggers";
  import { app, call, tr } from "../../shared/state.svelte";

  const s = $derived(app.view!.settings);
  let showUnverified = $state(false);
  let picking = $state(false);
  let apps = $state<{ name: string; path: string; bundle: string }[]>([]);
  let chosen = $state("");
  let scope = $state<"exe" | "app">("app");

  const visible = $derived(s.rules.filter((r) => r.verified || showUnverified || r.id.startsWith("custom:")));

  function save(rules: TriggerRule[]) {
    void call("updateSettings", { rules });
  }

  function toggle(rule: TriggerRule, enabled: boolean) {
    save(s.rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
  }

  async function openPicker() {
    apps = await call("listRunningApps");
    chosen = apps[0]?.path ?? "";
    picking = true;
  }

  function add() {
    const a = apps.find((x) => x.path === chosen);
    if (!a) return;
    save([...s.rules, ruleFromApp(a, scope, crypto.randomUUID())]);
    picking = false;
  }
</script>

<h1>{tr("set.triggers")}</h1>

<h2>{tr("set.presets")}</h2>
{#if visible.length === 0}<p class="muted small">{tr("set.noVerified")}</p>{/if}
<ul class="list">
  {#each visible as r (r.id)}
    <li>
      <label>
        <input type="checkbox" checked={r.enabled} disabled={!r.verified} onchange={(e) => toggle(r, e.currentTarget.checked)} />
        {r.label}
      </label>
      <span class="badge" class:ok={r.verified}>{r.verified ? tr("set.verified") : tr("set.unverified")}</span>
      {#if r.id.startsWith("custom:")}<button class="link" onclick={() => save(s.rules.filter((x) => x.id !== r.id))}>{tr("set.remove")}</button>{/if}
    </li>
  {/each}
</ul>
<label class="row"><input type="checkbox" bind:checked={showUnverified} /> {tr("set.showUnverified")}</label>

{#if picking}
  <div class="card">
    <select bind:value={chosen} aria-label={tr("set.addApp")}>
      {#each apps as a (a.path)}<option value={a.path}>{a.name} — {a.path.split("/").pop()}</option>{/each}
    </select>
    <label class="row"><input type="radio" bind:group={scope} value="app" /> {tr("set.wholeApp")}</label>
    <label class="row"><input type="radio" bind:group={scope} value="exe" /> {tr("set.thisExe")}</label>
    <div class="row"><button class="primary" onclick={add} disabled={!chosen}>{tr("set.addApp").replace("…", "")}</button><button onclick={() => (picking = false)}>✕</button></div>
  </div>
{:else}
  <button onclick={openPicker}>{tr("set.addApp")}</button>
{/if}

<h2>{tr("lease.input")}</h2>
<label class="row"><input type="checkbox" checked={s.inputTrigger} onchange={(e) => call("updateSettings", { inputTrigger: e.currentTarget.checked })} /> {tr("set.input")}</label>
<p class="muted small">{tr("set.inputHint")}</p>

<h2>{tr("set.grace", { n: Math.round(s.graceMs / 1000) })}</h2>
<input type="range" min="0" max="60" step="1" value={Math.round(s.graceMs / 1000)} aria-label={tr("set.grace", { n: Math.round(s.graceMs / 1000) })}
  onchange={(e) => call("updateSettings", { graceMs: Number(e.currentTarget.value) * 1000 })} />

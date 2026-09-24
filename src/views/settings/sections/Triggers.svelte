<script lang="ts">
  import { ruleFromApp, type TriggerRule } from "../../../domain/triggers";
  import { app, call, tr } from "../../shared/state.svelte";
  import Group from "../ui/Group.svelte";
  import Row from "../ui/Row.svelte";
  import Switch from "../ui/Switch.svelte";
  import AddApp from "./AddApp.svelte";

  const s = $derived(app.view!.settings);
  const games = $derived(s.rules.filter((r) => r.kind === "game" && !r.id.startsWith("custom:")));
  const calls = $derived(s.rules.filter((r) => r.kind === "call" && !r.id.startsWith("custom:")));
  const custom = $derived(s.rules.filter((r) => r.id.startsWith("custom:")));
  let adding = $state(false);
  let grace = $state(Math.round(app.view!.settings.graceMs / 1000));

  const save = (rules: TriggerRule[]) => call("updateSettings", { rules });
  const toggle = (rule: TriggerRule, enabled: boolean) => save(s.rules.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
  const tag = (r: TriggerRule) => (r.verified ? undefined : tr("s.untestedTag"));
</script>

<h1 class="page-title">{tr("set.triggers")}</h1>
<p class="page-lede">{tr("s.triggersLede")}</p>

<Group title={tr("s.games")} note={games.some((r) => !r.verified) ? tr("s.untestedNote") : undefined}>
  {#each games as r (r.id)}
    <Row title={r.label.replace(/ \(match\)$/, "")} tag={tag(r)}>
      <Switch checked={r.enabled} label={r.label} onchange={(v) => toggle(r, v)} />
    </Row>
  {/each}
</Group>

<Group title={tr("s.calls")} note={tr("s.callsNote")}>
  {#each calls as r (r.id)}
    <Row title={r.label.replace(/ \(.*\)$/, "")} tag={tag(r)}>
      <Switch checked={r.enabled} label={r.label} onchange={(v) => toggle(r, v)} />
    </Row>
  {/each}
  <Row title={tr("s.anyMic")} detail={tr("set.inputHint")}>
    <Switch checked={s.inputTrigger} label={tr("s.anyMic")} onchange={(v) => call("updateSettings", { inputTrigger: v })} />
  </Row>
</Group>

<Group title={tr("s.yourApps")}>
  {#each custom as r (r.id)}
    <Row title={r.label} detail={r.match.bundlePrefix ? tr("s.wholeApp") : tr("s.onlyProcess")}>
      <Switch checked={r.enabled} label={r.label} onchange={(v) => toggle(r, v)} />
      <button class="link danger-link" onclick={() => save(s.rules.filter((x) => x.id !== r.id))}>{tr("set.remove")}</button>
    </Row>
  {/each}
  {#if adding}
    <AddApp onadd={(a, scope) => { save([...s.rules, ruleFromApp(a, scope, crypto.randomUUID())]); adding = false; }} oncancel={() => (adding = false)} />
  {:else}
    <Row title={custom.length ? tr("s.addAnother") : tr("s.noApps")}>
      <button class="btn" onclick={() => (adding = true)}>{tr("s.addApp")}</button>
    </Row>
  {/if}
</Group>

<Group title={tr("s.after")}>
  <Row title={tr("s.graceTitle")} detail={tr("s.graceDetail")}>
    <input type="range" min="0" max="60" step="5" bind:value={grace} aria-label={tr("s.graceTitle")} onchange={() => call("updateSettings", { graceMs: grace * 1000 })} />
    <span class="value">{grace} s</span>
  </Row>
</Group>

<style>
  .value { width: 36px; text-align: right; font-variant-numeric: tabular-nums; color: var(--dim); }
  .danger-link { color: var(--danger); }
</style>

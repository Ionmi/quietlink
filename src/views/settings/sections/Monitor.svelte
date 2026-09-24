<script lang="ts">
  import { app, call, tr } from "../../shared/state.svelte";
  import Group from "../ui/Group.svelte";
  import Row from "../ui/Row.svelte";
  import Switch from "../ui/Switch.svelte";

  const s = $derived(app.view!.settings);
  let external = $state(app.view!.settings.externalTarget ?? "");
  let hop = $state("");
  const valid = (x: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(x) && x.split(".").every((p) => Number(p) <= 255);
  const externalOk = $derived(external.trim() === "" || valid(external.trim()));
  const set = (p: object) => call("updateSettings", p);

  function addHop() {
    const h = hop.trim();
    if (!valid(h) || s.extraTargets.includes(h)) return;
    void set({ extraTargets: [...s.extraTargets, h] });
    hop = "";
  }
</script>

<h1 class="page-title">{tr("set.monitor")}</h1>
<p class="page-lede">{tr("s.monitorLede")}</p>

<Group title={tr("s.menuBar")}>
  <Row title={tr("s.showPing")} detail={tr("s.showPingDetail")}>
    <Switch checked={s.showPingInMenuBar} label={tr("s.showPing")} onchange={(v) => set({ showPingInMenuBar: v })} />
  </Row>
  <Row title={tr("s.showTraffic")} detail={tr("s.showTrafficDetail")}>
    <Switch checked={s.showTrafficInMenuBar} label={tr("s.showTraffic")} onchange={(v) => set({ showTrafficInMenuBar: v })} />
  </Row>
</Group>

<Group title={tr("s.probes")} note={tr("set.externalHint")}>
  <Row title={tr("s.external")} detail={externalOk ? tr("s.externalDetail") : tr("s.invalidIp")} tone={externalOk ? undefined : "warn"}>
    <input class="field" bind:value={external} placeholder="1.1.1.1" aria-invalid={!externalOk} aria-label={tr("s.external")}
      onchange={() => externalOk && set({ externalTarget: external.trim() || null })} />
  </Row>
  <Row title={tr("s.hops")} detail={tr("s.hopsDetail")}>
    <input class="field small" bind:value={hop} placeholder="192.168.1.148" aria-label={tr("s.hops")} onkeydown={(e) => e.key === "Enter" && addHop()} />
    <button class="btn" onclick={addHop} disabled={!valid(hop.trim())}>{tr("s.add")}</button>
  </Row>
  {#if s.extraTargets.length}
    <div class="chips">
      {#each s.extraTargets as h (h)}
        <span class="chip">{h}<button aria-label={`${tr("set.remove")} ${h}`} onclick={() => set({ extraTargets: s.extraTargets.filter((x) => x !== h) })}>×</button></span>
      {/each}
    </div>
  {/if}
</Group>

<Group title={tr("s.explainTitle")}>
  <Row title={tr("set.explain")} detail={tr("set.explainHint")}>
    <Switch checked={s.explainCuts} label={tr("set.explain")} onchange={(v) => set({ explainCuts: v })} />
  </Row>
</Group>

<style>
  .small { width: 140px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 12px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 4px 3px 10px; border-radius: 999px; background: var(--field); border: 1px solid var(--hair); font-variant-numeric: tabular-nums; }
  .chip button { border: 0; background: none; color: var(--dim); cursor: pointer; width: 18px; height: 18px; border-radius: 50%; }
  .chip button:hover { background: var(--hair); color: var(--ink); }
</style>

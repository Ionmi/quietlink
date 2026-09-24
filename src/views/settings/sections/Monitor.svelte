<script lang="ts">
  import { app, call, tr } from "../../shared/state.svelte";

  const s = $derived(app.view!.settings);
  let external = $state(app.view!.settings.externalTarget ?? "");
  let extra = $state(app.view!.settings.extraTargets.join(", "));
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const valid = (x: string) => ipv4.test(x) && x.split(".").every((p) => Number(p) <= 255);
  const extraList = $derived(extra.split(",").map((x) => x.trim()).filter(Boolean));
  const externalOk = $derived(external.trim() === "" || valid(external.trim()));
  const extraOk = $derived(extraList.every(valid));
</script>

<h1>{tr("set.monitor")}</h1>

<h2>{tr("set.external")}</h2>
<div class="row">
  <input type="text" bind:value={external} placeholder="1.1.1.1" aria-invalid={!externalOk} aria-label={tr("set.external")} />
  <button disabled={!externalOk} onclick={() => call("updateSettings", { externalTarget: external.trim() || null })}>OK</button>
</div>
<p class="muted small">{tr("set.externalHint")}</p>

<h2>{tr("set.extra")}</h2>
<div class="row">
  <input type="text" bind:value={extra} placeholder="192.168.1.148, 192.168.1.193" aria-invalid={!extraOk} aria-label={tr("set.extra")} />
  <button disabled={!extraOk} onclick={() => call("updateSettings", { extraTargets: extraList })}>OK</button>
</div>

<h2>{tr("ui.router")}</h2>
<label class="row"><input type="checkbox" checked={s.showPingInMenuBar} onchange={(e) => call("updateSettings", { showPingInMenuBar: e.currentTarget.checked })} /> {tr("set.menuPing")}</label>
<label class="row"><input type="checkbox" checked={s.showTrafficInMenuBar} onchange={(e) => call("updateSettings", { showTrafficInMenuBar: e.currentTarget.checked })} /> {tr("set.menuTraffic")}</label>

<h2>{tr("set.explain")}</h2>
<label class="row"><input type="checkbox" checked={s.explainCuts} onchange={(e) => call("updateSettings", { explainCuts: e.currentTarget.checked })} /> {tr("set.explain")}</label>
<p class="muted small">{tr("set.explainHint")}</p>

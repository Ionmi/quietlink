<script lang="ts">
  import { app, call, tr } from "../../shared/state.svelte";

  const s = $derived(app.view!.settings);
</script>

<h1>Quietlink</h1>
<p>{tr("set.support")}</p>

<h2>{tr("set.lang")}</h2>
<select value={s.lang} aria-label={tr("set.lang")} onchange={(e) => call("updateSettings", { lang: e.currentTarget.value })}>
  <option value="en">English</option>
  <option value="es">Español</option>
</select>

<h2>{tr("set.login")}</h2>
<label class="row"><input type="checkbox" checked={s.launchAtLogin} onchange={(e) => call("updateSettings", { launchAtLogin: e.currentTarget.checked })} /> {tr("set.login")}</label>

<p class="muted small">{tr("set.license")} · github.com/Ionmi/quietlink</p>

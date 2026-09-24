<script lang="ts">
  import { app, call, tr } from "../../shared/state.svelte";
  import Group from "../ui/Group.svelte";
  import Row from "../ui/Row.svelte";
  import Switch from "../ui/Switch.svelte";
  import Select from "../ui/Select.svelte";

  const s = $derived(app.view!.settings);
</script>

<div class="hero">
  <svg viewBox="0 0 1024 1024" width="72" height="72" aria-hidden="true">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#12355a" /><stop offset="1" stop-color="#0e7c86" /></linearGradient></defs>
    <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#g)" />
    <g fill="none" stroke="#fff" stroke-linecap="round" stroke-width="66"><path d="M305 538a270 270 0 0 1 414 0" /><path d="M397 616a150 150 0 0 1 230 0" /></g>
    <circle cx="512" cy="712" r="46" fill="#fff" />
    <path d="M770 232a120 120 0 1 0 112 163 96 96 0 1 1-112-163z" fill="#9ff3e6" />
  </svg>
  <div>
    <h1 class="page-title">Quietlink</h1>
    <p class="dim">{tr("s.tagline")}</p>
  </div>
</div>

<Group title={tr("s.general")}>
  <Row title={tr("set.login")}>
    <Switch checked={s.launchAtLogin} label={tr("set.login")} onchange={(v) => call("updateSettings", { launchAtLogin: v })} />
  </Row>
  <Row title={tr("set.lang")}>
    <Select value={s.lang} label={tr("set.lang")} options={[{ value: "en", label: "English" }, { value: "es", label: "Español" }]} onchange={(v) => call("updateSettings", { lang: v })} />
  </Row>
</Group>

<Group note={tr("set.support")}>
  <Row title={tr("s.version")}><span class="dim">0.1.0</span></Row>
  <Row title={tr("s.license")}><span class="dim">MIT</span></Row>
</Group>

<style>
  .hero { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
  .hero p { margin: 0; }
</style>

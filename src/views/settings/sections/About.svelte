<script lang="ts">
  import { app, call, tr } from "../../shared/state.svelte";
  import Group from "../ui/Group.svelte";
  import Row from "../ui/Row.svelte";
  import Switch from "../ui/Switch.svelte";
  import Select from "../ui/Select.svelte";

  const s = $derived(app.view!.settings);
</script>

<div class="hero">
  <svg viewBox="100 100 824 824" width="72" height="72" aria-hidden="true">
        <defs>
          <linearGradient id="ab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2a4a" /><stop offset="1" stop-color="#0c1426" /></linearGradient>
          <linearGradient id="abl" x1="200" y1="0" x2="824" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.35" /><stop offset="0.45" stop-color="#fff" /><stop offset="0.8" stop-color="#6aa8ff" /><stop offset="1" stop-color="#3b82f6" /></linearGradient>
        </defs>
        <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#ab)" />
        <path d="M200 600 L300 600 L350 330 L410 700 L455 520 L490 600 L824 600" fill="none" stroke="url(#abl)" stroke-width="62" stroke-linecap="round" stroke-linejoin="round" />
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

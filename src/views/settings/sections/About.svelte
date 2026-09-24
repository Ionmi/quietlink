<script lang="ts">
  import { app, call, tr } from "../../shared/state.svelte";
  import Group from "../ui/Group.svelte";
  import Row from "../ui/Row.svelte";
  import Switch from "../ui/Switch.svelte";
  import Select from "../ui/Select.svelte";

  const s = $derived(app.view!.settings);
  const updateLine = $derived.by(() => {
    const u = app.view!.update;
    if (u.install === "error") return tr("s.installFailed", { error: u.installError ?? "?" });
    if (u.available) return tr("s.updateAvailable", { v: u.available.version });
    if (u.status === "checking") return tr("s.checking");
    if (u.status === "up-to-date") return tr("s.upToDate");
    if (u.status === "error") return tr("s.checkFailed");
    return undefined;
  });
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
  <Row title={tr("s.version")} detail={updateLine}>
    <span class="dim">{app.view!.version}</span>
    {#if app.view!.update.available}
      <button class="btn primary" onclick={() => call("installUpdate")} disabled={app.view!.update.install === "downloading" || app.view!.update.install === "restarting"}>
        {app.view!.update.install === "downloading" ? tr("s.installing") : app.view!.update.install === "restarting" ? tr("s.restarting") : tr("s.installUpdate", { v: app.view!.update.available.version })}
      </button>
    {:else}
      <button class="btn" onclick={() => call("checkUpdates")} disabled={app.view!.update.status === "checking"}>{tr("s.checkNow")}</button>
    {/if}
  </Row>
  <Row title={tr("s.autoCheck")} detail={tr("s.autoCheckDetail")}>
    <Switch checked={s.checkForUpdates} label={tr("s.autoCheck")} onchange={(v) => call("updateSettings", { checkForUpdates: v })} />
  </Row>
  <Row title={tr("s.license")}><span class="dim">MIT</span></Row>
</Group>

<style>
  .hero { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
  .hero p { margin: 0; }
</style>

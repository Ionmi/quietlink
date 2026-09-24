<script lang="ts">
  import { app, call, tr } from "../../shared/state.svelte";
  import Group from "../ui/Group.svelte";
  import Row from "../ui/Row.svelte";
  import Switch from "../ui/Switch.svelte";

  let includeIds = $state(false);
  let exported = $state("");
  let cli = $state("");
  let confirmClear = $state(false);
  let cleared = $state(false);
  const sessions = $derived(app.view!.sessions);

  const fmtDate = (ts: number) => new Date(ts).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const mins = (a: number, b: number) => Math.max(1, Math.round((b - a) / 60_000));

  async function exportIt() {
    exported = tr("set.working");
    exported = tr("set.exported", { path: (await call<string>("exportDiagnostics", includeIds)).replace(/^\/Users\/[^/]+/, "~") });
  }
  async function installCli() {
    const r = await call<{ ok: boolean; path?: string; error?: string }>("installCli");
    cli = r.ok ? tr("set.cliDone", { path: r.path!.replace(/^\/Users\/[^/]+/, "~") }) : tr("set.failed", { error: r.error ?? "?" });
  }
  function clear() {
    if (!confirmClear) { confirmClear = true; setTimeout(() => (confirmClear = false), 4000); return; }
    void call("clearData");
    confirmClear = false;
    cleared = true;
  }
</script>

<h1 class="page-title">{tr("set.data")}</h1>
<p class="page-lede">{tr("set.retention")}</p>

<Group title={tr("ui.sessions")}>
  {#each sessions as s (s.id)}
    <Row title={s.triggers.join(", ") || tr("lease.manual")} detail={`${fmtDate(s.start)} · ${mins(s.start, s.end)} min`}>
      <span class="stat"><b>{s.p95 ?? "—"}</b> ms p95</span>
      <span class="stat" class:bad={s.interruptions > 0}><b>{s.interruptions}</b> {tr("s.cuts")}</span>
    </Row>
  {:else}
    <Row title={tr("ui.noSessions")} detail={tr("s.sessionsHint")} />
  {/each}
</Group>

<Group title={tr("s.share")}>
  <Row title={tr("set.export")} detail={exported || tr("s.exportDetail")}>
    <button class="btn" onclick={exportIt}>{tr("s.exportBtn")}</button>
  </Row>
  <Row title={tr("set.includeIds")} detail={tr("s.includeIdsDetail")}>
    <Switch checked={includeIds} label={tr("set.includeIds")} onchange={(v) => (includeIds = v)} />
  </Row>
  <Row title={tr("s.cliTitle")} detail={cli || tr("s.cliDetail")}>
    <button class="btn" onclick={installCli}>{tr("s.install")}</button>
  </Row>
</Group>

<Group>
  <Row title={tr("set.clear")} detail={cleared ? tr("set.cleared") : tr("s.clearDetail")}>
    <button class="btn danger" onclick={clear}>{confirmClear ? tr("s.confirmClear") : tr("s.clear")}</button>
  </Row>
</Group>

<style>
  .stat { color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }
  .stat b { color: var(--ink); font-weight: 600; }
  .stat.bad b { color: var(--amber); }
</style>

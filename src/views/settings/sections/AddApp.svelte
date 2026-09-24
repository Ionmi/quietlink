<script lang="ts">
  import { call, tr } from "../../shared/state.svelte";
  import Select from "../ui/Select.svelte";

  type Proc = { name: string; path: string; bundle: string };
  let { onadd, oncancel }: { onadd: (a: Proc, scope: "exe" | "app") => void; oncancel: () => void } = $props();

  let procs = $state<Proc[]>([]);
  let query = $state("");
  let picked = $state<string | null>(null);
  let scope = $state<"app" | "exe">("app");
  let exe = $state("");

  $effect(() => { void call<Proc[]>("listRunningApps").then((p) => (procs = p)); });

  // One entry per top-level app bundle; helpers are chosen in the second step.
  const top = (bundle: string) => bundle.slice(0, bundle.indexOf(".app") + 4);
  const bundles = $derived.by(() => {
    const m = new Map<string, { name: string; bundle: string }>();
    for (const p of procs) {
      const b = top(p.path);
      if (!m.has(b)) m.set(b, { name: b.split("/").pop()!.replace(/\.app$/, ""), bundle: b });
    }
    return [...m.values()].filter((x) => x.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  });
  const inBundle = $derived(procs.filter((p) => picked && p.path.startsWith(picked + "/")));

  function choose(b: string) {
    picked = b;
    exe = inBundle[0]?.path ?? procs.find((p) => p.path.startsWith(b + "/"))?.path ?? "";
  }
  function add() {
    if (!picked) return;
    const name = picked.split("/").pop()!.replace(/\.app$/, "");
    if (scope === "app") onadd({ name, path: picked, bundle: picked }, "app");
    else onadd({ name: exe.split("/").pop() ?? name, path: exe, bundle: picked }, "exe");
  }
</script>

<div class="sheet">
  {#if !picked}
    <input class="field search" placeholder={tr("s.search")} bind:value={query} aria-label={tr("s.search")} />
    <ul class="apps">
      {#each bundles as b (b.bundle)}
        <li><button onclick={() => choose(b.bundle)}><span>{b.name}</span><span class="dim path">{b.bundle.replace(/\/[^/]+$/, "")}</span></button></li>
      {:else}
        <li class="dim empty">{tr("s.noMatch")}</li>
      {/each}
    </ul>
    <div class="actions"><button class="btn" onclick={oncancel}>{tr("s.cancel")}</button></div>
  {:else}
    <p class="picked">{picked.split("/").pop()?.replace(/\.app$/, "")}</p>
    <div class="seg" role="radiogroup" aria-label={tr("s.scope")}>
      <button role="radio" aria-checked={scope === "app"} onclick={() => (scope = "app")}>{tr("s.wholeApp")}</button>
      <button role="radio" aria-checked={scope === "exe"} onclick={() => (scope = "exe")} disabled={inBundle.length < 2}>{tr("s.onlyProcess")}</button>
    </div>
    <p class="dim hint">{scope === "app" ? tr("s.wholeAppHint") : tr("s.onlyProcessHint")}</p>
    {#if scope === "exe"}
      <Select value={exe} label={tr("s.onlyProcess")} options={inBundle.map((p) => ({ value: p.path, label: p.path.split("/").pop()! }))} onchange={(v) => (exe = v)} />
    {/if}
    <div class="actions">
      <button class="btn" onclick={() => (picked = null)}>{tr("s.back")}</button>
      <button class="btn primary" onclick={add}>{tr("s.add")}</button>
    </div>
  {/if}
</div>

<style>
  .sheet { border-top: 1px solid var(--hair); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  .search { width: 100%; }
  .apps { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; border: 1px solid var(--hair); border-radius: 8px; }
  .apps li + li { border-top: 1px solid var(--hair); }
  .apps button { width: 100%; display: flex; justify-content: space-between; gap: 12px; background: none; border: 0; color: var(--ink); padding: 8px 10px; text-align: left; cursor: pointer; }
  .apps button:hover { background: var(--hair); }
  .path { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55%; }
  .empty { padding: 10px; }
  .picked { margin: 0; font-weight: 600; }
  .seg { display: inline-flex; align-self: flex-start; background: var(--field); border: 1px solid var(--hair); border-radius: 8px; padding: 2px; }
  .seg button { background: none; border: 0; color: var(--ink); padding: 4px 12px; border-radius: 6px; cursor: pointer; }
  .seg button[aria-checked="true"] { background: var(--teal); color: #fff; }
  .seg button:disabled { opacity: 0.4; cursor: default; }
  .hint { margin: 0; font-size: 12px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>

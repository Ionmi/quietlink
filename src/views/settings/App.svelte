<script lang="ts">
  import { app, connect, tr } from "../shared/state.svelte";
  import Triggers from "./sections/Triggers.svelte";
  import Monitor from "./sections/Monitor.svelte";
  import Privileges from "./sections/Privileges.svelte";
  import Data from "./sections/Data.svelte";
  import About from "./sections/About.svelte";

  $effect(() => connect());

  // Icon paths are 20×20, stroked.
  const tabs = [
    { id: "triggers", key: "set.triggers", icon: "M3 7.5h14v6a2 2 0 0 1-2 2h-2.5l-1.5-2h-2l-1.5 2H5a2 2 0 0 1-2-2zM6.5 10v2M5.5 11h2M13 10.5h.01M14.5 12h.01" },
    { id: "monitor", key: "set.monitor", icon: "M2.5 11h3l2-5 3 9 2.5-6 1.5 2h3" },
    { id: "privileges", key: "set.privileges", icon: "M10 2.5 16 5v4.5c0 3.7-2.6 6.7-6 8-3.4-1.3-6-4.3-6-8V5zM7.5 10l1.8 1.8L13 8" },
    { id: "data", key: "set.data", icon: "M4 5.5c0-1.1 2.7-2 6-2s6 .9 6 2-2.7 2-6 2-6-.9-6-2zm0 0v9c0 1.1 2.7 2 6 2s6-.9 6-2v-9M4 10c0 1.1 2.7 2 6 2s6-.9 6-2" },
    { id: "about", key: "set.about", icon: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 9v4.5M10 6.5h.01" },
  ] as const;
  let tab = $state<(typeof tabs)[number]["id"]>("triggers");
</script>

<div class="layout">
  <nav aria-label={tr("set.title")}>
    <div class="brand">
      <svg viewBox="100 100 824 824" width="24" height="24" aria-hidden="true">
        <defs>
          <linearGradient id="sb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2a4a" /><stop offset="1" stop-color="#0c1426" /></linearGradient>
          <linearGradient id="sbl" x1="200" y1="0" x2="824" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.35" /><stop offset="0.45" stop-color="#fff" /><stop offset="0.8" stop-color="#6aa8ff" /><stop offset="1" stop-color="#3b82f6" /></linearGradient>
        </defs>
        <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#sb)" />
        <path d="M200 600 L300 600 L350 330 L410 700 L455 520 L490 600 L824 600" fill="none" stroke="url(#sbl)" stroke-width="80" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>Quietlink</span>
    </div>
    {#each tabs as t (t.id)}
      <button class:active={tab === t.id} aria-current={tab === t.id ? "page" : undefined} onclick={() => (tab = t.id)}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d={t.icon} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        {tr(t.key)}
      </button>
    {/each}
  </nav>
  <main>
    <div class="drag"></div>
    <div class="content">
      {#if app.view}
        {#if tab === "triggers"}<Triggers />{/if}
        {#if tab === "monitor"}<Monitor />{/if}
        {#if tab === "privileges"}<Privileges />{/if}
        {#if tab === "data"}<Data />{/if}
        {#if tab === "about"}<About />{/if}
      {/if}
    </div>
  </main>
</div>

<style>
  .layout { display: grid; grid-template-columns: 200px 1fr; height: 100vh; }
  nav { background: var(--side); border-right: 1px solid var(--hair); padding: 44px 10px 10px; display: flex; flex-direction: column; gap: 2px; -webkit-app-region: drag; }
  nav > * { -webkit-app-region: no-drag; }
  .brand { display: flex; align-items: center; gap: 8px; padding: 0 10px 16px; font: 600 15px ui-rounded, "SF Pro Rounded", -apple-system, sans-serif; }
  nav button { display: flex; align-items: center; gap: 10px; background: none; border: 0; color: var(--ink); text-align: left; padding: 7px 10px; border-radius: 8px; cursor: pointer; }
  nav button svg { color: var(--dim); }
  nav button:hover { background: var(--hair); }
  nav button.active { background: var(--teal); color: #fff; }
  nav button.active svg { color: #fff; }
  nav button:focus-visible:not(.active) { outline: 2px solid var(--mint); outline-offset: 1px; }
  main { display: flex; flex-direction: column; min-width: 0; }
  .drag { height: 38px; flex: none; -webkit-app-region: drag; }
  .content { flex: 1; overflow-y: auto; padding: 0 32px 32px; }
</style>

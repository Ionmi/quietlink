<script lang="ts">
  import { app, connect, tr } from "../shared/state.svelte";
  import Triggers from "./sections/Triggers.svelte";
  import Monitor from "./sections/Monitor.svelte";
  import Privileges from "./sections/Privileges.svelte";
  import Data from "./sections/Data.svelte";
  import About from "./sections/About.svelte";

  $effect(() => connect());

  const tabs = [
    ["triggers", "set.triggers"],
    ["monitor", "set.monitor"],
    ["privileges", "set.privileges"],
    ["data", "set.data"],
    ["about", "set.about"],
  ] as const;
  let tab = $state<(typeof tabs)[number][0]>("triggers");
</script>

<div class="layout">
  <nav aria-label={tr("set.title")}>
    <div class="drag"></div>
    {#each tabs as [id, key] (id)}
      <button class:active={tab === id} aria-current={tab === id ? "page" : undefined} onclick={() => (tab = id)}>{tr(key)}</button>
    {/each}
  </nav>
  <div class="content">
    {#if app.view}
      {#if tab === "triggers"}<Triggers />{/if}
      {#if tab === "monitor"}<Monitor />{/if}
      {#if tab === "privileges"}<Privileges />{/if}
      {#if tab === "data"}<Data />{/if}
      {#if tab === "about"}<About />{/if}
    {/if}
  </div>
</div>

<style>
  .layout { display: grid; grid-template-columns: 180px 1fr; height: 100vh; }
  nav { background: var(--chip); padding: 10px; display: flex; flex-direction: column; gap: 2px; }
  .drag { height: 30px; -webkit-app-region: drag; }
  nav button { background: none; text-align: left; padding: 6px 10px; border-radius: 6px; }
  nav button.active { background: var(--accent); color: white; }
  .content { padding: 24px 28px; overflow-y: auto; }
</style>

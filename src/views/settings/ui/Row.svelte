<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, detail, tone, tag, children }: { title: string; detail?: string; tone?: "warn"; tag?: string; children?: Snippet } = $props();
</script>

<div class="row">
  <div class="text">
    <span class="title">{title}{#if tag}<span class="tag">{tag}</span>{/if}</span>
    {#if detail}<span class="detail" class:warn={tone === "warn"}>{detail}</span>{/if}
  </div>
  {#if children}<div class="control">{@render children()}</div>{/if}
</div>

<style>
  .row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 11px 14px; min-height: 44px; }
  .row + :global(.row) { border-top: 1px solid var(--hair); }
  .text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .title { color: var(--ink); display: flex; align-items: center; gap: 8px; }
  .tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; color: var(--dim); border: 1px solid var(--hair-strong); }
  .detail { color: var(--dim); font-size: 12px; line-height: 1.35; }
  .detail.warn { color: var(--amber); }
  .control { flex: none; display: flex; align-items: center; gap: 8px; }
</style>

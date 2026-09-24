<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, note, children }: { title?: string; note?: string; children: Snippet } = $props();
</script>

<section>
  {#if title}<h2>{title}</h2>{/if}
  <div class="panel">{@render children()}</div>
  {#if note}<p class="note">{note}</p>{/if}
</section>

<style>
  section { margin-bottom: 22px; }
  h2 { margin: 0 0 7px 2px; font-size: 13px; font-weight: 600; color: var(--ink); }
  .panel { background: var(--panel); border: 1px solid var(--hair); border-radius: 12px; overflow: visible; }
  .note { margin: 7px 2px 0; color: var(--dim); font-size: 12px; line-height: 1.4; }
</style>

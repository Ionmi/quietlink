<script lang="ts" generics="T extends string">
  let { value, options, label, onchange }: { value: T; options: { value: T; label: string }[]; label: string; onchange: (v: T) => void } = $props();

  let open = $state(false);
  let active = $state(0);
  let root = $state<HTMLElement>();
  const current = $derived(options.find((o) => o.value === value)?.label ?? value);

  function show() {
    active = Math.max(0, options.findIndex((o) => o.value === value));
    open = true;
  }
  function pick(i: number) {
    open = false;
    if (options[i] && options[i].value !== value) onchange(options[i].value);
  }
  function key(e: KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); show(); return; }
    if (!open) return;
    if (e.key === "Escape") { open = false; e.preventDefault(); }
    else if (e.key === "ArrowDown") { active = Math.min(options.length - 1, active + 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); e.preventDefault(); }
    else if (e.key === "Enter" || e.key === " ") { pick(active); e.preventDefault(); }
  }
  $effect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (root && !root.contains(e.target as Node)) open = false; };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  });
</script>

<div class="select" bind:this={root}>
  <button class="trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onclick={() => (open ? (open = false) : show())} onkeydown={key}>
    <span>{current}</span>
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>
  {#if open}
    <ul role="listbox" aria-label={label}>
      {#each options as o, i (o.value)}
        <li role="option" aria-selected={o.value === value} class:active={i === active} onmouseenter={() => (active = i)} onmousedown={(e) => { e.preventDefault(); pick(i); }}>
          <span class="tick">{o.value === value ? "✓" : ""}</span>{o.label}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .select { position: relative; }
  .trigger { display: inline-flex; align-items: center; gap: 10px; min-width: 140px; justify-content: space-between; padding: 5px 10px; border-radius: 7px; border: 1px solid var(--hair); background: var(--field); color: var(--ink); font: inherit; cursor: pointer; }
  .trigger:hover { border-color: var(--hair-strong); }
  .trigger:focus-visible { outline: 2px solid var(--mint); outline-offset: 2px; }
  svg { color: var(--dim); }
  ul { position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; min-width: 100%; margin: 0; padding: 4px; list-style: none; background: var(--raised); border: 1px solid var(--hair); border-radius: 9px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); }
  li { display: flex; align-items: center; gap: 6px; padding: 6px 10px 6px 6px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
  li.active { background: var(--teal); color: #fff; }
  .tick { width: 14px; text-align: center; font-size: 11px; }
</style>

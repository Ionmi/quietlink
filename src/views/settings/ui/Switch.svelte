<script lang="ts">
  let { checked, label, disabled = false, onchange }: { checked: boolean; label: string; disabled?: boolean; onchange: (v: boolean) => void } = $props();
</script>

<button class="switch" role="switch" aria-checked={checked} aria-label={label} {disabled} onclick={() => onchange(!checked)}>
  <span class="knob"></span>
</button>

<style>
  .switch { position: relative; flex: none; width: 38px; height: 22px; border-radius: 11px; border: 0; padding: 0; background: var(--track); cursor: pointer; transition: background 0.16s; }
  .switch[aria-checked="true"] { background: var(--teal); }
  .knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); transition: transform 0.16s; }
  .switch[aria-checked="true"] .knob { transform: translateX(16px); }
  .switch:disabled { opacity: 0.4; cursor: default; }
  .switch:focus-visible { outline: 2px solid var(--mint); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .switch, .knob { transition: none; } }
</style>

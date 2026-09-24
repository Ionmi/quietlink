<script lang="ts">
  let { points }: { points: { t: number; rtt: number | null }[] } = $props();

  const W = 320;
  const H = 44;
  const max = $derived(Math.max(20, ...points.map((p) => p.rtt ?? 0)));
  const step = $derived(points.length > 1 ? W / (points.length - 1) : W);
  const path = $derived(
    points
      .map((p, i) => (p.rtt === null ? null : `${(i * step).toFixed(1)},${(H - 2 - (p.rtt / max) * (H - 4)).toFixed(1)}`))
      .filter(Boolean)
      .join(" "),
  );
</script>

<svg viewBox="0 0 {W} {H}" width="100%" height={H} role="img" aria-label="Router latency, last 5 minutes">
  <line x1="0" x2={W} y1={H - 2} y2={H - 2} class="axis" />
  {#if path}<polyline points={path} class="line" />{/if}
  <text x={W - 2} y="10" text-anchor="end" class="label">{Math.round(max)} ms</text>
</svg>

<style>
  .axis { stroke: var(--line); stroke-width: 1; }
  .line { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-linejoin: round; }
  .label { fill: var(--muted); font-size: 9px; }
</style>

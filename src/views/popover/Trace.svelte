<script lang="ts">
  // Live router latency: the product's whole story. Spikes and losses are marked
  // in amber; everything else stays a calm line.
  let { points, spikeMs = 30 }: { points: { t: number; rtt: number | null }[]; spikeMs?: number } = $props();

  const W = 332;
  const H = 86;
  const PAD = 6;
  const top = $derived(Math.max(40, ...points.map((p) => p.rtt ?? 0)) * 1.1);
  const x = (i: number, n: number) => (n <= 1 ? W : (i / (n - 1)) * W);
  const y = (ms: number) => H - PAD - (Math.min(ms, top) / top) * (H - 2 * PAD);

  const segments = $derived.by(() => {
    const out: string[] = [];
    let cur: string[] = [];
    points.forEach((p, i) => {
      if (p.rtt === null) {
        if (cur.length) out.push(cur.join(" "));
        cur = [];
      } else cur.push(`${x(i, points.length).toFixed(1)},${y(p.rtt).toFixed(1)}`);
    });
    if (cur.length) out.push(cur.join(" "));
    return out;
  });
  const area = $derived(
    points.length > 1 ? `0,${H} ${points.map((p, i) => `${x(i, points.length).toFixed(1)},${y(p.rtt ?? 0).toFixed(1)}`).join(" ")} ${W},${H}` : "",
  );
  const spikes = $derived(points.map((p, i) => ({ p, i })).filter(({ p }) => p.rtt !== null && p.rtt > spikeMs));
  const losses = $derived(points.map((p, i) => ({ p, i })).filter(({ p }) => p.rtt === null));
  const guide = $derived(y(spikeMs));
</script>

<svg viewBox="0 0 {W} {H}" width="100%" height={H} role="img" aria-label="Router latency over the last minutes; {spikes.length} spikes, {losses.length} lost probes">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--line-color)" stop-opacity="0.28" />
      <stop offset="1" stop-color="var(--line-color)" stop-opacity="0" />
    </linearGradient>
  </defs>
  <line x1="0" x2={W} y1={guide} y2={guide} class="guide" />
  {#if area}<polygon points={area} fill="url(#fill)" />{/if}
  {#each segments as s, k (k)}<polyline points={s} class="line" />{/each}
  {#each spikes as { p, i } (i)}<circle cx={x(i, points.length)} cy={y(p.rtt!)} r="2.6" class="spike" />{/each}
  {#each losses as { i } (i)}<line x1={x(i, points.length)} x2={x(i, points.length)} y1={H - 14} y2={H} class="loss" />{/each}
</svg>

<style>
  svg { display: block; overflow: visible; }
  .guide { stroke: var(--hair); stroke-dasharray: 2 4; }
  .line { fill: none; stroke: var(--line-color); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
  .spike { fill: var(--amber); }
  .loss { stroke: var(--amber); stroke-width: 2; stroke-linecap: round; }
</style>

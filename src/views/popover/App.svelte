<script lang="ts">
  let reply = $state("…");
  $effect(() => {
    window.quietlink.call<string>("ping").then((r) => (reply = r));
  });
</script>

<main>
  <h1>Quietlink</h1>
  <p>bridge: {reply}</p>
  <button onclick={() => window.quietlink.call("openSettings")}>Settings</button>
</main>

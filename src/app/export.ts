import { redact } from "../domain/redact";
import type { AppView } from "./controller";
import type { EventRow, SecondRow } from "../adapters/telemetry-store";

type Ctx = { username: string; home: string; macos: string; version: string; gatewayIds: string[] };

const fmt = (v: number | null | undefined, unit = "") => (v === null || v === undefined ? "—" : `${Math.round(v * 10) / 10}${unit}`);

/** Markdown diagnostics. Identifiers are redacted unless explicitly included. */
export function buildReport(view: AppView, seconds: SecondRow[], ctx: Ctx, includeIdentifiers: boolean, events: EventRow[] = []): string {
  const w = view.wifi;
  const lost = seconds.reduce((a, r) => a + r.lost, 0);
  const got = seconds.reduce((a, r) => a + r.count, 0);
  const lines = [
    `# Quietlink diagnostics`,
    ``,
    `Quietlink ${ctx.version} · macOS ${ctx.macos} · generated ${new Date().toISOString()}`,
    ``,
    `## Status`,
    `- Quiet mode: ${view.phase}${view.because.length ? ` (${view.because.join(", ")})` : ""}`,
    `- Automation paused: ${view.paused ? "yes" : "no"}`,
    `- Privilege installed: ${view.privilege ? "yes" : "no"} · Warden healthy: ${view.wardenHealthy ? "yes" : "no"}${view.recovering ? " (recovering)" : ""}`,
    ``,
    `## Wi-Fi`,
    w ? `- ${w.band ?? "—"} GHz · channel ${w.channel ?? "—"} · ${w.widthMHz ?? "—"} MHz · RSSI ${fmt(w.rssi, " dBm")} · noise ${fmt(w.noise, " dBm")} · reported PHY rate ${fmt(w.phyRateMbps, " Mbps")}` : `- Not connected to Wi-Fi`,
    `- Router ${view.router ?? "—"}: last ${fmt(view.ping.gw, " ms")} · jitter ${fmt(view.jitter, " ms")} · loss ${fmt(view.lossPct, " %")} · late replies ${view.late}`,
    `- External probe ${view.settings.externalTarget ?? "off"}: last ${fmt(view.ping.ext, " ms")}`,
    ...view.settings.extraTargets.map((h) => `- Extra hop ${h}`),
    `- Band advice: ${view.advice.kind}`,
    ``,
    `## Last 24 h`,
    `- Router probe seconds recorded: ${seconds.length} · replies ${got} · lost ${lost}`,
    `- Interruptions logged: ${events.filter((e) => e.kind === "interruption").length || view.interruptionsLastHour}`,
    ``,
    `## Sessions`,
    ...(view.sessions.length
      ? view.sessions.map((s) => `- ${new Date(s.start).toISOString()} · ${Math.round((s.end - s.start) / 60_000)} min · ${s.triggers.join(", ")} · p50 ${fmt(s.p50, " ms")} · p95 ${fmt(s.p95, " ms")} · max ${fmt(s.max, " ms")} · interruptions ${s.interruptions} · loss ${s.lossPct} % · AWDL re-enables ${s.awdlReenables}`)
      : ["- none"]),
    ``,
    `## Events`,
    ...(view.lastEvents.length ? view.lastEvents.map((e) => `- ${new Date(e.ts).toISOString()} ${e.kind} ${e.text}${e.note ? ` — ${e.note}` : ""}`) : ["- none"]),
    ``,
    `Notes are coincidences in time, not causes.`,
    ``,
  ];
  const md = lines.join("\n");
  if (includeIdentifiers) return md;
  return redact(md, { username: ctx.username, home: ctx.home, targets: [view.settings.externalTarget ?? "", ...view.settings.extraTargets].filter(Boolean), gatewayIds: ctx.gatewayIds });
}

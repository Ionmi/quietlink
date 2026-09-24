import type { WifiLogEvent } from "./notes";
export { noteFor, type WifiLogEvent, type Note } from "./notes";

// Parsers are versioned: only macOS releases with fixtures in tests/fixtures are parsed.
const SUPPORTED = new Set([27]);

const HEAD = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}) \S+ (\w+)\[/;
const UNITS: Record<string, number> = {
  ms: 1, milliseconds: 1, milisegundos: 1,
  s: 1000, second: 1000, seconds: 1000, segundo: 1000, segundos: 1000,
};

export function parseLogLine(line: string, macosMajor: number): WifiLogEvent | null {
  if (!SUPPORTED.has(macosMajor)) return null;
  const h = HEAD.exec(line);
  if (!h) return null;
  const [, y, mo, d, hh, mm, ss, ms, proc] = h;
  const ts = new Date(+y, +mo - 1, +d, +hh, +mm, +ss, +ms).getTime();

  if (proc === "wifip2pd") {
    const start = /Infra scan started \(2\.4GHz: (\d+) 5GHz: (\d+)\)/.exec(line);
    if (start) return { ts, kind: "scan-start", bands: { g24: +start[1], g5: +start[2] } };
    const end = /Infra scan complete \(duration: (\d+) (\w+)\)/.exec(line);
    if (end && UNITS[end[2]] !== undefined) return { ts, kind: "scan-end", durationMs: +end[1] * UNITS[end[2]] };
    return null;
  }
  if (proc === "airportd") {
    if (/> AWDL started$/.test(line)) return { ts, kind: "awdl-start" };
    if (/> AWDL ended$/.test(line)) return { ts, kind: "awdl-end" };
  }
  return null;
}

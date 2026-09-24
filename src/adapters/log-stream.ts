import { parseLogLine, type WifiLogEvent } from "../domain/logparse";

const PREDICATE = '(process == "airportd" AND (eventMessage ENDSWITH "AWDL started" OR eventMessage ENDSWITH "AWDL ended")) OR (process == "wifip2pd" AND eventMessage CONTAINS "Infra scan")';

/** Experimental: streams a narrow slice of the unified log. Unknown lines are ignored. */
export class LogStream {
  private proc: ReturnType<typeof Bun.spawn> | null = null;

  constructor(private macosMajor: number) {}

  start(onEvent: (e: WifiLogEvent) => void) {
    if (this.proc) return;
    const p = Bun.spawn(["/usr/bin/log", "stream", "--style", "compact", "--predicate", PREDICATE], { stdout: "pipe", stderr: "ignore" });
    this.proc = p;
    void (async () => {
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of p.stdout as ReadableStream<Uint8Array>) {
        buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const e = parseLogLine(buf.slice(0, i), this.macosMajor);
          buf = buf.slice(i + 1);
          if (e) onEvent(e);
        }
      }
    })();
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
  }
}

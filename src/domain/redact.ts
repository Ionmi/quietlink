export type RedactContext = { username: string; home: string; targets: string[]; gatewayIds: string[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function redact(text: string, ctx: RedactContext): string {
  let out = text;
  for (const id of ctx.gatewayIds.filter(Boolean)) out = out.replaceAll(id, "<gateway>");
  for (const t of ctx.targets.filter(Boolean)) out = out.replace(new RegExp(`(?<![\\w.])${escape(t)}(?![\\w.])`, "g"), "<target>");
  if (ctx.home) out = out.replaceAll(ctx.home, "<home>");
  out = out.replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, "<mac>");
  out = out.replace(/(?<![\w:])(?=[0-9a-f:]*::|(?:[0-9a-f]{1,4}:){4,})[0-9a-f:]{2,}(?:%\w+)?(?![\w:])/gi, "<ipv6>");
  out = out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ipv4>");
  if (ctx.username) out = out.replace(new RegExp(`\\b${escape(ctx.username)}\\b`, "g"), "<user>");
  return out;
}

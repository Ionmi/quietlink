export type Lang = "en" | "es";

const en = {
  "quiet.because": "Quiet because: {name}",
  "quiet.on": "Quiet mode on",
  "quiet.off": "Quiet mode off",
  "restore.airdrop": "Restore AirDrop now",
  "airdrop.break": "Allow AirDrop for 2 min",
  "pause.automation": "Pause automation",
  "resume.automation": "Resume automation",
};

export type Key = keyof typeof en;

const es: Record<Key, string> = {
  "quiet.because": "Silencio por: {name}",
  "quiet.on": "Modo silencio activado",
  "quiet.off": "Modo silencio desactivado",
  "restore.airdrop": "Restaurar AirDrop ahora",
  "airdrop.break": "Permitir AirDrop 2 min",
  "pause.automation": "Pausar automatización",
  "resume.automation": "Reanudar automatización",
};

export const strings: Record<Lang, Record<Key, string>> = { en, es };

export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  return strings[lang][key].replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

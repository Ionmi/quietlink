export type Lang = "en" | "es";

const en = {
  "quiet.because": "Quiet because: {name}",
  "quiet.on": "Quiet mode on",
  "quiet.off": "Quiet mode off",
  "restore.airdrop": "Restore AirDrop now",
  "airdrop.break": "Allow AirDrop for 2 min",
  "pause.automation": "Pause automation",
  "resume.automation": "Resume automation",
  "note.scan-before": "A Wi-Fi scan was logged {ms} ms before this cut",
  "note.scan-during": "A Wi-Fi scan was logged {ms} ms into this cut",
  "note.awdl-before": "AWDL activity was logged {ms} ms before this cut",
  "note.awdl-during": "AWDL activity was logged {ms} ms into this cut",
  "note.channel-change": "The Wi-Fi channel changed near this cut",
  "note.none": "No logged Wi-Fi event near this cut",
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
  "note.scan-before": "Se registró un escaneo Wi-Fi {ms} ms antes de este corte",
  "note.scan-during": "Se registró un escaneo Wi-Fi {ms} ms después de empezar este corte",
  "note.awdl-before": "Se registró actividad AWDL {ms} ms antes de este corte",
  "note.awdl-during": "Se registró actividad AWDL {ms} ms después de empezar este corte",
  "note.channel-change": "El canal Wi-Fi cambió cerca de este corte",
  "note.none": "Ningún evento Wi-Fi registrado cerca de este corte",
};

export const strings: Record<Lang, Record<Key, string>> = { en, es };

export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  return strings[lang][key].replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

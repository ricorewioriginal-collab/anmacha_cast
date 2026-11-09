// Widgets für die eigene Website: Hörerbereich (komplett oder nur Wunschbox, Grüße, Sprachnachricht, Voting, Umfrage,
// Formular) und Player. Drei Wege, alle über die öffentliche API des AnMaCha-Cast-Servers (CORS offen, je Sender
// einzeln freigeschaltet):
//  1. direkte Adresse auf dem eigenen AnMaCha-Cast-Server (hoerer.html / widget.html mit Parametern),
//  2. Einbettung mit einer Zeile Code (iframe oder embed.js),
//  3. eine einzelne HTML-Datei zum Hochladen auf den eigenen Webspace – Seite und Skript stecken in der Datei, die Daten
//     kommen von der eingetragenen Server-Adresse.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from './model.ts';

export const WIDGET_KINDS: Record<string, { label: string; page: 'hoerer' | 'player'; only?: string; height: number }> = {
  hoerer: { label: 'Hörerbereich komplett', page: 'hoerer', height: 720 },
  requests: { label: 'Wunschbox (Musikwunsch + Wunschliste)', page: 'hoerer', only: 'requests', height: 640 },
  messages: { label: 'Grüße & Nachrichten', page: 'hoerer', only: 'messages', height: 520 },
  voice: { label: 'Sprachnachricht ans Studio', page: 'hoerer', only: 'voice', height: 480 },
  voting: { label: 'Song-Voting & Hörer-Charts', page: 'hoerer', only: 'voting', height: 640 },
  polls: { label: 'Umfrage', page: 'hoerer', only: 'polls', height: 420 },
  forms: { label: 'Formular (Gewinnspiel, Anmeldung)', page: 'hoerer', only: 'forms', height: 640 },
  player: { label: 'Player (Jetzt läuft)', page: 'player', height: 170 },
};

export interface WidgetOpts { kind: string; station: string; theme: 'dark' | 'light'; accent: string; api: string; lautfm?: string }

/** Eingaben prüfen: bekannte Art, Senderkennung, Farbe, Server-Adresse (nur http/https, ohne Pfad-Tricks). */
export function cleanWidgetOpts(input: Record<string, unknown>, station: string): WidgetOpts {
  const kind = String(input.kind ?? 'requests');
  if (!WIDGET_KINDS[kind]) throw new AppError(400, 'invalid_kind', 'Unbekanntes Widget');
  const accent = String(input.accent ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 6);
  let api = String(input.api ?? '').trim().replace(/\/+$/, '');
  if (api) {
    let u: URL;
    try { u = new URL(api); } catch { throw new AppError(400, 'invalid_api', 'Die Server-Adresse ist keine gültige Adresse (z. B. https://radio.example.de)'); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) throw new AppError(400, 'invalid_api', 'Die Server-Adresse muss mit http:// oder https:// beginnen');
    api = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  }
  const lautfm = typeof input.lautfm === 'string' && /^[a-z0-9_-]{1,60}$/i.test(input.lautfm) ? input.lautfm : undefined;
  return { kind, station, theme: input.theme === 'light' ? 'light' : 'dark', accent: accent.length === 3 || accent.length === 6 ? accent : '', api, lautfm };
}

function params(o: WidgetOpts, withApi: boolean): URLSearchParams {
  const k = WIDGET_KINDS[o.kind]!;
  const q = new URLSearchParams();
  if (k.page === 'player' && o.lautfm) q.set('lautfm', o.lautfm);
  else q.set(k.page === 'player' ? 'station' : 's', o.station);
  if (k.only) q.set('only', k.only);
  if (o.theme === 'light') q.set('theme', 'light');
  if (o.accent) q.set('accent', o.accent);
  if (withApi && o.api) q.set('api', o.api);
  return q;
}

/** Direkte Adresse, iframe- und Skript-Einbettung für einen Server mit der Adresse origin. */
export function widgetLinks(o: WidgetOpts, origin: string): { url: string; iframe: string; script: string; height: number } {
  const k = WIDGET_KINDS[o.kind]!;
  const url = `${origin}/${k.page === 'player' ? 'widget' : 'hoerer'}.html?${params(o, false)}`;
  const allow = k.page === 'hoerer' && (!k.only || k.only === 'voice') ? ' allow="microphone"' : '';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return {
    url,
    height: k.height,
    iframe: `<iframe src="${esc(url)}" style="width:100%;max-width:640px;height:${k.height}px;border:0" loading="lazy"${allow} title="${esc(k.label)}"></iframe>`,
    script: `<script src="${esc(origin)}/embed.js" data-station="${esc(o.station)}" data-widget="${esc(o.kind)}"${o.theme === 'light' ? ' data-theme="light"' : ''}${o.accent ? ` data-accent="${o.accent}"` : ''}${o.lautfm ? ` data-lautfm="${esc(o.lautfm)}"` : ''} async></script>`,
  };
}

/**
 * Eine einzelne HTML-Datei für den eigenen Webspace: die Seite des Widgets mit eingebettetem Skript und Einstellungen.
 * Sie ruft nur die öffentliche API unter o.api auf (dort muss der AnMaCha-Cast-Server erreichbar sein).
 */
export function widgetFile(studioDir: string, o: WidgetOpts): { name: string; html: string } {
  if (!o.api) throw new AppError(400, 'no_api', 'Bitte die öffentliche Adresse deines AnMaCha-Cast-Servers angeben – von dort holt die Datei ihre Daten');
  const k = WIDGET_KINDS[o.kind]!;
  const page = k.page === 'player' ? 'widget' : 'hoerer';
  let html = readFileSync(join(studioDir, `${page}.html`), 'utf8');
  const js = readFileSync(join(studioDir, 'js', `${page}.js`), 'utf8');
  const cfg: Record<string, string> = Object.fromEntries(params(o, true));
  // </script> im Code oder in den Einstellungen darf das eingebettete Skript nicht beenden
  const safe = (s: string) => s.replace(/<\/script/gi, '<\\/script');
  const inline = `<script>window.ANMACHA_CAST = ${safe(JSON.stringify(cfg))};</script>\n<script>\n${safe(js)}\n</script>`;
  html = html.replace(`<script src="js/${page}.js"></script>`, () => inline)
    .replace(/(href|src)="(icons\/[^"]+)"/g, (_, attr: string, p: string) => `${attr}="${o.api}/${p}"`)
    .replace('<head>', `<head>\n<!-- AnMaCha Cast Widget „${k.label}“ – Daten von ${o.api} (Sender ${o.station}). Einfach auf den eigenen Webspace hochladen. -->`);
  if (!html.includes('window.ANMACHA_CAST')) throw new AppError(500, 'template', 'Widget-Vorlage nicht gefunden');
  return { name: `anmacha-cast-${o.kind}.html`, html };
}

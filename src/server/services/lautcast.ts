// lautcast-Admin des laut.fm-Streamingservers (Forum „Neue lautcast-Features“, 09.11.2026): Status-Seite (Versatz,
// Live-Puffer, wartende Ansagen) und Ansage-Seite (Aufnahme/Datei, läuft nach dem aktuellen Song – auch während einer
// Live-Sendung). Beide melden sich mit den Live-Zugangsdaten an (Benutzer „source“, Live-Passwort der Station) – also
// genau denen, die AnMaCha Cast für den laut.fm-Encoder schon gespeichert hat. Das Passwort verlässt den Server nie.
//
// Der Aufbau beider Seiten ist nicht öffentlich dokumentiert. Deshalb wird nichts geraten: die Status-Seite wird so
// angezeigt, wie laut.fm sie liefert (JSON oder lesbarer Text), und für die Ansage wird das Upload-Formular der Seite
// jedes Mal eingelesen und genau so ausgefüllt (Ziel, Feldname der Datei, versteckte Felder).
//
// Sicherheit: Ziel ist ausschließlich https://<station>.stream.laut.fm (Station aus dem Mountpoint, siehe lautfmLinks);
// Formular-Ziele auf anderen Hosts werden abgelehnt, Weiterleitungen nicht verfolgt (Zugangsdaten bleiben bei laut.fm).

import { spawn } from 'node:child_process';
import type { AnMaChaCastApp } from '../app.ts';
import { lautfmLinks } from '../icecast.ts';
import { AppError } from '../model.ts';

const ANNOUNCE_EXT = ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'webm'] as const;
const MAX_ANNOUNCE = 40 * 1024 * 1024;

export interface LautcastStatus {
  url: string;
  checkedAt: number;
  /** JSON, wenn laut.fm JSON liefert */
  json?: unknown;
  /** sonst der lesbare Text der Seite */
  text?: string;
}

/** HTML in lesbaren Text (für die Anzeige im Studio – nie als HTML eingefügt). */
export function htmlToText(html: string, max = 4000): string {
  const text = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|dt|dd)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  return text.length > max ? `${text.slice(0, max)} …` : text;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

export interface UploadForm { action: string; method: string; fileField: string; fields: [string, string][] }

/** Upload-Formular der Ansage-Seite: das erste <form> mit einem Datei-Feld. */
export function findUploadForm(html: string, pageUrl: string): UploadForm | null {
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const [, formAttrs = '', body = ''] = m;
    const inputs = [...body.matchAll(/<input\b[^>]*>/gi)].map((x) => x[0]);
    const file = inputs.find((t) => (attr(t, 'type') ?? '').toLowerCase() === 'file' && attr(t, 'name'));
    if (!file) continue;
    const fields: [string, string][] = [];
    for (const t of inputs) {
      const type = (attr(t, 'type') ?? 'text').toLowerCase();
      const name = attr(t, 'name');
      if (!name || type === 'file' || type === 'submit' || type === 'button' || type === 'image' || type === 'reset') continue;
      if ((type === 'checkbox' || type === 'radio') && !/\schecked\b/i.test(t)) continue;
      fields.push([name, attr(t, 'value') ?? '']);
    }
    let action: URL;
    try { action = new URL(attr(formAttrs, 'action') || pageUrl, pageUrl); } catch { continue; }
    return { action: action.toString(), method: (attr(formAttrs, 'method') ?? 'post').toUpperCase(), fileField: attr(file, 'name')!, fields };
  }
  return null;
}

export class LautcastAdmin {
  /** Nur für Tests: andere Basis statt https://<station>.stream.laut.fm */
  baseOverride: ((station: string) => string) | null = null;

  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  private target(stationId: string, outputId: string, page: 'status' | 'announcement') {
    const o = this.app.outputOf(stationId, outputId);
    const links = lautfmLinks(o.cfg);
    if (!links) throw new AppError(400, 'not_lautfm', 'Das ist kein laut.fm-Encoder');
    const pass = this.app.secrets.get(o.cfg.passwordRef);
    if (!pass) throw new AppError(400, 'no_password', 'Für diesen Encoder ist kein Live-Passwort hinterlegt');
    const url = this.baseOverride ? `${this.baseOverride(links.station)}/admin/${page}/${links.station}` : links[page];
    return { url, auth: 'Basic ' + Buffer.from(`${o.cfg.username || 'source'}:${pass}`).toString('base64') };
  }

  private async fetchPage(url: string, auth: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { Authorization: auth, 'User-Agent': 'AnMaCha Cast', ...(init.headers ?? {}) } });
    } catch (e) {
      throw new AppError(502, 'lautfm_unreachable', `laut.fm-Streamingserver nicht erreichbar: ${(e as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new AppError(502, 'lautfm_auth', 'laut.fm hat die Live-Zugangsdaten abgelehnt – Live-Passwort im Encoder prüfen');
    return res;
  }

  /** Status-Seite: Versatz, Live-Puffer und wartende Ansagen – so, wie laut.fm sie liefert. */
  async status(stationId: string, outputId: string): Promise<LautcastStatus> {
    const { url, auth } = this.target(stationId, outputId, 'status');
    const res = await this.fetchPage(url, auth, { headers: { Accept: 'application/json, text/html;q=0.9, */*;q=0.5' } });
    if (!res.ok) throw new AppError(502, 'lautfm_status', `laut.fm-Status antwortete ${res.status}`);
    const body = (await res.text()).slice(0, 200_000);
    const type = res.headers.get('content-type') ?? '';
    if (/json/i.test(type) || /^\s*[[{]/.test(body)) {
      try { return { url, checkedAt: Date.now(), json: JSON.parse(body) }; } catch { /* doch kein JSON */ }
    }
    return { url, checkedAt: Date.now(), text: /<[a-z!]/i.test(body) ? htmlToText(body) : body.slice(0, 4000) };
  }

  /** In MP3 wandeln, ohne den Server zu blockieren (die Wiedergabe läuft im selben Prozess weiter). */
  private toMp3(audio: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.app.ffmpeg!.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '2', '-ar', '44100', '-b:a', '192k', '-f', 'mp3', 'pipe:1'], { windowsHide: true });
      const out: Buffer[] = [];
      let err = '';
      p.stdout.on('data', (d: Buffer) => out.push(d));
      p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      p.on('error', (e) => reject(new AppError(500, 'convert_failed', `MP3-Wandlung fehlgeschlagen: ${e.message}`)));
      p.on('close', (code) => (code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new AppError(400, 'convert_failed', `Die Aufnahme ließ sich nicht in MP3 wandeln: ${err.slice(0, 160)}`))));
      p.stdin.on('error', () => {});
      p.stdin.end(audio);
    });
  }

  /** Ansage hochladen: läuft nach dem aktuellen Song – auch während einer Live-Sendung (dann mit Zeitversatz). */
  async announce(stationId: string, outputId: string, data: Buffer, filename: string, actor: string): Promise<{ ok: true; message: string }> {
    const ext = (filename.split('.').pop() ?? '').toLowerCase();
    if (!(ANNOUNCE_EXT as readonly string[]).includes(ext)) throw new AppError(400, 'invalid_format', `Format ${ANNOUNCE_EXT.join(', ')}`);
    if (data.length < 1024) throw new AppError(400, 'empty', 'Die Ansage ist leer');
    if (data.length > MAX_ANNOUNCE) throw new AppError(413, 'too_large', 'Die Ansage ist zu groß (höchstens 40 MB)');
    const { url, auth } = this.target(stationId, outputId, 'announcement');
    // Aufnahmen (WAV, WebM …) als MP3 schicken – das nimmt laut.fm sicher an; ohne ffmpeg geht die Datei unverändert
    if (ext !== 'mp3' && this.app.ffmpeg?.ffmpeg) {
      data = await this.toMp3(data);
      filename = filename.replace(/\.[^.]+$/, '') + '.mp3';
    }
    const page = await this.fetchPage(url, auth, { headers: { Accept: 'text/html' } });
    if (!page.ok) throw new AppError(502, 'lautfm_announcement', `laut.fm-Ansage-Seite antwortete ${page.status}`);
    const form = findUploadForm(await page.text(), url);
    if (!form) throw new AppError(502, 'lautfm_form', 'Auf der laut.fm-Ansage-Seite wurde kein Upload-Formular gefunden – bitte die Seite direkt öffnen');
    if (new URL(form.action).origin !== new URL(url).origin) throw new AppError(502, 'lautfm_form', 'Das Ansage-Formular zeigt auf einen anderen Server – aus Sicherheitsgründen nicht gesendet');
    const outExt = (filename.split('.').pop() ?? '').toLowerCase();
    const fd = new FormData();
    for (const [k, v] of form.fields) fd.append(k, v);
    const mime = outExt === 'mp3' ? 'audio/mpeg' : outExt === 'wav' ? 'audio/wav' : outExt === 'm4a' || outExt === 'aac' ? 'audio/mp4' : `audio/${outExt}`;
    fd.append(form.fileField, new Blob([new Uint8Array(data)], { type: mime }), filename.replace(/[^\w.\- ]+/g, '_').slice(0, 80) || `ansage.${outExt}`);
    const res = await this.fetchPage(form.action, auth, { method: form.method === 'GET' ? 'POST' : form.method, body: fd });
    const answer = htmlToText(await res.text(), 600);
    if (res.status >= 400) throw new AppError(502, 'lautfm_announcement', `laut.fm hat die Ansage abgelehnt (${res.status})${answer ? `: ${answer}` : ''}`);
    this.app.audit.write({ kind: 'lautfm', event: 'lautcast_announcement', actor, stationId, outputId, bytes: data.length });
    return { ok: true, message: answer || 'Ansage an laut.fm übergeben – läuft nach dem aktuellen Song' };
  }
}

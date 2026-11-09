// Hörer-Interaktion: Musikwunsch, Grüße/Wunschbox, Song-Voting und Sprachnachricht ans Studio.
// (Idee aus dem AnMaCha-Hörerbereich, hier eigenständig und ohne Abhängigkeiten.)
//
// Sicherheit: Alles ist je Sender ausgeschaltet, bis es im Studio eingeschaltet wird. Öffentliche Aufrufe sind
// begrenzt (je Absender und Zeitraum), Texte werden als reiner Text gespeichert, IP-Adressen nur als flüchtiger
// Hash im Speicher geführt und nie abgelegt. Eingänge landen im Studio im Hörer-Posteingang.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnMaChaCastApp } from '../app.ts';
import { AppError, newId, type Principal } from '../model.ts';

export interface ListenerConfig {
  requests: boolean;
  messages: boolean;
  voting: boolean;
  voice: boolean;
  /** Hörer-Umfragen (Community-Dienst) */
  polls?: boolean;
  /** Formulare (Community-Dienst) */
  forms?: boolean;
  /** Begrüßungstext auf der Hörerseite */
  welcome?: string;
}

export interface InboxItem {
  id: string;
  kind: 'request' | 'message' | 'voice';
  at: number;
  status: 'new' | 'done';
  name?: string;
  text?: string;
  mediaId?: string;
  title?: string;
  /** Sprachnachricht: Dateiname im Hörer-Ordner */
  file?: string;
  contentType?: string;
  bytes?: number;
  /** laut.fm-Wunsch (KI-Programmchef, services/programmchef-hoerer.ts) */
  wishId?: string;
  /** Antwortadresse (Studiomail oder freiwillig auf der Hörerseite angegeben) */
  email?: string;
  /** Studiomail: Betreff und Message-ID der Hörer-Mail */
  subject?: string;
  messageId?: string;
  source?: 'web' | 'mail';
  /** Antworten aus dem Studio */
  replies?: { at: number; text: string; by: string }[];
}

/** E-Mail-Adresse prüfen (freiwillige Angabe auf der Hörerseite) */
export function cleanEmail(v: unknown): string | undefined {
  const e = String(v ?? '').trim().toLowerCase().slice(0, 200);
  return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/.test(e) ? e : undefined;
}

export const DEFAULT_LISTENER: ListenerConfig = { requests: false, messages: false, voting: false, voice: false };

const MAX_INBOX = 300;
const MAX_VOICE_FILES = 100;
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;
const VOICE_TYPES: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
/** Grenzen je Absender: [Anzahl, Zeitraum ms] */
const LIMITS: Record<string, [number, number]> = { wishvote: [20, 10 * 60_000], request: [3, 10 * 60_000], message: [3, 10 * 60_000], voice: [2, 60 * 60_000], search: [60, 60_000] };
const VOTE_WINDOW_MS = 12 * 3600_000;

/** Nur reiner Text, ohne Steuerzeichen, begrenzt */
function clean(v: unknown, max: number): string {
  return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export class ListenerService {
  private readonly app: AnMaChaCastApp;
  /** Salz nur für diesen Prozess – Hashes sind nach einem Neustart nicht mehr zuordenbar */
  private readonly salt = randomBytes(16);
  private readonly hits = new Map<string, number[]>();
  private readonly votes = new Map<string, number>();

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  who(ip: string): string {
    return createHash('sha256').update(this.salt).update(ip).digest('base64url').slice(0, 16);
  }

  limit(sid: string, kind: string, ip: string): void {
    const [n, win] = LIMITS[kind]!;
    const key = `${sid}:${kind}:${this.who(ip)}`;
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < win);
    if (list.length >= n) throw new AppError(429, 'rate_limited', 'Zu viele Anfragen – bitte später noch einmal');
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 20_000) this.hits.clear();
  }

  config(sid: string): ListenerConfig {
    return { ...DEFAULT_LISTENER, ...this.app.rt(sid).data.listener };
  }

  setConfig(p: Principal, sid: string, input: Record<string, unknown>): ListenerConfig {
    const cur = this.config(sid);
    const b = (k: keyof ListenerConfig) => (typeof input[k] === 'boolean' ? (input[k] as boolean) : !!cur[k]);
    const next: ListenerConfig = { requests: b('requests'), messages: b('messages'), voting: b('voting'), voice: b('voice'), polls: b('polls'), forms: b('forms'), welcome: typeof input.welcome === 'string' ? clean(input.welcome, 300) || undefined : cur.welcome };
    this.app.rt(sid).data.listener = next;
    this.app.audit.write({ kind: 'listener', event: 'config', actor: p.id, stationId: sid, ...next });
    this.app.changed();
    return next;
  }

  /** Öffentliche Sicht: nur, wenn der Sender öffentlich ist und mindestens eine Funktion an ist. */
  private publicStation(sid: string): { cfg: ListenerConfig; name: string } {
    const rt = this.app.stations.get(sid);
    const cfg = rt ? this.config(sid) : DEFAULT_LISTENER;
    if (!rt || rt.station.publicStatus === false || !(cfg.requests || cfg.messages || cfg.voting || cfg.voice || cfg.polls || cfg.forms)) {
      throw new AppError(404, 'not_found', 'Für diesen Sender ist der Hörerbereich nicht freigeschaltet');
    }
    return { cfg, name: rt.station.name };
  }

  /** Für andere Dienste (Umfragen, Formulare): Sender öffentlich und Funktion an, sonst 404/403. */
  requireFeature(sid: string, feature: 'polls' | 'forms'): void {
    this.need(sid, feature);
  }

  private need(sid: string, feature: keyof Omit<ListenerConfig, 'welcome'>): ListenerConfig {
    const { cfg } = this.publicStation(sid);
    if (!cfg[feature]) throw new AppError(403, 'disabled', 'Diese Funktion ist für den Sender ausgeschaltet');
    return cfg;
  }

  publicInfo(sid: string): unknown {
    const { cfg, name } = this.publicStation(sid);
    const s = this.app.rt(sid).station;
    // laut.fm-Sender mit Wunschstunde/„jederzeit wünschen“: Wünsche aus dem laut.fm-Pool, Abstimmen über die Wunschliste
    const lautfm = cfg.requests && this.app.svc.hoerer.accepting(sid);
    return { station: { id: sid, name, slogan: s.slogan, logo: s.logo ? `/api/v1/stations/${sid}/logo` : null, color: s.primaryColor }, requests: cfg.requests, messages: cfg.messages, voting: cfg.voting, voice: cfg.voice, polls: !!cfg.polls, forms: !!cfg.forms, welcome: cfg.welcome ?? '', lautfm, live: this.app.svc.hoerer.liveCached(sid)?.mode === 'cast' || this.app.svc.hoerer.liveCached(sid)?.mode === 'external' };
  }

  /** Musiktitel suchen (nur Titel/Interpret, höchstens 30); bei laut.fm-Wünschen im laut.fm-Pool. */
  async search(sid: string, q: string, ip: string): Promise<{ id: string; title: string; artist: string }[]> {
    const cfg = this.publicStation(sid).cfg;
    if (!cfg.requests && !cfg.voting) throw new AppError(403, 'disabled', 'Suche ist für den Sender ausgeschaltet');
    this.limit(sid, 'search', ip);
    const needle = clean(q, 80).toLowerCase();
    if (needle.length < 2) return [];
    if (cfg.requests && this.app.svc.hoerer.accepting(sid)) return this.app.svc.hoerer.poolSearch(sid, needle);
    return this.app.rt(sid).data.library
      .filter((m) => m.category === 'music' && `${m.artist} ${m.title}`.toLowerCase().includes(needle))
      .slice(0, 30)
      .map((m) => ({ id: m.id, title: m.title, artist: m.artist }));
  }

  private add(sid: string, item: Omit<InboxItem, 'id' | 'at' | 'status'>): InboxItem {
    const rt = this.app.rt(sid);
    const inbox = (rt.data.inbox ??= []);
    const full: InboxItem = { id: newId('in'), at: Date.now(), status: 'new', ...item };
    inbox.unshift(full);
    // Platz schaffen: erst erledigte, dann die ältesten Einträge
    while (inbox.length > MAX_INBOX) {
      const i = inbox.findLastIndex((x) => x.status === 'done');
      this.dropItem(sid, inbox.splice(i >= 0 ? i : inbox.length - 1, 1)[0]!);
    }
    this.app.changed();
    this.app.publish('inbox.new', sid, full);
    return full;
  }

  /** Wunsch über laut.fm (Titel-ID „lf:…“ aus der Pool-Suche): Wunschstunde/jederzeit, landet auch im Posteingang. */
  async requestLautfm(sid: string, ip: string, input: Record<string, unknown>): Promise<{ ok: true; mode: string; message: string }> {
    this.need(sid, 'requests');
    const id = Number(String(input.mediaId ?? '').slice(3));
    if (!Number.isInteger(id) || id <= 0) throw new AppError(404, 'not_found', 'Titel nicht gefunden');
    this.limit(sid, 'request', ip);
    const name = clean(input.name, 40);
    const text = clean(input.text, 300);
    const r = await this.app.svc.hoerer.addWish(sid, this.who(ip), id, name, text);
    this.add(sid, { kind: 'request', title: r.title, name: name || undefined, text: [r.mode === 'now' ? 'läuft gleich (laut.fm)' : r.mode === 'slot' ? 'in der Wunschstunde eingeplant' : 'wartet auf die Wunschstunde', text].filter(Boolean).join(' · '), wishId: r.wishId });
    return { ok: true, mode: r.mode, message: r.message };
  }

  request(sid: string, ip: string, input: Record<string, unknown>): { ok: true } {
    this.need(sid, 'requests');
    const m = this.app.rt(sid).data.library.find((x) => x.id === String(input.mediaId ?? '') && x.category === 'music');
    if (!m) throw new AppError(404, 'not_found', 'Titel nicht gefunden');
    this.limit(sid, 'request', ip);
    this.add(sid, { kind: 'request', mediaId: m.id, title: m.artist ? `${m.artist} – ${m.title}` : m.title, name: clean(input.name, 40) || undefined, text: clean(input.text, 300) || undefined });
    return { ok: true };
  }

  message(sid: string, ip: string, input: Record<string, unknown>): { ok: true } {
    this.need(sid, 'messages');
    const text = clean(input.text, 500);
    if (text.length < 2) throw new AppError(400, 'empty', 'Bitte eine Nachricht eingeben');
    this.limit(sid, 'message', ip);
    this.add(sid, { kind: 'message', name: clean(input.name, 40) || undefined, text, email: cleanEmail(input.email) });
    return { ok: true };
  }

  vote(sid: string, ip: string, input: Record<string, unknown>): { ok: true; score: number } {
    this.need(sid, 'voting');
    const rt = this.app.rt(sid);
    const m = rt.data.library.find((x) => x.id === String(input.mediaId ?? '') && x.category === 'music');
    if (!m) throw new AppError(404, 'not_found', 'Titel nicht gefunden');
    const key = `${sid}:${m.id}:${this.who(ip)}`;
    const now = Date.now();
    if (now - (this.votes.get(key) ?? 0) < VOTE_WINDOW_MS) throw new AppError(429, 'already_voted', 'Für diesen Titel hast du schon abgestimmt');
    this.votes.set(key, now);
    if (this.votes.size > 50_000) for (const [k, t] of this.votes) if (now - t > VOTE_WINDOW_MS) this.votes.delete(k);
    const v = ((rt.data.votes ??= {})[m.id] ??= { up: 0, down: 0 });
    if (input.up === false) v.down++;
    else v.up++;
    this.app.changed();
    return { ok: true, score: v.up - v.down };
  }

  charts(sid: string, limit = 20): { id: string; title: string; artist: string; up: number; down: number; score: number }[] {
    const lib = new Map(this.app.rt(sid).data.library.map((m) => [m.id, m]));
    return Object.entries(this.app.rt(sid).data.votes ?? {})
      .filter(([id]) => lib.has(id))
      .map(([id, v]) => ({ id, title: lib.get(id)!.title, artist: lib.get(id)!.artist, up: v.up, down: v.down, score: v.up - v.down }))
      .sort((a, b) => b.score - a.score || b.up - a.up)
      .slice(0, Math.max(1, Math.min(100, limit)));
  }

  publicCharts(sid: string): unknown {
    this.need(sid, 'voting');
    return this.charts(sid);
  }

  private voiceDir(sid: string): string {
    return join(this.app.dataDir, 'listener-voice', sid);
  }

  voice(sid: string, ip: string, contentType: string, data: Buffer, meta: { name?: unknown; text?: unknown; email?: unknown }): { ok: true } {
    this.need(sid, 'voice');
    const type = contentType.split(';')[0]!.trim().toLowerCase();
    const ext = VOICE_TYPES[type];
    if (!ext) throw new AppError(415, 'unsupported_media', 'Sprachnachricht als WebM, Ogg, MP3, M4A oder WAV senden');
    if (data.length < 1000) throw new AppError(400, 'too_short', 'Die Aufnahme ist zu kurz');
    if (data.length > MAX_VOICE_BYTES) throw new AppError(413, 'too_large', 'Höchstens 3 MB (etwa 2–3 Minuten)');
    this.limit(sid, 'voice', ip);
    const inbox = (this.app.rt(sid).data.inbox ??= []);
    // Speicher begrenzen: älteste Sprachnachrichten verwerfen
    const voices = inbox.filter((x) => x.kind === 'voice');
    for (const old of voices.slice(MAX_VOICE_FILES - 1)) {
      inbox.splice(inbox.indexOf(old), 1);
      this.dropItem(sid, old);
    }
    const dir = this.voiceDir(sid);
    mkdirSync(dir, { recursive: true });
    const file = `${newId('v')}.${ext}`;
    writeFileSync(join(dir, file), data);
    this.add(sid, { kind: 'voice', file, contentType: type, bytes: data.length, name: clean(meta.name, 40) || undefined, text: clean(meta.text, 300) || undefined, email: cleanEmail(meta.email) });
    return { ok: true };
  }

  /** Hörerpost aus der Studiomail (services/studiomail.ts): als Gruß/Nachricht oder – mit Audio-Anhang – als Sprachnachricht. */
  addMail(sid: string, m: { name: string; email: string; subject: string; messageId: string; text: string; audio?: { contentType: string; data: Buffer } }): InboxItem {
    const base = { name: clean(m.name, 40) || undefined, email: cleanEmail(m.email), subject: clean(m.subject, 200) || undefined, messageId: m.messageId.slice(0, 300) || undefined, source: 'mail' as const };
    const text = clean([m.subject && !/^(re|aw|fwd?|wg):/i.test(m.subject) ? m.subject : '', m.text].filter(Boolean).join(' – '), 500);
    const type = m.audio?.contentType.split(';')[0]!.trim().toLowerCase() ?? '';
    const ext = VOICE_TYPES[type] ?? '';
    if (m.audio && ext && m.audio.data.length >= 1000 && m.audio.data.length <= MAX_VOICE_BYTES) {
      const dir = this.voiceDir(sid);
      mkdirSync(dir, { recursive: true });
      const file = `${newId('v')}.${ext}`;
      writeFileSync(join(dir, file), m.audio.data);
      return this.add(sid, { kind: 'voice', file, contentType: type, bytes: m.audio.data.length, text: text || undefined, ...base });
    }
    return this.add(sid, { kind: 'message', text: text || '(ohne Text)', ...base });
  }

  /** Antwort im Eintrag vermerken (Versand über die Studiomail). */
  noteReply(sid: string, id: string, text: string, by: string): InboxItem {
    const item = (this.app.rt(sid).data.inbox ?? []).find((x) => x.id === id);
    if (!item) throw new AppError(404, 'not_found', 'Eintrag nicht gefunden');
    (item.replies ??= []).push({ at: Date.now(), text: text.slice(0, 5000), by });
    item.status = 'done';
    this.app.changed();
    this.app.publish('inbox.changed', sid, { id, action: 'reply' });
    return item;
  }

  private dropItem(sid: string, item: InboxItem): void {
    if (item.file) rmSync(join(this.voiceDir(sid), item.file), { force: true });
  }

  // ---------- Studio ----------

  inbox(sid: string): { items: InboxItem[]; unread: number; config: ListenerConfig; charts: unknown; lautfm: boolean } {
    const items = this.app.rt(sid).data.inbox ?? [];
    const lf = this.app.svc.lautfm.lautfmConfig(sid);
    return { items, unread: items.filter((x) => x.status === 'new').length, config: this.config(sid), charts: this.charts(sid, 10), lautfm: !!(lf.hasToken && lf.stationId) };
  }

  voiceFile(sid: string, id: string): { path: string; type: string } {
    const item = (this.app.rt(sid).data.inbox ?? []).find((x) => x.id === id && x.kind === 'voice');
    if (!item?.file) throw new AppError(404, 'not_found', 'Sprachnachricht nicht gefunden');
    const path = join(this.voiceDir(sid), item.file);
    if (!existsSync(path)) throw new AppError(404, 'not_found', 'Datei fehlt');
    return { path, type: item.contentType ?? 'audio/webm' };
  }

  /** queue: Wunsch/Sprachnachricht in die Queue · done: erledigt · delete: entfernen */
  action(p: Principal, sid: string, id: string, action: string): unknown {
    const rt = this.app.rt(sid);
    const inbox = rt.data.inbox ?? [];
    const item = inbox.find((x) => x.id === id);
    if (!item) throw new AppError(404, 'not_found', 'Eintrag nicht gefunden');
    if (action === 'delete') {
      inbox.splice(inbox.indexOf(item), 1);
      this.dropItem(sid, item);
    } else if (action === 'done') {
      item.status = 'done';
    } else if (action === 'queue') {
      let mediaId = item.mediaId;
      if (item.kind === 'voice') {
        // Sprachnachricht als Titel in die Bibliothek übernehmen (Kategorie Voicetrack, Ordner „Hörer“)
        const { path } = this.voiceFile(sid, id);
        const mid = newId('m');
        const file = `${mid}.${item.file!.split('.').pop()}`;
        copyFileSync(path, join(this.app.mediaDir, sid, file));
        this.app.svc.media.addMedia(sid, {
          id: mid, title: `Hörer: ${item.name ?? 'Sprachnachricht'}`.slice(0, 200), artist: '', category: 'voice_track', file, durationMs: null, addedAt: Date.now(), folder: 'Hörer',
        });
        mediaId = mid;
      }
      if (!mediaId) throw new AppError(409, 'not_queueable', 'Dieser Eintrag lässt sich nicht in die Queue legen');
      this.app.queueAdd(sid, mediaId);
      item.status = 'done';
    } else throw new AppError(400, 'invalid_action', 'Aktion: queue, done oder delete');
    this.app.audit.write({ kind: 'listener', event: action, actor: p.id, stationId: sid, item: id, itemKind: item.kind });
    this.app.changed();
    this.app.publish('inbox.changed', sid, { id, action });
    return this.inbox(sid);
  }
}

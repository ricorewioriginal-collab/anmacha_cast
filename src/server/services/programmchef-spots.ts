// KI-Programmchef für laut.fm, Teil 2: Moderationen, Uhrzeit-Ansagen, Sender-Ansagen, Nachrichten/Wetter und die
// Sendeuhr – eigenständig in AnMaCha Cast (Port aus dem AnMaCha Control Center, ai-lautspots.php / ai-lautclock.php).
// Ablauf je Beitrag: Text (KI; Uhrzeit/Ansage auch ohne KI) → Stimme (KI-Sprachanbieter) → als PRIVATER Titel zu laut.fm
// hochladen → warten, bis laut.fm ihn verarbeitet hat → an die laut Sendeplan gerade laufende Playlist anhängen (laut.fm
// puffert ihn zum nächstmöglichen Zeitpunkt ein) → sobald er gelaufen ist (Beleg: tracks/stats/24h), aus der Playlist
// entfernen und bei laut.fm löschen. Nicht gelaufene Beiträge verfallen nach 24 Stunden.

import { spawnSync } from 'node:child_process';
import type { AnMaChaCastApp } from '../app.ts';
import { cleanSpeech, systemPrompt } from '../ai/director.ts';
import { AppError, newId, type Principal } from '../model.ts';
import { scheduleGrid } from '../programmchef/plan.ts';

export type SpotKind = 'moderation' | 'uhrzeit' | 'ansage' | 'nachrichten';

export const SPOT_KINDS: Record<SpotKind, string> = {
  moderation: 'Moderation (zum laufenden Programm)', uhrzeit: 'Uhrzeit-Ansage', ansage: 'Sender-Ansage (Station-ID)', nachrichten: 'Nachrichten & Wetter',
};

export interface SpotConfig {
  enabled: boolean;
  /** Moderationen/Ansagen je Stunde (0 = nur Sendeuhr) */
  perHour: number;
  kinds: SpotKind[];
  /** Sendezeit von/bis (volle Stunden, Ortszeit des Servers) */
  fromH: number;
  toH: number;
  /** höchstens so viele Beiträge gleichzeitig angehängt und noch nicht gelaufen */
  maxOpen: number;
  /** Text der Sender-Ansage (leer = KI formuliert aus Sendername/Slogan) */
  ansage: string;
  /** Sendeuhr: feste Minute je Stunde → Beitrag (z. B. :00 Nachrichten). Wird einige Minuten vorher erzeugt. */
  clock: { minute: number; kind: SpotKind }[];
}

/** Hörer-Beiträge (Teil 4): Gruß mit fertigem Text, Sprachnachricht mit fertiger Aufnahme */
export type ListenerSpotKind = 'gruss' | 'voicemail';

export interface Spot {
  id: string;
  kind: SpotKind | ListenerSpotKind;
  title: string;
  text: string;
  status: 'producing' | 'processing' | 'queued' | 'played' | 'expired' | 'failed';
  createdAt: number;
  trackId?: number;
  playlistId?: number;
  queuedAt?: number;
  doneAt?: number;
  error?: string;
  /** Sendeuhr-Eintrag „HH:MM“, damit er je Stunde nur einmal erzeugt wird */
  slot?: string;
}

export const DEFAULT_SPOTS: SpotConfig = { enabled: false, perHour: 1, kinds: ['moderation', 'uhrzeit'], fromH: 6, toH: 22, maxOpen: 2, ansage: '', clock: [] };

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
/** Sendeuhr-Beiträge so viele Minuten vorher erzeugen (TTS + Upload + Verarbeitung bei laut.fm) */
const LEAD_MIN = 4;

/** Konfiguration prüfen und begrenzen. */
export function cleanSpotConfig(input: Record<string, unknown>, cur: SpotConfig): SpotConfig {
  const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
  const kinds = Array.isArray(input.kinds) ? (input.kinds.filter((k) => typeof k === 'string' && k in SPOT_KINDS) as SpotKind[]) : cur.kinds;
  const clock = Array.isArray(input.clock)
    ? (input.clock as { minute?: unknown; kind?: unknown }[]).filter((c) => c && typeof c.kind === 'string' && c.kind in SPOT_KINDS).slice(0, 12)
      .map((c) => ({ minute: int(c.minute, 0, 59, 0), kind: c.kind as SpotKind }))
    : cur.clock;
  const fromH = int(input.fromH, 0, 23, cur.fromH);
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : cur.enabled,
    perHour: int(input.perHour, 0, 6, cur.perHour),
    kinds: [...new Set(kinds)],
    fromH,
    toH: Math.max(fromH + 1, int(input.toH, 1, 24, cur.toH)),
    maxOpen: int(input.maxOpen, 1, 6, cur.maxOpen),
    ansage: typeof input.ansage === 'string' ? input.ansage.trim().slice(0, 400) : cur.ansage,
    clock: [...new Map(clock.map((c) => [c.minute, c])).values()].sort((a, b) => a.minute - b.minute),
  };
}

/** Uhrzeit als gesprochener Text („Es ist 14 Uhr 30“, volle Stunde „Es ist 15 Uhr“). */
export function spokenTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `Es ist ${h} Uhr.` : `Es ist ${h} Uhr ${m}.`;
}

/** Welche Sendeuhr-Beiträge jetzt zu erzeugen sind (je Stunde und Minute einmal): Ziel liegt LEAD_MIN Minuten voraus. */
export function dueClockSlots(clock: SpotConfig['clock'], now: Date, done: Set<string>): { slot: string; kind: SpotKind; at: Date }[] {
  const out: { slot: string; kind: SpotKind; at: Date }[] = [];
  for (const c of clock) {
    const at = new Date(now);
    at.setSeconds(0, 0);
    at.setMinutes(c.minute);
    if (at.getTime() <= now.getTime()) at.setHours(at.getHours() + 1);
    const lead = (at.getTime() - now.getTime()) / 60_000;
    const slot = `${at.getDate()}-${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    if (lead <= LEAD_MIN && !done.has(slot)) out.push({ slot, kind: c.kind, at });
  }
  return out;
}

export class ProgrammchefSpots {
  private readonly app: AnMaChaCastApp;
  private readonly busy = new Set<string>();
  /** Takt der Verarbeitungs-Abfrage bei laut.fm (für Tests verkürzbar) */
  pollMs = 4000;
  now: () => Date = () => new Date();

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  private store(stationId: string): { spots?: SpotConfig; spotList?: Spot[] } {
    const d = this.app.rt(stationId).data as { programmchef?: { spots?: SpotConfig; spotList?: Spot[] } };
    return (d.programmchef ??= {});
  }

  config(stationId: string): SpotConfig {
    return { ...DEFAULT_SPOTS, ...this.store(stationId).spots };
  }

  view(stationId: string): unknown {
    const ai = this.app.svc.ai.aiConfig(stationId);
    return { config: this.config(stationId), kinds: SPOT_KINDS, spots: (this.store(stationId).spotList ?? []).slice(0, 40), voice: !!ai.voice.providerId, text: !!ai.text.providerId };
  }

  setConfig(p: Principal, stationId: string, input: Record<string, unknown>): unknown {
    const next = cleanSpotConfig(input, this.config(stationId));
    if (next.enabled) {
      this.lfId(stationId);
      if (!this.app.svc.ai.aiConfig(stationId).voice.providerId) throw new AppError(400, 'no_voice', 'Für Moderationen zuerst unter „KI-Studio & Anbieter“ eine Stimme (Sprachanbieter) wählen');
    }
    this.store(stationId).spots = next;
    this.app.audit.write({ kind: 'lautfm', event: 'programmchef_spots', actor: p.id, stationId, enabled: next.enabled });
    this.app.changed();
    return this.view(stationId);
  }

  private lfId(stationId: string): number {
    const cfg = this.app.svc.lautfm.lautfmConfig(stationId);
    if (!cfg.hasToken || !cfg.stationId) throw new AppError(409, 'lautfm_not_connected', 'Zuerst unter „laut.fm verwalten“ mit laut.fm verbinden und die Station wählen');
    return cfg.stationId;
  }

  private async ra<T = unknown>(stationId: string, method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.app.svc.lautfm.radioadmin(stationId, method, `/stations/${this.lfId(stationId)}${path}`, body);
    if (r.status >= 200 && r.status < 300) return r.data as T;
    throw new AppError(r.status === 401 || r.status === 403 ? 409 : 502, 'lautfm_failed', `laut.fm antwortete ${r.status} (${method} ${path})`);
  }

  private list(stationId: string): Spot[] {
    return (this.store(stationId).spotList ??= []);
  }

  // ---------- Text ----------

  private async writeText(stationId: string, kind: SpotKind, cfg: SpotConfig): Promise<string> {
    const c = this.app.svc.ai.aiConfig(stationId);
    const st = this.app.rt(stationId).station;
    const now = this.now();
    if (kind === 'uhrzeit' && !c.text.providerId) return `${spokenTime(now)} Hier ist ${st.name}.`;
    if (kind === 'ansage' && cfg.ansage && !c.text.providerId) return cfg.ansage;
    if (!c.text.providerId) throw new Error('Für diesen Beitrag wird eine Text-KI gebraucht (KI-Studio & Anbieter)');
    const words = kind === 'nachrichten' ? c.maxWords * 3 : kind === 'moderation' ? c.maxWords : Math.min(c.maxWords, 30);
    let prompt: string;
    if (kind === 'nachrichten') {
      const news = await this.app.director.context(c, ['news']);
      if (!news.length) throw new Error('Keine Nachrichtenquelle eingerichtet oder erreichbar (KI-Studio → Quellen) – Nachrichten entfallen');
      const weather = await this.app.director.context(c, ['weather']);
      prompt = [`Anlass: Nachrichten zur vollen Stunde (${(now.getHours() + 1) % 24}:00 Uhr), ${WEEKDAYS[now.getDay()]}.`,
        'Fasse die wichtigsten 3 bis 5 Meldungen neutral und sachlich zusammen, danach kurz das Wetter, falls eine Wetterquelle vorliegt.', ...news, ...weather].join('\n\n');
    } else if (kind === 'moderation') {
      const song = await this.currentSong(stationId);
      const next = await this.ra<{ tracks?: { artist?: string; title?: string }[] }>(stationId, 'GET', '/current_playlist').then((r) => r.tracks?.[0]).catch(() => undefined);
      const extra = await this.app.director.context(c, ['weather', 'info']).catch(() => [] as string[]);
      prompt = [`Anlass: kurze Moderation zwischen zwei Titeln. Uhrzeit ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}, ${WEEKDAYS[now.getDay()]}.`,
        song ? `Gerade läuft: ${song}` : '', next?.title ? `Als Nächstes: ${next.artist ?? ''} – ${next.title}` : '', ...extra, 'Schreibe jetzt den Moderationstext.'].filter(Boolean).join('\n');
    } else if (kind === 'uhrzeit') {
      prompt = `Anlass: kurze Uhrzeit-Ansage. ${spokenTime(now)} Nenne die Uhrzeit und den Sender „${st.name}“ in einem lockeren, kurzen Satz (höchstens 20 Wörter).`;
    } else {
      prompt = `Anlass: kurze Sender-Ansage (Station-ID) für „${st.name}“${st.slogan ? `, Slogan „${st.slogan}“` : ''}.${cfg.ansage ? ` Vorgabe: ${cfg.ansage}` : ''} Ein bis zwei Sätze.`;
    }
    const r = await this.app.ai.text(stationId, `lautfm_${kind}`, [c.text, c.text.fallback], systemPrompt(c, st, words), prompt);
    return cleanSpeech(r.text, words);
  }

  private async currentSong(stationId: string): Promise<string> {
    const name = this.app.svc.lautfm.lautfmConfig(stationId).stationName;
    if (!name) return '';
    try {
      const s = (await this.app.svc.status.lautfmPublicStatus(name)) as { now?: { artist?: string; title?: string } | null } | null;
      return s?.now?.title ? `${s.now.artist ?? ''} – ${s.now.title}` : '';
    } catch {
      return '';
    }
  }

  // ---------- Erzeugen, hochladen, anhängen ----------

  /** WAV der Sprachausgabe für laut.fm in MP3 wandeln (laut.fm nimmt MP3). */
  private toMp3(audio: Buffer, ext: string): Buffer {
    if (ext === 'mp3') return audio;
    const ff = this.app.ffmpeg?.ffmpeg;
    if (!ff) throw new Error('ffmpeg fehlt – die Sprachausgabe (WAV) lässt sich nicht in MP3 wandeln');
    const r = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '2', '-ar', '44100', '-b:a', '192k', '-f', 'mp3', 'pipe:1'], { input: audio, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    if (r.status !== 0 || !r.stdout?.length) throw new Error(`MP3-Wandlung fehlgeschlagen: ${String(r.stderr ?? '').slice(0, 160)}`);
    return r.stdout;
  }

  /** Playlist, die laut Sendeplan gerade läuft (Stunde der Woche, Montag 0 Uhr = Slot 0), sonst die Basis-Playlist. */
  async scheduledNow(stationId: string): Promise<number> {
    const r = await this.ra<unknown>(stationId, 'GET', '/schedule');
    const s = (Array.isArray(r) ? r[0] : r) as { base_playlist_id?: number; entries?: { playlist_id: number; slot: number; duration: number }[] } | undefined;
    const now = this.now();
    const slot = ((now.getDay() + 6) % 7) * 24 + now.getHours();
    return scheduleGrid(s?.entries ?? [])[slot] || Number(s?.base_playlist_id ?? 0);
  }

  /** Einen Beitrag erzeugen und bei laut.fm einreihen. Läuft im Hintergrund; der Stand steht in der Beitragsliste. */
  produce(stationId: string, kind: SpotKind, slot?: string): Spot {
    this.lfId(stationId);
    if (!this.app.svc.ai.aiConfig(stationId).voice.providerId) throw new AppError(400, 'no_voice', 'Zuerst unter „KI-Studio & Anbieter“ eine Stimme (Sprachanbieter) wählen');
    const now = this.now();
    const spot: Spot = { id: newId('sp'), kind, title: `${kind === 'nachrichten' ? 'Nachrichten' : kind === 'uhrzeit' ? 'Uhrzeit' : kind === 'ansage' ? 'Sender-Ansage' : 'Moderation'} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, text: '', status: 'producing', createdAt: Date.now(), ...(slot ? { slot } : {}) };
    const list = this.list(stationId);
    list.unshift(spot);
    list.length = Math.min(list.length, 100);
    this.app.changed();
    void this.run(stationId, spot).catch((err) => {
      spot.status = 'failed';
      spot.error = (err as Error).message.slice(0, 300);
      this.app.changed();
    });
    return spot;
  }

  /**
   * Hörer-Beitrag einreihen (Teil 4): Gruß mit fertigem Text (wird gesprochen) oder Sprachnachricht mit fertiger
   * Aufnahme (wird zu MP3). Gleicher Weg wie die Moderationen: privat hochladen, anhängen, nach dem Abspielen löschen.
   */
  produceListener(stationId: string, kind: ListenerSpotKind, title: string, input: { text?: string; audio?: { data: Buffer; ext: string } }): Spot {
    this.lfId(stationId);
    if (!input.audio && !this.app.svc.ai.aiConfig(stationId).voice.providerId) throw new AppError(400, 'no_voice', 'Für gesprochene Grüße zuerst unter „KI-Studio & Anbieter“ eine Stimme (Sprachanbieter) wählen');
    const spot: Spot = { id: newId('sp'), kind, title: title.slice(0, 80), text: input.text ?? '', status: 'producing', createdAt: Date.now() };
    const list = this.list(stationId);
    list.unshift(spot);
    list.length = Math.min(list.length, 100);
    this.app.changed();
    void this.run(stationId, spot, input.audio).catch((err) => {
      spot.status = 'failed';
      spot.error = (err as Error).message.slice(0, 300);
      this.app.changed();
    });
    return spot;
  }

  private async run(stationId: string, spot: Spot, audio?: { data: Buffer; ext: string }): Promise<void> {
    const cfg = this.config(stationId);
    const c = this.app.svc.ai.aiConfig(stationId);
    let mp3: Buffer;
    if (audio) mp3 = this.toMp3(audio.data, audio.ext);
    else {
      if (spot.kind !== 'gruss') spot.text = await this.writeText(stationId, spot.kind as SpotKind, cfg);
      const speech = await this.app.ai.voice(stationId, `lautfm_${spot.kind}`, [c.voice, c.voice.fallback], spot.text);
      mp3 = this.toMp3(speech.audio, speech.ext);
    }
    // Schnappschuss der neuesten eigenen Titel-ID: der hochgeladene Titel bekommt erst nach der Verarbeitung eine echte ID
    const own = await this.ra<{ tracks?: { id: number }[] }>(stationId, 'GET', '/tracks?own=true&order=desc').catch(() => ({ tracks: [] }));
    const before = Number(own.tracks?.[0]?.id ?? 0);
    const form = new FormData();
    form.append('track', new Blob([new Uint8Array(mp3)], { type: 'audio/mpeg' }), `${spot.id}.mp3`);
    form.append('private', 'true');
    const up = await this.app.svc.lautfm.radioadminMultipart(stationId, `/stations/${this.lfId(stationId)}/tracks`, form);
    if (up.status < 200 || up.status >= 300) throw new Error(`Upload zu laut.fm fehlgeschlagen (${up.status})`);
    spot.status = 'processing';
    this.app.changed();
    let trackId = 0;
    const until = Date.now() + 120_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, this.pollMs));
      const r = await this.ra<{ tracks?: { id: number }[] }>(stationId, 'GET', '/tracks?own=true&order=desc').catch(() => ({ tracks: [] }));
      const newest = Number(r.tracks?.[0]?.id ?? 0);
      if (newest > before) { trackId = newest; break; }
    }
    if (!trackId) throw new Error('laut.fm hat den Beitrag nicht rechtzeitig verarbeitet – er wird nicht eingereiht');
    spot.trackId = trackId;
    await this.ra(stationId, 'PATCH', `/tracks/${trackId}`, { title: spot.title, artist: this.app.rt(stationId).station.name, type: 'jingle', private: true }).catch(() => undefined);
    const pid = await this.scheduledNow(stationId);
    if (!pid) throw new Error('Keine laufende Playlist laut Sendeplan gefunden (Basis-Playlist fehlt?)');
    await this.ra(stationId, 'POST', `/playlists/${pid}`, { track_id: trackId });
    spot.playlistId = pid;
    spot.status = 'queued';
    spot.queuedAt = Date.now();
    this.app.changed();
  }

  // ---------- Aufräumen & Takt ----------

  /** Gelaufene Beiträge (laut tracks/stats/24h) und verfallene (über 24 h) aus der Playlist nehmen und bei laut.fm löschen. */
  async cleanup(stationId: string): Promise<number> {
    const open = this.list(stationId).filter((s) => s.status === 'queued' && s.trackId);
    if (!open.length) return 0;
    const stats = await this.ra<unknown>(stationId, 'GET', '/tracks/stats/24h').catch(() => null);
    const played = new Set((Array.isArray(stats) ? stats : (stats as { tracks?: unknown[] } | null)?.tracks ?? []).map((t) => Number((t as { id?: number; track_id?: number }).id ?? (t as { track_id?: number }).track_id)));
    let n = 0;
    for (const s of open) {
      const gone = played.has(s.trackId!) ? 'played' : Date.now() - (s.queuedAt ?? s.createdAt) > 24 * 3600_000 ? 'expired' : null;
      if (!gone) continue;
      if (s.playlistId) await this.ra(stationId, 'DELETE', `/playlists/${s.playlistId}/entries/${s.trackId}`).catch(() => undefined);
      await this.ra(stationId, 'DELETE', `/tracks/${s.trackId}`).catch(() => undefined);
      s.status = gone;
      s.doneAt = Date.now();
      n++;
    }
    if (n) this.app.changed();
    return n;
  }

  /** Etwa minütlich: Sendeuhr-Beiträge rechtzeitig erzeugen, Moderationen nach Takt, Gelaufenes aufräumen. */
  async tick(stationId: string): Promise<void> {
    const cfg = this.config(stationId);
    const list = this.store(stationId).spotList ?? [];
    if (!cfg.enabled && !list.some((s) => s.status === 'queued')) return;
    if (this.busy.has(stationId)) return;
    this.busy.add(stationId);
    try {
      await this.cleanup(stationId).catch(() => 0);
      if (!cfg.enabled) return;
      // während einer Live-Sendung spielt laut.fm keine Playlist – nichts erzeugen (spart Stimme/KI)
      if ((await this.app.svc.hoerer.liveState(stationId).catch(() => ({ mode: 'automation' }))).mode !== 'automation') return;
      const now = this.now();
      const done = new Set(list.map((s) => s.slot).filter((x): x is string => !!x));
      for (const d of dueClockSlots(cfg.clock, now, done)) {
        const h = d.at.getHours();
        if (h >= cfg.fromH && h < cfg.toH) this.produce(stationId, d.kind, d.slot);
      }
      const h = now.getHours();
      if (cfg.perHour <= 0 || !cfg.kinds.length || h < cfg.fromH || h >= cfg.toH) return;
      const open = list.filter((s) => ['producing', 'processing', 'queued'].includes(s.status)).length;
      if (open >= cfg.maxOpen) return;
      const free = list.filter((s) => !s.slot && s.kind in SPOT_KINDS);
      const lastFree = free[0];
      if (lastFree && Date.now() - lastFree.createdAt < (60 / cfg.perHour) * 60_000) return;
      const kind = cfg.kinds[free.length % cfg.kinds.length]!;
      this.produce(stationId, kind);
    } finally {
      this.busy.delete(stationId);
    }
  }
}

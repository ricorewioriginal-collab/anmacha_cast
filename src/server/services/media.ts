// Medien: Bibliothek, Tags und Laufzeit, Lautheitsanalyse (EBU R128), URL-Streams, M3U, Cover,
// eingebundene Ordner (vorhandene Musiksammlung wird indiziert und überwacht statt kopiert).

import type { AnMaChaCastApp } from '../app.ts';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MEDIA_CATEGORIES, parseFileName, type MediaCategory, type MediaItem } from '../../core/automation.ts';
import { parseM3U, toM3U } from '../../core/scheduler.ts';
import { analyzeKey, analyzeTrack, probeMedia, type TrackAnalysis } from '../ffmpeg.ts';
import { AUDIO_FILE_RE, AppError, newId, type LinkedFolder } from '../model.ts';

const MAX_LINKED_FILES = 20_000;
const MAX_DEPTH = 8;
import { writeFileAtomic } from '../store.ts';

export const WAVE_BINS = 600;
const WAVE_RATE = 4000;

/** Datei dekodieren und in WAVE_BINS Spitzenwerte (0–100, wahrnehmungsnah gestaucht) einteilen. */
export function computePeaks(ffmpeg: string, file: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', String(WAVE_RATE), '-f', 's16le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const chunks: Buffer[] = [];
    let total = 0;
    p.stdout.on('data', (d: Buffer) => {
      chunks.push(d);
      total += d.length;
      // Schutz: mehr als 6 Stunden Audio ergeben keine sinnvollere Wellenform
      if (total > WAVE_RATE * 2 * 6 * 3600) p.kill();
    });
    const timer = setTimeout(() => p.kill(), 120_000);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', () => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      const n = buf.length >> 1;
      if (n === 0) return reject(new AppError(422, 'no_audio', 'Keine Audiodaten'));
      const peaks = new Array<number>(WAVE_BINS).fill(0);
      for (let b = 0; b < WAVE_BINS; b++) {
        const from = Math.floor((b * n) / WAVE_BINS);
        const to = Math.max(from + 1, Math.floor(((b + 1) * n) / WAVE_BINS));
        let max = 0;
        for (let i = from; i < to && i < n; i++) {
          const v = Math.abs(buf.readInt16LE(i * 2));
          if (v > max) max = v;
        }
        peaks[b] = Math.round(Math.pow(max / 32768, 0.6) * 100);
      }
      resolve(peaks);
    });
  });
}

export class MediaService {
  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  library(stationId: string): MediaItem[] {
    return this.app.rt(stationId).data.library;
  }

  media(stationId: string, id: string): MediaItem {
    const m = this.app.rt(stationId).data.library.find((x) => x.id === id);
    if (!m) throw new AppError(404, 'not_found', 'Medium nicht gefunden');
    return m;
  }

  mediaPath(stationId: string, m: MediaItem): string {
    if (m.url) return m.url;
    if (m.linkedPath) return m.linkedPath;
    return join(this.app.mediaDir, stationId, m.file);
  }

  addMedia(stationId: string, item: MediaItem): MediaItem {
    const rt = this.app.rt(stationId);
    rt.data.library.push(item);
    this.app.publish('library.changed', stationId, { added: item });
    this.app.changed();
    // Laufzeit und ID3-Tags serverseitig lesen (wichtig für Crossfade/Backtiming im Headless-Betrieb)
    const ffprobe = this.app.ffmpeg?.ffprobe;
    if (ffprobe && !item.url) {
      probeMedia(ffprobe, this.mediaPath(stationId, item)).then(({ durationMs, tags }) => {
        if (!rt.data.library.includes(item)) return;
        const patch: Record<string, unknown> = {};
        if (durationMs && item.durationMs == null) patch.durationMs = durationMs;
        if (tags.title) patch.title = tags.title;
        if (tags.artist) patch.artist = tags.artist;
        if (tags.bpm && item.bpm == null) patch.bpm = tags.bpm;
        if (tags.album) item.album = tags.album;
        if (tags.genre) item.genre = tags.genre;
        if (tags.year) item.year = tags.year;
        if (Object.keys(patch).length || tags.album || tags.genre || tags.year) this.updateMedia(stationId, item.id, patch);
      });
    }
    if (!item.url && !item.check) this.queueLoudness(stationId, item.id);
    return item;
  }

  readonly loudQueue: { stationId: string; id: string }[] = [];

  loudBusy = false;

  queueLoudness(stationId: string, id: string): void {
    if (!this.app.ffmpeg || this.loudQueue.some((x) => x.stationId === stationId && x.id === id)) return;
    this.loudQueue.push({ stationId, id });
    void this.runLoudness();
  }

  /** Alle noch nicht gemessenen Titel eines Senders einreihen. */
  analyzeLibrary(stationId: string, force = false): { queued: number } {
    if (!this.app.ffmpeg) throw new AppError(501, 'unsupported', 'Lautheitsanalyse benötigt ffmpeg');
    let queued = 0;
    for (const m of this.app.rt(stationId).data.library) {
      if (m.url || (!force && m.check)) continue;
      this.queueLoudness(stationId, m.id);
      queued++;
    }
    return { queued };
  }

  loudnessStatus(stationId: string): unknown {
    const lib = this.app.rt(stationId).data.library.filter((m) => !m.url);
    return { total: lib.length, measured: lib.filter((m) => m.check || m.lufs != null).length, warnings: lib.filter((m) => trackWarnings(m).length).length, pending: this.loudQueue.filter((x) => x.stationId === stationId).length, running: this.loudBusy };
  }

  async runLoudness(): Promise<void> {
    if (this.loudBusy || !this.app.ffmpeg) return;
    this.loudBusy = true;
    try {
      for (let job = this.loudQueue.shift(); job; job = this.loudQueue.shift()) {
        const rt = this.app.stations.get(job.stationId);
        const m = rt?.data.library.find((x) => x.id === job!.id);
        if (!m || m.url) continue;
        // Track-Check in einem Durchlauf: Lautheit, Stille am Anfang/Ende, Übersteuerung, Bitrate
        const r = await analyzeTrack(this.app.ffmpeg.ffmpeg, this.mediaPath(job.stationId, m));
        if (!r || !rt!.data.library.includes(m)) continue;
        // Tonart nur für Musik (Jingles/Sprache liefern keine sinnvolle Tonart); vor dem Übernehmen messen,
        // damit das Ergebnis in einem Schritt sichtbar wird
        const k = m.category === 'music' && !r.silent ? await analyzeKey(this.app.ffmpeg.ffmpeg, this.mediaPath(job.stationId, m)) : null;
        if (!rt!.data.library.includes(m)) continue;
        applyTrackCheck(m, r);
        if (k) { m.key = k.name; m.camelot = k.camelot; }
        this.app.publish('library.changed', job.stationId, { updated: m });
        this.app.changed();
      }
    } finally {
      this.loudBusy = false;
    }
  }


  updateMedia(stationId: string, id: string, patch: Record<string, unknown>): MediaItem {
    const m = this.media(stationId, id);
    if (typeof patch.title === 'string') m.title = patch.title.slice(0, 200);
    if (typeof patch.artist === 'string') m.artist = patch.artist.slice(0, 200);
    if (typeof patch.category === 'string' && (MEDIA_CATEGORIES as readonly string[]).includes(patch.category)) m.category = patch.category as MediaItem['category'];
    if (typeof patch.folder === 'string') m.folder = patch.folder.trim().slice(0, 80) || undefined;
    if (typeof patch.genre === 'string') m.genre = patch.genre.trim().slice(0, 80) || undefined;
    if (typeof patch.album === 'string') m.album = patch.album.trim().slice(0, 200) || undefined;
    if (typeof patch.key === 'string') { m.key = patch.key.trim().slice(0, 20) || undefined; if (!m.key) delete m.camelot; }
    if (typeof patch.camelot === 'string') m.camelot = patch.camelot.trim().slice(0, 4) || undefined;
    for (const k of ['durationMs', 'cueInMs', 'cueOutMs', 'segueMs', 'introMs', 'loopEndMs', 'bpm', 'gainDb', 'year'] as const) {
      const v = patch[k];
      if (v === null && k !== 'durationMs') delete m[k];
      else if (typeof v === 'number' && Number.isFinite(v) && (k === 'gainDb' || v >= 0)) m[k] = v;
    }
    if (patch.tags === null) delete m.tags;
    else if (Array.isArray(patch.tags)) {
      const tags = [...new Set(patch.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
      if (tags.length) m.tags = tags;
      else delete m.tags;
    }
    this.app.publish('library.changed', stationId, { updated: m });
    this.app.changed();
    return m;
  }

  removeMedia(stationId: string, id: string): void {
    const rt = this.app.rt(stationId);
    const m = this.media(stationId, id);
    rt.data.library = rt.data.library.filter((x) => x.id !== id);
    rt.queue.prune((mid) => mid !== id);
    for (const c of rt.data.cardwall) if (c.mediaId === id) c.mediaId = null;
    for (const pl of rt.data.playlists ?? []) pl.items = pl.items.filter((x) => x !== id);
    // eingebundene Dateien gehören dem Benutzer: nur aus der Bibliothek entfernen, nie löschen
    if (!m.url && !m.linkedPath) rmSync(this.mediaPath(stationId, m), { force: true });
    this.app.publish('library.changed', stationId, { removed: id });
    this.app.publishQueue(stationId);
    this.app.changed();
  }

  /** Billige Vorprüfung ohne ffmpeg: Cover kann es nur für Dateien geben und nicht, wenn zuvor „keins“ festgestellt wurde. */
  coverPossible(stationId: string, mediaId: string): boolean {
    const m = this.app.stations.get(stationId)?.data.library?.find((x) => x.id === mediaId);
    if (!m || m.url || !this.app.ffmpeg) return false;
    return !existsSync(join(this.app.dataDir, 'covers', stationId, `${m.id}.jpg.none`));
  }

  /** Cover-Bild aus der Audiodatei (eingebettetes Bild), zwischengespeichert. */
  async cover(stationId: string, mediaId: string): Promise<string | null> {
    const m = this.media(stationId, mediaId);
    if (m.url || !this.app.ffmpeg) return null;
    const dir = join(this.app.dataDir, 'covers', stationId);
    const file = join(dir, `${m.id}.jpg`);
    const none = `${file}.none`;
    if (existsSync(file)) return file;
    if (existsSync(none)) return null;
    mkdirSync(dir, { recursive: true });
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(this.app.ffmpeg!.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', this.mediaPath(stationId, m), '-an', '-frames:v', '1', '-vf', 'scale=300:300:force_original_aspect_ratio=increase,crop=300:300', file], { windowsHide: true });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0 && existsSync(file)));
      setTimeout(() => p.kill(), 15_000).unref();
    });
    if (!ok) {
      rmSync(file, { force: true });
      writeFileAtomic(none, '');
      return null;
    }
    return file;
  }

  private readonly waveJobs = new Map<string, Promise<number[]>>();

  /**
   * Wellenform für die Decks: WAVE_BINS Spitzenwerte (0–100) über die ganze Datei. Aus einer grob
   * heruntergerechneten Dekodierung (4 kHz mono), danach als kleine Datei zwischengespeichert.
   */
  async waveform(stationId: string, mediaId: string): Promise<number[]> {
    const m = this.media(stationId, mediaId);
    if (m.url) throw new AppError(400, 'stream', 'Streams haben keine Wellenform');
    if (!this.app.ffmpeg) throw new AppError(501, 'unsupported', 'Wellenform benötigt ffmpeg');
    const dir = join(this.app.dataDir, 'waveforms', stationId);
    const file = join(dir, `${m.id}.json`);
    if (existsSync(file)) {
      try {
        const cached = JSON.parse(readFileSync(file, 'utf8')) as number[];
        if (Array.isArray(cached) && cached.length === WAVE_BINS) return cached;
      } catch {
        // kaputte Zwischenspeicher-Datei: neu berechnen
      }
    }
    const key = `${stationId}/${m.id}`;
    let job = this.waveJobs.get(key);
    if (!job) {
      const ffmpeg = this.app.ffmpeg.ffmpeg;
      const path = this.mediaPath(stationId, m);
      job = computePeaks(ffmpeg, path).then((peaks) => {
        mkdirSync(dir, { recursive: true });
        writeFileAtomic(file, JSON.stringify(peaks));
        return peaks;
      }).finally(() => this.waveJobs.delete(key));
      this.waveJobs.set(key, job);
    }
    return job;
  }

  /** Test-/Austauschpunkt für die Online-Suche */
  fetchImpl: typeof fetch = (...a) => fetch(...a);

  /**
   * Track-TÜV: Tonart jetzt messen (braucht ffmpeg). Setzt key/camelot am Titel.
   */
  async analyzeKeyNow(stationId: string, id: string): Promise<MediaItem> {
    const m = this.media(stationId, id);
    if (!this.app.ffmpeg) throw new AppError(501, 'unsupported', 'Tonart-Analyse benötigt ffmpeg');
    if (m.url) throw new AppError(400, 'stream', 'Streams haben keine Tonart');
    const k = await analyzeKey(this.app.ffmpeg.ffmpeg, this.mediaPath(stationId, m));
    if (!k) throw new AppError(422, 'no_key', 'Keine Tonart erkennbar (Datei still oder nicht lesbar)');
    m.key = k.name;
    m.camelot = k.camelot;
    this.app.publish('library.changed', stationId, { updated: m });
    this.app.changed();
    return m;
  }

  /**
   * Online-Tag-/Cover-Suche (Track-TÜV): iTunes Search (Cover, Genre, Jahr) und MusicBrainz (Titel, Interpret,
   * Album, Jahr). Liefert Kandidaten, geändert wird erst mit applyLookup().
   */
  async lookupTags(stationId: string, id: string, q?: { artist?: string; title?: string }): Promise<LookupCandidate[]> {
    const m = this.media(stationId, id);
    const artist = (q?.artist ?? m.artist ?? '').trim();
    const title = (q?.title ?? m.title ?? '').trim();
    if (!artist && !title) throw new AppError(400, 'empty', 'Interpret oder Titel angeben');
    const out: LookupCandidate[] = [];
    const ua = { headers: { 'User-Agent': 'AnMaCha Cast/1.0 (https://ricorewi-radio.de)', Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) };
    try {
      const r = await this.fetchImpl(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`.trim())}&entity=song&limit=5&country=de`, ua);
      if (r.ok) {
        const j = (await r.json()) as { results?: { artistName?: string; trackName?: string; collectionName?: string; releaseDate?: string; primaryGenreName?: string; artworkUrl100?: string }[] };
        for (const it of j.results ?? []) {
          if (!it.trackName) continue;
          out.push({ source: 'itunes', title: it.trackName, artist: it.artistName ?? '', album: it.collectionName, year: it.releaseDate ? Number(it.releaseDate.slice(0, 4)) || undefined : undefined, genre: it.primaryGenreName, coverUrl: it.artworkUrl100?.replace('100x100bb', '600x600bb') });
        }
      }
    } catch { /* iTunes nicht erreichbar - MusicBrainz reicht */ }
    try {
      const mbQ = [artist ? `artist:"${artist.replace(/"/g, '')}"` : '', title ? `recording:"${title.replace(/"/g, '')}"` : ''].filter(Boolean).join(' AND ');
      const r = await this.fetchImpl(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(mbQ)}&limit=5&fmt=json`, ua);
      if (r.ok) {
        const j = (await r.json()) as { recordings?: { title?: string; 'artist-credit'?: { name?: string }[]; releases?: { id?: string; title?: string; date?: string }[] }[] };
        for (const rec of j.recordings ?? []) {
          if (!rec.title) continue;
          const rel = rec.releases?.[0];
          out.push({ source: 'musicbrainz', title: rec.title, artist: rec['artist-credit']?.[0]?.name ?? '', album: rel?.title, year: rel?.date ? Number(rel.date.slice(0, 4)) || undefined : undefined, coverUrl: rel?.id ? `https://coverartarchive.org/release/${rel.id}/front-500` : undefined });
        }
      }
    } catch { /* MusicBrainz nicht erreichbar */ }
    if (!out.length) throw new AppError(404, 'not_found', 'Online nichts gefunden (oder keine Internetverbindung)');
    // Dubletten (gleicher Interpret + Titel) zusammenfassen, iTunes-Treffer zuerst
    const seen = new Set<string>();
    return out.filter((c) => { const k = `${c.artist}|${c.title}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  /** Gewählten Kandidaten übernehmen: nur leere oder ausdrücklich freigegebene Felder, Cover herunterladen. */
  async applyLookup(stationId: string, id: string, c: Partial<LookupCandidate> & { overwrite?: boolean; cover?: boolean }): Promise<MediaItem> {
    const m = this.media(stationId, id);
    const set = (k: 'title' | 'artist' | 'album' | 'genre', v?: string) => { if (v && (c.overwrite || !m[k])) m[k] = v.slice(0, 200); };
    set('title', typeof c.title === 'string' ? c.title : undefined);
    set('artist', typeof c.artist === 'string' ? c.artist : undefined);
    set('album', typeof c.album === 'string' ? c.album : undefined);
    set('genre', typeof c.genre === 'string' ? c.genre : undefined);
    if (typeof c.year === 'number' && Number.isFinite(c.year) && (c.overwrite || !m.year)) m.year = Math.round(c.year);
    let coverSaved = false;
    if (c.cover !== false && typeof c.coverUrl === 'string' && /^https:\/\//.test(c.coverUrl)) {
      try {
        const r = await this.fetchImpl(c.coverUrl, { headers: { 'User-Agent': 'AnMaCha Cast/1.0 (https://ricorewi-radio.de)' }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
        const type = r.headers.get('content-type') ?? '';
        if (r.ok && /image\/(jpeg|png|webp)/.test(type)) coverSaved = await this.storeCover(stationId, m, Buffer.from(await r.arrayBuffer()), type);
      } catch { /* Cover optional */ }
    }
    this.app.audit.write({ kind: 'media', event: 'lookup_applied', stationId, mediaId: m.id, cover: coverSaved });
    this.app.publish('library.changed', stationId, { updated: m });
    this.app.changed();
    return m;
  }

  /** Cover-Bild speichern (JPEG direkt, PNG/WebP über ffmpeg nach 300×300 JPEG). false = ungültig oder zu groß. */
  async storeCover(stationId: string, m: MediaItem, data: Buffer, type: string): Promise<boolean> {
    if (data.length === 0 || data.length > 5 * 1024 * 1024 || !/image\/(jpeg|png|webp)/.test(type)) return false;
    const dir = join(this.app.dataDir, 'covers', stationId);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${m.id}.jpg`);
    if (this.app.ffmpeg && !/jpeg/.test(type)) {
      const tmp = join(dir, `${m.id}.dl`);
      writeFileSync(tmp, data);
      await new Promise<void>((resolve) => { const p = spawn(this.app.ffmpeg!.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-vf', 'scale=300:300:force_original_aspect_ratio=increase,crop=300:300', file], { windowsHide: true }); p.on('error', () => resolve()); p.on('close', () => resolve()); });
      rmSync(tmp, { force: true });
    } else if (/jpeg/.test(type)) {
      // nur echte JPEG-Daten (FF D8 FF) übernehmen
      if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) return false;
      writeFileSync(file, data);
    } else return false;
    rmSync(`${file}.none`, { force: true });
    return existsSync(file);
  }

  /** Eigenes Cover für einen Titel (Mediathek → Bearbeiten). */
  async setCover(stationId: string, id: string, data: Buffer, type: string): Promise<MediaItem> {
    const m = this.media(stationId, id);
    if (m.url) throw new AppError(400, 'stream', 'Streams haben kein Cover');
    if (!(await this.storeCover(stationId, m, data, type))) throw new AppError(400, 'invalid_image', 'Bitte ein JPEG-, PNG- oder WebP-Bild bis 5 MB wählen');
    this.app.audit.write({ kind: 'media', event: 'cover_set', stationId, mediaId: m.id });
    this.app.publish('library.changed', stationId, { updated: m });
    return m;
  }

  /** Cover entfernen (danach keins mehr anzeigen, auch nicht aus der Datei). */
  removeCover(stationId: string, id: string): MediaItem {
    const m = this.media(stationId, id);
    const file = join(this.app.dataDir, 'covers', stationId, `${m.id}.jpg`);
    rmSync(file, { force: true });
    mkdirSync(join(this.app.dataDir, 'covers', stationId), { recursive: true });
    writeFileAtomic(`${file}.none`, '');
    this.app.publish('library.changed', stationId, { updated: m });
    return m;
  }

  /** Track-TÜV-Bericht: Vorher (gemessen) / Nachher (nach Angleichung auf die Ziel-Lautheit) je Titel. */
  tuevReport(stationId: string): TuevRow[] {
    const rt = this.app.rt(stationId);
    const target = rt.data.playout?.loudness?.targetLufs ?? -16;
    return rt.data.library.filter((m) => !m.url).map((m) => {
      const gain = m.lufs != null ? Math.round((target - m.lufs) * 10) / 10 : null;
      const peakAfter = m.lufs != null && m.truePeakDb != null ? Math.round((m.truePeakDb + (gain ?? 0)) * 10) / 10 : null;
      return {
        id: m.id, title: m.title, artist: m.artist, category: m.category, durationMs: m.durationMs,
        lufs: m.lufs ?? null, truePeakDb: m.truePeakDb ?? null, gainDb: gain, lufsAfter: m.lufs != null ? target : null, peakAfterDb: peakAfter,
        limited: peakAfter != null && peakAfter > -1, key: m.key ?? null, camelot: m.camelot ?? null, bitrateKbps: m.check?.bitrateKbps ?? null,
        warnings: trackWarnings(m), checkedAt: m.check?.at ?? null,
      };
    });
  }

  tuevCsv(stationId: string): string {
    const f = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const n = (v: number | null) => (v == null ? '' : String(v).replace('.', ','));
    const lines = [['Titel', 'Interpret', 'Kategorie', 'Länge (s)', 'LUFS vorher', 'True Peak vorher (dBTP)', 'Gain (dB)', 'LUFS nachher', 'True Peak nachher (dBTP)', 'Limiter nötig', 'Tonart', 'Camelot', 'Bitrate (kbit/s)', 'Hinweise', 'Geprüft'].map(f).join(';')];
    for (const r of this.tuevReport(stationId)) {
      lines.push([r.title, r.artist, r.category, r.durationMs != null ? Math.round(r.durationMs / 1000) : '', n(r.lufs), n(r.truePeakDb), n(r.gainDb), n(r.lufsAfter), n(r.peakAfterDb), r.limited ? 'ja' : '', r.key ?? '', r.camelot ?? '', r.bitrateKbps ?? '', r.warnings.join(', '), r.checkedAt ? new Date(r.checkedAt).toLocaleString('de-DE') : ''].map(f).join(';'));
    }
    return lines.join('\r\n') + '\r\n';
  }

  folders(stationId: string): string[] {
    return [...new Set(this.app.rt(stationId).data.library.map((m) => m.folder ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  }

  /** Dateien im Medienordner des Senders, auf die kein Bibliothekseintrag mehr zeigt (z. B. nach unvollständigem Restore). */
  async orphanFiles(stationId: string): Promise<string[]> {
    const dir = join(this.app.mediaDir, stationId);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const known = new Set(this.app.rt(stationId).data.library.filter((m) => !m.url && !m.linkedPath).map((m) => m.file));
    return entries.filter((e) => e.isFile() && AUDIO_FILE_RE.test(e.name) && !known.has(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'de'));
  }

  /**
   * Bibliotheks-Integritätsprüfung: fehlende Dateien (in der DB, aber nicht auf der Platte) und
   * mögliche Duplikate (gleicher Interpret/Titel/Länge). Baut auf der bestehenden Bibliothek auf,
   * keine zweite Mediendatenbank.
   */
  async integrityCheck(stationId: string): Promise<{ missing: MediaItem[]; duplicates: MediaItem[][]; orphans: string[] }> {
    const lib = this.app.rt(stationId).data.library;
    const missing: MediaItem[] = [];
    const groups = new Map<string, MediaItem[]>();
    const norm = (x: string) => x.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    for (const m of lib) {
      if (!m.url && !existsSync(this.mediaPath(stationId, m))) {
        missing.push(m);
        continue;
      }
      if (m.durationMs == null) continue;
      const key = `${norm(m.artist)}|${norm(m.title)}|${Math.round(m.durationMs / 1000)}`;
      if (!key.trim().replace(/\|/g, '')) continue;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(m);
    }
    const duplicates = [...groups.values()].filter((g) => g.length > 1);
    return { missing, duplicates, orphans: await this.orphanFiles(stationId) };
  }

  /** Fehlenden Eintrag auf eine vorhandene, unbekannte Datei im Medienordner umbiegen (statt neu hochzuladen). */
  relinkMedia(stationId: string, id: string, file: string): MediaItem {
    const m = this.media(stationId, id);
    if (m.url) throw new AppError(400, 'invalid_media', 'URL-Medien können nicht neu verknüpft werden');
    const target = join(this.app.mediaDir, stationId, file);
    if (!existsSync(this.mediaPath(stationId, m))) {
      // nur tatsächlich fehlende Einträge dürfen umgebogen werden
    } else {
      throw new AppError(409, 'not_missing', 'Dieser Eintrag hat bereits eine gültige Datei');
    }
    if (!AUDIO_FILE_RE.test(file) || file.includes('/') || file.includes('\\') || !existsSync(target)) throw new AppError(400, 'invalid_file', 'Datei nicht im Medienordner gefunden');
    m.file = file;
    m.linkedPath = undefined;
    m.durationMs = null;
    m.check = undefined;
    m.lufs = undefined;
    m.truePeakDb = undefined;
    this.app.publish('library.changed', stationId, { updated: m });
    this.app.changed();
    this.app.audit.write({ kind: 'media', event: 'relinked', stationId, id, file });
    const ffprobe = this.app.ffmpeg?.ffprobe;
    if (ffprobe) probeMedia(ffprobe, this.mediaPath(stationId, m)).then(({ durationMs }) => {
      if (durationMs && this.app.rt(stationId).data.library.includes(m)) this.updateMedia(stationId, m.id, { durationMs });
    });
    this.queueLoudness(stationId, m.id);
    return m;
  }

  addUrlMedia(stationId: string, input: { url: string; title?: string; artist?: string; durationMs?: number; folder?: string }): MediaItem {
    const url = String(input.url ?? '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new AppError(400, 'invalid_url', 'Nur http(s)-URLs sind erlaubt');
    const existing = this.app.rt(stationId).data.library.find((m) => m.url === url);
    if (existing) return existing;
    const dur = typeof input.durationMs === 'number' && input.durationMs > 0 ? Math.round(input.durationMs) : null;
    return this.addMedia(stationId, {
      id: newId('m'), title: String(input.title || url).slice(0, 200), artist: String(input.artist ?? '').slice(0, 200),
      category: 'stream', file: '', url, durationMs: dur, cueOutMs: dur ?? undefined, addedAt: Date.now(), folder: input.folder,
    });
  }

  exportQueueM3U(stationId: string): string {
    const rt = this.app.rt(stationId);
    const lib = new Map(rt.data.library.map((m) => [m.id, m]));
    return toM3U(rt.queue.list().map((q) => lib.get(q.mediaId)).filter((m): m is MediaItem => !!m).map((m) => ({
      title: m.title, artist: m.artist, durationMs: m.durationMs, path: m.url ?? m.originalName ?? m.file,
    })));
  }

  /** M3U importieren: Einträge werden über Dateiname, "Interpret - Titel" oder URL der Bibliothek zugeordnet. */
  importM3U(stationId: string, text: string, target: { playlistName?: string }): { matched: number; missing: string[]; playlistId?: string } {
    const rt = this.app.rt(stationId);
    const norm = (x: string) => x.toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').replace(/\s+/g, ' ').trim();
    const byName = new Map<string, MediaItem>();
    for (const m of rt.data.library) {
      if (m.originalName) byName.set(norm(m.originalName), m);
      byName.set(norm(m.artist ? `${m.artist} - ${m.title}` : m.title), m);
      if (m.url) byName.set(m.url.toLowerCase(), m);
    }
    const ids: string[] = [];
    const missing: string[] = [];
    for (const e of parseM3U(text).slice(0, 5000)) {
      const base = e.path.replace(/^.*[\\/]/, '');
      let m = byName.get(e.path.toLowerCase()) ?? byName.get(norm(base)) ?? (e.title ? byName.get(norm(e.title)) : undefined);
      if (!m && /^https?:\/\//i.test(e.path)) m = this.addUrlMedia(stationId, { url: e.path, title: e.title, durationMs: e.durationMs });
      if (m) ids.push(m.id);
      else missing.push(e.title ?? base);
    }
    if (target.playlistName) {
      const pl = this.app.svc.planning.savePlaylist(stationId, null, { name: target.playlistName, items: ids });
      return { matched: ids.length, missing, playlistId: pl.id };
    }
    for (const id of ids) rt.queue.add(id, 'manual');
    this.app.publishQueue(stationId);
    return { matched: ids.length, missing };
  }

  // ---------- Eingebundene Ordner ----------

  linkedFolders(stationId: string): LinkedFolder[] {
    return this.app.rt(stationId).data.linkedFolders ?? [];
  }

  /** Vorhandenen Musikordner einbinden: Dateien bleiben, wo sie sind; AnMaCha Cast indiziert und überwacht sie. */
  async linkFolder(stationId: string, input: { path?: unknown; category?: unknown }): Promise<LinkedFolder> {
    const rt = this.app.rt(stationId);
    const raw = String(input.path ?? '').trim();
    if (!raw || !isAbsolute(raw)) throw new AppError(400, 'invalid_path', 'Vollständigen Ordnerpfad angeben (z. B. D:\\Musik oder /srv/musik)');
    const path = resolve(raw);
    let st;
    try {
      st = statSync(path);
    } catch {
      throw new AppError(400, 'not_found', 'Ordner nicht gefunden oder nicht lesbar');
    }
    if (!st.isDirectory()) throw new AppError(400, 'not_directory', 'Das ist kein Ordner');
    // der eigene Datenordner wird nicht eingebunden (Medien liegen dort bereits)
    const inside = (a: string, b: string) => a === b || a.startsWith(b + sep);
    if (inside(path, resolve(this.app.dataDir)) || inside(resolve(this.app.dataDir), path)) throw new AppError(400, 'invalid_path', 'Der AnMaCha-Cast-Datenordner kann nicht eingebunden werden');
    const list = (rt.data.linkedFolders ??= []);
    if (list.some((f) => inside(path, f.path) || inside(f.path, path))) throw new AppError(409, 'exists', 'Dieser Ordner (oder ein über-/untergeordneter) ist bereits eingebunden');
    const category = (MEDIA_CATEGORIES as readonly string[]).includes(String(input.category)) ? (input.category as MediaCategory) : 'music';
    const f: LinkedFolder = { path, category };
    list.push(f);
    this.app.changed();
    this.app.audit.write({ kind: 'media', event: 'folder_linked', stationId, path });
    await this.scanFolder(stationId, f);
    return f;
  }

  /** Einbindung lösen: Einträge verschwinden aus der Bibliothek, die Dateien bleiben unangetastet. */
  unlinkFolder(stationId: string, path: string): { removed: number } {
    const rt = this.app.rt(stationId);
    const f = (rt.data.linkedFolders ?? []).find((x) => x.path === path);
    if (!f) throw new AppError(404, 'not_found', 'Ordner ist nicht eingebunden');
    rt.data.linkedFolders = rt.data.linkedFolders!.filter((x) => x !== f);
    const gone = rt.data.library.filter((m) => m.source === `folder:${f.path}`).map((m) => m.id);
    for (const id of gone) this.removeMedia(stationId, id);
    this.app.changed();
    this.app.audit.write({ kind: 'media', event: 'folder_unlinked', stationId, path, removed: gone.length });
    return { removed: gone.length };
  }

  private scanning = false;

  /** Alle eingebundenen Ordner abgleichen (vom Takt des Kerns aufgerufen, nie parallel). */
  async scanLinked(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      for (const [sid, rt] of this.app.stations) for (const f of [...(rt.data.linkedFolders ?? [])]) await this.scanFolder(sid, f);
    } finally {
      this.scanning = false;
    }
  }

  /** Neue Dateien aufnehmen, verschwundene aus der Bibliothek nehmen. Asynchron, damit der Sendebetrieb nicht stockt. */
  async scanFolder(stationId: string, f: LinkedFolder): Promise<{ added: number; removed: number }> {
    const rt = this.app.stations.get(stationId);
    if (!rt) return { added: 0, removed: 0 };
    const found = new Map<string, string>();
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || found.size >= MAX_LINKED_FILES) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (found.size >= MAX_LINKED_FILES) return;
        if (e.name.startsWith('.')) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p, depth + 1);
        else if (e.isFile() && AUDIO_FILE_RE.test(e.name)) found.set(p, relative(f.path, dir).split(sep).join(' / '));
      }
    };
    try {
      statSync(f.path);
    } catch {
      // Laufwerk/Netzlaufwerk gerade nicht da: nichts entfernen, nur melden
      f.error = 'Ordner nicht erreichbar';
      return { added: 0, removed: 0 };
    }
    await walk(f.path, 0);
    const source = `folder:${f.path}`;
    const known = new Map(rt.data.library.filter((m) => m.source === source).map((m) => [m.linkedPath!, m]));
    let added = 0;
    for (const [p, sub] of found) {
      if (known.has(p)) continue;
      const name = p.slice(p.lastIndexOf(sep) + 1);
      const meta = parseFileName(name);
      this.addMedia(stationId, {
        id: newId('m'), title: meta.title || name, artist: meta.artist, category: f.category, file: '', linkedPath: p,
        durationMs: null, addedAt: Date.now(), folder: (sub || undefined)?.slice(0, 80), originalName: name, source,
      });
      added++;
    }
    let removed = 0;
    for (const [p, m] of known) {
      if (found.has(p)) continue;
      this.removeMedia(stationId, m.id);
      removed++;
    }
    f.scannedAt = Date.now();
    f.files = found.size;
    f.error = found.size >= MAX_LINKED_FILES ? `Nur die ersten ${MAX_LINKED_FILES} Dateien übernommen` : undefined;
    if (added || removed) this.app.audit.write({ kind: 'media', event: 'folder_scan', stationId, path: f.path, added, removed });
    this.app.changed();
    return { added, removed };
  }

}

/** Mindestlängen, ab denen Stille als Cue-Punkt übernommen wird */
const LEAD_MIN_MS = 250;
const TAIL_MIN_MS = 500;

/**
 * Ergebnis des Track-Checks übernehmen. Von Hand gesetzte Cue-Punkte bleiben immer unangetastet;
 * automatisch gesetzte werden bei einer erneuten Messung aktualisiert.
 */
export function applyTrackCheck(m: MediaItem, r: TrackAnalysis): void {
  if (r.lufs !== null) {
    m.lufs = r.lufs;
    m.truePeakDb = r.truePeakDb;
  }
  if (m.durationMs == null && r.durationMs) m.durationMs = r.durationMs;
  const prev = m.check;
  const check: NonNullable<MediaItem['check']> = { at: Date.now(), clipped: r.clippedSamples, bitrateKbps: r.bitrateKbps, silent: r.silent };
  const manualIn = m.cueInMs != null && m.cueInMs !== prev?.autoCueIn;
  const manualOut = m.cueOutMs != null && m.cueOutMs !== prev?.autoCueOut;
  if (!manualIn) {
    if (r.leadSilenceMs !== null && r.leadSilenceMs >= LEAD_MIN_MS) {
      // kleine Reserve, damit kein Anschlag abgeschnitten wird
      m.cueInMs = Math.max(0, r.leadSilenceMs - 20);
      check.autoCueIn = m.cueInMs;
    } else if (prev?.autoCueIn !== undefined) delete m.cueInMs;
  }
  const end = r.durationMs;
  if (!manualOut) {
    if (r.tailSilenceMs !== null && end !== null && end - r.tailSilenceMs >= TAIL_MIN_MS) {
      m.cueOutMs = Math.min(end, r.tailSilenceMs + 20);
      check.autoCueOut = m.cueOutMs;
    } else if (prev?.autoCueOut !== undefined) delete m.cueOutMs;
  }
  m.check = check;
}

/** Hinweise des Track-Checks in Klartext (Studio, API) */
export function trackWarnings(m: MediaItem): string[] {
  const c = m.check;
  if (!c) return [];
  const w: string[] = [];
  if (c.silent) w.push('Datei ist still');
  if (c.clipped > 1000) w.push('übersteuert (Clipping)');
  if (c.bitrateKbps !== null && c.bitrateKbps < 128 && /\.(mp3|aac|m4a)$/i.test(m.linkedPath ?? m.file)) w.push(`niedrige Bitrate (${c.bitrateKbps} kbit/s)`);
  return w;
}


export interface LookupCandidate {
  source: 'itunes' | 'musicbrainz';
  title: string;
  artist: string;
  album?: string;
  year?: number;
  genre?: string;
  coverUrl?: string;
}

export interface TuevRow {
  id: string; title: string; artist: string; category: string; durationMs: number | null;
  lufs: number | null; truePeakDb: number | null; gainDb: number | null; lufsAfter: number | null; peakAfterDb: number | null;
  limited: boolean; key: string | null; camelot: string | null; bitrateKbps: number | null; warnings: string[]; checkedAt: number | null;
}

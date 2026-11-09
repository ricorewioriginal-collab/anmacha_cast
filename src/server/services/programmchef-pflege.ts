// KI-Programmchef Teil 3: Playlist-Pflege für laut.fm – eigenständig in AnMaCha Cast (Port aus dem AnMaCha Control
// Center, ai-lautshuffle.php / ai-lautsonglist.php / ai-lautmanage.php):
//  • Smart-Mischen: Songs neu gemischt, gleiche Interpreten möglichst weit auseinander, Jingles/Beiträge bleiben an
//    ihrer Stelle; alternativ laut.fm selbst mischen lassen. Automatisch alle 6 Stunden, täglich oder wöchentlich.
//  • Songliste → Playlist: Liste einfügen („Titel - Interpret“ oder umgekehrt), jeder Eintrag wird im eigenen Bestand
//    und im laut.fm-Pool gesucht, Schreibfehler korrigiert auf Wunsch die KI; neue Playlist oder an bestehende anhängen.
//  • Aufräumen: doppelte Titel, Interpreten über dem Limit, Flops nach Hörerzahlen – Vorschlag, dann gezielt entfernen.
//  • Sicherung: Playlisten (Titel + Reihenfolge) und Sendeplan sichern, wiederherstellen, als Datei laden/einspielen.
// Jede Änderung lässt sich mit „Letzte Pflege rückgängig“ zurücknehmen.
// Nur dokumentierte Radioadmin-Endpunkte: playlists, playlists/{id}, playlists/{id}/tracks, playlists/{id}/entries/{tid},
// schedule, tracks (Suche), tracks/stats/{24h|Datum}.

import type { AnMaChaCastApp } from '../app.ts';
import { AppError, newId, type Principal } from '../model.ts';
import { parseJsonLoose, type Match } from '../programmchef/match.ts';
import { cleanupFindings, isFixedTrack, parseSongList, shuffleOrder, type Finding, type ListItem, type PlTrack } from '../programmchef/pflege.ts';
import type { LautPlaylist } from './programmchef.ts';

export type ShuffleMode = 'off' | 'laut' | 'smart';
export type Cadence = 'h6' | 'daily' | 'weekly';
const GAP: Record<Cadence, number> = { h6: 6 * 3600_000, daily: 86400_000, weekly: 7 * 86400_000 };

interface ShuffleCfg { mode: ShuffleMode; cadence: Cadence; hour: number; title?: string; lastRun?: number; lastStatus?: string }
interface Schedule { base_playlist_id: number; entries: { playlist_id: number; slot: number; duration: number }[] }
interface BackupPlaylist { id: number; title: string; description?: string; color?: string; shuffled?: boolean; tracks: number[] }
export interface Backup { id: string; at: number; label: string; auto: boolean; playlists: BackupPlaylist[]; schedule: Schedule | null }
interface PflegeUndo { at: number; summary: string; playlists: { id: number; tracks: number[] }[]; created: number[]; schedule: Schedule | null }

export interface PflegeData {
  shuffle?: Record<string, ShuffleCfg>;
  backups?: Backup[];
  autoBackup?: boolean;
  lastAutoBackup?: number;
  undo?: PflegeUndo;
}

export interface ListJob {
  id: string;
  stationId: string;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  progress: number;
  step: string;
  name: string;
  items: (ListItem & { match: Match | null; how: '' | 'titel-interpret' | 'interpret-titel' | 'ki' })[];
  ai: 'used' | 'none' | 'failed' | '';
  error?: string;
}

const MAX_BACKUPS = 5;
const MAX_BACKUP_TRACKS = 40_000;
const MAX_SMART = 800;

export class ProgrammchefPflege {
  private readonly app: AnMaChaCastApp;
  private readonly jobs = new Map<string, ListJob>();
  private readonly busy = new Set<string>();
  /** Pause zwischen Radioadmin-Schreibaufrufen (laut.fm drosselt sonst; Tests: 0) */
  gapMs = 30;
  now: () => Date = () => new Date();

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  private get pc() { return this.app.svc.programmchef; }

  private store(stationId: string): PflegeData {
    const d = this.pc.data(stationId) as { pflege?: PflegeData };
    return (d.pflege ??= {});
  }

  private pause(): Promise<void> {
    return this.gapMs ? new Promise((r) => setTimeout(r, this.gapMs)) : Promise.resolve();
  }

  /** Eine Aktion je Sender gleichzeitig – sonst würden sich Mischen/Wiederherstellen in die Quere kommen. */
  private async exclusive<T>(stationId: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(stationId)) throw new AppError(409, 'busy', 'Für diesen Sender läuft gerade eine andere Pflege-Aktion – bitte kurz warten');
    this.busy.add(stationId);
    try { return await fn(); } finally { this.busy.delete(stationId); }
  }

  private async playlist(stationId: string, pid: number): Promise<LautPlaylist> {
    const p = (await this.pc.playlists(stationId)).find((x) => Number(x.id) === pid);
    if (!p) throw new AppError(404, 'not_found', 'Die Playlist gibt es bei laut.fm nicht (mehr)');
    return p;
  }

  private async setShuffledFlag(stationId: string, p: LautPlaylist, on: boolean): Promise<void> {
    await this.pc.ra(stationId, 'PATCH', `/playlists/${p.id}`, { title: p.title, description: p.description ?? '', color: /^#[0-9a-f]{6}$/i.test(p.color ?? '') ? p.color : '#888888', shuffled: on });
  }

  /** Moderationen/Ansagen, die gerade in einer Playlist warten (Teil 2) – bleiben wie Jingles an ihrer Stelle. */
  private spotIds(stationId: string): number[] {
    const d = this.pc.data(stationId);
    return (d.spotList ?? []).filter((s) => s.status === 'queued' && s.trackId).map((s) => Number(s.trackId));
  }

  /** Titel einreihen; „steht schon drin“ (laut.fm 400/409/422) zählt wie im Control Center als erledigt. */
  private async addTrack(stationId: string, pid: number, id: number): Promise<'added' | 'already'> {
    try {
      await this.pc.ra(stationId, 'POST', `/playlists/${pid}`, { track_id: id });
      return 'added';
    } catch (err) {
      if ([400, 409, 422].includes(Number((err as { upstream?: number }).upstream))) return 'already';
      throw err;
    }
  }

  /** Playlist genau auf diese Titel in dieser Reihenfolge setzen (alles entfernen, dann neu einreihen; einmal nachfassen). */
  private async writeOrder(stationId: string, pid: number, ids: number[], current?: number[]): Promise<{ added: number; failed: number }> {
    const before = current ?? (await this.pc.playlistTrackIds(stationId, pid));
    for (const id of new Set(before)) { await this.pc.ra(stationId, 'DELETE', `/playlists/${pid}/entries/${id}`).catch(() => undefined); await this.pause(); }
    let added = 0;
    const failed: number[] = [];
    for (const id of ids) {
      try { await this.addTrack(stationId, pid, id); added++; } catch { failed.push(id); }
      await this.pause();
    }
    let fail = 0;
    for (const id of failed) { try { await this.addTrack(stationId, pid, id); added++; } catch { fail++; } }
    return { added, failed: fail };
  }

  private remember(stationId: string, undo: Omit<PflegeUndo, 'at'>): void {
    this.store(stationId).undo = { at: Date.now(), ...undo };
    this.app.changed();
  }

  // ---------- Übersicht ----------

  async view(stationId: string): Promise<unknown> {
    const s = this.store(stationId);
    let playlists: (LautPlaylist & { shuffle: ShuffleCfg })[] = [];
    let error = '';
    try {
      playlists = (await this.pc.playlists(stationId)).map((p) => ({ id: p.id, title: p.title, shuffled: !!p.shuffled, color: p.color, description: p.description, shuffle: { mode: 'off', cadence: 'daily', hour: 4, ...s.shuffle?.[String(p.id)] } }));
    } catch (err) {
      if (err instanceof AppError && err.code === 'lautfm_not_connected') throw err;
      error = (err as Error).message;
    }
    return {
      playlists,
      error,
      backups: (s.backups ?? []).map((b) => ({ id: b.id, at: b.at, label: b.label, auto: b.auto, playlists: b.playlists.length, tracks: b.playlists.reduce((a, p) => a + p.tracks.length, 0), schedule: !!b.schedule })),
      autoBackup: !!s.autoBackup,
      lastAutoBackup: s.lastAutoBackup ?? null,
      undo: s.undo ? { at: s.undo.at, summary: s.undo.summary } : null,
      ai: !!this.app.svc.ai.aiConfig(stationId).text.providerId,
      busy: this.busy.has(stationId),
    };
  }

  // ---------- Mischen ----------

  /** Vorschau des Smart-Mischens: kleinster Interpreten-Abstand vorher/nachher und die ersten Titel der neuen Reihenfolge. */
  async shufflePreview(stationId: string, pid: number): Promise<unknown> {
    const p = await this.playlist(stationId, pid);
    const tracks = await this.pc.playlistTracks(stationId, pid);
    const seed = 1 + Math.floor(Math.random() * 2_000_000_000);
    const o = shuffleOrder(tracks, seed, this.spotIds(stationId));
    const byId = new Map(tracks.map((t) => [Number(t.id), t]));
    const fixed = new Set(o.fixed);
    return {
      playlist: { id: p.id, title: p.title, shuffled: !!p.shuffled },
      count: tracks.length,
      fixed: o.fixed.length,
      gapBefore: o.gapBefore,
      gapAfter: o.gapAfter,
      seed,
      preview: o.order.slice(0, 20).map((id) => { const t = byId.get(id)!; return { id, artist: typeof t.artist === 'object' ? t.artist?.name ?? '' : t.artist ?? '', title: t.title ?? '', fixed: fixed.has(id) }; }),
    };
  }

  /** Jetzt mischen. laut: laut.fm-Mischen einschalten. smart: Reihenfolge neu schreiben (bis 800 Titel). */
  async shuffleRun(p: Principal | null, stationId: string, pid: number, mode: 'laut' | 'smart', seed?: number): Promise<{ ok: boolean; message: string }> {
    return this.exclusive(stationId, () => this.doShuffle(p, stationId, pid, mode, seed));
  }

  private async doShuffle(p: Principal | null, stationId: string, pid: number, mode: 'laut' | 'smart', seed?: number): Promise<{ ok: boolean; message: string }> {
    const pl = await this.playlist(stationId, pid);
    if (mode === 'laut') {
      if (pl.shuffled) return { ok: true, message: `laut.fm mischt „${pl.title}“ bereits.` };
      await this.setShuffledFlag(stationId, pl, true);
      return { ok: true, message: `laut.fm-Mischen für „${pl.title}“ eingeschaltet.` };
    }
    const tracks = await this.pc.playlistTracks(stationId, pid);
    if (tracks.length < 3) throw new AppError(422, 'too_few', `Zu wenige Titel zum Mischen (${tracks.length})`);
    if (tracks.length > MAX_SMART) throw new AppError(422, 'too_many', `Zu viele Titel (${tracks.length}) für das Smart-Mischen – bis ${MAX_SMART}. „laut.fm mischt“ geht immer.`);
    const o = shuffleOrder(tracks, seed && Number.isFinite(seed) ? seed : 1 + Math.floor(Math.random() * 2_000_000_000), this.spotIds(stationId));
    const before = tracks.map((t) => Number(t.id));
    this.remember(stationId, { summary: `Playlist „${pl.title}“ gemischt`, playlists: [{ id: pid, tracks: before }], created: [], schedule: null });
    // laut.fm würde die neue Reihenfolge sonst gleich wieder zufällig abspielen
    if (pl.shuffled) await this.setShuffledFlag(stationId, pl, false);
    const r = await this.writeOrder(stationId, pid, o.order, before);
    const gap = o.gapAfter === null ? '' : ` (kleinster Abstand gleicher Interpreten: ${o.gapBefore ?? '–'} → ${o.gapAfter} Songs)`;
    const message = `${r.added} Titel in „${pl.title}“ neu gemischt${gap}${r.failed ? ` – ${r.failed} Titel ließen sich nicht wieder einreihen, mit „Letzte Pflege rückgängig“ wiederherstellen` : ''}.`;
    if (p) this.app.audit.write({ kind: 'lautfm', event: 'programmchef_shuffle', actor: p.id, stationId, playlist: pid });
    this.pc.log(stationId, 'mischen', message, r.failed === 0);
    return { ok: r.failed === 0, message };
  }

  /** Automatisches Mischen einer Playlist einstellen. */
  async setShuffle(p: Principal, stationId: string, pid: number, input: Record<string, unknown>): Promise<unknown> {
    const pl = await this.playlist(stationId, pid);
    const s = this.store(stationId);
    const cur: ShuffleCfg = { mode: 'off', cadence: 'daily', hour: 4, ...s.shuffle?.[String(pid)] };
    const mode = (['off', 'laut', 'smart'] as const).find((m) => m === input.mode) ?? cur.mode;
    const cadence = (['h6', 'daily', 'weekly'] as const).find((m) => m === input.cadence) ?? cur.cadence;
    const hour = typeof input.hour === 'number' && Number.isInteger(input.hour) && input.hour >= 0 && input.hour <= 23 ? input.hour : cur.hour;
    s.shuffle = { ...s.shuffle, [String(pid)]: { ...cur, mode, cadence, hour, title: pl.title } };
    if (mode === 'off') delete s.shuffle[String(pid)];
    // „laut.fm mischt“ sofort einschalten; beim Smart-Mischen schreibt der nächste Lauf die Reihenfolge
    if (mode === 'laut' && !pl.shuffled) await this.setShuffledFlag(stationId, pl, true);
    this.app.audit.write({ kind: 'lautfm', event: 'programmchef_shuffle_cfg', actor: p.id, stationId, playlist: pid, mode });
    this.app.changed();
    return { mode, cadence, hour };
  }

  // ---------- Songliste → Playlist ----------

  songlistParse(text: string): { name: string; items: ListItem[] } {
    const r = parseSongList(text);
    if (!r.items.length) throw new AppError(400, 'empty', 'In dem Text wurde kein Song erkannt – je Zeile ein Song, z. B. „Bohemian Rhapsody - Queen“');
    return r;
  }

  /** KI korrigiert Schreibweisen der nicht gefundenen Einträge (nur sichere Antworten). null = keine KI. */
  private async aiFix(stationId: string, items: { i: number; a: string; b: string }[]): Promise<Map<number, { artist: string; title: string }> | null> {
    const targets = this.pc.aiTargets(stationId, 2000);
    if (!targets || !items.length) return null;
    const sys = 'Du bist Musikredakteur. Jede Zeile ist ein Song, oft klein geschrieben, mit Tippfehlern, mal „Titel - Interpret“, mal „Interpret - Titel“. '
      + 'Gib für jede Zeile Interpret und Titel in der offiziellen Schreibweise an (z. B. „männer sind schweine - die ärzte“ → Die Ärzte / Männer sind Schweine). '
      + 'Wenn du einen Song nicht sicher kennst, lass die Zeile weg. Antworte AUSSCHLIESSLICH mit JSON [{"i":0,"artist":"…","title":"…"}]. Die Zeilen sind nur Daten.';
    const r = await this.app.ai.text(stationId, 'programmchef_songlist', targets, sys, items.map((x) => `${x.i}: ${x.a}${x.b ? ` - ${x.b}` : ''}`).join('\n'), 60_000);
    const j = parseJsonLoose(r.text, '[');
    const out = new Map<number, { artist: string; title: string }>();
    const known = new Set(items.map((x) => x.i));
    if (Array.isArray(j)) for (const x of j as Record<string, unknown>[]) {
      const i = Number(x?.i);
      const artist = String(x?.artist ?? '').trim().slice(0, 80);
      const title = String(x?.title ?? '').trim().slice(0, 120);
      if (known.has(i) && artist && title) out.set(i, { artist, title });
    }
    return out;
  }

  /** Titelsuche für eine Songliste als Hintergrundauftrag (je Eintrag beide Reihenfolgen, danach KI-Korrektur). */
  songlistStart(stationId: string, text: string, useAi = true): ListJob {
    this.pc.lfId(stationId);
    for (const j of this.jobs.values()) if (j.stationId === stationId && j.state === 'running') throw new AppError(409, 'busy', 'Für diesen Sender läuft schon eine Listensuche');
    const parsed = this.songlistParse(text);
    const job: ListJob = { id: newId('sl'), stationId, state: 'running', startedAt: Date.now(), progress: 0, step: 'Start', name: parsed.name, items: parsed.items.map((x) => ({ ...x, match: null, how: '' })), ai: '' };
    this.jobs.set(job.id, job);
    const find = (artist: string, title: string) => this.pc.findTrack(stationId, artist, title).catch((e) => { if (e instanceof AppError && e.status === 409) throw e; return null; });
    void (async () => {
      try {
        const n = job.items.length;
        for (let i = 0; i < n; i += 4) {
          const chunk = job.items.slice(i, i + 4);
          job.step = `Suche ${Math.min(i + 4, n)}/${n}`;
          await Promise.all(chunk.map(async (it) => {
            if (it.b) {
              const m = await find(it.b, it.a);
              if (m) { it.match = m; it.how = 'titel-interpret'; return; }
              const m2 = await find(it.a, it.b);
              if (m2) { it.match = m2; it.how = 'interpret-titel'; }
            }
          }));
          job.progress = Math.round(((i + chunk.length) / n) * (useAi ? 80 : 100));
        }
        const open = job.items.map((x, i) => ({ i, a: x.a, b: x.b })).filter((x) => !job.items[x.i]!.match);
        if (useAi && open.length) {
          job.step = 'KI korrigiert Schreibweisen';
          let fix: Map<number, { artist: string; title: string }> | null = null;
          try { fix = await this.aiFix(stationId, open.slice(0, 120)); job.ai = fix ? 'used' : 'none'; } catch { job.ai = 'failed'; }
          if (fix) {
            const list = [...fix.entries()];
            for (let k = 0; k < list.length; k += 4) {
              await Promise.all(list.slice(k, k + 4).map(async ([i, q]) => {
                const m = await find(q.artist, q.title);
                if (m) { job.items[i]!.match = m; job.items[i]!.how = 'ki'; }
              }));
            }
          }
        }
        job.progress = 100;
        job.state = 'done';
        job.step = 'fertig';
      } catch (err) {
        job.state = 'failed';
        job.error = (err as Error).message;
      }
      for (const [id, j] of this.jobs) if (Date.now() - j.startedAt > 3600_000) this.jobs.delete(id);
    })();
    return job;
  }

  songlistJob(stationId: string, id: string): ListJob {
    const j = this.jobs.get(id);
    if (!j || j.stationId !== stationId) throw new AppError(404, 'not_found', 'Auftrag nicht gefunden (abgelaufen?) – bitte die Liste neu suchen lassen');
    return j;
  }

  /**
   * Gefundene Titel übernehmen: neue Playlist (name) oder an bestehende (playlistId) anhängen – in Listen-Reihenfolge.
   * replace: bestehende Playlist genau auf diese Titel setzen (Jingles/Beiträge bleiben am Ende erhalten).
   */
  async songlistApply(p: Principal, stationId: string, input: { name?: string; playlistId?: number; ids?: number[]; replace?: boolean }): Promise<{ playlistId: number; created: boolean; added: number; already: number; failed: number; summary: string }> {
    const ids = [...new Set((input.ids ?? []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
    if (!ids.length) throw new AppError(400, 'empty', 'Keine gefundenen Songs ausgewählt');
    return this.exclusive(stationId, async () => {
      let pid = Number(input.playlistId ?? 0);
      let created = false;
      let title = '';
      if (pid) title = (await this.playlist(stationId, pid)).title;
      else {
        title = String(input.name ?? '').trim().slice(0, 60);
        if (!title) throw new AppError(400, 'no_name', 'Bitte einen Namen für die neue Playlist eingeben');
        const r = await this.pc.ra<{ id?: number }>(stationId, 'POST', '/playlists', { title, color: '#19c3e6', description: 'aus Songliste (AnMaCha Cast)', shuffled: false });
        pid = Number(r?.id ?? 0) || ((await this.pc.playlists(stationId)).find((x) => x.title === title)?.id ?? 0);
        if (!pid) throw new AppError(502, 'create_failed', `Playlist „${title}“ wurde bei laut.fm nicht angelegt`);
        created = true;
      }
      const cur = created ? [] : await this.pc.playlistTracks(stationId, pid);
      const before = cur.map((t) => Number(t.id));
      this.remember(stationId, { summary: created ? `Playlist „${title}“ aus Songliste angelegt` : `Songliste in „${title}“ übernommen`, playlists: created ? [] : [{ id: pid, tracks: before }], created: created ? [pid] : [], schedule: null });
      let added = 0, already = 0, failed = 0;
      if (input.replace && !created) {
        const keep = cur.filter((t) => isFixedTrack(t) && !ids.includes(Number(t.id))).map((t) => Number(t.id));
        const r = await this.writeOrder(stationId, pid, [...ids, ...keep], before);
        added = r.added - keep.length;
        failed = r.failed;
      } else {
        for (const id of ids) {
          if (before.includes(id)) { already++; continue; }
          try { if ((await this.addTrack(stationId, pid, id)) === 'added') added++; else already++; } catch { failed++; }
          await this.pause();
        }
      }
      const summary = `${created ? `Playlist „${title}“ angelegt` : `„${title}“`}: ${added} Titel ${input.replace && !created ? 'in Listen-Reihenfolge gesetzt' : 'hinzugefügt'}${already ? `, ${already} waren schon drin` : ''}${failed ? `, ${failed} gingen nicht` : ''}`;
      this.app.audit.write({ kind: 'lautfm', event: 'programmchef_songlist', actor: p.id, stationId, playlist: pid, added });
      this.pc.log(stationId, 'songliste', summary, failed === 0);
      return { playlistId: pid, created, added, already, failed, summary };
    });
  }

  // ---------- Aufräumen ----------

  /** Hörerzahlen der letzten Tage (24h + volle Vortage) aus laut.fm. */
  private async stats(stationId: string, days: number): Promise<{ id: number; listeners: number }[]> {
    const ranges = ['24h'];
    for (let i = 1; i < days; i++) { const d = new Date(this.now().getTime() - i * 86400_000); ranges.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }
    const out: { id: number; listeners: number }[] = [];
    const seen = new Set<string>();
    for (const r of ranges) {
      let j: unknown;
      try { j = await this.pc.ra(stationId, 'GET', `/tracks/stats/${r}`); } catch { continue; }
      const list = (Array.isArray(j) ? j : (j as { tracks?: unknown[] })?.tracks ?? []) as { id?: number; listeners?: number; started_at?: string; live?: boolean }[];
      for (const x of list) {
        const key = `${x.id}@${x.started_at ?? out.length}`;
        if (!x || !x.id || x.live || seen.has(key)) continue;
        seen.add(key);
        out.push({ id: Number(x.id), listeners: Number(x.listeners ?? 0) });
      }
    }
    return out;
  }

  async cleanupScan(stationId: string, pid: number, perArtist = 5, days = 3): Promise<{ playlist: { id: number; title: string }; count: number; duplicates: Finding[]; overload: Finding[]; flops: Finding[]; avgListeners: number; statsPlays: number }> {
    const pl = await this.playlist(stationId, pid);
    const tracks: PlTrack[] = await this.pc.playlistTracks(stationId, pid);
    const st = await this.stats(stationId, Math.max(1, Math.min(7, days)));
    const r = cleanupFindings(tracks, st, Math.max(0, Math.min(50, perArtist)));
    return { playlist: { id: pl.id, title: pl.title }, count: tracks.length, ...r, statsPlays: st.length };
  }

  /** Ausgewählte Titel aus der Playlist nehmen. Doppelt eingetragene bleiben einmal drin. */
  async cleanupApply(p: Principal, stationId: string, pid: number, remove: number[]): Promise<{ removed: number; summary: string }> {
    const ids = [...new Set(remove.map(Number).filter((x) => Number.isInteger(x) && x > 0))];
    if (!ids.length) throw new AppError(400, 'empty', 'Nichts zum Entfernen ausgewählt');
    return this.exclusive(stationId, async () => {
      const pl = await this.playlist(stationId, pid);
      const before = await this.pc.playlistTrackIds(stationId, pid);
      const fixed = new Set((await this.pc.playlistTracks(stationId, pid)).filter(isFixedTrack).map((t) => Number(t.id)));
      this.remember(stationId, { summary: `„${pl.title}“ aufgeräumt`, playlists: [{ id: pid, tracks: before }], created: [], schedule: null });
      let removed = 0;
      for (const id of ids) {
        if (fixed.has(id) || !before.includes(id)) continue;
        await this.pc.ra(stationId, 'DELETE', `/playlists/${pid}/entries/${id}`);
        removed++;
        // laut.fm entfernt alle Einträge dieses Titels – doppelt eingetragene kommen einmal wieder hinein
        if (before.filter((x) => x === id).length > 1) await this.addTrack(stationId, pid, id).catch(() => undefined);
        await this.pause();
      }
      const summary = `„${pl.title}“ aufgeräumt: ${removed} Titel entfernt`;
      this.app.audit.write({ kind: 'lautfm', event: 'programmchef_cleanup', actor: p.id, stationId, playlist: pid, removed });
      this.pc.log(stationId, 'aufräumen', summary);
      return { removed, summary };
    });
  }

  // ---------- Sicherung ----------

  async backup(p: Principal | null, stationId: string, label: string, auto = false): Promise<{ id: string; summary: string }> {
    return this.exclusive(stationId, async () => {
      const pls = (await this.pc.playlists(stationId)).slice(0, 60);
      const out: BackupPlaylist[] = [];
      let total = 0;
      for (const pl of pls) {
        const tracks = await this.pc.playlistTrackIds(stationId, pl.id);
        total += tracks.length;
        if (total > MAX_BACKUP_TRACKS) throw new AppError(422, 'too_big', `Zu viele Titel für eine Sicherung (über ${MAX_BACKUP_TRACKS})`);
        out.push({ id: pl.id, title: pl.title, description: pl.description ?? '', color: pl.color, shuffled: !!pl.shuffled, tracks });
      }
      const sch = await this.pc.getSchedule(stationId).catch(() => null);
      return this.storeBackup(p, stationId, { label: label.trim().slice(0, 120) || `Sicherung ${this.now().toLocaleString('de-DE')}`, auto, playlists: out, schedule: sch && sch.base_playlist_id ? sch : null });
    });
  }

  private storeBackup(p: Principal | null, stationId: string, b: Omit<Backup, 'id' | 'at'>): { id: string; summary: string } {
    const s = this.store(stationId);
    const bk: Backup = { id: newId('bk'), at: Date.now(), ...b };
    s.backups = [bk, ...(s.backups ?? [])].slice(0, MAX_BACKUPS);
    if (b.auto) s.lastAutoBackup = bk.at;
    this.app.changed();
    const summary = `${b.playlists.length} Playlist(en), ${b.playlists.reduce((a, x) => a + x.tracks.length, 0)} Titel${b.schedule ? ' und Sendeplan' : ''} gesichert`;
    if (p) this.app.audit.write({ kind: 'lautfm', event: 'programmchef_backup', actor: p.id, stationId });
    this.pc.log(stationId, 'sicherung', `${b.label}: ${summary}`);
    return { id: bk.id, summary };
  }

  backupData(stationId: string, id: string): Backup {
    const b = (this.store(stationId).backups ?? []).find((x) => x.id === id);
    if (!b) throw new AppError(404, 'not_found', 'Sicherung nicht gefunden');
    return b;
  }

  /** Sicherungsdatei (z. B. von einem anderen Sender oder Rechner) einspielen – wird geprüft und als Sicherung abgelegt. */
  importBackup(p: Principal, stationId: string, input: unknown): { id: string; summary: string } {
    const d = input as { label?: unknown; playlists?: unknown; schedule?: unknown } | null;
    if (!d || !Array.isArray(d.playlists) || !d.playlists.length || d.playlists.length > 60) throw new AppError(400, 'invalid', 'Das ist keine AnMaCha-Cast-Sicherung (Playlisten fehlen)');
    let total = 0;
    const playlists: BackupPlaylist[] = (d.playlists as Record<string, unknown>[]).map((x) => {
      const tracks = Array.isArray(x?.tracks) ? (x.tracks as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
      total += tracks.length;
      const title = String(x?.title ?? '').trim().slice(0, 100);
      if (!title) throw new AppError(400, 'invalid', 'Eine Playlist in der Sicherung hat keinen Namen');
      return { id: Number(x?.id) || 0, title, description: String(x?.description ?? '').slice(0, 500), color: /^#[0-9a-f]{6}$/i.test(String(x?.color ?? '')) ? String(x.color) : '#888888', shuffled: x?.shuffled === true, tracks };
    });
    if (total > MAX_BACKUP_TRACKS) throw new AppError(422, 'too_big', `Zu viele Titel (über ${MAX_BACKUP_TRACKS})`);
    const sc = d.schedule as Schedule | null;
    const schedule = sc && Number(sc.base_playlist_id) && Array.isArray(sc.entries)
      ? { base_playlist_id: Number(sc.base_playlist_id), entries: sc.entries.slice(0, 168).map((e) => ({ playlist_id: Number(e.playlist_id), slot: Math.max(0, Math.min(167, Number(e.slot))), duration: Math.max(1, Math.min(168, Number(e.duration))) })) }
      : null;
    return this.storeBackup(p, stationId, { label: `Eingespielt: ${String(d.label ?? 'Datei').slice(0, 100)}`, auto: false, playlists, schedule });
  }

  deleteBackup(p: Principal, stationId: string, id: string): void {
    const s = this.store(stationId);
    this.backupData(stationId, id);
    s.backups = (s.backups ?? []).filter((x) => x.id !== id);
    this.app.audit.write({ kind: 'lautfm', event: 'programmchef_backup_delete', actor: p.id, stationId });
    this.app.changed();
  }

  /**
   * Sicherung wiederherstellen: Playlisten nach Namen zuordnen (fehlende werden angelegt). exact: Titel und Reihenfolge
   * genau wie gesichert (Jingles/Beiträge der Playlist bleiben), sonst nur fehlende Titel ergänzen. schedule: Sendeplan zurück.
   */
  async restore(p: Principal, stationId: string, id: string, opts: { exact?: boolean; schedule?: boolean }): Promise<{ playlists: { name: string; created: boolean; added: number; failed: number }[]; schedule: string; summary: string }> {
    const b = this.backupData(stationId, id);
    return this.exclusive(stationId, async () => {
      const have = await this.pc.playlists(stationId);
      const byName = new Map(have.map((x) => [x.title.toLowerCase(), x]));
      const undo: Omit<PflegeUndo, 'at'> = { summary: `Sicherung „${b.label}“ wiederhergestellt`, playlists: [], created: [], schedule: null };
      const map = new Map<number, number>();
      const report: { name: string; created: boolean; added: number; failed: number }[] = [];
      for (const bp of b.playlists) {
        let pid = byName.get(bp.title.toLowerCase())?.id ?? 0;
        let created = false;
        if (!pid) {
          const r = await this.pc.ra<{ id?: number }>(stationId, 'POST', '/playlists', { title: bp.title, description: bp.description ?? '', color: bp.color ?? '#888888', shuffled: !!bp.shuffled });
          pid = Number(r?.id ?? 0) || ((await this.pc.playlists(stationId)).find((x) => x.title === bp.title)?.id ?? 0);
          if (!pid) { report.push({ name: bp.title, created: false, added: 0, failed: bp.tracks.length }); continue; }
          created = true;
          undo.created.push(pid);
        }
        if (bp.id) map.set(bp.id, pid);
        const cur = created ? [] : await this.pc.playlistTracks(stationId, pid);
        const before = cur.map((t) => Number(t.id));
        if (!created) undo.playlists.push({ id: pid, tracks: before });
        let added = 0, failed = 0;
        if (opts.exact && !created) {
          const keep = cur.filter((t) => isFixedTrack(t) && !bp.tracks.includes(Number(t.id))).map((t) => Number(t.id));
          const r = await this.writeOrder(stationId, pid, [...bp.tracks, ...keep], before);
          added = r.added; failed = r.failed;
        } else {
          for (const tid of bp.tracks) {
            if (before.includes(tid)) continue;
            try { if ((await this.addTrack(stationId, pid, tid)) === 'added') added++; } catch { failed++; }
            await this.pause();
          }
        }
        report.push({ name: bp.title, created, added, failed });
      }
      let schedule = '';
      if (opts.schedule && b.schedule) {
        const base = map.get(b.schedule.base_playlist_id) ?? 0;
        if (!base) schedule = 'Basis-Playlist der Sicherung nicht verfügbar – Sendeplan nicht geändert';
        else {
          undo.schedule = await this.pc.getSchedule(stationId);
          const entries = b.schedule.entries.map((e) => ({ ...e, playlist_id: map.get(e.playlist_id) ?? 0 })).filter((e) => e.playlist_id && e.playlist_id !== base);
          await this.pc.ra(stationId, 'PATCH', '/schedule', { base_playlist_id: base, entries });
          schedule = 'Sendeplan wiederhergestellt';
        }
      }
      this.remember(stationId, undo);
      const fails = report.reduce((a, r) => a + r.failed, 0);
      const summary = `${report.length} Playlist(en) wiederhergestellt (${report.filter((r) => r.created).length} neu angelegt, ${report.reduce((a, r) => a + r.added, 0)} Titel eingereiht)${schedule ? `, ${schedule}` : ''}${fails ? ` – ${fails} Titel gingen nicht (eigene Uploads eines anderen Senders oder gelöschte Titel)` : ''}`;
      this.app.audit.write({ kind: 'lautfm', event: 'programmchef_restore', actor: p.id, stationId });
      this.pc.log(stationId, 'sicherung', summary, fails === 0);
      return { playlists: report, schedule, summary };
    });
  }

  setAutoBackup(p: Principal, stationId: string, on: boolean): { autoBackup: boolean } {
    this.store(stationId).autoBackup = on;
    this.app.audit.write({ kind: 'lautfm', event: 'programmchef_autobackup', actor: p.id, stationId, enabled: on });
    this.app.changed();
    return { autoBackup: on };
  }

  // ---------- Rückgängig ----------

  async undo(p: Principal, stationId: string): Promise<{ summary: string }> {
    const u = this.store(stationId).undo;
    if (!u) throw new AppError(404, 'nothing', 'Keine Pflege-Änderung zum Rückgängigmachen');
    return this.exclusive(stationId, async () => {
      let failed = 0;
      for (const pl of u.playlists) failed += (await this.writeOrder(stationId, pl.id, pl.tracks)).failed;
      for (const id of u.created) await this.pc.ra(stationId, 'DELETE', `/playlists/${id}`).catch(() => undefined);
      if (u.schedule) await this.pc.ra(stationId, 'PATCH', '/schedule', u.schedule);
      delete this.store(stationId).undo;
      this.app.changed();
      const summary = `Zurückgenommen: ${u.summary}${failed ? ` (${failed} Titel ließen sich nicht wieder einreihen)` : ''}`;
      this.app.audit.write({ kind: 'lautfm', event: 'programmchef_pflege_undo', actor: p.id, stationId });
      this.pc.log(stationId, 'rückgängig', summary, failed === 0);
      return { summary };
    });
  }

  // ---------- Takt ----------

  /** Vom App-Takt (etwa minütlich): wöchentliche Auto-Sicherung und fälliges Mischen (je Lauf höchstens ein Smart-Mischen). */
  async tick(stationId: string): Promise<void> {
    if (this.busy.has(stationId) || this.pc.isBusy(stationId)) return;
    const cfg = this.app.svc.lautfm.lautfmConfig(stationId);
    if (!cfg.hasToken || !cfg.stationId) return;
    const s = this.store(stationId);
    const now = this.now();
    if (s.autoBackup && (!s.lastAutoBackup || now.getTime() - s.lastAutoBackup > 7 * 86400_000)) {
      s.lastAutoBackup = now.getTime(); // auch bei Fehler nicht minütlich erneut versuchen
      await this.backup(null, stationId, `Auto-Sicherung ${now.toLocaleDateString('de-DE')}`, true).catch((e) => this.pc.log(stationId, 'sicherung', `Auto-Sicherung fehlgeschlagen: ${(e as Error).message}`, false));
      return;
    }
    for (const [pid, c] of Object.entries(s.shuffle ?? {})) {
      if (c.mode === 'off') continue;
      const last = c.lastRun ?? 0;
      if (c.mode === 'laut' ? now.getTime() - last < GAP.h6 : now.getTime() - last < GAP[c.cadence] - 600_000 || (c.cadence !== 'h6' && now.getHours() !== c.hour)) continue;
      c.lastRun = now.getTime();
      try {
        const r = await this.shuffleRun(null, stationId, Number(pid), c.mode);
        c.lastStatus = `${now.toLocaleString('de-DE')}: ${r.message}`;
      } catch (err) {
        c.lastStatus = `${now.toLocaleString('de-DE')}: Fehler – ${(err as Error).message}`;
        if (err instanceof AppError && err.status === 404) delete s.shuffle![pid];
      }
      this.app.changed();
      if (c.mode === 'smart') return;
    }
  }
}

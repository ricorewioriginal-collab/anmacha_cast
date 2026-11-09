// KI-Programmchef für laut.fm – eigenständig in AnMaCha Cast (Port der Kernfunktionen aus dem AnMaCha Control Center,
// ai-lautplan.php / ai-lautauto.php):
//  • Sendeplaner: Wunsch („morgens Pop 6–10 Uhr, abends Rock, je 60 Songs“) → Plan aus Playlisten und Sendezeiten
//    (KI, ohne KI per Regel-Planer), Titel aus Charts/KI-Vorschlägen/Genre/Interpreten, jeder Titel wird im laut.fm-Pool
//    gesucht (erst eigener Bestand, dann Pool), Vorschau mit gefunden/fehlt, Einspielen bei laut.fm mit Rückgängig.
//  • Autopilot: eine Vorgabe je Sender; der Programmchef baut das Programm und frischt die Playlisten regelmäßig auf.
// Nur dokumentierte Radioadmin-Endpunkte (Spezifikation 1.0.1): playlists, playlists/{id}, playlists/{id}/tracks,
// playlists/{id}/entries/{tid}, schedule, tracks (Suche).

import type { AnMaChaCastApp } from '../app.ts';
import { AppError, newId, type Principal } from '../model.ts';
import { artistOf, bestMatch, mainArtist, norm, parseJsonLoose, searchTries, songLines, type Match, type PoolTrack } from '../programmchef/match.ts';
import { PLAN_SYSTEM, fineCriteria, gridEntries, heuristicPlan, normalizePlan, planSlots, scheduleGrid, type Plan, type PlanPlaylist } from '../programmchef/plan.ts';

export interface CollectResult {
  name: string;
  source: string;
  found: Match[];
  missing: { artist: string; title: string }[];
  note: string;
  error?: string;
}

export interface CollectJob {
  id: string;
  stationId: string;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  step: string;
  progress: number;
  plan: Plan;
  results: CollectResult[];
  error?: string;
}

interface UndoState {
  at: number;
  created: number[];
  touched: Record<string, number[]>;
  schedule: { base_playlist_id: number; entries: { playlist_id: number; slot: number; duration: number }[] } | null;
  summary: string;
}

export interface AutopilotConfig {
  enabled: boolean;
  brief: string;
  everyHours: number;
  lastRun?: number;
  lastResult?: string;
  lastOk?: boolean;
}

export interface ProgrammchefData {
  undo?: UndoState;
  autopilot?: AutopilotConfig;
  /** Plan der Autopilot-Vorgabe (wird bei geänderter Vorgabe neu verstanden) */
  autoPlan?: { brief: string; plan: Plan; at: number };
  log?: { at: number; kind: string; text: string; ok: boolean }[];
  /** Teil 2: Moderationen & Sendeuhr (services/programmchef-spots.ts) */
  spots?: import('./programmchef-spots.ts').SpotConfig;
  spotList?: import('./programmchef-spots.ts').Spot[];
  /** Teil 3: Playlist-Pflege (services/programmchef-pflege.ts) */
  pflege?: import('./programmchef-pflege.ts').PflegeData;
  /** Teil 4: Hörer-Funktionen (services/programmchef-hoerer.ts) */
  hoerer?: import('./programmchef-hoerer.ts').HoererData;
}

export interface LautPlaylist { id: number; title: string; color?: string; description?: string; shuffled?: boolean }

type RaTracks = { tracks?: PoolTrack[]; _paging?: { next_page?: number | null; total_pages?: number; current_page?: number } };
type Fetch = typeof fetch;

const DEEZER_DE_PLAYLIST = 1111143121; // „Top Germany“ (Deezer, öffentlich, ohne Schlüssel)

export class ProgrammchefService {
  private readonly app: AnMaChaCastApp;
  private readonly jobs = new Map<string, CollectJob>();
  private readonly autoRunning = new Set<string>();
  /** für Tests austauschbar (Charts von Deezer) */
  fetchFn: Fetch = fetch;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  data(stationId: string): ProgrammchefData {
    const rt = this.app.rt(stationId).data as { programmchef?: ProgrammchefData };
    return (rt.programmchef ??= {});
  }

  log(stationId: string, kind: string, text: string, ok = true): void {
    const d = this.data(stationId);
    (d.log ??= []).unshift({ at: Date.now(), kind, text: text.slice(0, 400), ok });
    d.log.length = Math.min(d.log.length, 60);
    this.app.changed();
  }

  // ---------- laut.fm ----------

  lfId(stationId: string): number {
    const cfg = this.app.svc.lautfm.lautfmConfig(stationId);
    if (!cfg.hasToken || !cfg.stationId) throw new AppError(409, 'lautfm_not_connected', 'Zuerst unter „laut.fm verwalten“ mit laut.fm verbinden und die Station wählen');
    return cfg.stationId;
  }

  /** Radioadmin-Aufruf relativ zur eigenen Station; Fehler werden zu verständlichen Meldungen. */
  async ra<T = unknown>(stationId: string, method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.app.svc.lautfm.radioadmin(stationId, method, `/stations/${this.lfId(stationId)}${path}`, body);
    if (r.status >= 200 && r.status < 300) return r.data as T;
    const msg = typeof r.data === 'object' && r.data ? String((r.data as { error?: unknown; message?: unknown }).message ?? (r.data as { error?: unknown }).error ?? '') : String(r.data ?? '');
    const err = new AppError(r.status === 401 || r.status === 403 ? 409 : 502, 'lautfm_failed', `laut.fm antwortete ${r.status}${msg ? `: ${msg.slice(0, 160)}` : ''}`);
    (err as AppError & { upstream?: number }).upstream = r.status;
    throw err;
  }

  async playlists(stationId: string): Promise<LautPlaylist[]> {
    const r = await this.ra<{ playlists?: LautPlaylist[] } | LautPlaylist[]>(stationId, 'GET', '/playlists');
    return (Array.isArray(r) ? r : r.playlists ?? []).filter((p) => p && p.id);
  }

  async playlistTrackIds(stationId: string, pid: number): Promise<number[]> {
    return (await this.playlistTracks(stationId, pid)).map((t) => Number(t.id));
  }

  /** Alle Titel einer Playlist in Spielreihenfolge (seitenweise gelesen). */
  async playlistTracks(stationId: string, pid: number): Promise<(PoolTrack & { tags?: string[] })[]> {
    const ids: (PoolTrack & { tags?: string[] })[] = [];
    for (let page = 1; page <= 100; page++) {
      const r = await this.ra<RaTracks>(stationId, 'GET', `/playlists/${pid}/tracks?page=${page}`);
      for (const t of r.tracks ?? []) ids.push(t);
      const pg = r._paging;
      const total = Number(pg?.total_pages ?? 1);
      if (!(pg?.next_page || page < total) || !(r.tracks ?? []).length) break;
    }
    return ids;
  }

  async getSchedule(stationId: string): Promise<{ base_playlist_id: number; entries: { playlist_id: number; slot: number; duration: number }[] }> {
    const r = await this.ra<unknown>(stationId, 'GET', '/schedule');
    const s = (Array.isArray(r) ? r[0] : r) as { base_playlist_id?: number; entries?: { playlist_id: number; slot: number; duration: number }[] } | undefined;
    return { base_playlist_id: Number(s?.base_playlist_id ?? 0), entries: (s?.entries ?? []).map((e) => ({ playlist_id: Number(e.playlist_id), slot: Number(e.slot), duration: Number(e.duration) })) };
  }

  /** Einen Titel im eigenen Bestand und im Pool suchen (Suchstufen wie im Control Center). */
  async findTrack(stationId: string, artist: string, title: string): Promise<Match | null> {
    for (const t of searchTries(artist, title)) {
      for (let page = 1; page <= t.pages; page++) {
        const q = new URLSearchParams({ ...t.query, page: String(page) });
        let r: RaTracks;
        try { r = await this.ra<RaTracks>(stationId, 'GET', `/tracks?${q}`); } catch (err) {
          if (err instanceof AppError && err.status === 409) throw err; // Token abgelehnt: abbrechen statt alle Titel durchzuprobieren
          break;
        }
        const m = bestMatch(r.tracks ?? [], artist, title);
        if (m) return m;
        if (!r._paging?.next_page) break;
      }
    }
    return null;
  }

  // ---------- Plan verstehen ----------

  aiTargets(stationId: string, maxTokens: number) {
    const c = this.app.svc.ai.aiConfig(stationId);
    if (!c.text.providerId) return null;
    return [{ ...c.text, maxTokens: Math.max(c.text.maxTokens ?? 0, maxTokens) }, c.text.fallback ? { ...c.text.fallback, maxTokens } : undefined];
  }

  /** Wunsch → Plan. KI zuerst; ist keine eingerichtet oder die Antwort unbrauchbar, springt der Regel-Planer ein. */
  async understand(stationId: string, wish: string, single = false): Promise<{ plan: Plan; model: string; note: string }> {
    const prompt = wish.trim().slice(0, 4000);
    if (!prompt) throw new AppError(400, 'empty', 'Bitte einen Wunsch eingeben, z. B. „Morgens Pop 6–10 Uhr, abends Rock 18–22 Uhr, je 60 Songs“');
    let existing: string[] = [];
    let busy: string[] = [];
    try {
      const pls = await this.playlists(stationId);
      existing = pls.map((p) => p.title);
      const sch = await this.getSchedule(stationId);
      const names = new Map(pls.map((p) => [p.id, p.title]));
      const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
      busy = sch.entries.map((e) => `${days[Math.floor(e.slot / 24)]} ${e.slot % 24}–${(e.slot % 24) + e.duration} Uhr: ${names.get(e.playlist_id) ?? e.playlist_id}`);
    } catch (err) {
      if (err instanceof AppError && err.status === 409) throw err;
    }
    let err = '';
    const targets = this.aiTargets(stationId, 3500);
    if (targets) {
      for (const sys of [PLAN_SYSTEM(single, existing, busy), PLAN_SYSTEM(single, existing, busy) + '\nWICHTIG: Antworte ausschließlich mit dem JSON-Objekt, ohne Text davor oder danach, ohne Markdown.']) {
        try {
          const r = await this.app.ai.text(stationId, 'programmchef_plan', targets, sys, prompt, 90_000);
          const j = parseJsonLoose(r.text, '{') as Record<string, unknown> | null;
          const inner = j && !('playlists' in j) ? (['plan', 'result', 'programm'].map((k) => j[k]).find((x) => x && typeof x === 'object' && 'playlists' in (x as object)) ?? j) : j;
          const plan = normalizePlan(inner, prompt);
          if (plan) {
            if (single) { plan.playlists = plan.playlists.slice(0, 1); plan.schedule = []; plan.basePlaylist = ''; }
            return { plan, model: r.model, note: '' };
          }
          err = `Die KI-Antwort war kein verwertbarer Plan (Antwort begann mit „${r.text.replace(/\s+/g, ' ').slice(0, 80)}“).`;
        } catch (e) {
          err = `Die KI hat gerade nicht geantwortet: ${(e as Error).message}`;
          break;
        }
      }
    } else err = 'Keine KI eingerichtet (KI-Programmchef → Anbieter & lokale KI).';
    const plan = heuristicPlan(prompt, single);
    if (!plan) throw new AppError(422, 'no_plan', `${err} Auch der Regel-Planer konnte aus dem Text keinen Plan ableiten – bitte konkreter formulieren (z. B. „Morgens Pop 6–10 Uhr, abends Rock 18–22 Uhr, je 60 Songs“).`);
    return { plan, model: 'Regel-Planer (ohne KI)', note: `${err} Der Plan wurde nach festen Regeln aus deinem Text erstellt – bitte prüfen.` };
  }

  // ---------- Titel sammeln ----------

  /** Kandidaten aus den deutschen/weltweiten Charts (Deezer, öffentlich). */
  private async charts(kind: 'chart_de' | 'chart_global', limit: number): Promise<{ artist: string; title: string }[]> {
    const url = kind === 'chart_de' ? `https://api.deezer.com/playlist/${DEEZER_DE_PLAYLIST}/tracks?limit=${limit}` : `https://api.deezer.com/chart/0/tracks?limit=${limit}`;
    const r = await this.fetchFn(url, { headers: { Accept: 'application/json', 'User-Agent': 'AnMaCha Cast' }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Charts nicht erreichbar (${r.status})`);
    const j = (await r.json()) as { data?: { title?: string; title_short?: string; artist?: { name?: string } }[] };
    return (j.data ?? []).map((t) => ({ artist: t.artist?.name ?? '', title: t.title_short || t.title || '' })).filter((x) => x.artist && x.title).slice(0, limit);
  }

  /** KI nennt echte Songs für die Playlist (JSON-Liste; Fließtext wird zur Not zeilenweise gelesen). */
  private async aiSongs(stationId: string, p: PlanPlaylist, need: number, exclude: string[]): Promise<{ artist: string; title: string }[]> {
    const targets = this.aiTargets(stationId, 6000);
    if (!targets) throw new Error('Keine KI eingerichtet – für diese Playlist (Quelle „KI“) wird ein Text-Anbieter gebraucht');
    const crit = `Playlist „${p.name}“${p.description ? ` (${p.description})` : ''}${p.genres.length ? `, Genres: ${p.genres.join(', ')}` : ''}${p.mood ? `, Stimmung: ${p.mood}` : ''}${p.minYear || p.maxYear ? `, Erscheinungsjahr ${p.minYear ?? '…'}–${p.maxYear ?? 'heute'}` : ''}${p.artists.length ? `, Interpreten wie: ${p.artists.join(', ')}` : ''}${p.wish ? `. Besondere Vorgaben (unbedingt beachten): ${p.wish}` : ''}${p.avoid.length ? `. Keine Titel von/zu: ${p.avoid.join(', ')}` : ''}${fineCriteria(p)}`;
    const sys = `Du bist Musikchef eines Radiosenders. Nenne ${need} ECHTE, bekannte Songs (reale Interpreten, reale Titel – keine erfundenen) für: ${crit}. Jeder Song nur einmal, abwechslungsreiche Interpreten (kein Interpret mehr als dreimal). Antworte NUR mit einem JSON-Array, z. B. [{"artist":"Queen","title":"Don't Stop Me Now"}] – kein Text davor oder danach.${exclude.length ? ` Nicht erneut nennen: ${exclude.slice(-80).join('; ')}` : ''}`;
    const r = await this.app.ai.text(stationId, 'programmchef_songs', targets, sys, 'Liste jetzt.', 120_000);
    let list = parseJsonLoose(r.text, '[') as unknown;
    if (!Array.isArray(list)) {
      const o = parseJsonLoose(r.text, '{') as Record<string, unknown> | null;
      list = o ? ['songs', 'tracks', 'titel', 'list'].map((k) => o[k]).find(Array.isArray) : null;
    }
    if (!Array.isArray(list) || !list.length) list = songLines(r.text);
    const avoid = p.avoid.map((a) => a.toLowerCase());
    const out: { artist: string; title: string }[] = [];
    const seen = new Set<string>();
    for (const x of list as Record<string, unknown>[]) {
      if (!x || typeof x !== 'object') continue;
      const artist = String(x.artist ?? x.interpret ?? x.band ?? '').trim().slice(0, 80);
      const title = String(x.title ?? x.titel ?? x.song ?? x.track ?? '').trim().slice(0, 100);
      if (!artist || !title || avoid.some((w) => w && `${artist} ${title}`.toLowerCase().includes(w))) continue;
      const k = norm(`${artist} ${title}`);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ artist, title });
    }
    return out;
  }

  /** Titel einer Playlist aus dem Pool nach Genre (und Jahren), beliebteste zuerst ist nicht abfragbar – Reihenfolge des Pools. */
  private async poolGenre(stationId: string, p: PlanPlaylist, need: number): Promise<Match[]> {
    const out: Match[] = [];
    const seen = new Set<number>();
    for (const genre of p.genres.length ? p.genres : ['Pop']) {
      for (let page = 1; page <= 10 && out.length < need; page++) {
        const q = new URLSearchParams({ genre, private: 'false', page: String(page) });
        let r: RaTracks;
        try { r = await this.ra<RaTracks>(stationId, 'GET', `/tracks?${q}`); } catch { break; }
        for (const t of r.tracks ?? []) {
          const y = Number(t.release_year ?? 0);
          if (seen.has(Number(t.id)) || (p.minYear && y && y < p.minYear) || (p.maxYear && y && y > p.maxYear)) continue;
          seen.add(Number(t.id));
          out.push({ id: Number(t.id), artist: artistOf(t), title: t.title ?? '', duration: Number(t.duration ?? 0), year: y, score: 1 });
        }
        if (!r._paging?.next_page) break;
      }
    }
    return out;
  }

  /** Alle Titel der genannten Interpreten (eigener Bestand und Pool, je Interpret höchstens perArtist). */
  private async artistTracks(stationId: string, artists: string[], per: number): Promise<Match[]> {
    const out: Match[] = [];
    const seen = new Set<number>();
    for (const a of artists) {
      let n = 0;
      for (const query of [{ own: 'true', artist: a }, { private: 'false', artist: a }] as Record<string, string>[]) {
        let r: RaTracks;
        try { r = await this.ra<RaTracks>(stationId, 'GET', `/tracks?${new URLSearchParams({ ...query, page: '1' })}`); } catch { continue; }
        for (const t of r.tracks ?? []) {
          if (n >= per || seen.has(Number(t.id))) continue;
          const ta = norm(artistOf(t));
          if (!ta.includes(norm(mainArtist(a)))) continue;
          seen.add(Number(t.id));
          out.push({ id: Number(t.id), artist: artistOf(t), title: t.title ?? '', duration: Number(t.duration ?? 0), year: Number(t.release_year ?? 0), score: 1 });
          n++;
        }
      }
    }
    return out;
  }

  /** Feineinstellungen serverseitig nachprüfen: Ausschlüsse, Jahre (falls bekannt), höchstens N je Interpret. */
  private passes(p: PlanPlaylist, m: Match, found: Match[]): boolean {
    const text = `${m.artist} ${m.title}`.toLowerCase();
    if (p.avoid.some((w) => w && text.includes(w.toLowerCase()))) return false;
    if (m.year && ((p.minYear && m.year < p.minYear) || (p.maxYear && m.year > p.maxYear))) return false;
    const limit = p.perArtist || 3;
    return found.filter((f) => norm(mainArtist(f.artist)) === norm(mainArtist(m.artist))).length < limit;
  }

  /** Titel für eine Playlist sammeln und im Pool abgleichen. */
  async collectPlaylist(stationId: string, p: PlanPlaylist, onStep: (s: string) => void = () => {}): Promise<CollectResult> {
    const res: CollectResult = { name: p.name, source: p.source, found: [], missing: [], note: '' };
    if (p.source === 'existing') { res.note = 'Vorhandene Playlist – wird nur eingeplant.'; return res; }
    const add = (m: Match) => { if (!res.found.some((f) => f.id === m.id) && this.passes(p, m, res.found)) res.found.push(m); };
    if (p.must.length) for (const m of await this.artistTracks(stationId, p.must, 4)) if (res.found.length < Math.ceil(p.count * 0.6)) add(m);
    if (p.source === 'artists') {
      for (const m of await this.artistTracks(stationId, p.artists, p.perArtist || 8)) if (res.found.length < p.count) add(m);
      res.note = `Titel der ${p.artists.length} Interpreten aus eigenem Bestand und laut.fm-Pool.`;
      return res;
    }
    if (p.source === 'pool_genre') {
      for (const m of await this.poolGenre(stationId, p, p.count * 2)) if (res.found.length < p.count) add(m);
      res.note = `Aus dem laut.fm-Pool nach Genre ${p.genres.join(', ') || 'Pop'}${p.minYear || p.maxYear ? ` (${p.minYear ?? '…'}–${p.maxYear ?? 'heute'})` : ''}.`;
      return res;
    }
    let candidates: { artist: string; title: string }[];
    if (p.source === 'chart_de' || p.source === 'chart_global') {
      try { candidates = await this.charts(p.source, Math.min(100, p.count)); } catch (err) { res.error = `Die Chartliste ist gerade nicht erreichbar (${(err as Error).message}).`; return res; }
      res.note = `Quelle: ${p.source === 'chart_de' ? 'Deezer „Top Germany“' : 'Deezer weltweite Charts'} – jeder Titel wird im laut.fm-Pool gesucht.`;
    } else {
      try { candidates = await this.aiSongs(stationId, p, Math.min(80, Math.ceil(p.count * 1.4)), []); } catch (err) { res.error = (err as Error).message; return res; }
      res.note = 'KI-Vorschläge – jeder Titel wird im laut.fm-Pool geprüft; nicht vorhandene fallen heraus.';
    }
    // je Runde höchstens 4 Titel gleichzeitig suchen (laut.fm drosselt sonst)
    let rounds = 0;
    while (res.found.length < p.count && candidates.length && rounds < 3) {
      for (let i = 0; i < candidates.length && res.found.length < p.count; i += 4) {
        const chunk = candidates.slice(i, i + 4);
        onStep(`${p.name}: suche ${Math.min(i + 4, candidates.length)}/${candidates.length}`);
        const hits = await Promise.all(chunk.map((c) => this.findTrack(stationId, c.artist, c.title).catch((e) => { if (e instanceof AppError && e.status === 409) throw e; return null; })));
        hits.forEach((m, k) => (m ? add(m) : res.missing.push(chunk[k]!)));
      }
      rounds++;
      // KI-Quelle: zu wenig gefunden → nachfragen, ohne Bekanntes zu wiederholen
      if (p.source !== 'ai' || res.found.length >= p.count) break;
      const known = [...res.found.map((f) => `${f.artist} – ${f.title}`), ...res.missing.map((m) => `${m.artist} – ${m.title}`)];
      try { candidates = await this.aiSongs(stationId, p, Math.min(60, (p.count - res.found.length) * 2), known); } catch { break; }
    }
    return res;
  }

  /** Titelsuche für alle Playlisten eines Plans als Hintergrundauftrag (dauert je nach Größe Minuten). */
  startCollect(stationId: string, plan: Plan): CollectJob {
    this.lfId(stationId);
    for (const j of this.jobs.values()) if (j.stationId === stationId && j.state === 'running') throw new AppError(409, 'busy', 'Für diesen Sender läuft schon eine Titelsuche');
    const job: CollectJob = { id: newId('pc'), stationId, state: 'running', startedAt: Date.now(), step: 'Start', progress: 0, plan, results: [] };
    this.jobs.set(job.id, job);
    void (async () => {
      try {
        for (const [i, p] of plan.playlists.entries()) {
          job.step = `${p.name}: sammle Titel`;
          job.results.push(await this.collectPlaylist(stationId, p, (s) => (job.step = s)));
          job.progress = Math.round(((i + 1) / plan.playlists.length) * 100);
        }
        job.state = 'done';
        job.step = 'fertig';
      } catch (err) {
        job.state = 'failed';
        job.error = (err as Error).message;
      }
      // alte Aufträge aufräumen (eine Stunde aufheben)
      for (const [id, j] of this.jobs) if (Date.now() - j.startedAt > 3600_000) this.jobs.delete(id);
    })();
    return job;
  }

  job(stationId: string, id: string): CollectJob {
    const j = this.jobs.get(id);
    if (!j || j.stationId !== stationId) throw new AppError(404, 'not_found', 'Auftrag nicht gefunden (abgelaufen?) – bitte die Titelsuche neu starten');
    return j;
  }

  // ---------- Einspielen & Rückgängig ----------

  /**
   * Plan bei laut.fm einspielen: Playlisten anlegen (oder gleichnamige vorhandene weiterverwenden), gefundene Titel
   * anhängen, Sendezeiten eintragen. Merkt sich alles für „Rückgängig“. refresh: Playlisten auf genau die neue Auswahl
   * bringen (Autopilot), sonst nur ergänzen.
   */
  async apply(p: Principal | null, stationId: string, plan: Plan, results: CollectResult[], opts: { refresh?: boolean } = {}): Promise<{ playlists: { name: string; id: number; created: boolean; added: number; removed: number }[]; schedule: boolean; summary: string }> {
    const pls = await this.playlists(stationId);
    const undo: UndoState = { at: Date.now(), created: [], touched: {}, schedule: null, summary: '' };
    const report: { name: string; id: number; created: boolean; added: number; removed: number }[] = [];
    const ids = new Map<string, number>();
    for (const pl of plan.playlists) {
      const res = results.find((r) => r.name === pl.name);
      let target = pls.find((x) => x.title.toLowerCase() === pl.name.toLowerCase());
      let created = false;
      if (!target) {
        if (pl.source === 'existing') continue;
        const r = await this.ra<{ id?: number }>(stationId, 'POST', '/playlists', { title: pl.name, color: pl.color, description: pl.description, shuffled: pl.shuffled });
        let id = Number(r?.id ?? 0);
        if (!id) id = (await this.playlists(stationId)).find((x) => x.title === pl.name)?.id ?? 0;
        if (!id) throw new AppError(502, 'create_failed', `Playlist „${pl.name}“ wurde bei laut.fm nicht angelegt`);
        target = { id, title: pl.name };
        created = true;
        undo.created.push(id);
      }
      ids.set(pl.name.toLowerCase(), target.id);
      let added = 0, removed = 0;
      if (res?.found.length) {
        const before = created ? [] : await this.playlistTrackIds(stationId, target.id);
        if (!created) undo.touched[String(target.id)] = before;
        const want = new Set(res.found.map((f) => f.id));
        if (opts.refresh) for (const id of before) if (!want.has(id)) { await this.ra(stationId, 'DELETE', `/playlists/${target.id}/entries/${id}`); removed++; }
        for (const f of res.found) {
          if (before.includes(f.id)) continue;
          try { await this.ra(stationId, 'POST', `/playlists/${target.id}`, { track_id: f.id }); added++; } catch { /* schon drin */ }
        }
      }
      report.push({ name: pl.name, id: target.id, created, added, removed });
    }
    let scheduled = false;
    if (plan.schedule.length || plan.basePlaylist) {
      const cur = await this.getSchedule(stationId);
      undo.schedule = cur;
      const grid = scheduleGrid(cur.entries);
      for (const s of planSlots(plan.schedule)) {
        const id = ids.get(s.playlist.toLowerCase());
        if (id) for (let h = 0; h < s.duration; h++) grid[(s.slot + h) % 168] = id;
      }
      const base = ids.get(plan.basePlaylist.toLowerCase()) ?? cur.base_playlist_id ?? report[0]?.id ?? 0;
      if (!base) throw new AppError(409, 'no_base', 'laut.fm braucht eine Basis-Playlist – bitte im Plan eine Hauptplaylist wählen');
      const entries = gridEntries(grid, base);
      await this.ra(stationId, 'PATCH', '/schedule', { base_playlist_id: base, entries });
      // Gegenkontrolle: hat laut.fm den Sendeplan wirklich so übernommen?
      const check = await this.getSchedule(stationId);
      const got = scheduleGrid(check.entries);
      const want = scheduleGrid(entries);
      scheduled = check.base_playlist_id === base && got.every((v, i) => v === want[i]);
      if (!scheduled) this.log(stationId, 'apply', 'laut.fm hat den Sendeplan anders gespeichert als gesendet – bitte unter „Sendeplan“ prüfen', false);
    }
    undo.summary = `${report.filter((r) => r.created).length} Playlist(en) angelegt, ${report.reduce((a, r) => a + r.added, 0)} Titel hinzugefügt${undo.schedule ? ', Sendeplan geändert' : ''}`;
    this.data(stationId).undo = undo;
    this.app.changed();
    if (p) this.app.audit.write({ kind: 'lautfm', event: 'programmchef_apply', actor: p.id, stationId, playlists: report.length });
    this.log(stationId, opts.refresh ? 'autopilot' : 'apply', undo.summary);
    return { playlists: report, schedule: scheduled, summary: undo.summary };
  }

  /** Letztes Einspielen zurücknehmen: neue Playlisten löschen, hinzugefügte Titel entfernen, alten Sendeplan zurück. */
  async undo(p: Principal, stationId: string): Promise<{ summary: string }> {
    const u = this.data(stationId).undo;
    if (!u) throw new AppError(404, 'nothing', 'Nichts zum Rückgängigmachen');
    if (u.schedule) await this.ra(stationId, 'PATCH', '/schedule', u.schedule);
    let removed = 0;
    for (const [pid, before] of Object.entries(u.touched)) {
      const now = await this.playlistTrackIds(stationId, Number(pid));
      for (const id of now) if (!before.includes(id)) { await this.ra(stationId, 'DELETE', `/playlists/${pid}/entries/${id}`); removed++; }
    }
    for (const id of u.created) await this.ra(stationId, 'DELETE', `/playlists/${id}`).catch(() => undefined);
    delete this.data(stationId).undo;
    this.app.changed();
    const summary = `Zurückgenommen: ${u.created.length} Playlist(en) gelöscht, ${removed} Titel entfernt${u.schedule ? ', Sendeplan wiederhergestellt' : ''}`;
    this.app.audit.write({ kind: 'lautfm', event: 'programmchef_undo', actor: p.id, stationId });
    this.log(stationId, 'undo', summary);
    return { summary };
  }

  // ---------- Autopilot ----------

  /** Läuft für den Sender gerade der Autopilot? (Die Playlist-Pflege wartet dann.) */
  isBusy(stationId: string): boolean {
    return this.autoRunning.has(stationId);
  }

  status(stationId: string): unknown {
    const d = this.data(stationId);
    return {
      autopilot: { enabled: false, brief: '', everyHours: 24, ...d.autopilot, running: this.autoRunning.has(stationId) },
      undo: d.undo ? { at: d.undo.at, summary: d.undo.summary } : null,
      log: d.log ?? [],
      ai: !!this.app.svc.ai.aiConfig(stationId).text.providerId,
    };
  }

  setAutopilot(p: Principal, stationId: string, input: Record<string, unknown>): unknown {
    const d = this.data(stationId);
    const cur: AutopilotConfig = { enabled: false, brief: '', everyHours: 24, ...d.autopilot };
    const brief = typeof input.brief === 'string' ? input.brief.trim().slice(0, 2000) : cur.brief;
    const every = [6, 12, 24, 48, 168].includes(Number(input.everyHours)) ? Number(input.everyHours) : cur.everyHours;
    const enabled = typeof input.enabled === 'boolean' ? input.enabled : cur.enabled;
    if (enabled && !brief) throw new AppError(400, 'no_brief', 'Für den Autopilot eine Vorgabe eintragen (z. B. „Tagsüber aktuelle Hits, abends Rock, am Wochenende 90er“)');
    if (enabled) this.lfId(stationId);
    d.autopilot = { ...cur, enabled, brief, everyHours: every };
    if (d.autoPlan && d.autoPlan.brief !== brief) delete d.autoPlan;
    this.app.audit.write({ kind: 'lautfm', event: 'programmchef_autopilot', actor: p.id, stationId, enabled });
    this.app.changed();
    return this.status(stationId);
  }

  /** Einmal ausführen: Vorgabe verstehen (gemerkt, solange sie gleich bleibt), Titel sammeln, Playlisten auffrischen. */
  async runAutopilot(stationId: string): Promise<string> {
    const d = this.data(stationId);
    const cfg = d.autopilot;
    if (!cfg?.brief) throw new AppError(400, 'no_brief', 'Keine Autopilot-Vorgabe gespeichert');
    if (this.autoRunning.has(stationId)) throw new AppError(409, 'busy', 'Der Autopilot läuft gerade');
    this.autoRunning.add(stationId);
    try {
      if (!d.autoPlan || d.autoPlan.brief !== cfg.brief || Date.now() - d.autoPlan.at > 7 * 86400_000) {
        const u = await this.understand(stationId, cfg.brief, false);
        d.autoPlan = { brief: cfg.brief, plan: u.plan, at: Date.now() };
      }
      const plan = d.autoPlan.plan;
      const results: CollectResult[] = [];
      for (const p of plan.playlists) results.push(await this.collectPlaylist(stationId, p));
      const r = await this.apply(null, stationId, plan, results, { refresh: true });
      cfg.lastResult = `${r.summary}${r.playlists.some((x) => x.removed) ? `, ${r.playlists.reduce((a, x) => a + x.removed, 0)} Titel ausgetauscht` : ''}`;
      cfg.lastOk = true;
      return cfg.lastResult;
    } catch (err) {
      cfg.lastResult = (err as Error).message;
      cfg.lastOk = false;
      this.log(stationId, 'autopilot', cfg.lastResult, false);
      throw err;
    } finally {
      cfg.lastRun = Date.now();
      this.autoRunning.delete(stationId);
      this.app.changed();
    }
  }

  /** Vom App-Takt aufgerufen (etwa minütlich): fällige Autopilot-Läufe starten. */
  tick(stationId: string, now = Date.now()): void {
    const cfg = this.data(stationId).autopilot;
    if (!cfg?.enabled || this.autoRunning.has(stationId)) return;
    if (cfg.lastRun && now - cfg.lastRun < cfg.everyHours * 3600_000) return;
    // nach einem Fehler höchstens stündlich erneut versuchen
    if (cfg.lastOk === false && cfg.lastRun && now - cfg.lastRun < 3600_000) return;
    void this.runAutopilot(stationId).catch(() => undefined);
  }
}

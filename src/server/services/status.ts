// Öffentlicher Stream-Status (wie Icecast status-json) für alle Sendewege, mit kurzem Zwischenspeicher.

import type { AnMaChaCastApp } from '../app.ts';
import { AppError } from '../model.ts';
import { PUBLIC_API } from '../lautfm.ts';
import { lautfmStatus, listenUrlOf, type StreamStatus } from '../status.ts';
import type { ExternalNow } from '../bridge.ts';

export class StatusService {
  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  readonly statusCache = new Map<string, { at: number; data: Promise<StreamStatus> }>();

  readonly startedAt = new Date().toISOString();

  cached(key: string, ttlMs: number, fn: () => Promise<StreamStatus>): Promise<StreamStatus> {
    const hit = this.statusCache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    const data = fn();
    this.statusCache.set(key, { at: Date.now(), data });
    data.catch(() => this.statusCache.delete(key));
    if (this.statusCache.size > 200) this.statusCache.delete(this.statusCache.keys().next().value!);
    return data;
  }

  /** Zwischenspeicher eines Senders verwerfen (z. B. nach gemeldetem Now Playing). */
  invalidate(stationId: string): void {
    for (const k of [...this.statusCache.keys()]) if (k.startsWith(`a:${stationId}:`)) this.statusCache.delete(k);
  }

  /** Öffentliche Senderliste für die Statusseite. */
  publicStations(): { id: string; name: string; lautfm?: string }[] {
    return [...this.app.stations.values()].filter((r) => r.station.publicStatus !== false).map((r) => ({ id: r.station.id, name: r.station.name, ...(r.data.lautfm?.stationName ? { lautfm: r.data.lautfm.stationName } : {}) }));
  }

  // ---------- Öffentliche Seiten (Senderseite, Sendeplan, Charts, Netzwerk) ----------

  private publicRt(stationId: string) {
    const rt = this.app.stations.get(stationId);
    if (!rt || rt.station.publicStatus === false) throw new AppError(404, 'not_found', 'Sender nicht gefunden oder nicht öffentlich');
    return rt;
  }

  private brand(stationId: string) {
    const s = this.publicRt(stationId).station;
    return { id: s.id, name: s.name, slogan: s.slogan, genre: s.genre ?? '', color: s.primaryColor, accent: s.accentColor, logo: s.logo ? `/api/v1/stations/${s.id}/logo?v=${encodeURIComponent(s.logo)}` : null };
  }

  /** Wochen-Sendeplan (Sendungen aus dem Sendeplan) + aktuelle Sendung. */
  publicSchedule(stationId: string, now = new Date()): { station: ReturnType<StatusService['brand']>; days: { day: number; label: string; shows: { label: string; from: string; to: string; now: boolean }[] }[]; current: { label: string; from: string; to: string } | null } {
    const rt = this.publicRt(stationId);
    const plans = rt.data.plans ?? [];
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = (now.getDay() + 6) % 7;
    const inWindow = (p: { from: string; to: string }, t: string) => (p.from === p.to ? true : p.from < p.to ? t >= p.from && t < p.to : t >= p.from || t < p.to);
    const labels = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
    const days = labels.map((label, day) => ({
      day, label,
      shows: plans.filter((p) => !p.days.length || p.days.includes(day)).sort((a, b) => a.from.localeCompare(b.from))
        .map((p) => ({ label: p.label, from: p.from, to: p.to, now: day === today && inWindow(p, hhmm) })),
    }));
    const cur = days[today]!.shows.find((x) => x.now);
    return { station: this.brand(stationId), days, current: cur ? { label: cur.label, from: cur.from, to: cur.to } : null };
  }

  /** Charts: meistgespielte Musiktitel (7 oder 30 Tage), kein Login. */
  publicCharts(stationId: string, period: string): { station: ReturnType<StatusService['brand']>; period: string; items: { rank: number; title: string; artist: string; plays: number; cover: string | null }[] } {
    const rt = this.publicRt(stationId);
    const p = period === '30d' ? '30d' : period === 'today' ? 'today' : '7d';
    const st = this.app.svc.stats.stats(stationId, p);
    const lib = new Set((rt.data.library ?? []).map((m) => m.id));
    // Öffentliche Cover-Adresse (ohne Login); nur für Titel, bei denen ein Cover möglich ist
    return { station: this.brand(stationId), period: p, items: st.topSongs.slice(0, 20).map((t, i) => ({ rank: i + 1, title: t.title, artist: t.artist, plays: t.plays, cover: lib.has(t.mediaId) && this.app.svc.media.coverPossible(stationId, t.mediaId) ? `/api/v1/public/stations/${stationId}/cover/${t.mediaId}` : null })) };
  }

  /** Cover eines Titels aus den Charts (7 oder 30 Tage) - nur dafür, damit niemand die ganze Bibliothek abgreifen oder ffmpeg anstoßen kann. */
  async publicCover(stationId: string, mediaId: string): Promise<string> {
    this.publicRt(stationId);
    const inCharts = ['7d', '30d'].some((p) => this.app.svc.stats.stats(stationId, p as '7d' | '30d').topSongs.slice(0, 20).some((t) => t.mediaId === mediaId));
    const file = inCharts ? await this.app.svc.media.cover(stationId, mediaId).catch(() => null) : null;
    if (!file) throw new AppError(404, 'no_cover', 'Kein Cover');
    return file;
  }

  /** Senderseite: Marke, Stream-Status (Jetzt läuft, Hörer, Stream-Adresse), aktuelle Sendung, Top 5, Podcast-Feed. */
  async publicPage(stationId: string, host: string): Promise<unknown> {
    const rt = this.publicRt(stationId);
    const status = await this.streamStatus(stationId, host);
    const schedule = this.publicSchedule(stationId);
    const charts = this.publicCharts(stationId, '7d');
    const episodes = (rt.data.episodes ?? []).filter((e) => e.publishedAt).length;
    return {
      station: this.brand(stationId), status, current: schedule.current,
      today: schedule.days[(new Date().getDay() + 6) % 7]!.shows, charts: charts.items.slice(0, 5),
      podcast: episodes ? { episodes, feed: `/api/v1/public/stations/${stationId}/podcast.xml` } : null,
      team: this.publicTeam(stationId),
    };
  }

  /** Team: Benutzer dieses Senders, die in „Mein Profil“ Links hinterlegt haben (nur dann öffentlich, kein Benutzername). */
  private publicTeam(stationId: string): { name: string; links: Record<string, string> }[] {
    return this.app.users.list()
      .filter((u) => !u.disabled && u.links && Object.keys(u.links).length && (u.stationIds.includes('*') || u.stationIds.includes(stationId)))
      .map((u) => ({ name: u.name, links: u.links! }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .slice(0, 30);
  }

  /** Netzwerk: alle öffentlichen Sender mit Jetzt läuft, Hörern und Sendestatus. */
  async publicNetwork(host: string): Promise<{ stations: unknown[] }> {
    const list = this.publicStations();
    const stations = await Promise.all(list.map(async (s) => {
      const brand = this.brand(s.id);
      try {
        const st = await this.streamStatus(s.id, host);
        const src = st.icestats.source[0];
        return { ...brand, onAir: !!src, listeners: st.icestats.source.reduce((a, x) => a + (x.listeners ?? 0), 0), now: st.now ? { title: st.now.title, artist: st.now.artist } : null, listenUrl: src?.listenurl ?? null, lautfm: s.lautfm ?? null };
      } catch {
        return { ...brand, onAir: false, listeners: 0, now: null, listenUrl: null, lautfm: s.lautfm ?? null };
      }
    }));
    return { stations: stations.sort((a, b) => Number(b.onAir) - Number(a.onAir) || b.listeners - a.listeners || a.name.localeCompare(b.name, 'de')) };
  }

  /** Status eines AnMaCha-Cast-Senders: aktive Quelle, verbundene Ausgänge, laut.fm (falls verbunden), Now Playing, Verlauf. */
  streamStatus(stationId: string, host: string): Promise<StreamStatus> {
    const rt = this.app.stations.get(stationId);
    if (!rt || rt.station.publicStatus === false) return Promise.reject(new AppError(404, 'not_found', 'Sender nicht gefunden oder nicht öffentlich'));
    return this.cached(`a:${stationId}:${host}`, 5000, async () => {
      const lib = new Map(rt.data.library.map((m) => [m.id, m]));
      const m = rt.nowPlaying.mediaId ? lib.get(rt.nowPlaying.mediaId) : undefined;
      const active = this.app.engine.list(stationId).find((s) => s.state === 'active');
      const fmt = rt.data.playout?.format ?? 'mp3';
      const type = fmt === 'opus' ? 'application/ogg' : fmt === 'aac' ? 'audio/aac' : 'audio/mpeg';
      const title = m ? (m.artist ? `${m.artist} - ${m.title}` : m.title) : '';
      const sources: StreamStatus['icestats']['source'] = [];
      for (const o of this.app.outputs.values()) {
        if (o.cfg.stationId !== stationId || !o.cfg.enabled || o.state.status !== 'connected') continue;
        if (/(^|\.)laut\.fm$/i.test(o.cfg.host) && rt.data.lautfm?.stationName) continue; // kommt unten mit echten laut.fm-Daten
        sources.push({
          kind: o.cfg.type === 'shoutcast' ? 'shoutcast' : 'icecast', listenurl: listenUrlOf(o.cfg), server_name: rt.station.name, server_description: rt.station.slogan,
          server_type: o.state.contentType ?? type, genre: rt.station.genre, bitrate: o.cfg.bitrateKbps ?? rt.data.playout?.bitrateKbps ?? null,
          listeners: o.state.listeners ?? null, title, artist: m?.artist, stream_start_iso8601: o.state.connectedAt ? new Date(o.state.connectedAt).toISOString() : null,
        });
      }
      let laut: StreamStatus | null = null;
      if (rt.data.lautfm?.stationName) laut = await this.lautfmPublicStatus(rt.data.lautfm.stationName).catch(() => null);
      if (laut) sources.push(...laut.icestats.source);
      // Gespiegelte Systeme (AzuraCast/Icecast) und per Bridge-API gemeldete Streams
      let ext: ExternalNow | undefined;
      for (const b of rt.data.bridges ?? []) {
        const d = b.mirror ? this.app.svc.bridges.bridgeStatus.get(b.id)?.data : undefined;
        if (!d) continue;
        ext ??= d;
        for (const u of d.listenUrls.slice(0, 3)) {
          sources.push({ kind: b.kind === 'azuracast' ? 'azuracast' : 'icecast', listenurl: u, server_name: d.name, server_type: d.format ? (d.format.includes('/') ? d.format : `audio/${d.format}`) : 'audio/mpeg',
            bitrate: d.bitrate ?? null, listeners: d.listeners, title: d.now ? (d.now.artist ? `${d.now.artist} - ${d.now.title}` : d.now.title) : '', artist: d.now?.artist, stream_start_iso8601: d.now?.started_at ?? null, genre: rt.station.genre });
        }
      }
      const pushed = this.app.svc.bridges.externalNow.get(stationId);
      if (pushed && Date.now() - pushed.at < 6 * 3600_000) {
        ext = pushed;
        for (const u of pushed.listenUrls) sources.push({ kind: 'extern', listenurl: u, server_name: rt.station.name, server_type: 'audio/mpeg', listeners: pushed.listeners, title: pushed.now ? (pushed.now.artist ? `${pushed.now.artist} - ${pushed.now.title}` : pushed.now.title) : '', artist: pushed.now?.artist, stream_start_iso8601: pushed.now?.started_at ?? null });
      }
      const log = (rt.data.playLog ?? []).filter((e) => e.category === 'music').slice(0, 10);
      return {
        kind: 'anmachacast', station: stationId, name: rt.station.name, description: rt.station.slogan,
        icestats: { admin: '', host, location: 'AnMaCha Cast', server_id: `AnMaCha Cast ${this.app.updater.current}`, server_start_iso8601: this.startedAt, source: sources },
        now: m ? { artist: m.artist, title: m.title, album: m.album, started_at: rt.nowPlaying.startedAt ? new Date(rt.nowPlaying.startedAt).toISOString() : null,
          ends_at: rt.nowPlaying.startedAt && m.durationMs ? new Date(rt.nowPlaying.startedAt + m.durationMs - (m.cueInMs ?? 0)).toISOString() : null } : ext?.now ?? laut?.now ?? null,
        last_songs: log.length ? log.map((e) => ({ started_at: new Date(e.at).toISOString(), artist: e.artist, title: e.title })) : ext?.history.length ? ext.history : laut?.last_songs ?? [],
        onair: active ? { source: active.name, type: active.type, priority: active.priority } : null,
        links: { ...(laut?.links ?? {}), ...(rt.station.logo ? { logo: `/api/v1/stations/${stationId}/logo` } : {}) },
        updated_at: new Date().toISOString(),
      };
    });
  }

  /** Beliebiger laut.fm-Sender (Name) – Icecast-Status nachgebaut aus der öffentlichen API, 10 s zwischengespeichert. */
  lautfmPublicStatus(name: string): Promise<StreamStatus> {
    return this.cached(`l:${name}`, 10_000, () => lautfmStatus(name, PUBLIC_API));
  }

  /**
   * Wer automatisiert diesen Sender gerade tatsächlich? AnMaCha-Cast-Server-Playout, laut.fm über den
   * Radioadmin (eigener Algorithmus, AnMaCha Cast hat darauf keinen Einfluss) oder gar niemand. Das Studio
   * zeigt bei "lautfm" den aktuellen/letzten Titel aus der öffentlichen laut.fm-API statt leerer Decks -
   * AnMaCha Cast kennt den nächsten Titel in diesem Fall nicht (laut.fm veröffentlicht ihn nicht im Voraus).
   */
  async automationSource(stationId: string): Promise<{ source: 'anmachacast' | 'lautfm' | 'none'; now: StreamStatus['now'] }> {
    if (this.app.playouts.get(stationId)?.playout.status().running) {
      // laufenden Titel mitliefern – sonst meldet die Sendezentrale „Keine Automation aktiv“, obwohl sie läuft
      const rt = this.app.rt(stationId);
      const m = rt.nowPlaying.mediaId ? this.app.svc.media.media(stationId, rt.nowPlaying.mediaId) : null;
      return { source: 'anmachacast', now: m ? { artist: m.artist, title: m.title } : null };
    }
    const stationName = this.app.rt(stationId).data.lautfm?.stationName;
    if (!stationName) return { source: 'none', now: null };
    const laut = await this.lautfmPublicStatus(stationName).catch(() => null);
    return { source: 'lautfm', now: laut?.now ?? null };
  }
}

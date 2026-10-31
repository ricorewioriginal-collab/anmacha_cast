// Hörerstatistik - nach dem Statistik-Tab des AnMaCha Control Centers (automation.html): Zeitraum-Chips
// (Heute / 24 h / 7 Tage / 30 Tage / 3 Monate), Kennzahl-Kacheln, Untertabs Gespielt / Top-Songs /
// Hörer-Verlauf / Genre-Mix / Live-Plays. Grundlage: Play-Log (mit Hörerzahl je Titel), 30-s-Stichproben
// (48 h) und das Stunden-Aggregat listenerHours (100 Tage). Kein eigener Datenbestand.

import type { AnMaChaCastApp } from '../app.ts';
import { AppError, type PlayLogEntry } from '../model.ts';

export type StatsPeriod = 'today' | '24h' | '7d' | '30d' | '3m';
export const STATS_PERIODS: Record<StatsPeriod, string> = { today: 'Heute', '24h': '24 h', '7d': '7 Tage', '30d': '30 Tage', '3m': '3 Monate' };

export interface StatsReport {
  period: StatsPeriod;
  from: number;
  to: number;
  kpis: {
    played: number;
    listenersNow: number;
    avgPerSong: number | null;
    peak: number;
    livePlays: number;
    uniqueSongs: number;
    topSong: { title: string; artist: string; plays: number } | null;
    hoursOnAir: number;
  };
  played: PlayLogEntry[];
  topSongs: { mediaId: string; title: string; artist: string; plays: number; avgListeners: number | null }[];
  topArtists: { artist: string; plays: number }[];
  /** Hörer-Verlauf: Punkte (Zeit → Ø Hörer), Auflösung je nach Zeitraum (10 min / Stunde / Tag) */
  series: { at: number; avg: number; peak: number }[];
  seriesStep: 'minutes' | 'hours' | 'days';
  /** Ø Hörer nach Tageszeit 0–23 (null = keine Daten) */
  byHour: (number | null)[];
  genres: { genre: string; plays: number }[];
  livePlays: PlayLogEntry[];
  categories: { category: string; plays: number }[];
}

/** Deep Stats: Heatmap Wochentag × Uhrzeit, Top/Flop mit Vorperiode, Interpreten-Anteile, Song-Verlauf. */
export interface DeepReport {
  period: StatsPeriod;
  from: number;
  to: number;
  /** [Wochentag 0 = Montag … 6][Stunde 0–23] → Ø Hörer, null = keine Daten */
  heatmap: (number | null)[][];
  heatmapPeak: number;
  /** Kennzahlen mit Vergleich zur Vorperiode gleicher Länge */
  compare: { key: string; label: string; now: number | null; prev: number | null; delta: number | null }[];
  top: { mediaId: string; title: string; artist: string; plays: number; avgListeners: number | null }[];
  flop: { mediaId: string; title: string; artist: string; plays: number; avgListeners: number | null }[];
  /** Interpreten-Anteile an allen Musik-Einsätzen (Top 10 + Sonstige) */
  artists: { artist: string; plays: number; share: number }[];
  /** Song-Verlauf: Einsätze je Tag für die fünf meistgespielten Titel */
  trend: { days: string[]; songs: { title: string; artist: string; plays: number[] }[] };
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const csvField = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const num = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

export function periodRange(period: StatsPeriod, now = Date.now()): { from: number; to: number } {
  if (period === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return { from: d.getTime(), to: now }; }
  const h = period === '24h' ? 24 : period === '7d' ? 7 * 24 : period === '30d' ? 30 * 24 : 90 * 24;
  return { from: now - h * 3_600_000, to: now };
}

export class StatsService {
  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  stats(stationId: string, periodIn: string): StatsReport {
    const period = (Object.keys(STATS_PERIODS) as StatsPeriod[]).includes(periodIn as StatsPeriod) ? (periodIn as StatsPeriod) : null;
    if (!period) throw new AppError(400, 'invalid_period', 'Zeitraum: today, 24h, 7d, 30d oder 3m');
    const rt = this.app.rt(stationId);
    const { from, to } = periodRange(period);
    const played = (rt.data.playLog ?? []).filter((e) => e.at >= from && e.at <= to);
    const byMedia = new Map<string, { title: string; artist: string; plays: number; sum: number; n: number }>();
    const byArtist = new Map<string, number>();
    const byGenre = new Map<string, number>();
    const byCat = new Map<string, number>();
    const lib = new Map(rt.data.library.map((m) => [m.id, m]));
    for (const e of played) {
      byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
      if (e.category !== 'music') continue;
      const s = byMedia.get(e.mediaId) ?? { title: e.title, artist: e.artist, plays: 0, sum: 0, n: 0 };
      s.plays++;
      if (typeof e.listeners === 'number') { s.sum += e.listeners; s.n++; }
      byMedia.set(e.mediaId, s);
      if (e.artist) byArtist.set(e.artist, (byArtist.get(e.artist) ?? 0) + 1);
      const g = lib.get(e.mediaId)?.genre?.trim();
      if (g) byGenre.set(g, (byGenre.get(g) ?? 0) + 1);
    }
    const topSongs = [...byMedia.entries()].map(([mediaId, s]) => ({ mediaId, title: s.title, artist: s.artist, plays: s.plays, avgListeners: s.n ? Math.round(s.sum / s.n) : null }))
      .sort((a, b) => b.plays - a.plays || (b.avgListeners ?? 0) - (a.avgListeners ?? 0)).slice(0, 50);
    const withListeners = played.filter((e) => typeof e.listeners === 'number');
    const avgPerSong = withListeners.length ? Math.round(withListeners.reduce((s, e) => s + e.listeners!, 0) / withListeners.length) : null;
    const livePlays = played.filter((e) => e.live);

    // Hörer-Verlauf
    const { series, seriesStep, peak, byHour } = this.series(stationId, period, from, to);
    const hoursOnAir = Math.round(series.filter((p) => p.avg > 0 || p.peak > 0).length * (seriesStep === 'minutes' ? 1 / 6 : seriesStep === 'hours' ? 1 : 24) * 10) / 10;

    return {
      period, from, to,
      kpis: {
        played: played.length, listenersNow: this.app.listenersNow(stationId), avgPerSong, peak: Math.max(peak, ...withListeners.map((e) => e.listeners!)),
        livePlays: livePlays.length, uniqueSongs: byMedia.size,
        topSong: topSongs[0] ? { title: topSongs[0].title, artist: topSongs[0].artist, plays: topSongs[0].plays } : null, hoursOnAir,
      },
      played: played.slice(0, 300),
      topSongs,
      topArtists: [...byArtist.entries()].map(([artist, plays]) => ({ artist, plays })).sort((a, b) => b.plays - a.plays).slice(0, 20),
      series, seriesStep, byHour,
      genres: [...byGenre.entries()].map(([genre, plays]) => ({ genre, plays })).sort((a, b) => b.plays - a.plays).slice(0, 12),
      livePlays: livePlays.slice(0, 200),
      categories: [...byCat.entries()].map(([category, plays]) => ({ category, plays })).sort((a, b) => b.plays - a.plays),
    };
  }

  /**
   * Kennzahlen für die Senderkarten der Sendezentrale: Hörer jetzt (verbundene Ausgänge), Ø 24 h aus den
   * 30-s-Stichproben, Ø 7 Tage aus dem Stunden-Aggregat. null = noch keine Daten.
   */
  cardNumbers(stationId: string, now = Date.now()): { live: number; avg24h: number | null; avg7d: number | null } {
    const rt = this.app.rt(stationId);
    const h = 3_600_000;
    let sum = 0, n = 0;
    for (const s of rt.data.recapSamples ?? []) if (s.at >= now - 24 * h) { sum += s.listeners; n++; }
    let sum7 = 0, n7 = 0;
    for (const x of rt.data.listenerHours ?? []) if (x.at >= now - 7 * 24 * h) { sum7 += x.sum; n7 += x.n; }
    return {
      live: this.app.listenersNow(stationId),
      avg24h: n ? Math.round((sum / n) * 10) / 10 : null,
      avg7d: n7 ? Math.round((sum7 / n7) * 10) / 10 : null,
    };
  }

  deep(stationId: string, periodIn: string, now = Date.now()): DeepReport {
    const period = (Object.keys(STATS_PERIODS) as StatsPeriod[]).includes(periodIn as StatsPeriod) ? (periodIn as StatsPeriod) : null;
    if (!period) throw new AppError(400, 'invalid_period', 'Zeitraum: today, 24h, 7d, 30d oder 3m');
    const rt = this.app.rt(stationId);
    const { from, to } = periodRange(period, now);
    const len = to - from;
    const h = 3_600_000;
    const weekday = (t: number) => (new Date(t).getDay() + 6) % 7;

    // Heatmap: kurze Zeiträume aus den 30-s-Stichproben, längere aus dem Stunden-Aggregat
    const cells: { sum: number; n: number }[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ sum: 0, n: 0 })));
    if (period === 'today' || period === '24h') {
      for (const s of rt.data.recapSamples ?? []) if (s.at >= from && s.at <= to) { const c = cells[weekday(s.at)]![new Date(s.at).getHours()]!; c.sum += s.listeners; c.n++; }
    } else {
      for (const x of rt.data.listenerHours ?? []) if (x.at >= from - h && x.at <= to) { const c = cells[weekday(x.at)]![new Date(x.at).getHours()]!; c.sum += x.sum; c.n += x.n; }
    }
    const heatmap = cells.map((row) => row.map((c) => (c.n ? Math.round((c.sum / c.n) * 10) / 10 : null)));
    const heatmapPeak = Math.max(0, ...heatmap.flat().map((v) => v ?? 0));

    // Kennzahlen jetzt vs. Vorperiode
    const kpis = (f: number, t: number) => {
      const played = (rt.data.playLog ?? []).filter((e) => e.at >= f && e.at <= t);
      const withL = played.filter((e) => typeof e.listeners === 'number');
      const music = played.filter((e) => e.category === 'music');
      return {
        played: played.length,
        music: music.length,
        unique: new Set(music.map((e) => e.mediaId)).size,
        avg: withL.length ? Math.round(withL.reduce((a, e) => a + e.listeners!, 0) / withL.length) : null,
        peak: withL.length ? Math.max(...withL.map((e) => e.listeners!)) : null,
        live: played.filter((e) => e.live).length,
      };
    };
    const cur = kpis(from, to);
    const prev = kpis(from - len, from);
    const row = (key: keyof typeof cur, label: string) => {
      const a = cur[key], b = prev[key];
      return { key, label, now: a, prev: b, delta: a != null && b != null && b !== 0 ? Math.round(((a - b) / b) * 100) : null };
    };
    const compare = [row('played', 'Gespielt'), row('music', 'Musiktitel'), row('unique', 'Einzelne Songs'), row('avg', 'Ø Hörer/Song'), row('peak', 'Peak Hörer'), row('live', 'Live-Plays')];

    // Top/Flop + Interpreten-Anteile + Song-Verlauf aus den Musik-Einsätzen des Zeitraums
    const played = (rt.data.playLog ?? []).filter((e) => e.at >= from && e.at <= to && e.category === 'music');
    const byMedia = new Map<string, { title: string; artist: string; plays: number; sum: number; n: number; days: Map<string, number> }>();
    const byArtist = new Map<string, number>();
    const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    for (const e of played) {
      const s = byMedia.get(e.mediaId) ?? { title: e.title, artist: e.artist, plays: 0, sum: 0, n: 0, days: new Map() };
      s.plays++;
      if (typeof e.listeners === 'number') { s.sum += e.listeners; s.n++; }
      s.days.set(dayKey(e.at), (s.days.get(dayKey(e.at)) ?? 0) + 1);
      byMedia.set(e.mediaId, s);
      byArtist.set(e.artist || '–', (byArtist.get(e.artist || '–') ?? 0) + 1);
    }
    const songs = [...byMedia.entries()].map(([mediaId, s]) => ({ mediaId, title: s.title, artist: s.artist, plays: s.plays, avgListeners: s.n ? Math.round(s.sum / s.n) : null, days: s.days }));
    const top = [...songs].sort((a, b) => b.plays - a.plays || (b.avgListeners ?? 0) - (a.avgListeners ?? 0)).slice(0, 10);
    const flop = songs.filter((x) => x.avgListeners != null).sort((a, b) => a.avgListeners! - b.avgListeners! || a.plays - b.plays).slice(0, 10);
    const total = played.length || 1;
    const artistsSorted = [...byArtist.entries()].sort((a, b) => b[1] - a[1]);
    const artists = artistsSorted.slice(0, 10).map(([artist, plays]) => ({ artist, plays, share: Math.round((plays / total) * 1000) / 10 }));
    const rest = artistsSorted.slice(10).reduce((a, [, n]) => a + n, 0);
    if (rest) artists.push({ artist: 'Sonstige', plays: rest, share: Math.round((rest / total) * 1000) / 10 });
    const days: string[] = [];
    for (let t = from; t <= to; t += 24 * h) days.push(dayKey(t));
    if (days[days.length - 1] !== dayKey(to)) days.push(dayKey(to));
    const trend = { days, songs: top.slice(0, 5).map((x) => ({ title: x.title, artist: x.artist, plays: days.map((d) => x.days.get(d) ?? 0) })) };

    return {
      period, from, to, heatmap, heatmapPeak, compare,
      top: top.map(({ days: _d, ...x }) => x), flop: flop.map(({ days: _d, ...x }) => x), artists, trend,
    };
  }

  /** Deep Stats als Semikolon-CSV (Excel-tauglich): Kennzahlen, Top/Flop, Interpreten, Heatmap. */
  deepCsv(stationId: string, period: string, now?: number): string {
    const r = this.deep(stationId, period, now);
    const rt = this.app.rt(stationId);
    const L: string[] = [];
    L.push(`Deep Stats;${csvField(rt.station.name)};${csvField(STATS_PERIODS[r.period])}`);
    L.push(`Von;${csvField(new Date(r.from).toLocaleString('de-DE'))};Bis;${csvField(new Date(r.to).toLocaleString('de-DE'))}`);
    L.push('');
    L.push(['Kennzahl', 'Jetzt', 'Vorperiode', 'Δ %'].map(csvField).join(';'));
    for (const c of r.compare) L.push([c.label, num(c.now), num(c.prev), num(c.delta)].map(csvField).join(';'));
    L.push('');
    L.push(['Top-Songs', 'Interpret', 'Titel', 'Einsätze', 'Ø Hörer'].map(csvField).join(';'));
    r.top.forEach((t, i) => L.push([i + 1, t.artist, t.title, t.plays, num(t.avgListeners)].map(csvField).join(';')));
    L.push('');
    L.push(['Flop-Songs', 'Interpret', 'Titel', 'Einsätze', 'Ø Hörer'].map(csvField).join(';'));
    r.flop.forEach((t, i) => L.push([i + 1, t.artist, t.title, t.plays, num(t.avgListeners)].map(csvField).join(';')));
    L.push('');
    L.push(['Interpret', 'Einsätze', 'Anteil %'].map(csvField).join(';'));
    for (const a of r.artists) L.push([a.artist, a.plays, num(a.share)].map(csvField).join(';'));
    L.push('');
    L.push(['Heatmap Ø Hörer', ...Array.from({ length: 24 }, (_, i) => `${i} Uhr`)].map(csvField).join(';'));
    r.heatmap.forEach((row, d) => L.push([WEEKDAYS[d], ...row.map(num)].map(csvField).join(';')));
    L.push('');
    L.push(['Song-Verlauf', ...r.trend.days].map(csvField).join(';'));
    for (const sng of r.trend.songs) L.push([`${sng.artist ? `${sng.artist} – ` : ''}${sng.title}`, ...sng.plays].map(csvField).join(';'));
    return L.join('\r\n') + '\r\n';
  }

  /** Kurzfassung als Text (E-Mail). */
  deepText(stationId: string, period: string, now?: number): string {
    const r = this.deep(stationId, period, now);
    const rt = this.app.rt(stationId);
    const fmtDelta = (d: number | null) => (d == null ? '' : ` (${d > 0 ? '+' : ''}${d} % zur Vorperiode)`);
    return [
      `Deep Stats – ${rt.station.name} – ${STATS_PERIODS[r.period]}`,
      `${new Date(r.from).toLocaleString('de-DE')} bis ${new Date(r.to).toLocaleString('de-DE')}`,
      '',
      ...r.compare.map((c) => `${c.label}: ${c.now ?? '–'}${fmtDelta(c.delta)}`),
      '',
      'Top-Songs:',
      ...r.top.slice(0, 5).map((t, i) => `${i + 1}. ${t.artist ? `${t.artist} – ` : ''}${t.title} (${t.plays}×${t.avgListeners != null ? `, Ø ${t.avgListeners} Hörer` : ''})`),
      '',
      'Flop-Songs (wenigste Hörer):',
      ...r.flop.slice(0, 5).map((t, i) => `${i + 1}. ${t.artist ? `${t.artist} – ` : ''}${t.title} (Ø ${t.avgListeners} Hörer)`),
      '',
      'Interpreten-Anteile:',
      ...r.artists.slice(0, 5).map((a) => `${a.artist}: ${a.share} %`),
    ].join('\n');
  }

  async emailDeep(stationId: string, period: string, toAddress?: string): Promise<boolean> {
    const cfg = this.app.rt(stationId).data.integrations?.email;
    if (!cfg) throw new AppError(400, 'no_email', 'Zuerst unter Benachrichtigungen einen E-Mail-Kanal einrichten');
    const ok = await this.app.notifier.sendCustomEmail(cfg, `Deep Stats – ${this.app.rt(stationId).station.name}`, this.deepText(stationId, period), toAddress?.trim() || undefined);
    this.app.audit.write({ kind: 'stats', event: ok ? 'emailed' : 'email_failed', stationId, period });
    return ok;
  }

  private series(stationId: string, period: StatsPeriod, from: number, to: number) {
    const rt = this.app.rt(stationId);
    const byHour: { sum: number; n: number }[] = Array.from({ length: 24 }, () => ({ sum: 0, n: 0 }));
    let peak = 0;
    const series: { at: number; avg: number; peak: number }[] = [];
    let seriesStep: 'minutes' | 'hours' | 'days';
    if (period === 'today' || period === '24h') {
      // 30-s-Stichproben → 10-Minuten-Raster
      seriesStep = 'minutes';
      const step = 600_000;
      const buckets = new Map<number, { sum: number; n: number; peak: number }>();
      for (const s of rt.data.recapSamples ?? []) {
        if (s.at < from || s.at > to) continue;
        const k = s.at - (s.at % step);
        const b = buckets.get(k) ?? { sum: 0, n: 0, peak: 0 };
        b.sum += s.listeners; b.n++; b.peak = Math.max(b.peak, s.listeners);
        buckets.set(k, b);
        peak = Math.max(peak, s.listeners);
        const h = byHour[new Date(s.at).getHours()]!; h.sum += s.listeners; h.n++;
      }
      for (const [at, b] of [...buckets.entries()].sort((a, c) => a[0] - c[0])) series.push({ at, avg: Math.round((b.sum / b.n) * 10) / 10, peak: b.peak });
    } else {
      const hours = (rt.data.listenerHours ?? []).filter((h) => h.at >= from - 3_600_000 && h.at <= to);
      for (const h of hours) {
        peak = Math.max(peak, h.peak);
        const bh = byHour[new Date(h.at).getHours()]!; bh.sum += h.sum; bh.n += h.n;
      }
      if (period === '7d') {
        seriesStep = 'hours';
        for (const h of hours) series.push({ at: h.at, avg: Math.round((h.sum / Math.max(1, h.n)) * 10) / 10, peak: h.peak });
      } else {
        seriesStep = 'days';
        const days = new Map<number, { sum: number; n: number; peak: number }>();
        for (const h of hours) {
          const d = new Date(h.at); d.setHours(0, 0, 0, 0);
          const b = days.get(d.getTime()) ?? { sum: 0, n: 0, peak: 0 };
          b.sum += h.sum; b.n += h.n; b.peak = Math.max(b.peak, h.peak);
          days.set(d.getTime(), b);
        }
        for (const [at, b] of [...days.entries()].sort((a, c) => a[0] - c[0])) series.push({ at, avg: Math.round((b.sum / Math.max(1, b.n)) * 10) / 10, peak: b.peak });
      }
    }
    return { series, seriesStep, peak, byHour: byHour.map((h) => (h.n ? Math.round((h.sum / h.n) * 10) / 10 : null)) };
  }
}

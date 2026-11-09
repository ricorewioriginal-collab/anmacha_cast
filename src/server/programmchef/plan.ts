// Programm-Plan des KI-Programmchefs (Port aus dem AnMaCha Control Center, ai-lautplan.php): Datenmodell, Prüfung/
// Normalisierung der KI-Antwort, Regel-Planer ohne KI (Uhrzeiten, Tage, Anzahl aus dem Text) und das Sendeplan-Raster.
// laut.fm-Sendeplan: 168 Stunden-Slots (slot = Tag·24 + Stunde, 0 = Montag 0 Uhr), Basis-Playlist nicht in den Einträgen.

export type PlanSource = 'chart_de' | 'chart_global' | 'ai' | 'pool_genre' | 'artists' | 'existing';

export interface PlanPlaylist {
  name: string;
  description: string;
  why: string;
  wish: string;
  color: string;
  shuffled: boolean;
  count: number;
  source: PlanSource;
  genres: string[];
  artists: string[];
  must: string[];
  avoid: string[];
  minYear: number | null;
  maxYear: number | null;
  mood: string;
  energy: '' | 'ruhig' | 'mittel' | 'energie' | 'tanz';
  lang: '' | 'de' | 'en' | 'mix';
  fame: '' | 'hits' | 'mix' | 'tipps';
  perArtist: number;
}

export interface PlanSlot {
  playlist: string;
  /** 1 = Montag … 7 = Sonntag */
  days: number[];
  from: number;
  to: number;
}

export interface Plan {
  summary: string;
  playlists: PlanPlaylist[];
  schedule: PlanSlot[];
  basePlaylist: string;
}

const SOURCES: PlanSource[] = ['chart_de', 'chart_global', 'ai', 'pool_genre', 'artists', 'existing'];

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\x00-\x1f<>]/g, ' ').trim().slice(0, max) : '');
const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => str(String(x ?? ''), 60)).filter(Boolean).slice(0, max) : []);

function hashColor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `#${(h & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** KI-Antwort prüfen und vereinheitlichen – Ergebnis ist ein gültiger Plan oder null. Fakten aus dem Wunschtext haben Vorrang. */
export function normalizePlan(j: unknown, prompt = '', now = new Date()): Plan | null {
  const o = j as Record<string, any> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.playlists) || !o.playlists.length) return null;
  const yearMax = now.getFullYear() + 1;
  const yr = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 1950 && n <= yearMax ? n : null; };
  const playlists: PlanPlaylist[] = [];
  const seen = new Set<string>();
  for (const p of o.playlists.slice(0, 20)) {
    if (!p || typeof p !== 'object') continue;
    const name = str(p.name ?? p.title, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const source: PlanSource = SOURCES.includes(p.source) ? p.source : 'ai';
    const charts = source === 'chart_de' || source === 'chart_global';
    playlists.push({
      name,
      description: str(p.description, 200),
      why: str(p.why, 300),
      wish: str(p.wish, 500),
      color: /^#[0-9a-f]{6}$/i.test(String(p.color ?? '')) ? String(p.color) : hashColor(name),
      shuffled: p.shuffled !== false,
      count: Math.max(1, Math.min(charts ? 100 : 500, Math.round(Number(p.count) || 50))),
      source,
      genres: list(p.genres, 6),
      artists: list(p.artists, 60),
      must: list(p.must, 60),
      avoid: list(p.avoid, 40),
      minYear: yr(p.min_year ?? p.minYear),
      maxYear: yr(p.max_year ?? p.maxYear),
      mood: str(p.mood, 120),
      energy: ['ruhig', 'mittel', 'energie', 'tanz'].includes(p.energy) ? p.energy : '',
      lang: ['de', 'en', 'mix'].includes(p.lang) ? p.lang : '',
      fame: ['hits', 'mix', 'tipps'].includes(p.fame) ? p.fame : '',
      perArtist: Math.max(0, Math.min(10, Math.round(Number(p.per_artist ?? p.perArtist) || 0))),
    });
  }
  if (!playlists.length) return null;
  const names = playlists.map((p) => p.name.toLowerCase());
  const schedule: PlanSlot[] = [];
  for (const s of (Array.isArray(o.schedule) ? o.schedule : []).slice(0, 40)) {
    if (!s || typeof s !== 'object') continue;
    const i = names.indexOf(str(s.playlist, 60).toLowerCase());
    if (i < 0) continue;
    const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 1 && d <= 7))] as number[];
    const from = Math.max(0, Math.min(23, Math.floor(Number(s.from) || 0)));
    const to = Math.max(from + 1, Math.min(24, Math.floor(Number(s.to) || 24)));
    if (days.length) schedule.push({ playlist: playlists[i]!.name, days, from, to });
  }
  const bi = names.indexOf(str(o.base_playlist ?? o.basePlaylist, 60).toLowerCase());
  const plan: Plan = { summary: str(o.summary, 900), playlists, schedule, basePlaylist: bi >= 0 ? playlists[bi]!.name : '' };
  // Eindeutiges aus dem Text setzt der Server selbst durch – unabhängig davon, wie gut das Sprachmodell war
  const t = prompt.toLowerCase();
  const isChart = /top\s*-?\s*\d+|charts?|hitliste|aktuelle?n?\s+hits/u.test(t);
  const n = /(\d{1,3})\s*(songs?|titel|tracks?|lieder)/u.exec(t);
  if (playlists.length === 1) {
    if (isChart && playlists[0]!.source === 'ai') playlists[0]!.source = /global|weltweit|international/u.test(t) ? 'chart_global' : 'chart_de';
    if (n) playlists[0]!.count = Math.max(1, Math.min(500, Number(n[1])));
  }
  return plan;
}

const DAY_WORDS: [RegExp, number[]][] = [
  [/werktag|wochentag|montag\s*(?:bis|-)\s*freitag|mo\s*-\s*fr/u, [1, 2, 3, 4, 5]],
  [/wochenende|samstag\s*(?:und|&)\s*sonntag|sa\s*(?:\+|und|-)\s*so/u, [6, 7]],
  [/täglich|jeden tag|immer|rund um die uhr/u, [1, 2, 3, 4, 5, 6, 7]],
];

/** Regel-Planer ohne KI: „Morgens Pop 6–10 Uhr, abends Rock 18–22 Uhr, je 60 Songs“ → Playlisten mit Sendezeiten. */
export function heuristicPlan(prompt: string, single: boolean): Plan | null {
  const text = prompt.trim();
  if (!text) return null;
  const parts = single ? [text] : text.split(/[,;\n]|\bund dann\b/u).map((x) => x.trim()).filter(Boolean);
  const count = Number(/(?:je|pro)?\s*(\d{1,3})\s*(?:songs?|titel|tracks?|lieder)/u.exec(text.toLowerCase())?.[1] ?? 50);
  const playlists: PlanPlaylist[] = [];
  const schedule: PlanSlot[] = [];
  for (const part of parts) {
    const low = part.toLowerCase();
    const time = /(\d{1,2})(?::00)?\s*(?:uhr)?\s*(?:-|–|bis)\s*(\d{1,2})(?::00)?\s*uhr?/u.exec(low);
    const name = part.replace(/\d{1,2}(?::00)?\s*(?:uhr)?\s*(?:-|–|bis)\s*\d{1,2}(?::00)?\s*(?:uhr)?/giu, '').replace(/\b(?:je|pro)?\s*\d{1,3}\s*(?:songs?|titel|tracks?|lieder)\b/giu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) continue;
    const isChart = /charts?|top\s*\d+/u.test(low);
    playlists.push({
      name: name[0]!.toUpperCase() + name.slice(1), description: '', why: 'aus deinem Text (ohne KI)', wish: part.slice(0, 500), color: hashColor(name), shuffled: true,
      count: Math.max(1, Math.min(isChart ? 100 : 500, count)), source: isChart ? 'chart_de' : 'ai', genres: [], artists: [], must: [], avoid: [],
      minYear: null, maxYear: null, mood: '', energy: '', lang: '', fame: '', perArtist: 0,
    });
    if (time && !single) {
      const from = Math.min(23, Number(time[1]));
      const to = Math.max(from + 1, Math.min(24, Number(time[2]) || 24));
      const days = DAY_WORDS.find(([re]) => re.test(low))?.[1] ?? [1, 2, 3, 4, 5, 6, 7];
      schedule.push({ playlist: playlists.at(-1)!.name, days, from, to });
    }
  }
  if (!playlists.length) return null;
  return { summary: 'Plan nach festen Regeln aus deinem Text (ohne KI) – bitte prüfen.', playlists: single ? playlists.slice(0, 1) : playlists, schedule: single ? [] : schedule, basePlaylist: schedule.length ? '' : playlists[0]!.name };
}

/** Plan-Zeitfenster → laut.fm-Slots. */
export function planSlots(schedule: PlanSlot[]): { playlist: string; slot: number; duration: number }[] {
  return schedule.flatMap((s) => s.days.map((d) => ({ playlist: s.playlist, slot: (d - 1) * 24 + s.from, duration: s.to - s.from })));
}

/** laut.fm-Einträge → 168er-Raster (Playlist-ID je Stunde, 0 = Basis-Playlist). */
export function scheduleGrid(entries: { playlist_id: number; slot: number; duration: number }[]): number[] {
  const g = new Array<number>(168).fill(0);
  for (const e of entries) for (let i = 0; i < e.duration; i++) g[(e.slot + i) % 168] = e.playlist_id;
  return g;
}

/** 168er-Raster → zusammenhängende Einträge je Tag; die Basis-Playlist wird nicht eingetragen (laut.fm-Regel). */
export function gridEntries(g: number[], base: number): { playlist_id: number; slot: number; duration: number }[] {
  const out: { playlist_id: number; slot: number; duration: number }[] = [];
  for (let day = 0; day < 7; day++) {
    let h = 0;
    while (h < 24) {
      const id = g[day * 24 + h]!;
      if (!id || id === base) { h++; continue; }
      let end = h + 1;
      while (end < 24 && g[day * 24 + end] === id) end++;
      out.push({ playlist_id: id, slot: day * 24 + h, duration: end - h });
      h = end;
    }
  }
  return out;
}

/** Feineinstellungen als verbindliche Vorgabe für die KI-Titelwahl. */
export function fineCriteria(p: PlanPlaylist): string {
  const E = { ruhig: 'ruhige, entspannte Titel (langsames Tempo)', mittel: 'mittleres Tempo, angenehm im Hintergrund', energie: 'energiegeladene, schnelle Titel', tanz: 'tanzbare Titel für Party und Club' };
  const L = { de: 'NUR deutschsprachige Titel', en: 'NUR englischsprachige Titel', mix: 'deutsch- und englischsprachige Titel gemischt' };
  const F = { hits: 'große, bekannte Hits, die fast jeder kennt', mix: 'Mischung aus bekannten Hits und weniger bekannten Perlen', tipps: 'überwiegend weniger bekannte Titel und Geheimtipps' };
  const o: string[] = [];
  if (p.energy) o.push(`Tempo/Stimmung: ${E[p.energy]}`);
  if (p.lang) o.push(`Sprache: ${L[p.lang]}`);
  if (p.fame) o.push(`Bekanntheit: ${F[p.fame]}`);
  if (p.perArtist) o.push(`höchstens ${p.perArtist} Titel je Interpret`);
  return o.length ? `. Feineinstellungen (verbindlich): ${o.join('; ')}` : '';
}

export const PLAN_SYSTEM = (single: boolean, existing: string[], busy: string[]) =>
  'Du bist Programmplaner für laut.fm-Webradios. Wandle den Wunsch in einen Plan aus PLAYLISTEN' + (single ? '' : ' und SENDEPLAN-ZEITEN') + ' um. Antworte NUR mit JSON, ohne Erklärung:\n' +
  '{"summary":"2-4 Sätze: wie das Programm aufgebaut ist und warum","playlists":[{"name":"max 40 Zeichen","description":"","why":"1 Satz Begründung","wish":"freie Zusatzvorgaben für die Titelauswahl","avoid":[],"color":"#rrggbb","shuffled":true,"count":50,"source":"chart_de|chart_global|ai|pool_genre|artists|existing","genres":[],"artists":[],"must":[],"min_year":null,"max_year":null,"mood":"","energy":"|ruhig|mittel|energie|tanz","lang":"|de|en|mix","fame":"|hits|mix|tipps","per_artist":0}],"schedule":[{"playlist":"Name","days":[1,2,3,4,5,6,7],"from":0,"to":24}],"base_playlist":"Name oder leer"}\n' +
  'Regeln: Tempo/Stimmung gehört in "energy", Sprache in "lang", Hits vs. Geheimtipps in "fame", Grenze je Interpret in "per_artist". Alles andere (Anlass, Stimmen, Hörerkreis) als freier Satz in "wish"; was NICHT vorkommen soll, in "avoid". ' +
  'Verwende NUR die Anzahl, die der Nutzer nennt (sonst 50, erlaubt bis 500). source: chart_de = allgemeine deutsche Single-Charts, chart_global = weltweite Charts, artists = feste Interpretenliste (dann "artists" füllen), pool_genre = nach Genre/Jahr aus dem laut.fm-Pool (dann "genres", ggf. min_year/max_year), ai = stimmungs-/themenbasiert (dann "mood"), existing = eine VORHANDENE eigene Playlist, die nur eingeplant wird. ' +
  'Nennt der Nutzer Künstler, trage sie in "must" ein; erfinde keine Künstler. ' +
  (existing.length ? `Vorhandene Playlisten dieses Senders: ${existing.slice(0, 60).join(' | ')}. Meint der Nutzer eine davon, verwende EXAKT diesen Namen (nur einplanen: source existing). ` : '') +
  (busy.length ? `Bereits belegte Sendeplan-Zeiten (nicht überplanen): ${busy.slice(0, 25).join('; ')}. ` : '') +
  (single ? 'Liefere GENAU EINE Playlist und "schedule":[].' : 'Wochentage 1=Montag … 7=Sonntag; Uhrzeiten 0–24 (to > from, nicht über Mitternacht). Ohne Zeitwunsch: "schedule":[] und base_playlist = die Hauptplaylist.') + ' Erfinde keine Sonderwünsche.';

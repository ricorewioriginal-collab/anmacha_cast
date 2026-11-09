// KI-Programmchef Teil 3 (Playlist-Pflege) – reine Logik ohne laut.fm-Aufrufe, damit sie einzeln testbar ist.
// Port aus dem AnMaCha Control Center: ai-lautshuffle.php (anmachaLautShuffleOrder/MinGap), ai-lautsonglist.php
// (Listen lesen) und ai-lautmanage.php (Programm-Check: Interpret dominiert, Flops aus den Hörerzahlen).

import { artistOf, mainArtist, norm, type PoolTrack } from './match.ts';

export interface PlTrack extends PoolTrack {
  tags?: string[];
}

/** Jingles, Moderationen, Beiträge: Art ≠ „song“ oder Tag „Jingle“. Diese bleiben beim Mischen an ihrer Stelle. */
export function isFixedTrack(t: PlTrack): boolean {
  const ty = String(t.type ?? 'song').toLowerCase();
  if (ty !== '' && ty !== 'song') return true;
  return (t.tags ?? []).some((x) => String(x).trim().toLowerCase() === 'jingle');
}

const artistKey = (t: PlTrack) => norm(mainArtist(artistOf(t)));

/** Kleinster Abstand (in Songs) zwischen zwei Titeln desselben Interpreten; null = kein Interpret doppelt. */
export function minGap(order: number[], byId: Map<number, PlTrack>, fixed: Set<number>): number | null {
  const last = new Map<string, number>();
  let n = 0;
  let min: number | null = null;
  for (const id of order) {
    const t = byId.get(id);
    if (!t || fixed.has(id)) continue;
    const k = artistKey(t);
    if (k) {
      const prev = last.get(k);
      if (prev !== undefined && (min === null || n - prev < min)) min = n - prev;
      last.set(k, n);
    }
    n++;
  }
  return min;
}

/** Kleiner Zufallsgenerator mit Startwert: dieselbe Vorschau ergibt beim Übernehmen dieselbe Reihenfolge. */
function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Neue Reihenfolge: Songs gemischt, gleiche Interpreten möglichst weit auseinander; Jingles/Beiträge (Art ≠ song,
 * Tag „Jingle“ oder in fixedIds) bleiben auf ihrer Position. tracks = aktuelle Playlist in Spielreihenfolge.
 */
export function shuffleOrder(tracks: PlTrack[], seed: number, fixedIds: number[] = []): { order: number[]; fixed: number[]; gapBefore: number | null; gapAfter: number | null } {
  const byId = new Map(tracks.map((t) => [Number(t.id), t]));
  const cur = tracks.map((t) => Number(t.id));
  const fixed = new Set<number>(fixedIds);
  for (const t of tracks) if (isFixedTrack(t)) fixed.add(Number(t.id));
  const songs = cur.filter((id) => !fixed.has(id));
  const rand = rng(seed);
  for (let i = songs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [songs[i], songs[j]] = [songs[j]!, songs[i]!];
  }
  const left = new Map<string, number>();
  for (const id of songs) { const k = artistKey(byId.get(id)!); left.set(k, (left.get(k) ?? 0) + 1); }
  const most = Math.max(0, ...left.values());
  // Mindestabstand: höchstens 4, nie größer als der häufigste Interpret verträgt
  const K = Math.max(1, Math.min(4, Math.floor(left.size / 2), most ? Math.floor(songs.length / most) - 1 : 1));
  const out: number[] = [];
  const recent: string[] = [];
  for (const id of cur) {
    if (fixed.has(id)) { out.push(id); continue; }
    // bevorzugt der Interpret mit den meisten offenen Titeln, der nicht kurz zuvor lief; sonst der am längsten nicht gespielte
    let pick = -1, best = -1, oldest = Infinity;
    songs.forEach((sid, i) => {
      const k = artistKey(byId.get(sid)!);
      const r = recent.indexOf(k);
      if (r < 0) { if (left.get(k)! > best) { best = left.get(k)!; pick = i; } } else if (best < 0 && r < oldest) { oldest = r; pick = i; }
    });
    const [sid] = songs.splice(pick, 1) as [number];
    const k = artistKey(byId.get(sid)!);
    left.set(k, left.get(k)! - 1);
    out.push(sid);
    recent.push(k);
    if (recent.length > K) recent.shift();
  }
  return { order: out, fixed: [...fixed].filter((id) => byId.has(id)), gapBefore: minGap(cur, byId, fixed), gapAfter: minGap(out, byId, fixed) };
}

// ---------- Songliste lesen ----------

const LIST_SEP = /\s+[-–—]\s*|\s*[-–—]\s+|\s+(?:von|by)\s+|\s*:\s+/iu;
const DASH = /\s+[-–—]\s*|\s*[-–—]\s+|\s+(?:von|by)\s+/iu;
const HEADING = /\b(?:folge|episode|ep|playlist|liste|sendung|show|podcast|teil|staffel|songs?|musik|wunschliste|tracklist)\b/iu;
const QUOTES = /^[\s"„“”']+|[\s"„“”']+$/gu;

export interface ListItem { raw: string; a: string; b: string }

/**
 * Songliste aus beliebigem Text (Zeilen, Kommas, Semikolons, „ | “): je Eintrag zwei Teile a/b – ob „Titel - Interpret“
 * oder „Interpret - Titel“ entscheidet erst die Suche. Ein Vorspann wie „Folge 44: …“ wird zum Playlist-Namen.
 */
export function parseSongList(text: string, max = 300): { name: string; items: ListItem[] } {
  let txt = String(text ?? '').replace(/\r/g, '').slice(0, 30_000);
  let name = '';
  const m = /^\s*([^\n:,;]{2,60}?)\s*:\s*([^\n]+)/u.exec(txt);
  if (m && !LIST_SEP.test(` ${m[1]} `)) {
    const first = m[2]!.split(/[,;]/u)[0]!;
    // Name, wenn im selben Teil schon ein Song folgt – oder bei typischen Überschriften; sonst ist „Queen: Bohemian Rhapsody“ der erste Song
    if (DASH.test(` ${first} `) || (HEADING.test(m[1]!) && DASH.test(` ${m[2]} `))) {
      name = m[1]!.trim();
      txt = txt.slice(m.index + m[0].length - m[2]!.length);
    }
  }
  const parts = txt.split(/\n+|;|,|\s\|\s/u);
  const items: string[] = [];
  let buf = '';
  for (const raw of parts) {
    const p = raw.trim().replace(/^(?:[-*•·]+|\d{1,3}[.)])\s+/u, '').trim().replace(QUOTES, '');
    if (!p) continue;
    const full = buf ? `${buf}, ${p}` : p;
    // ohne Trenner gehört der Teil zum nächsten („bullen, schweine - sdp“)
    if (LIST_SEP.test(` ${p} `) || full.length > 120) { items.push(full); buf = ''; } else buf = full;
  }
  if (buf) items.push(buf);
  const out: ListItem[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const raw = it.replace(/\s+/gu, ' ').trim().slice(0, 160);
    // Bindestrich hat Vorrang („Stand by Me - Ben E. King“)
    let sp = raw.split(/\s+[-–—]\s*|\s*[-–—]\s+/u);
    if (sp.length < 2) sp = raw.split(/\s*:\s+|\s+(?:von|by)\s+/iu);
    const a = (sp[0] ?? '').replace(QUOTES, '');
    const b = sp.slice(1).join(' - ').replace(QUOTES, '');
    const k = `${a}|${b}`.toLowerCase();
    if (!a || seen.has(k)) continue;
    seen.add(k);
    out.push({ raw, a, b });
    if (out.length >= max) break;
  }
  return { name: name.slice(0, 60), items: out };
}

// ---------- Aufräumen ----------

export interface Finding { id: number; artist: string; title: string; reason: string; kind: 'dup_id' | 'dup_song' | 'overload' | 'flop' }

/**
 * Aufräum-Vorschläge für eine Playlist: doppelte Titel (gleiche ID oder gleicher Interpret+Titel), Interpreten über dem
 * Limit (perArtist) und Flops (deutlich weniger Hörer als im Schnitt). Jingles/Beiträge werden nie vorgeschlagen.
 */
export function cleanupFindings(tracks: PlTrack[], stats: { id: number; listeners: number }[], perArtist: number): { duplicates: Finding[]; overload: Finding[]; flops: Finding[]; avgListeners: number } {
  const songs = tracks.filter((t) => !isFixedTrack(t));
  const f = (t: PlTrack, reason: string, kind: Finding['kind']): Finding => ({ id: Number(t.id), artist: artistOf(t), title: t.title ?? '', reason, kind });
  const duplicates: Finding[] = [];
  const seenId = new Set<number>();
  const seenKey = new Map<string, PlTrack>();
  const dupIds = new Set<number>();
  for (const t of songs) {
    const k = `${artistKey(t)}|${norm(String(t.title ?? '').replace(/\s*[([].*?(?:remaster|version|edit|mix|live).*?[)\]]/giu, ''))}`;
    const twin = seenKey.get(k);
    if (seenId.has(Number(t.id))) duplicates.push(f(t, 'steht mehrfach in der Playlist', 'dup_id'));
    else if (twin) {
      // die schlichtere Fassung behalten („Song“ statt „Song (Remastered 2012)“)
      const [keep, drop] = String(t.title ?? '').length < String(twin.title ?? '').length ? [t, twin] : [twin, t];
      duplicates.push(f(drop, `gleicher Song wie „${keep.title ?? ''}“ (#${keep.id})`, 'dup_song'));
      dupIds.add(Number(drop.id));
      seenKey.set(k, keep);
    }
    seenId.add(Number(t.id));
    if (!twin) seenKey.set(k, t);
  }
  const overload: Finding[] = [];
  const per = new Map<string, number>();
  const counted = new Set<number>();
  for (const t of songs) {
    if (dupIds.has(Number(t.id)) || counted.has(Number(t.id))) continue;
    counted.add(Number(t.id));
    const k = artistKey(t);
    const n = (per.get(k) ?? 0) + 1;
    per.set(k, n);
    if (k && perArtist > 0 && n > perArtist) overload.push(f(t, `${artistOf(t)} schon ${perArtist}× in der Playlist`, 'overload'));
  }
  // Hörerzahlen: Schnitt über alle Ausspielungen; Flop = unter 60 % des Schnitts bei mindestens 2 Ausspielungen
  const sum = new Map<number, { n: number; s: number }>();
  let all = 0, cnt = 0;
  for (const r of stats) {
    if (!r.id) continue;
    const x = sum.get(r.id) ?? { n: 0, s: 0 };
    x.n++; x.s += r.listeners;
    sum.set(r.id, x);
    all += r.listeners; cnt++;
  }
  const avg = cnt ? all / cnt : 0;
  const listed = new Set([...duplicates, ...overload].map((x) => x.id));
  const flops: Finding[] = [];
  for (const t of songs) {
    const x = sum.get(Number(t.id));
    if (!x || x.n < 2 || !avg || listed.has(Number(t.id))) continue;
    const a = x.s / x.n;
    if (a < avg * 0.6) flops.push(f(t, `Ø ${a.toFixed(1)} Hörer bei ${x.n} Ausspielungen (Sender-Schnitt ${avg.toFixed(1)})`, 'flop'));
  }
  return { duplicates, overload, flops: flops.slice(0, 30), avgListeners: Math.round(avg * 10) / 10 };
}

// Titelabgleich für den KI-Programmchef (Port aus dem AnMaCha Control Center, ai-lautplan.php): Normalisierung,
// Ähnlichkeit wie PHP similar_text, beste Übereinstimmung aus Radioadmin-Treffern und die Suchstufen im laut.fm-Pool.
// Rein funktional – ohne Netz, damit gut testbar.

export interface PoolTrack {
  id: number;
  artist?: string | { name?: string };
  title?: string;
  duration?: number;
  release_year?: number;
  genre?: string;
  type?: string;
}

export interface Match {
  id: number;
  artist: string;
  title: string;
  duration: number;
  year: number;
  score: number;
}

const FOLD: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', é: 'e', è: 'e', ê: 'e', á: 'a', à: 'a', â: 'a', í: 'i', ó: 'o', ô: 'o', ú: 'u', ç: 'c', ñ: 'n', '&': ' and ' };

/** Kleinbuchstaben, Umlaute ausgeschrieben, Zusätze („(Radio Edit)“, „feat. …“, „Remastered 2011“) und Satzzeichen weg. */
export function norm(s: string): string {
  let t = s.toLowerCase().replace(/[äöüßéèêáàâíóôúçñ&]/g, (c) => FOLD[c] ?? c);
  t = t.replace(/\(.*?\)|\[.*?\]|\b(feat|ft|featuring|with)\b.*$|\b(radio edit|single version|remastered( \d{4})?|album version|original mix)\b/g, ' ');
  return t.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Anzahl gemeinsamer Zeichen nach dem Algorithmus von PHP similar_text (längster gemeinsamer Block, rekursiv links/rechts). */
function simCount(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let max = 0, pa = 0, pb = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > max) { max = k; pa = i; pb = j; }
    }
  }
  if (!max) return 0;
  return max + simCount(a.slice(0, pa), b.slice(0, pb)) + simCount(a.slice(pa + max), b.slice(pb + max));
}

/** Ähnlichkeit 0…1 wie similar_text($a, $b, $percent) / 100. */
export function sim(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return (simCount(a, b) * 2) / (a.length + b.length);
}

/** Haupt-Interpret einer Zusammenarbeit: „Shakira x Burna Boy“, „A feat. B“, „A, B & C“ → „Shakira“, „A“. */
export function mainArtist(a: string): string {
  return (a.trim().split(/\s+(?:x|&|und|and|vs\.?|feat\.?|ft\.?|featuring|with|mit)\s+|\s*[,;]\s*/iu)[0] ?? a).trim();
}

/** Suchbegriff bereinigen: „Espresso (Radio Edit)“ → „Espresso“, „Song feat. X“ → „Song“ (laut.fm sucht als Teilzeichenkette). */
export function core(t: string): string {
  return t.replace(/\(.*?\)|\[.*?\]|\s+(feat|ft|featuring|with)\.?\s.*$/giu, ' ').replace(/\s+/g, ' ').trim();
}

export const artistOf = (t: PoolTrack): string => (typeof t.artist === 'object' ? t.artist?.name ?? '' : t.artist ?? '');

/** Beste Übereinstimmung (Titel zählt 60 %, Interpret 40 %; Mindestwerte verhindern falsche Treffer) oder null. */
export function bestMatch(tracks: PoolTrack[], artist: string, title: string): Match | null {
  const na = norm(artist);
  const nt = norm(title);
  if (!nt) return null;
  let best: PoolTrack | null = null;
  let bs = 0;
  for (const t of tracks) {
    if (!t || !t.id) continue;
    const ta = norm(artistOf(t));
    const tt = norm(t.title ?? '');
    const ts = sim(nt, tt);
    let as = na === '' ? 0.7 : Math.max(sim(na, ta), na.length >= 4 && ta !== '' && (ta.includes(na) || na.includes(ta)) ? 0.9 : 0);
    const nm = norm(mainArtist(artist));
    // Kooperation: Haupt-Interpret stimmt („Shakira x Burna Boy“ ↔ „Shakira“)
    if (na !== '' && as < 0.75 && nm !== na && nm.length >= 3 && ta !== '' && (nm === ta || ta.startsWith(nm + ' '))) as = 0.85;
    let score = 0.6 * ts + 0.4 * as;
    if (ts >= 0.999 && as >= 0.99) score = 1;
    if (ts >= 0.82 && as >= 0.75 && score > bs) { bs = score; best = t; }
  }
  return best ? { id: Number(best.id), artist: artistOf(best), title: best.title ?? '', duration: Number(best.duration ?? 0), year: Number(best.release_year ?? 0), score: Math.round(bs * 1000) / 1000 } : null;
}

export type TrySource = 'own' | 'pool';

/** Suchstufen für einen Titel: erst eigener Bestand, dann der gemeinsame Pool (genau, ohne Interpret, Originalschreibweise, Haupt-Interpret, alle Titel des Interpreten). */
export function searchTries(artist: string, title: string): { src: TrySource; query: Record<string, string>; pages: number }[] {
  const coreT = core(title);
  const coreA = core(artist);
  const tries: { src: TrySource; query: Record<string, string>; pages?: number }[] = [
    { src: 'own', query: { own: 'true', artist: coreA, title: coreT } },
    { src: 'pool', query: { private: 'false', artist: coreA, title: coreT } },
    { src: 'pool', query: { private: 'false', title: coreT } },
  ];
  if (coreT !== title) tries.push({ src: 'pool', query: { private: 'false', artist, title } });
  const mainA = mainArtist(coreA);
  if (mainA !== '' && mainA !== coreA) {
    tries.push({ src: 'own', query: { own: 'true', artist: mainA, title: coreT } });
    tries.push({ src: 'pool', query: { private: 'false', artist: mainA, title: coreT } });
  }
  tries.push({ src: 'pool', query: { private: 'false', artist: mainA !== '' ? mainA : coreA }, pages: 2 });
  return tries
    .map((t) => ({ src: t.src, query: Object.fromEntries(Object.entries(t.query).filter(([, v]) => v.trim() !== '')), pages: t.pages ?? 1 }))
    .filter((t) => 'title' in t.query || 'artist' in t.query);
}

/**
 * KI-Antworten sind oft „fast JSON“: <think>-Blöcke, Markdown-Zäune, typografische Anführungszeichen, Kommas am Ende,
 * abgeschnittene Antworten. Reparatur in Stufen; liefert das erste Objekt/Array, das sich lesen lässt, sonst null.
 */
export function parseJsonLoose(text: string, open: '{' | '[' = '{'): unknown {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
  const start = t.indexOf(open);
  if (start < 0) return null;
  t = t.slice(start);
  const attempts = [
    (s: string) => s,
    (s: string) => s.replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'").replace(/,\s*([}\]])/g, '$1'),
    (s: string) => balance(s.replace(/[„“”]/g, '"').replace(/,\s*([}\]])/g, '$1')),
  ];
  for (const fix of attempts) {
    const s = fix(t);
    // bis zur passenden schließenden Klammer kürzen (Text danach ignorieren)
    const end = closingIndex(s);
    try { return JSON.parse(end > 0 ? s.slice(0, end + 1) : s); } catch { /* nächste Stufe */ }
  }
  return null;
}

function closingIndex(s: string): number {
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Abgeschnittenes JSON schließen (String-bewusst). */
function balance(s: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of s) {
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = s.replace(/,\s*$/, '');
  if (inStr) out += '"';
  return out.replace(/,\s*$/, '') + stack.reverse().join('');
}

/** Songliste aus Fließtext („1. Queen – Bohemian Rhapsody“, „- Adele - Hello“, „Hello von Adele“). */
export function songLines(text: string): { artist: string; title: string }[] {
  const out: { artist: string; title: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').replace(/["„“]/g, '').trim();
    if (!l) continue;
    let m = /^(.+?)\s+[–—-]\s+(.+)$/.exec(l);
    if (m) { out.push({ artist: m[1]!.trim(), title: m[2]!.trim() }); continue; }
    m = /^(.+?)\s+(?:von|by)\s+(.+)$/i.exec(l);
    if (m) out.push({ artist: m[2]!.trim(), title: m[1]!.trim() });
  }
  return out;
}

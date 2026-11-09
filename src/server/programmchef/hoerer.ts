// KI-Programmchef Teil 4 (Hörer-Funktionen) – reine Logik ohne laut.fm-Aufrufe, einzeln testbar.
// Port aus dem AnMaCha Control Center: ai-lautwish.php (Wunschstunde), ai-lautgreet.php (Grüße), ai-lautjingles.php (Jingle-Rotation).

export interface WishSlotCfg {
  /** Wochentage 1 = Montag … 7 = Sonntag */
  days: number[];
  /** Beginn (volle Stunde) und Dauer in Stunden */
  from: number;
  hours: number;
}

/** Nächste (oder gerade laufende) Wunschstunde ab now: [Beginn, Ende] als Zeitstempel, sonst null. Ortszeit des Servers. */
export function nextWishSlot(cfg: WishSlotCfg, now: Date): { start: number; end: number; day: string } | null {
  if (!cfg.days.length) return null;
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, cfg.from, 0, 0, 0);
    const wd = ((d.getDay() + 6) % 7) + 1;
    const end = d.getTime() + cfg.hours * 3600_000;
    if (cfg.days.includes(wd) && end > now.getTime()) {
      return { start: d.getTime(), end, day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}#${cfg.from}` };
    }
  }
  return null;
}

/** Sendeplan-Slots (Stunde der Woche, Montag 0 Uhr = 0) einer Wunschstunde. */
export function wishGridSlots(cfg: WishSlotCfg): number[] {
  const out: number[] = [];
  for (const d of cfg.days) for (let h = cfg.from; h < cfg.from + cfg.hours && h < 24; h++) out.push((d - 1) * 24 + h);
  return out;
}

/**
 * Jingles zwischen Songs verteilen: höchstens ein Jingle je `every` Songs, jeder Jingle je Playlist nur einmal
 * (laut.fm erlaubt keinen Titel doppelt). Gleichmäßig verteilt, jeweils in der Mitte eines Abschnitts.
 */
export function placeJingles(songs: number[], jingles: number[], every: number): number[] {
  const k = every > 0 ? Math.min(Math.floor(songs.length / every), jingles.length) : 0;
  if (k <= 0) return [...songs];
  const gap = Math.floor(songs.length / k);
  const after = new Map<number, number>();
  for (let j = 0; j < k; j++) after.set(j * gap + Math.ceil(gap / 2) - 1, jingles[j]!);
  return songs.flatMap((id, i) => (after.has(i) ? [id, after.get(i)!] : [id]));
}

/** Auswahl der Jingles für einen Durchlauf: im Wechsel (ab pos weiterrücken) oder zufällig. */
export function pickJingles(ids: number[], mode: 'rotate' | 'random', pos: number, k: number, rand: () => number = Math.random): number[] {
  if (!ids.length || k <= 0) return [];
  if (mode === 'random') {
    const a = [...ids];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
    return a.slice(0, k);
  }
  const out: number[] = [];
  for (let i = 0; i < Math.min(k, ids.length); i++) out.push(ids[(pos + i) % ids.length]!);
  return out;
}

/** Vorname für die Ansage: nur Buchstaben, erstes Wort, höchstens 20 Zeichen. */
export function firstName(name: string): string {
  const w = String(name ?? '').replace(/[^\p{L}\- ]/gu, '').trim().split(/\s+/u)[0] ?? '';
  return w.slice(0, 20);
}

/** Grußtext für die Stimme vorbereiten: keine Links, E-Mail-Adressen oder Telefonnummern, Länge begrenzt. */
export function cleanGreeting(text: string, max = 240): string {
  return String(text ?? '')
    .replace(/https?:\/\/\S+|www\.\S+/giu, '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/gu, '')
    .replace(/\+?\d[\d ()/-]{6,}\d/gu, '')
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max);
}

/** Gruß ohne KI: fester Satz mit Vorname und bereinigter Nachricht. */
export function plainGreeting(name: string, text: string, station: string): string {
  const n = firstName(name);
  const t = cleanGreeting(text, 200).replace(/[.!?]*$/u, '');
  return `${n ? `Ein Gruß von ${n}` : 'Ein Hörergruß'} hier bei ${station}: ${t}.`;
}

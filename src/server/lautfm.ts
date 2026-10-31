// laut.fm-Anbindung (optionaler Adapter):
//  • Radioadmin-API (https://api.radioadmin.laut.fm, Bearer-Token des Nutzers) – Playlists, Titel,
//    Sendeplan, Statistik, Benutzer, Station, Live-Zugang. Nur dokumentierte Endpunkte (radioadmin-api-spec).
//  • Öffentliche API (https://api.laut.fm) – current_song, last_songs, listeners (ohne Login).
// AnMaCha Cast leitet Anfragen serverseitig weiter: der Token bleibt verschlüsselt lokal und erreicht nie den Browser.
//
// Stabilität (Regeln wie im AnMaCha Control Center, docs/lautfm/RADIOADMIN-API.md dort; Spezifikation: OpenAPI 3
// „laut.fm Radioadmin-Api“ 1.0.1 von https://docs.api.radioadmin.laut.fm/):
//  • Lesezugriffe (GET/HEAD) bei Last (429/502/503/504) oder Netzfehler bis zu dreimal – mit Retry-After (1–5 s),
//    sonst steigender Wartezeit. Schreibzugriffe werden NIE automatisch wiederholt: ein Zeitlimit heißt nicht
//    „nicht ausgeführt“, erneutes Senden könnte doppelte Playlists/Titel erzeugen.
//  • 401/403 = laut.fm hat den Aufruf nicht ausgeführt (z. B. Origin passt nicht mehr): Origin neu ermitteln und
//    einmal wiederholen, sofern die Anfrage keinen Body hat, der schon gesendet wurde.
//  • Fehlerantworten von laut.fm ({ messages } bzw. { error }) bekommen einen verständlichen deutschen „message“-Text.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { envVar } from './env.ts';

// Umgebungsvariablen nur für Tests/Staging (z. B. lokaler Mock); Standard sind die echten laut.fm-Server
export const RADIOADMIN = envVar(process.env, 'RADIOADMIN_URL') || 'https://api.radioadmin.laut.fm';
export const PUBLIC_API = envVar(process.env, 'LAUTFM_API_URL') || 'https://api.laut.fm';

/**
 * Radioadmin-Tokens gehören zu einer „callback_url“. Bei jeder Anfrage muss derselbe Wert als
 * Origin-Header mitgeschickt werden (Auskunft laut.fm). Historisch nutzte AirDeck standardmäßig „airdeck“ –
 * dieser Wert ist Teil des bei laut.fm hinterlegten Protokolls bestehender Nutzer-Tokens (callback_url)
 * und bleibt daher dauerhaft „airdeck“, unabhängig vom AirDeck→AnMaCha-Cast-Rebranding (siehe
 * docs/REBRANDING_ANMACHA_CAST.md): eine Änderung würde bei laut.fm hinterlegte Zugänge bestehender
 * Nutzer brechen.
 */
export const DEFAULT_ORIGIN = 'airdeck';
export const ORIGIN_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/;

export function loginUrl(origin = DEFAULT_ORIGIN): string {
  return `https://radioadmin.laut.fm/login?callback_url=${encodeURIComponent(origin)}`;
}

export interface LautfmConfig {
  /** callback_url, mit der das Token erzeugt wurde (= Origin-Header) */
  origin?: string;
  /** Numerische Station-ID im Radioadmin */
  stationId?: number;
  /** Stationsname (URL-Name, z. B. "80er-radio") für die öffentliche API */
  stationName?: string;
}

export const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,400}$/;

/** Token aus Kopieren/Einfügen säubern: „Bearer “, Anführungszeichen, Leerraum. */
export function cleanToken(v: unknown): string {
  return String(v ?? '').trim().replace(/^bearer\s+/i, '').replace(/^["']+|["']+$/g, '').trim();
}

export interface RaStation {
  id: number;
  name: string;
  displayName: string;
  role: string;
}

/** /stations liefert je nach Version ein Array oder { stations: [...] } – beides verstehen. */
export function normalizeStations(data: unknown): RaStation[] | null {
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { stations?: unknown }).stations) ? (data as { stations: unknown[] }).stations : null;
  if (!list) return null;
  const out: RaStation[] = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const id = Number(o.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const name = String(o.name ?? '').trim().toLowerCase();
    out.push({ id, name, displayName: String(o.display_name ?? o.name ?? ''), role: String(o.role ?? 'dj').toLowerCase() });
  }
  return out;
}

/**
 * Probiert Origin-Kandidaten gegen GET /stations. Der erste Kandidat bekommt bis zu drei Versuche
 * (frisch ausgestellte Tokens sind bei laut.fm nicht sofort überall gültig), die übrigen je einen.
 */
export async function detectOrigin(token: string, candidates: unknown[], waitMs = 400): Promise<{ origin: string; stations: RaStation[] | null; unreachable: boolean }> {
  const list = [...new Set(candidates.map((c) => String(c ?? '').trim()).filter((c) => c && ORIGIN_RE.test(c)))];
  let reached = false;
  for (let i = 0; i < list.length; i++) {
    for (let attempt = 1; attempt <= (i === 0 ? 3 : 1); attempt++) {
      try {
        const r = await fetch(`${RADIOADMIN}/stations`, { headers: { Authorization: `Bearer ${token}`, Origin: list[i]!, Accept: 'application/json', 'User-Agent': 'AnMaCha Cast' }, signal: AbortSignal.timeout(8000) });
        reached = true;
        if (r.ok) {
          const st = normalizeStations(await r.json().catch(() => null));
          if (st) return { origin: list[i]!, stations: st, unreachable: false };
        } else await r.body?.cancel();
      } catch {
        // Netzwerkfehler: nächster Versuch
      }
      if (i === 0 && attempt < 3) await new Promise((ok) => setTimeout(ok, waitMs));
    }
  }
  return { origin: list[0] ?? DEFAULT_ORIGIN, stations: null, unreachable: !reached };
}

/**
 * Erlaubte Radioadmin-Pfade: nur die eigene Station bzw. Listen/Status.
 * `;incomplete` / `;queued` sind Teil der offiziellen Pfade.
 */
export function allowedRadioadminPath(path: string, stationId: number | undefined): boolean {
  if (!/^\/[A-Za-z0-9_\-/;,.]*$/.test(path) || path.includes('..')) return false;
  if (path === '/stations' || path === '/server_status') return true;
  if (/^\/automation_algorithms\/[A-Za-z0-9_-]+$/.test(path)) return true;
  if (stationId === undefined) return false;
  return path === `/stations/${stationId}` || path.startsWith(`/stations/${stationId}/`);
}

/** Öffentliche laut.fm-API laut api-spec (ohne die Dauer-Streams song_change.*). */
export function allowedPublicPath(path: string): boolean {
  if (path.includes('..')) return false;
  return /^\/(server_status|time|letters|genres|station_names|listeners|stations(\/(live|numbers|letter\/[a-z0-9]|genre\/[A-Za-z0-9%._ -]{1,60}|[a-z0-9_,-]{1,400}))?|station\/[a-z0-9_-]+(\/(listeners|images\/[a-z_]{1,30}|schedule|playlists|current_song|last_songs|next_artists))?)$/.test(path);
}

const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'set-cookie']);

/** Statuscodes, bei denen ein Lesezugriff wiederholt wird (laut.fm überlastet bzw. Gateway-Fehler). */
export const RETRY_STATUS = new Set([429, 502, 503, 504]);
export const READ_TRIES = 3;

/** Wartezeit vor dem nächsten Versuch: Retry-After (Sekunden, auf 1–5 s begrenzt), sonst 500 ms × Versuch. */
export function retryDelay(retryAfter: string | null | undefined, attempt: number): number {
  const sec = Number(retryAfter);
  if (retryAfter && Number.isFinite(sec)) return Math.min(5, Math.max(1, Math.round(sec))) * 1000;
  return 500 * attempt;
}

/** Text aus einer laut.fm-Fehlerantwort (Schema „Error“: { messages: string }; ältere Antworten: { error } / { message }). */
export function upstreamDetail(data: unknown): string {
  if (typeof data === 'string') return data.trim().slice(0, 300);
  if (!data || typeof data !== 'object') return '';
  const o = data as Record<string, unknown>;
  const v = o.messages ?? o.message ?? o.error ?? o.errors;
  if (Array.isArray(v)) return v.map(String).join(' · ').slice(0, 300);
  return typeof v === 'string' ? v.trim().slice(0, 300) : '';
}

/** Verständliche Meldung zu einer Fehlerantwort von laut.fm. */
export function lautfmMessage(status: number, detail = ''): string {
  const d = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403) return `laut.fm hat den Zugriff abgelehnt – Token ungültig, widerrufen oder ohne Rechte für diese Station. Bitte unter „laut.fm“ neu verbinden.${d}`;
  if (status === 404) return `Bei laut.fm nicht gefunden – vielleicht schon gelöscht oder eine andere Station.${d}`;
  if (status === 400 || status === 409 || status === 422) return `laut.fm hat die Änderung nicht angenommen${detail ? `: ${detail}` : ' (ungültige Angaben oder der Titel ist schon in der Playlist)'}.`;
  if (status === 429) return 'laut.fm begrenzt gerade die Anfragen – bitte kurz warten und erneut versuchen.';
  if (status >= 500) return `laut.fm hat gerade ein Problem (HTTP ${status}) – bitte später erneut versuchen.${d}`;
  return `laut.fm antwortete mit HTTP ${status}.${d}`;
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/**
 * Ein Aufruf an laut.fm mit den Wiederholungsregeln oben. `send(origin)` führt einen Versuch aus.
 * `reorigin` ermittelt nach 401/403 den passenden Origin neu (nur wenn `replayable`).
 */
export async function raCall(
  method: string,
  send: (origin: string) => Promise<Response>,
  origin: string,
  opts: { replayable?: boolean; reorigin?: () => Promise<string | undefined>; wait?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
  const read = method === 'GET' || method === 'HEAD';
  const wait = opts.wait ?? sleep;
  let reoriginTried = false;
  for (let attempt = 1; ; attempt++) {
    let r: Response;
    try {
      r = await send(origin);
    } catch (err) {
      if (read && attempt < READ_TRIES) {
        await wait(retryDelay(null, attempt));
        continue;
      }
      throw err;
    }
    if (read && RETRY_STATUS.has(r.status) && attempt < READ_TRIES) {
      await r.body?.cancel().catch(() => undefined);
      await wait(retryDelay(r.headers.get('retry-after'), attempt));
      continue;
    }
    if ((r.status === 401 || r.status === 403) && opts.replayable !== false && opts.reorigin && !reoriginTried) {
      reoriginTried = true;
      const next = await opts.reorigin().catch(() => undefined);
      if (next && next !== origin) {
        await r.body?.cancel().catch(() => undefined);
        origin = next;
        attempt--; // der neue Origin bekommt eigene Versuche
        continue;
      }
    }
    return r;
  }
}

/** Leitet eine Anfrage an laut.fm weiter und streamt die Antwort zurück (inkl. Uploads). */
export async function forward(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  token: string | undefined,
  timeoutMs = 60_000,
  origin?: string,
  reorigin?: () => Promise<string | undefined>,
): Promise<void> {
  const method = req.method ?? 'GET';
  const base: Record<string, string> = { Accept: String(req.headers.accept ?? 'application/json'), 'User-Agent': 'AnMaCha Cast' };
  if (token) base.Authorization = `Bearer ${token}`;
  if (req.headers['content-type']) base['Content-Type'] = String(req.headers['content-type']);
  // DELETE kann laut Spezifikation einen Body haben (z. B. Tags entfernen)
  const hasBody = !['GET', 'HEAD'].includes(method) && (!!req.headers['transfer-encoding'] || Number(req.headers['content-length'] ?? 0) > 0);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await raCall(method, (o) => fetch(url, {
      method,
      headers: o ? { ...base, Origin: o } : base,
      body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
      duplex: hasBody ? 'half' : undefined,
      signal: ctrl.signal,
      redirect: 'follow',
    }), origin ?? '', { replayable: !hasBody, reorigin });
    const out: Record<string, string> = { 'Cache-Control': 'no-store' };
    r.headers.forEach((v, k) => {
      if (!HOP.has(k.toLowerCase())) out[k] = v;
    });
    // Fehlerantworten: verständliche Meldung ergänzen (Body ist klein und JSON oder Text)
    if (!r.ok && method !== 'HEAD') {
      const text = await r.text().catch(() => '');
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // Text-Antwort
      }
      const body: Record<string, unknown> = data && typeof data === 'object' && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : { upstream: data };
      body.message = lautfmMessage(r.status, upstreamDetail(data));
      body.lautfm = true;
      if (typeof body.error !== 'string') body.error = `lautfm_${r.status}`;
      delete out['content-type'];
      res.writeHead(r.status, { ...out, 'Content-Type': 'application/json; charset=utf-8' });
      return void res.end(JSON.stringify(body));
    }
    res.writeHead(r.status, out);
    if (!r.body) return void res.end();
    await new Promise<void>((ok) => {
      Readable.fromWeb(r.body as never).on('error', () => ok()).pipe(res).on('finish', ok).on('close', ok);
    });
  } catch (err) {
    if (!res.headersSent) {
      const aborted = (err as Error).name === 'AbortError';
      const read = method === 'GET' || method === 'HEAD';
      // Schreibzugriff ohne Antwort: Ergebnis unbekannt – nicht „fehlgeschlagen“ behaupten
      const message = aborted
        ? read ? 'laut.fm antwortet nicht – bitte später erneut versuchen' : 'laut.fm hat nicht rechtzeitig geantwortet – die Änderung ist eventuell trotzdem angekommen. Bitte neu laden und prüfen, bevor du sie wiederholst.'
        : 'laut.fm nicht erreichbar';
      res.writeHead(aborted ? 504 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: aborted ? 'timeout' : 'upstream_unreachable', message, lautfm: true }));
    } else res.destroy();
  } finally {
    clearTimeout(timer);
  }
}

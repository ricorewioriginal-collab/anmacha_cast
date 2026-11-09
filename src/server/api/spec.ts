// OpenAPI-3.1-Spezifikation und Markdown-Referenz der REST-API v1, erzeugt aus der tatsächlich registrierten Routentabelle
// (http.ts) plus den Beschreibungen in summaries.ts und den öffentlichen Sonderrouten unten. So kann die Doku nicht
// vom Server abweichen: ein Test prüft Vollständigkeit und dass die eingecheckten Dateien aktuell sind.

import { ALL_SCOPES } from '../model.ts';
import { SUMMARIES } from './summaries.ts';

export interface RouteInfo { method: string; path: string; scope: string | null }
export interface Endpoint extends RouteInfo { summary: string; tag: string; auth: 'public' | 'session' | 'scope'; note?: string }

export const API_PREFIX = '/api/v1';

export const TAGS: Array<{ name: string; description: string }> = [
  { name: 'Konto & Zugang', description: 'Anmeldung, Benutzer, Rollen, API-Schlüssel, Geräte-Kopplung.' },
  { name: 'Apps & Geräte', description: 'Verbindung der Apps (Android, Windows): Kopplung, Server finden, Verbindungsdaten, Updates.' },
  { name: 'Sender', description: 'Sender anlegen, ändern, Senderverbund.' },
  { name: 'Quellen & Live', description: 'Live-Eingänge, Relays, Übernahme, Browser-/App-Live-Übertragung.' },
  { name: 'Ausgänge & Streams', description: 'Icecast/Shoutcast/laut.fm-Ausgänge, Zusatz-Streams, Stream-Profile, Liquidsoap.' },
  { name: 'Bibliothek', description: 'Titel hochladen, suchen, bearbeiten, Wellenform, Voice Studio, Lautheit, Prüfungen.' },
  { name: 'MusicHub', description: 'Senderübergreifender Austausch von Titeln, Jingles und Dokumenten.' },
  { name: 'Nextcloud', description: 'Dateien aus Nextcloud importieren, Mitschnitte dorthin kopieren.' },
  { name: 'Warteschlange & Playlists', description: 'Warteschlange, Playlists, Smart-Blöcke, Rotation, Playlist-Lifehacks.' },
  { name: 'Playout & Decks', description: 'Automation, Decks A–D, Cardwall, Betriebsart, aktueller Titel, Verlauf.' },
  { name: 'Planung & Aufnahme', description: 'Sendeplan, Uhr-Ereignisse, Aufgaben, Recorder und Mitschnitte.' },
  { name: 'Nachrichten & Vorbereitung', description: 'Nachrichten, Wetter und Sendungsvorbereitung.' },
  { name: 'Podcast', description: 'Eigener Podcast-Feed, Episoden, öffentliche Adresse und Upload zu Buzzsprout/Podbean.' },
  { name: 'Statistik', description: 'Hörerstatistik und Sendungs-Rückblick.' },
  { name: 'Motion Mix', description: 'Automatisch gemischte Übergänge als Aufträge.' },
  { name: 'KI', description: 'KI-Anbieter, Text, Sprache, Musik, Spot-Werkstatt, Assistent.' },
  { name: 'Integrationen', description: 'Brücken zu Icecast/AzuraCast/laut.fm, Webhooks, laut.fm-Anbindung.' },
  { name: 'Hörer-Interaktion', description: 'Posteingang, Umfragen, Formulare, Auslosungen und die Einstellungen des Hörerbereichs.' },
  { name: 'System', description: 'Server-Zustand, Speicher, Updates, Sicherungen, Einrichtung, Live-Ereignisse.' },
  { name: 'Öffentlich & Hörer', description: 'Ohne Anmeldung erreichbar: Senderseite, Hörer-Funktionen, Statusdateien, Podcast-Feed.' },
];

/** Zuordnung eines Pfads (ohne /api/v1) zu einem Bereich; die erste passende Regel gilt. */
const TAG_RULES: Array<[RegExp, string]> = [
  [/^\/(pairing|devices|app\/connect|discover)/, 'Apps & Geräte'],
  [/^\/(me|auth|users|tokens|audit|capabilities)(\/|$)/, 'Konto & Zugang'],
  [/^\/(network$|stations$|stations\/:sid(\/logo)?$)/, 'Sender'],
  [/^\/stations\/:sid\/sources/, 'Quellen & Live'],
  [/^\/stations\/:sid\/(outputs|own-streams|stream-profiles|liquidsoap)|^\/dsp\//, 'Ausgänge & Streams'],
  [/^\/music-hub\/nextcloud|^\/nextcloud|\/nextcloud(\/|$)/, 'Nextcloud'],
  [/^\/music-hub/, 'MusicHub'],
  [/^\/stations\/:sid\/(queue|playlists|smart-blocks|rotation-pool|lifehacks|m3u)/, 'Warteschlange & Playlists'],
  [/^\/stations\/:sid\/(automation|now-playing|decks|playout|mode|onair|metadata|history|quick|cardwall|stream-profiles-test)/, 'Playout & Decks'],
  [/^\/stations\/:sid\/(planning|preflight|jobs|clock-events|plans|rec-plans|recorder|recordings)/, 'Planung & Aufnahme'],
  [/^\/stations\/:sid\/(news|showprep)/, 'Nachrichten & Vorbereitung'],
  [/^\/stations\/:sid\/podcast/, 'Podcast'],
  [/^\/stations\/:sid\/(stats|recap)/, 'Statistik'],
  [/^\/stations\/:sid\/motion-mix/, 'Motion Mix'],
  [/^\/ai(\/|$)|^\/stations\/:sid\/ai/, 'KI'],
  [/^\/bridge|^\/stations\/:sid\/(bridges|integrations|lautfm)/, 'Integrationen'],
  [/^\/stations\/:sid\/(inbox|polls|forms|form-entries|draw|draws|listener)/, 'Hörer-Interaktion'],
  [/^\/stations\/:sid\/(media|folders)|^\/audio-devices/, 'Bibliothek'],
  [/^\/(system|database|audio|encoder|stream|storage|update|backup|setup|app|events|site)(\/|$)/, 'System'],
];

export function tagOf(path: string): string {
  for (const [re, tag] of TAG_RULES) if (re.test(path)) return tag;
  return 'System';
}

/** Routen, die http.ts außerhalb der Routentabelle behandelt (öffentlich, Streams, Proxy). */
export const EXTRA: Endpoint[] = ([
  ['GET', '/health', 'public', 'Öffentlicher Gesundheitsstand ohne Details', 'System'],
  ['GET', '/auth/status', 'public', 'Gibt an, ob Benutzerkonten existieren und Kopplung möglich ist', 'Konto & Zugang'],
  ['POST', '/auth/login', 'public', 'Anmelden: { username, password } liefert Sitzungs-Token und Benutzer', 'Konto & Zugang'],
  ['POST', '/pair', 'public', 'Kopplungscode einlösen: { code, name, platform } liefert den Geräte-Token (Apps)', 'Apps & Geräte'],
  ['GET', '/public/site', 'public', 'Ankündigungs-Banner und Wartungsmeldung', 'Öffentlich & Hörer'],
  ['GET', '/public/network', 'public', 'Öffentliche Senderliste', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/page', 'public', 'Öffentliche Senderseite: Name, Logo, aktueller Titel, Streams', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/schedule', 'public', 'Öffentlicher Sendeplan', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/charts', 'public', 'Öffentliche Charts', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/cover/:mid', 'public', 'Cover eines Chart-Titels', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/listener', 'public', 'Hörerbereich: Einstellungen und Funktionen des Senders', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/listener/search', 'public', 'Hörerbereich: Titel suchen (?q=)', 'Öffentlich & Hörer'],
  ['POST', '/public/stations/:sid/listener/request', 'public', 'Hörerbereich: Musikwunsch senden (bei laut.fm-Wünschen Titel-ID „lf:…“ aus der Suche)', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/listener/wishes', 'public', 'Hörerbereich: Wunschliste (laut.fm) mit Stimmen und nächster Wunschstunde', 'Öffentlich & Hörer'],
  ['POST', '/public/stations/:sid/listener/wish/vote', 'public', 'Hörerbereich: für einen Wunsch abstimmen (laut.fm)', 'Öffentlich & Hörer'],
  ['POST', '/public/stations/:sid/listener/message', 'public', 'Hörerbereich: Nachricht an das Studio senden', 'Öffentlich & Hörer'],
  ['POST', '/public/stations/:sid/listener/vote', 'public', 'Hörerbereich: für einen Titel abstimmen', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/listener/charts', 'public', 'Hörerbereich: Wunsch-Charts', 'Öffentlich & Hörer'],
  ['POST', '/public/stations/:sid/listener/voice', 'public', 'Hörerbereich: Sprachnachricht senden (Audio im Body)', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/listener/poll', 'public', 'Hörerbereich: aktive Umfrage lesen', 'Öffentlich & Hörer'],
  ['POST', '/public/stations/:sid/listener/poll/vote', 'public', 'Hörerbereich: an der Umfrage teilnehmen', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/listener/form', 'public', 'Hörerbereich: Formular lesen (?id=)', 'Öffentlich & Hörer'],
  ['POST', '/public/stations/:sid/listener/form/submit', 'public', 'Hörerbereich: Formular absenden', 'Öffentlich & Hörer'],
  ['GET', '/public/stations/:sid/podcast.xml', 'public', 'Podcast-Feed (RSS 2.0 mit iTunes-Erweiterung)', 'Podcast'],
  ['GET', '/public/stations/:sid/podcast/cover', 'public', 'Podcast-Cover', 'Podcast'],
  ['GET', '/public/stations/:sid/podcast/episodes/:eid/audio', 'public', 'Audio einer veröffentlichten Episode', 'Podcast'],
  ['GET', '/stations/:sid/logo', 'public', 'Sender-Logo als Bild', 'Sender'],
  ['GET', '/lautfm/public/*', 'session', 'Öffentliche laut.fm-API durchreichen (nur erlaubte Pfade)', 'Integrationen'],
  ['GET', '/stations/:sid/lautfm/ra/*', 'scope', 'laut.fm-Radioadmin mit dem gespeicherten Token durchreichen (lesen, Recht lautfm:read)', 'Integrationen'],
  ['POST', '/stations/:sid/lautfm/ra/*', 'scope', 'laut.fm-Radioadmin mit dem gespeicherten Token durchreichen (schreiben, Recht lautfm:write; auch PUT, PATCH, DELETE)', 'Integrationen'],
] as const).map(([method, path, auth, summary, tag]) => ({ method, path, auth, summary, tag, scope: null }));

/** Außerhalb von /api/v1: Statusdateien, Streams, Ingest, Downloads, Dokumentation. */
export const OUTSIDE: Array<{ method: string; path: string; summary: string; auth: string }> = [
  { method: 'GET', path: '/status.json', summary: 'Alle öffentlichen Sender mit Status (JSON)', auth: 'öffentlich' },
  { method: 'GET', path: '/status/{sender}.json', summary: 'Stream-Status eines Senders (auch .xml im Icecast-Format, .m3u, .xspf)', auth: 'öffentlich' },
  { method: 'GET', path: '/status/lautfm/{sender}.json', summary: 'Öffentlicher Status einer laut.fm-Station', auth: 'öffentlich' },
  { method: 'GET', path: '/listen/{sender}/{mount}', summary: 'Stream hören (Audio); Token als Header oder ?token=', auth: 'Recht stream:read' },
  { method: 'GET', path: '/hls/{sender}/{datei}', summary: 'HLS-Playlist und -Segmente der Zusatz-Streams', auth: 'Recht stream:read' },
  { method: 'PUT', path: '/ingest/{sender}/{mount}', summary: 'Icecast-kompatibler Quell-Eingang (auch Methode SOURCE), HTTP Basic', auth: 'Quell-Passwort' },
  { method: 'GET', path: '/download/AnMaCha-Cast-Android.apk', summary: 'Android-App herunterladen', auth: 'öffentlich' },
  { method: 'GET', path: '/api/v1/openapi.json', summary: 'Diese Spezifikation (OpenAPI 3.1)', auth: 'öffentlich' },
  { method: 'GET', path: '/api-docs.html', summary: 'Interaktive API-Dokumentation', auth: 'öffentlich' },
];

const BASE_ERRORS = { '400': 'Ungültige Anfrage', '401': 'Nicht angemeldet', '403': 'Recht fehlt', '404': 'Nicht gefunden', '409': 'Konflikt', '429': 'Zu viele Anfragen' };

export function parseSummaries(text = SUMMARIES): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^(GET|POST|PUT|PATCH|DELETE) (\S+) \| (.+)$/.exec(line.trim());
    if (m) map.set(`${m[1]} ${m[2]}`, m[3]!);
  }
  return map;
}

/** Alle Endpunkte: registrierte Routen (mit Beschreibung) plus die öffentlichen Sonderrouten, stabil sortiert. */
export function endpoints(routes: RouteInfo[]): Endpoint[] {
  const sums = parseSummaries();
  const seen = new Set<string>();
  const out: Endpoint[] = [];
  for (const r of routes) {
    const path = r.path.replace(API_PREFIX, '');
    const key = `${r.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method: r.method, path, scope: r.scope, summary: sums.get(key) ?? '', tag: tagOf(path), auth: r.scope ? 'scope' : 'session' });
  }
  for (const e of EXTRA) if (!seen.has(`${e.method} ${e.path}`)) out.push(e);
  const order = new Map(TAGS.map((t, i) => [t.name, i]));
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return out.sort((a, b) => (order.get(a.tag)! - order.get(b.tag)!) || a.path.localeCompare(b.path) || methods.indexOf(a.method) - methods.indexOf(b.method));
}

const SCOPE_TEXT: Record<string, string> = {
  'now_playing:read': 'Aktuellen Titel, Verlauf und Statistik lesen',
  'schedule:read': 'Sendeplan und Planung lesen',
  'stream:read': 'Streams anhören',
  'branding:read': 'Sender, Namen und Logos lesen',
  'queue:read': 'Warteschlange, Playlists, Posteingang lesen',
  'queue:write': 'Warteschlange und Playlists ändern, Posteingang bearbeiten',
  'cardwall:read': 'Cardwall lesen',
  'cardwall:trigger': 'Cardwall-Tasten, Carts und Schnellstarts auslösen',
  'sources:read': 'Quellen und Brücken lesen',
  'sources:write': 'Quellen und Brücken ändern, Live-Übernahme',
  'automation:read': 'Automation, Planung, Aufnahmen, Podcast und Statistik lesen',
  'automation:write': 'Automation steuern, Planung, Aufnahme und Podcast ändern',
  'media:read': 'Bibliothek lesen',
  'media:write': 'Bibliothek ändern, Titel hochladen und bearbeiten',
  'stations:write': 'Sender, Umfragen, Formulare und Hörerbereich ändern',
  'outputs:read': 'Ausgänge und Streams lesen',
  'outputs:write': 'Ausgänge und Streams ändern',
  'audit:read': 'Audit-Protokoll lesen',
  'tokens:write': 'API-Schlüssel und Geräte-Kopplung verwalten',
  'lautfm:read': 'laut.fm-Anbindung lesen',
  'lautfm:write': 'laut.fm-Anbindung ändern',
  'ai:read': 'KI-Einstellungen und Verlauf lesen',
  'ai:write': 'KI-Funktionen nutzen und einstellen',
  'bridge:write': 'Brücken-Schnittstelle für externe Systeme nutzen',
};
export const scopeTable = (): Array<[string, string]> => ALL_SCOPES.map((s) => [s, SCOPE_TEXT[s] ?? '']);

const paramNames = (path: string) => [...path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
const oaPath = (path: string) => path.replace(/:(\w+)/g, '{$1}');

export function buildOpenApi(routes: RouteInfo[], version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of endpoints(routes)) {
    const op: Record<string, unknown> = {
      summary: e.summary,
      tags: [e.tag],
      operationId: `${e.method.toLowerCase()}_${oaPath(e.path).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      parameters: paramNames(e.path).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      responses: { '200': { description: 'Erfolg' }, ...Object.fromEntries(Object.entries(BASE_ERRORS).map(([c, d]) => [c, { description: d }])) },
    };
    if (e.auth === 'public') op.security = [];
    else if (e.scope) { op.security = [{ bearer: [e.scope] }]; op['x-scope'] = e.scope; }
    else op.security = [{ bearer: [] }];
    if (e.method !== 'GET' && e.method !== 'DELETE') op.requestBody = { content: { 'application/json': { schema: { type: 'object' } } } };
    (paths[oaPath(e.path)] ??= {})[e.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'AnMaCha Cast API', version,
      description: 'REST-API von AnMaCha Cast. Alle Pfade liegen unter /api/v1. Anmeldung per Header `Authorization: Bearer <Schlüssel>` (API-Schlüssel, Sitzungs- oder Geräte-Token). Fehler: { "error": "<code>", "message": "…" }.',
      license: { name: 'AnMaCha Cast Lizenz', url: 'https://github.com/ricorewioriginal-collab/anmacha_cast/blob/main/LICENSE' },
    },
    servers: [{ url: API_PREFIX }],
    tags: TAGS,
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API-Schlüssel (ad_…), Sitzungs-Token (Anmeldung) oder Geräte-Token (Kopplung)' } } },
    paths,
  };
}

const esc = (s: string) => s.replace(/\|/g, '\\|');

/** docs/API-REFERENCE.md: alle Endpunkte nach Bereichen. */
export function buildMarkdown(routes: RouteInfo[], version: string): string {
  const eps = endpoints(routes);
  const lines: string[] = [
    '# AnMaCha Cast – API-Referenz',
    '',
    `Vollständige Liste aller Endpunkte (Version ${version}, ${eps.length} Endpunkte). Diese Datei wird aus dem laufenden Code erzeugt (\`npm run docs:api\`);`,
    'die maschinenlesbare Fassung ist [openapi.json](openapi.json) (OpenAPI 3.1), live unter `/api/v1/openapi.json`, interaktiv unter `/api-docs.html`.',
    'Einführung, Anmeldung, Rechte und Beispiele: [API.md](API.md).',
    '',
    '„Recht“ nennt den Scope, den der Schlüssel braucht. `Sitzung` = jede Anmeldung genügt (zusätzliche Prüfungen, z. B. Administrator, macht der Server). `–` = ohne Anmeldung.',
    '',
  ];
  for (const t of TAGS) {
    const list = eps.filter((e) => e.tag === t.name);
    if (!list.length) continue;
    lines.push(`## ${t.name}`, '', t.description, '', '| Methode | Pfad | Recht | Beschreibung |', '|---|---|---|---|');
    for (const e of list) lines.push(`| ${e.method} | \`${API_PREFIX}${e.path}\` | ${e.auth === 'public' ? '–' : e.scope ? `\`${e.scope}\`` : 'Sitzung'} | ${esc(e.summary)} |`);
    lines.push('');
  }
  lines.push('## Außerhalb von /api/v1', '', '| Methode | Pfad | Zugriff | Beschreibung |', '|---|---|---|---|');
  for (const o of OUTSIDE) lines.push(`| ${o.method} | \`${o.path}\` | ${o.auth} | ${esc(o.summary)} |`);
  lines.push('');
  return lines.join('\n');
}

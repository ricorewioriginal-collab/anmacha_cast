// laut.fm-Radioadmin: Wiederholungsregeln und Fehlermeldungen (wie im AnMaCha Control Center, siehe src/server/lautfm.ts).
//  • Lesen bei 429/502/503/504 oder Netzfehler bis zu dreimal, Retry-After auf 1–5 s begrenzt
//  • Schreiben nie automatisch wiederholen (Ergebnis bei Zeitlimit unbekannt)
//  • 401/403: Origin neu ermitteln und einmal wiederholen, solange kein Body gesendet wurde
//  • Fehlerantworten bekommen eine verständliche deutsche Meldung
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOKEN = 'stab1234-efgh-5678-ijkl-9012mnop3456';
const ORIGIN = 'anmacha_dashboard';
const hits: Record<string, number> = {};
const mock = createServer((req, res) => {
  const key = `${req.method} ${req.url}`;
  hits[key] = (hits[key] ?? 0) + 1;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { messages: 'Invalid token' });
  if (req.headers.origin !== ORIGIN) return json(403, { messages: 'The HTTP header ORIGIN must match the callback_url' });
  if (req.url === '/stations') return json(200, [{ id: 7, name: 'mein-radio', role: 'owner' }]);
  // Erster Abruf überlastet (ohne Retry-After → 500 ms Pause), zweiter klappt
  if (req.url === '/stations/7/playlists' && req.method === 'GET') return hits[key] === 1 ? json(503, { messages: 'busy' }) : json(200, { playlists: [{ id: 1, title: 'Rotation' }] });
  if (req.url === '/stations/7/playlists' && req.method === 'POST') return json(503, { messages: 'busy' });
  if (req.url === '/stations/7/playlists/1' && req.method === 'POST') return json(422, { messages: 'Track already in playlist' });
  if (req.url === '/stations/7/playlists/99/tracks') return json(404, { messages: 'Not found' });
  json(200, {});
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
process.env.ANMACHA_CAST_RADIOADMIN_URL = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

const { AnMaChaCastApp } = await import('../src/server/app.ts');
const { createHttpServer } = await import('../src/server/http.ts');
const { raCall, retryDelay, lautfmMessage, upstreamDetail } = await import('../src/server/lautfm.ts');

const resp = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : '{}', { status, headers });

test('retryDelay: Retry-After auf 1–5 s begrenzt, sonst steigend', () => {
  assert.equal(retryDelay('3', 1), 3000);
  assert.equal(retryDelay('120', 1), 5000);
  assert.equal(retryDelay('0', 2), 1000);
  assert.equal(retryDelay(null, 1), 500);
  assert.equal(retryDelay(undefined, 2), 1000);
});

test('raCall: Lesen wird bei Last wiederholt, Schreiben nie', async () => {
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  let n = 0;
  const ok = await raCall('GET', async () => (++n < 3 ? resp(503, { 'retry-after': '2' }) : resp(200)), 'o', { wait });
  assert.equal(ok.status, 200);
  assert.equal(n, 3);
  assert.deepEqual(waits, [2000, 2000]);

  n = 0;
  const give = await raCall('GET', async () => { n++; return resp(502); }, 'o', { wait });
  assert.equal(give.status, 502, 'nach drei Versuchen kommt die letzte Antwort');
  assert.equal(n, 3);

  n = 0;
  const write = await raCall('POST', async () => { n++; return resp(503); }, 'o', { wait });
  assert.equal(write.status, 503);
  assert.equal(n, 1, 'Schreibzugriff genau einmal');

  n = 0;
  await assert.rejects(raCall('PATCH', async () => { n++; throw new Error('netz'); }, 'o', { wait }));
  assert.equal(n, 1, 'Schreibzugriff ohne Antwort wird nicht erneut gesendet');

  n = 0;
  const net = await raCall('GET', async () => { if (++n === 1) throw new Error('netz'); return resp(200); }, 'o', { wait });
  assert.equal(net.status, 200, 'Netzfehler beim Lesen: erneut versuchen');
});

test('raCall: nach 401/403 einmal mit neu ermitteltem Origin, nie bei schon gesendetem Body', async () => {
  const used: string[] = [];
  const send = async (o: string) => { used.push(o); return resp(o === 'richtig' ? 200 : 403); };
  const r = await raCall('DELETE', send, 'falsch', { reorigin: async () => 'richtig' });
  assert.equal(r.status, 200);
  assert.deepEqual(used, ['falsch', 'richtig']);

  used.length = 0;
  const once = await raCall('GET', send, 'falsch', { reorigin: async () => 'auch-falsch' });
  assert.equal(once.status, 403);
  assert.deepEqual(used, ['falsch', 'auch-falsch'], 'nur ein neuer Origin, keine Schleife');

  used.length = 0;
  const body = await raCall('POST', send, 'falsch', { replayable: false, reorigin: async () => 'richtig' });
  assert.equal(body.status, 403);
  assert.deepEqual(used, ['falsch'], 'gestreamter Body kann nicht erneut gesendet werden');
});

test('Fehlermeldungen: laut.fm-Text wird übernommen und verständlich ergänzt', () => {
  assert.equal(upstreamDetail({ messages: 'Track already in playlist' }), 'Track already in playlist');
  assert.equal(upstreamDetail({ error: 'x' }), 'x');
  assert.equal(upstreamDetail(null), '');
  assert.match(lautfmMessage(403), /abgelehnt.*neu verbinden/);
  assert.match(lautfmMessage(404), /nicht gefunden/);
  assert.match(lautfmMessage(422, 'Track already in playlist'), /nicht angenommen: Track already in playlist/);
  assert.match(lautfmMessage(429), /begrenzt/);
  assert.match(lautfmMessage(503), /Problem \(HTTP 503\)/);
});

test('Weiterleitung: Lesen übersteht Überlast, Schreiben nicht doppelt, falscher Origin wird repariert, Meldungen lesbar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-lautfm-stab-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = app.svc.auth.createToken({ name: 't', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  const api = (m: string, p: string, body?: unknown) => fetch(`${root}/api/v1/stations/main${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await api('POST', '/lautfm/connect', { token: TOKEN })).status, 200);
    assert.equal(app.svc.lautfm.lautfmConfig('main').origin, ORIGIN, 'anmacha_dashboard als Kandidat gefunden');

    // GET: erster Versuch 503, zweiter 200 – der Studio-Client merkt nichts davon
    const pl = await api('GET', '/lautfm/ra/stations/7/playlists');
    assert.equal(pl.status, 200);
    assert.equal(((await pl.json()) as { playlists: unknown[] }).playlists.length, 1);
    assert.equal(hits['GET /stations/7/playlists'], 2);

    // POST: 503 wird weitergegeben, aber nur einmal gesendet; Meldung auf Deutsch
    const created = await api('POST', '/lautfm/ra/stations/7/playlists', { title: 'Neu', color: '#19c3e6' });
    assert.equal(created.status, 503);
    assert.equal(hits['POST /stations/7/playlists'], 1, 'Playlist nicht doppelt angelegt');
    const cb = (await created.json()) as { message: string; lautfm: boolean };
    assert.equal(cb.lautfm, true);
    assert.match(cb.message, /laut\.fm hat gerade ein Problem/);

    // Doppelter Titel: laut.fm-Text bleibt erhalten
    const dup = (await (await api('POST', '/lautfm/ra/stations/7/playlists/1', { track_id: 5 })).json()) as { message: string; messages: string };
    assert.equal(dup.messages, 'Track already in playlist');
    assert.match(dup.message, /nicht angenommen: Track already in playlist/);
    assert.match(((await (await api('GET', '/lautfm/ra/stations/7/playlists/99/tracks')).json()) as { message: string }).message, /nicht gefunden/);

    // Gespeicherter Origin verstellt: Lesen repariert ihn selbst (Origin neu ermitteln, einmal wiederholen)
    await api('PUT', '/lautfm', { origin: 'falscher-origin' });
    const st = await api('GET', '/lautfm/ra/stations/7');
    assert.equal(st.status, 200);
    assert.equal(app.svc.lautfm.lautfmConfig('main').origin, ORIGIN, 'richtiger Origin wieder gespeichert');
    // Serverseitige Aufrufe genauso
    await api('PUT', '/lautfm', { origin: 'falscher-origin' });
    assert.equal((await app.svc.lautfm.radioadmin('main', 'GET', '/stations/7')).status, 200);
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.after(() => new Promise<void>((r) => mock.close(() => r())));

// Studio-Hilfen (studio/js/lautfm.js): alle Seiten der Playlist-Titel, Sendeplan ohne Basis-Playlist in den Einträgen
// @ts-expect-error – Browser-Modul ohne Typdeklaration
const { hasNextPage, collectTrackPages, scheduleEntries } = await import('../studio/js/lautfm.js');

test('Studio: weitere Seite nach beiden Paging-Formen der Spezifikation', () => {
  assert.equal(hasNextPage({ _paging: { current_page: 1, total_pages: 3 } }, 1), true);
  assert.equal(hasNextPage({ _paging: { current_page: 3, total_pages: 3 } }, 3), false);
  assert.equal(hasNextPage({ _paging: { current_page: 1, next_page: 2 } }, 1), true);
  assert.equal(hasNextPage({ tracks: [] }, 1), false);
});

test('Studio: Playlist-Titel über alle Seiten, kein endloses Blättern', async () => {
  const pages: Record<number, unknown> = {
    1: { tracks: [{ id: 1 }, { id: 2 }], _paging: { current_page: 1, total_pages: 2 } },
    2: { tracks: [{ id: 3 }], _paging: { current_page: 2, total_pages: 2 } },
  };
  assert.deepEqual((await collectTrackPages(async (p: number) => pages[p])).map((t: { id: number }) => t.id), [1, 2, 3]);
  // Server ignoriert „page“: immer dieselbe Seite → nach der zweiten Abfrage Schluss
  let calls = 0;
  const same = await collectTrackPages(async () => { calls++; return { tracks: [{ id: 1 }], _paging: { current_page: 1, total_pages: 5 } }; });
  assert.equal(same.length, 1);
  assert.equal(calls, 2);
});

test('Studio: Sendeplan-Einträge zusammengefasst, Basis-Playlist nie in den Einträgen', () => {
  assert.deepEqual(scheduleEntries({ 0: 5, 1: 5, 2: 9, 30: 5, 40: 1 }, 1), [
    { playlist_id: 5, slot: 0, duration: 2 }, { playlist_id: 9, slot: 2, duration: 1 }, { playlist_id: 5, slot: 30, duration: 1 },
  ]);
});

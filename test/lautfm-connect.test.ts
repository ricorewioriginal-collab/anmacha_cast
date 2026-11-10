import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Nachbau des laut.fm-Verhaltens: Token gilt nur mit dem Origin, für den es ausgestellt wurde;
// /stations kommt verpackt als { stations: [...] }.
const TOKEN = 'abcd1234-efgh-5678-ijkl-9012mnop3456';
const ORIGIN = 'http://studio.local:8750';
const seen: string[] = [];
const mock = createServer((req, res) => {
  seen.push(`${req.method} ${req.url} ${req.headers.origin}`);
  if (req.headers.authorization !== `Bearer ${TOKEN}` || req.headers.origin !== ORIGIN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid token format' }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url === '/stations') return res.end(JSON.stringify({ stations: [{ id: 7, name: 'Mein-Radio', display_name: 'Mein Radio', role: 'owner' }, { id: 9, name: 'anderes', role: 'dj' }] }));
  if (req.url === '/stations/7') return res.end(JSON.stringify({ id: 7, name: 'mein-radio' }));
  if (req.url === '/stations/9/live') return res.end(JSON.stringify({ protocol: 'http', server: 'stream.laut.fm', port: 8000, mountpoint: '/anderes', user: 'source', password: 'geheim9' }));
  if (req.url === '/stations/9/schedule') return res.end(JSON.stringify({ base_playlist_id: 55, entries: [] }));
  res.end('{}');
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
process.env.ANMACHA_CAST_RADIOADMIN_URL = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;

const { AnMaChaCastApp } = await import('../src/server/app.ts');
const { createHttpServer } = await import('../src/server/http.ts');
const { cleanToken, normalizeStations } = await import('../src/server/lautfm.ts');

test('laut.fm: Token säubern und Stationslisten beider Formate verstehen', () => {
  assert.equal(cleanToken(`  Bearer "${TOKEN}"\n`), TOKEN);
  assert.deepEqual(normalizeStations([{ id: 1, name: 'A' }]), [{ id: 1, name: 'a', displayName: 'A', role: 'dj' }]);
  assert.equal(normalizeStations({ stations: [] })?.length, 0);
  assert.equal(normalizeStations({ error: 'x' }), null);
});

test('laut.fm verbinden: Origin wird selbst ermittelt, Station gewählt, Anfragen laufen mit dem richtigen Origin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-lautfm-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = app.svc.auth.createToken({ name: 't', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  const api = (m: string, p: string, body?: unknown) => fetch(`${root}/api/v1/stations/main${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    // Unsinn wird vorab abgelehnt, ohne laut.fm zu fragen
    assert.equal((await api('POST', '/lautfm/connect', { token: 'kurz' })).status, 400);
    // Falsches Token: klare Meldung
    const bad = await api('POST', '/lautfm/connect', { token: 'x'.repeat(30), pageOrigin: ORIGIN });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { message: string }).message, /abgelehnt/);

    // Richtiges Token, eingefügt mit „Bearer “ – Origin kommt von der Studio-Seite
    const r = await api('POST', '/lautfm/connect', { token: `Bearer ${TOKEN}`, pageOrigin: ORIGIN });
    assert.equal(r.status, 200);
    const cfg = (await r.json()) as { origin: string; stationId: number; stationName: string; hasToken: boolean; stations: unknown[] };
    assert.equal(cfg.origin, ORIGIN);
    assert.equal(cfg.stationId, 7, 'eigene Station (owner) automatisch gewählt');
    assert.equal(cfg.stationName, 'mein-radio');
    assert.equal(cfg.hasToken, true);
    assert.equal(cfg.stations.length, 2);

    // Nutzerbericht: laut.fm-Sender fehlten im Dropdown "Meine Sender" - der zweite Sender des Kontos
    // ("anderes", id 9, noch keinem AnMaCha-Cast-Sender zugeordnet) muss jetzt automatisch als eigener
    // AnMaCha-Cast-Sender angelegt werden (nur weil hier mit einem globalen Admin-Token verbunden wurde).
    const listStations = () => fetch(`${root}/api/v1/stations`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()) as Promise<Array<{ id: string; name: string; lautfmConnected: boolean }>>;
    const allStations = await listStations();
    const auto = allStations.find((s) => s.id === 'anderes');
    assert.ok(auto, 'zweiter laut.fm-Sender wurde automatisch als eigener AnMaCha-Cast-Sender angelegt');
    assert.equal(auto?.name, 'anderes');
    // Nutzerbericht: laut.fm-Navigation soll sich nur bei tatsächlich verbundenen Sendern zeigen
    assert.equal(allStations.find((s) => s.id === 'main')?.lautfmConnected, true);
    assert.equal(auto?.lautfmConnected, true);
    const autoLf = await fetch(`${root}/api/v1/stations/anderes/lautfm`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(autoLf.status, 200);
    assert.equal(((await autoLf.json()) as { stationId: number }).stationId, 9);
    // Erneutes Verbinden legt den bereits vorhandenen Sender nicht doppelt an.
    await api('POST', '/lautfm/connect', { pageOrigin: ORIGIN });
    const again2 = await listStations();
    assert.equal(again2.filter((s) => s.id === 'anderes').length, 1);

    // Weiterleitung nutzt den ermittelten Origin
    const st = await api('GET', '/lautfm/ra/stations/7');
    assert.equal(st.status, 200);
    assert.deepEqual(await st.json(), { id: 7, name: 'mein-radio' });

    // Gespeicherter Origin falsch (z. B. von Hand verstellt): Prüfung findet den richtigen wieder
    await api('PUT', '/lautfm', { origin: 'airdeck' });
    const chk = (await (await api('POST', '/lautfm/check')).json()) as { ok: boolean; origin: string };
    assert.equal(chk.ok, false, 'ohne Seiten-Origin kein Treffer unter den Standardnamen');
    const again = await api('POST', '/lautfm/connect', { pageOrigin: ORIGIN });
    assert.equal(again.status, 200, 'erneut verbinden mit gespeichertem Token');
    assert.equal(((await (await api('POST', '/lautfm/check')).json()) as { ok: boolean }).ok, true);
    assert.equal(((await app.svc.lautfm.radioadmin('main', 'GET', '/stations/7')).status), 200);

    // Nutzerbericht: eigener Sender (keine laut.fm-Identität) soll zusätzlich live auf laut.fm zu hören
    // sein, ohne dass dieser Sender selbst unter "laut.fm" verbunden werden muss - eigenes Token je Ausgang.
    const globalApi = (m: string, p: string, body?: unknown) => fetch(`${root}/api/v1${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await globalApi('POST', '/stations', { id: 'eigener-sender', name: 'Eigener Sender' })).status, 200);
    const eigenerApi = (m: string, p: string, body?: unknown) => fetch(`${root}/api/v1/stations/eigener-sender${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    // Ohne Angabe der Station: zwei Sender im Konto -> Liste zur Auswahl statt Raten
    const ambiguous = (await (await eigenerApi('POST', '/lautfm/relay-output', { token: TOKEN, pageOrigin: ORIGIN })).json()) as { stations?: unknown[] };
    assert.equal(ambiguous.stations?.length, 2);
    // Mit gewählter Station: Ausgang wird mit den echten Live-Zugangsdaten angelegt
    const created = await eigenerApi('POST', '/lautfm/relay-output', { token: TOKEN, pageOrigin: ORIGIN, lautfmStationId: 9 });
    assert.equal(created.status, 200);
    const out = (await created.json()) as { host: string; mount: string; port: number; enabled: boolean; state: { status: string } };
    assert.equal(out.host, 'stream.laut.fm');
    // Nicht schon beim Auswählen der Station verbinden – erst wenn im Studio „Verbinden“ gedrückt wird
    assert.equal(out.enabled, false);
    assert.equal(out.state.status, 'idle');
    assert.equal(out.mount, '/anderes');
    assert.equal(out.port, 8000);
    // "eigener-sender" bekam dabei KEINE eigene laut.fm-Identität zugewiesen (bleibt ein eigener Sender)
    const eigenerLf = (await (await eigenerApi('GET', '/lautfm')).json()) as { stationId?: number };
    assert.equal(eigenerLf.stationId, undefined);
    assert.equal((await listStations()).find((s) => s.id === 'eigener-sender')?.lautfmConnected, false);

    // Nutzerbericht (Windows): laut.fm-Sender gewählt → Encoder steht automatisch im Live-Studio. Das Studio ruft
    // dafür live-output auf; mehrfaches Aufrufen darf keine doppelten Encoder anlegen.
    const anderesApi = (m: string, p: string, body?: unknown, raw?: Uint8Array) => fetch(`${root}/api/v1/stations/anderes${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': raw ? 'audio/wav' : 'application/json' }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    const first = (await (await anderesApi('POST', '/lautfm/live-output', {})).json()) as { id: string; enabled: boolean };
    assert.equal(first.enabled, false, 'angelegt, aber noch nicht verbunden');
    const second = (await (await anderesApi('POST', '/lautfm/live-output', {})).json()) as { id: string };
    assert.equal(second.id, first.id, 'vorhandener laut.fm-Encoder wird aufgefrischt statt doppelt angelegt');
    const outs = (await (await anderesApi('GET', '/outputs')).json()) as { host: string }[];
    assert.equal(outs.filter((o) => o.host === 'stream.laut.fm').length, 1);

    // Schnellzugriff bei laut.fm-Automation: Jingle sofort an die laufende Playlist (Sendeplan → Basis-Playlist 55)
    const jn = await anderesApi('POST', '/programmchef/hoerer/jingles/321/now', {});
    assert.equal(jn.status, 200);
    assert.deepEqual(await jn.json(), { playlistId: 55, result: 'added' });
    assert.ok(seen.some((l) => l.startsWith('POST /stations/9/playlists/55 ')), 'Titel wurde bei laut.fm an die Playlist gehängt');
    assert.equal((await anderesApi('POST', '/programmchef/hoerer/jingles/abc/now', {})).status, 400);

    // Voicetrack bei laut.fm-Automation: Aufnahme wird als Beitrag angenommen (Umwandlung/Upload laufen im Hintergrund)
    assert.equal((await anderesApi('POST', '/programmchef/voicetrack?ext=wav', undefined, new Uint8Array(10))).status, 400, 'leere Aufnahme');
    assert.equal((await anderesApi('POST', '/programmchef/voicetrack?ext=exe', undefined, new Uint8Array(4096))).status, 400, 'nur Audioformate');
    const vt = await anderesApi('POST', '/programmchef/voicetrack?ext=wav&title=Moderation%2014%20Uhr', undefined, new Uint8Array(4096));
    assert.equal(vt.status, 200);
    const spot = (await vt.json()) as { kind: string; title: string };
    assert.equal(spot.kind, 'voicetrack');
    assert.equal(spot.title, 'Moderation 14 Uhr');
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.after(() => new Promise<void>((r) => mock.close(() => r())));

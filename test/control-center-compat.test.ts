// Sichert die Verträge ab, auf die sich das AnMaCha Control Center verlässt (anmacha-cast-connect.js, golive-relay/adsync.js):
// Test der Verbindung (health/auth/pair), Abfragen der Leiste, Bedienung, CORS für die freigegebene Seite, Dateiübergabe.
// Wird eine dieser Antworten umgebaut oder umbenannt, bricht dort die Verbindungsleiste – dieser Test schlägt dann zuerst fehl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';

test('Control Center: Verbindungstest, Abfragen, Bedienung und CORS wie von der Verbindungsleiste benutzt', async () => {
  const app = new AnMaChaCastApp(mkdtempSync(join(tmpdir(), 'anmachacast-cc-')), { stableMs: 0, ffmpeg: null });
  const admin = app.svc.auth.createToken({ name: 'a', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (method: string, path: string, tok: string | null, body?: unknown) => {
    const r = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    // Stufen des Verbindungstests: erreichbar → ist AnMaCha Cast → API-Hauptversion 1 → Anmeldeart
    const health = (await call('GET', '/health', null)).body;
    assert.equal(health.name, 'AnMaCha Cast');
    assert.equal(Number(String(health.api).split('.')[0]), 1);
    assert.ok(health.version);
    const status = (await call('GET', '/auth/status', null)).body;
    assert.equal(status.pairing, true);
    assert.equal(typeof status.users, 'boolean');

    // Kopplung mit Code (Leiste: POST /pair mit name + platform 'web'), danach alles mit dem Geräte-Token
    const code = (await call('POST', '/pairing', admin, { role: 'operator', stationIds: ['*'] })).body.code as string;
    const pair = (await call('POST', '/pair', null, { code, name: 'AnMaCha (Browser)', platform: 'web' })).body;
    assert.ok(pair.token && pair.device?.id);
    const dev = pair.token as string;
    assert.equal((await call('GET', '/me', dev)).status, 200);

    const stations = (await call('GET', '/stations', dev)).body as { id: string; name: string }[];
    assert.ok(Array.isArray(stations) && stations.length > 0 && stations[0]!.id && stations[0]!.name);
    const sp = `/stations/${encodeURIComponent(stations[0]!.id)}`;

    // Abfragen der Leiste und ihre Felder
    const np = (await call('GET', `${sp}/now-playing`, dev)).body;
    assert.ok('media' in np && 'next' in np);
    const queue = (await call('GET', `${sp}/queue`, dev)).body;
    assert.ok(Array.isArray(queue.items));
    const mode = (await call('GET', `${sp}/mode`, dev)).body;
    assert.ok(['AUTO', 'MANUAL', 'LIVE'].includes(mode.base ?? mode.mode));
    const playout = (await call('GET', `${sp}/playout`, dev)).body;
    assert.ok('status' in playout, 'running() der Leiste prüft playout.status');
    assert.ok(Array.isArray((await call('GET', `${sp}/cardwall`, dev)).body));

    // Inhaltsabgleich (adsync.js): Datei per PUT /media?name&category&folder, Playlist {name, items, mode}, Sendeplan – mit echten Datensätzen
    const up = await fetch(`${base}/api/v1${sp}/media?name=${encodeURIComponent('Test - Titel.mp3')}&category=music&folder=Tracks`, {
      method: 'PUT', headers: { Authorization: `Bearer ${dev}`, 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(2000, 5),
    });
    assert.equal(up.status, 200);
    const created = (await up.json()) as { id: string };
    const media = (await call('GET', `${sp}/media`, dev)).body as Record<string, unknown>[];
    const m = media.find((x) => x.id === created.id)!;
    assert.ok(m, 'hochgeladener Titel steht in der Liste');
    for (const k of ['id', 'title', 'artist', 'category', 'file', 'durationMs', 'folder']) assert.ok(k in m, `media.${k}`);
    assert.deepEqual([m.artist, m.title, m.category, m.folder], ['Test', 'Titel', 'music', 'Tracks']);
    const pl = (await call('POST', `${sp}/playlists`, dev, { name: 'Abgleich', items: [created.id], mode: 'shuffle' })).body;
    const plists = (await call('GET', `${sp}/playlists`, dev)).body as Record<string, unknown>[];
    const pe = plists.find((x) => x.id === pl.id)!;
    assert.ok(pe, 'Playlist steht in der Liste');
    assert.deepEqual([pe.name, pe.items, pe.mode], ['Abgleich', [created.id], 'shuffle']);
    const plan = (await call('POST', `${sp}/plans`, dev, { label: 'Show', days: [], from: '00:00', to: '00:00', playlistId: pl.id, shuffle: false })).body;
    const planning = (await call('GET', `${sp}/planning`, dev)).body as { plans: Record<string, unknown>[] };
    const pn = planning.plans.find((x) => x.id === plan.id)!;
    assert.ok(pn, 'Sendeplan-Eintrag steht in planning.plans');
    for (const k of ['id', 'label', 'days', 'from', 'to', 'playlistId', 'shuffle']) assert.ok(k in pn, `plan.${k}`);

    // Bedienung
    const baseMode = async () => { const v = (await call('GET', `${sp}/mode`, dev)).body; return v.base ?? v.mode; };
    assert.equal((await call('PUT', `${sp}/mode`, dev, { mode: 'MANUAL' })).status, 200);
    assert.equal(await baseMode(), 'MANUAL');
    assert.equal((await call('PUT', `${sp}/mode`, dev, { mode: 'AUTO' })).status, 200);
    assert.equal(await baseMode(), 'AUTO');
    assert.ok([200, 204].includes((await call('POST', `${sp}/queue/fill`, dev, {})).status));
    assert.ok([200, 204, 409].includes((await call('POST', `${sp}/playout/stop`, dev, {})).status));
    const ai = await call('POST', `${sp}/ai/moderation`, dev, { kind: 'break' });
    assert.ok(ai.status === 200 || (ai.status === 502 && ai.body.error === 'ai_failed'), `KI-Ansage: erlaubt sind Erfolg oder ai_failed (kein Anbieter), nicht ${ai.status}`);

    // Live-Ereignisse: Token als Abfrageparameter (EventSource kann keine Header setzen). Der Stream ist auf einen Sender gefiltert:
    // ein Wechsel auf einem zweiten Sender darf nicht ankommen, der auf dem gewählten Sender schon.
    assert.equal((await call('POST', '/stations', admin, { id: 'zweit', name: 'Zweiter Sender' })).status, 200);
    const sse = await fetch(`${base}/api/v1/events?station=${encodeURIComponent(stations[0]!.id)}&token=${encodeURIComponent(dev)}`);
    assert.equal(sse.status, 200);
    assert.match(sse.headers.get('content-type') ?? '', /event-stream/);
    reader = sse.body!.getReader();
    const text = new TextDecoder();
    let seen = '';
    void (async () => { for (;;) { const { value, done } = await reader!.read(); if (done) return; seen += text.decode(value); } })().catch(() => {});
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await call('GET', '/stations/zweit/mode', dev); // Betriebsart-Steuerung des Senders anlegen, damit der Wechsel ein Ereignis auslöst
    assert.equal((await call('PUT', '/stations/zweit/mode', dev, { mode: 'MANUAL' })).status, 200);
    await wait(500);
    assert.doesNotMatch(seen, /^event: MODE_CHANGED$/m, 'Ereignisse anderer Sender werden herausgefiltert');
    await call('PUT', `${sp}/mode`, dev, { mode: 'MANUAL' });
    await call('PUT', `${sp}/mode`, dev, { mode: 'AUTO' });
    for (let i = 0; i < 50 && !/^event: MODE_CHANGED$/m.test(seen); i++) await wait(100);
    assert.match(seen, /^event: MODE_CHANGED$/m, 'Betriebsartwechsel des gewählten Senders kommt als MODE_CHANGED an');

    // CORS: erst nach Freigabe unter „Web-Fernsteuerung“, inkl. PUT/Authorization/Content-Type
    const origin = 'https://control.example.org';
    const pre = (h: Record<string, string>) => fetch(`${base}/api/v1/stations`, { method: 'OPTIONS', headers: { Origin: origin, ...h } });
    const ask = { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' };
    assert.equal((await pre(ask)).status, 403);
    assert.equal((await call('PUT', '/app/origins', admin, { webOrigins: [origin] })).status, 200);
    const ok = await pre(ask);
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), origin);
    assert.match(ok.headers.get('access-control-allow-methods') ?? '', /PUT/);
    // …und auf den eigentlichen Antworten (der Browser verlangt den Header auch dort)
    const real = await fetch(`${base}/api/v1/stations`, { headers: { Origin: origin, Authorization: `Bearer ${dev}` } });
    assert.equal(real.status, 200);
    assert.equal(real.headers.get('access-control-allow-origin'), origin);
    const realPut = await fetch(`${base}/api/v1${sp}/mode`, { method: 'PUT', headers: { Origin: origin, Authorization: `Bearer ${dev}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'AUTO' }) });
    assert.equal(realPut.status, 200);
    assert.equal(realPut.headers.get('access-control-allow-origin'), origin);
    const allowed = (ok.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    assert.ok(allowed.includes('authorization') && allowed.includes('content-type'), `CORS erlaubt Authorization und Content-Type: ${allowed}`);
  } finally {
    await reader?.cancel().catch(() => {});
    server.closeAllConnections();
    server.close();
  }
});

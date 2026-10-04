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
    assert.ok(Array.isArray((await call('GET', `${sp}/media`, dev)).body));
    assert.equal((await call('GET', `${sp}/planning`, dev)).body.plans.constructor, Array);

    // Bedienung
    assert.equal((await call('PUT', `${sp}/mode`, dev, { mode: 'MANUAL' })).status, 200);
    assert.equal((await call('PUT', `${sp}/mode`, dev, { mode: 'AUTO' })).status, 200);
    assert.ok([200, 204].includes((await call('POST', `${sp}/queue/fill`, dev, {})).status));
    assert.ok([200, 204, 409].includes((await call('POST', `${sp}/playout/stop`, dev, {})).status));
    assert.equal((await call('POST', `${sp}/ai/moderation`, dev, { kind: 'break' })).status === 404, false);

    // Live-Ereignisse: Token als Abfrageparameter (EventSource kann keine Header setzen)
    const sse = await fetch(`${base}/api/v1/events?station=${encodeURIComponent(stations[0]!.id)}&token=${encodeURIComponent(dev)}`);
    assert.equal(sse.status, 200);
    assert.match(sse.headers.get('content-type') ?? '', /event-stream/);
    await sse.body!.cancel();

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
  } finally {
    server.close();
  }
});

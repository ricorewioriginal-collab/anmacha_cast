// KI-Programmchef Teil 2: Moderationen/Ansagen für laut.fm gegen Radioadmin- und KI-Nachbau – Text → Stimme → privater
// Upload → Verarbeitung abwarten → an die laut Sendeplan laufende Playlist hängen → nach dem Abspielen entfernen und löschen.
// Dazu Sendeuhr-Fälligkeit und Konfigurationsprüfung als Einheiten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SPOTS, cleanSpotConfig, dueClockSlots, spokenTime } from '../src/server/services/programmchef-spots.ts';

test('Sendeuhr: Beiträge werden einige Minuten vorher und je Stunde nur einmal fällig', () => {
  const clock = [{ minute: 0, kind: 'nachrichten' as const }, { minute: 30, kind: 'uhrzeit' as const }];
  const at = (h: number, m: number) => new Date(2026, 10, 9, h, m, 0);
  assert.deepEqual(dueClockSlots(clock, at(13, 50), new Set()), [], '10 Minuten vorher noch nicht');
  const due = dueClockSlots(clock, at(13, 57), new Set());
  assert.equal(due.length, 1);
  assert.equal(due[0]!.kind, 'nachrichten');
  assert.equal(due[0]!.at.getHours(), 14);
  assert.deepEqual(dueClockSlots(clock, at(13, 58), new Set([due[0]!.slot])), [], 'schon erzeugt');
  assert.equal(dueClockSlots(clock, at(14, 27), new Set())[0]!.kind, 'uhrzeit');
  assert.equal(spokenTime(at(9, 0)), 'Es ist 9 Uhr.');
  assert.equal(spokenTime(at(9, 5)), 'Es ist 9 Uhr 5.');
  const c = cleanSpotConfig({ perHour: 99, kinds: ['moderation', 'quatsch'], fromH: 22, toH: 3, clock: [{ minute: 70, kind: 'uhrzeit' }, { minute: 5, kind: 'x' }] }, DEFAULT_SPOTS);
  assert.equal(c.perHour, 6);
  assert.deepEqual(c.kinds, ['moderation']);
  assert.equal(c.toH, 23, 'bis liegt nach von');
  assert.deepEqual(c.clock, [{ minute: 59, kind: 'uhrzeit' }]);
});

const TOKEN = 'abcd1234-efgh-5678-ijkl-9012mnop3456';
const ST = 7;
let own: { id: number; title: string; artist: string; type?: string }[] = [{ id: 100, title: 'alt', artist: 'x' }];
const playlists = new Map<number, number[]>([[1, [100]], [2, []]]);
const deleted: number[] = [];
let played: number[] = [];
let uploads = 0;
let ttsText = '';

const mock = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (d: Buffer) => chunks.push(d));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const send = (code: number, body?: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/v1/chat/completions') return send(200, { choices: [{ message: { content: 'Hallo zusammen, schön dass ihr dabei seid – gleich geht es weiter mit guter Musik!' } }] });
    if (u.pathname === '/v1/audio/speech') {
      ttsText = String(JSON.parse(raw.toString()).input ?? '');
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(4096)]));
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, {});
    const p = u.pathname;
    let m: RegExpExecArray | null;
    if (p === `/stations/${ST}/tracks` && req.method === 'POST') {
      assert.match(String(req.headers['content-type']), /multipart\/form-data/);
      assert.ok(raw.includes(Buffer.from('name="private"')) && raw.includes(Buffer.from('true')), 'als privater Titel');
      uploads++;
      // laut.fm verarbeitet kurz und vergibt dann eine echte ID
      setTimeout(() => own.unshift({ id: 200 + uploads, title: 'upload.mp3', artist: '' }), 30);
      return send(201, { id: -5 });
    }
    if (p === `/stations/${ST}/tracks` && u.searchParams.get('own') === 'true') return send(200, { tracks: own });
    if ((m = /^\/stations\/7\/tracks\/(\d+)$/.exec(p))) {
      if (req.method === 'PATCH') { const t = own.find((x) => x.id === Number(m![1])); Object.assign(t ?? {}, JSON.parse(raw.toString())); return send(200, t); }
      if (req.method === 'DELETE') { deleted.push(Number(m[1])); own = own.filter((x) => x.id !== Number(m![1])); return send(204); }
    }
    if (p === `/stations/${ST}/schedule`) return send(200, [{ base_playlist_id: 1, entries: [{ playlist_id: 2, slot: 0, duration: 168 }] }]);
    if ((m = /^\/stations\/7\/playlists\/(\d+)$/.exec(p)) && req.method === 'POST') { playlists.get(Number(m[1]))!.push(JSON.parse(raw.toString()).track_id); return send(200, {}); }
    if ((m = /^\/stations\/7\/playlists\/(\d+)\/entries\/(\d+)$/.exec(p))) { const id = Number(m[1]); playlists.set(id, playlists.get(id)!.filter((x) => x !== Number(m![2]))); return send(200, {}); }
    if (p === `/stations/${ST}/tracks/stats/24h`) return send(200, played.map((id) => ({ id, listeners: 3 })));
    if (p === `/stations/${ST}/current_playlist`) return send(200, { tracks: [{ artist: 'Nena', title: '99 Luftballons' }] });
    send(404, { path: p });
  });
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
const mockUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
process.env.ANMACHA_CAST_RADIOADMIN_URL = mockUrl;
process.env.ANMACHA_CAST_LAUTFM_API_URL = mockUrl;
const { AnMaChaCastApp } = await import('../src/server/app.ts');

test('Moderation für laut.fm: Text → Stimme → privat hochladen → in laufende Playlist → nach dem Abspielen gelöscht', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-spots-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };
  try {
    app.secrets.set('lautfm:main', TOKEN);
    app.rt('main').data.lautfm = { stationId: ST, stationName: 'mein-radio', origin: 'http://studio.local' };
    // ohne Stimme klare Meldung
    assert.throws(() => app.svc.spots.produce('main', 'moderation'), /Stimme/);
    app.ai.update({ providers: [
      { id: 'ki', name: 'KI', role: 'text', kind: 'openai_compat', baseUrl: `${mockUrl}/v1`, local: true },
      { id: 'tts', name: 'TTS', role: 'voice', kind: 'openai_compat', baseUrl: `${mockUrl}/v1`, local: true },
    ] });
    app.svc.ai.setAiConfig(admin, 'main', { text: { providerId: 'ki', model: 'm' }, voice: { providerId: 'tts', voice: 'v', model: 'tts' } });
    app.svc.spots.pollMs = 20;

    const spot = app.svc.spots.produce('main', 'moderation');
    const end = Date.now() + 10_000;
    while (!['queued', 'failed'].includes(spot.status) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    assert.equal(spot.status, 'queued', spot.error ?? '');
    assert.match(ttsText, /schön dass ihr dabei seid/, 'KI-Text wurde gesprochen');
    assert.equal(spot.trackId, 201);
    assert.equal(spot.playlistId, 2, 'laut Sendeplan laufende Playlist (nicht die Basis)');
    assert.ok(playlists.get(2)!.includes(201));
    const t = own.find((x) => x.id === 201)!;
    assert.equal(t.type, 'jingle');
    assert.match(t.title, /^Moderation \d\d:\d\d$/);

    // noch nicht gelaufen: bleibt
    assert.equal(await app.svc.spots.cleanup('main'), 0);
    played = [201];
    assert.equal(await app.svc.spots.cleanup('main'), 1);
    assert.equal(spot.status, 'played');
    assert.deepEqual(deleted, [201], 'bei laut.fm gelöscht');
    assert.ok(!playlists.get(2)!.includes(201), 'aus der Playlist entfernt');

    // Uhrzeit-Ansage geht auch ohne Text-KI (Vorlage)
    app.svc.ai.setAiConfig(admin, 'main', { text: { providerId: '', model: '' } });
    const u = app.svc.spots.produce('main', 'uhrzeit');
    while (!['queued', 'failed'].includes(u.status) && Date.now() < end + 10_000) await new Promise((r) => setTimeout(r, 20));
    assert.equal(u.status, 'queued', u.error ?? '');
    assert.match(u.text, /^Es ist \d+ Uhr/);
  } finally {
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.after(() => new Promise<void>((r) => mock.close(() => r())));

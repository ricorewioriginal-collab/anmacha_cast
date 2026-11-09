// KI-Programmchef (laut.fm): Titelabgleich und Plan-Prüfung als Einheiten, dazu der ganze Ablauf gegen einen
// Radioadmin-Nachbau und einen OpenAI-kompatiblen KI-Nachbau: Wunsch → Plan → Titelsuche im Pool → Einspielen →
// Sendeplan-Gegenkontrolle → Rückgängig, plus Regel-Planer ohne KI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bestMatch, norm, parseJsonLoose, searchTries, sim, songLines } from '../src/server/programmchef/match.ts';
import { gridEntries, heuristicPlan, normalizePlan, scheduleGrid } from '../src/server/programmchef/plan.ts';

test('Titelabgleich: Schreibweisen, Zusätze und Kooperationen werden erkannt, Falsches nicht', () => {
  assert.equal(norm('Beyoncé – Halo (Radio Edit) feat. X'), 'beyonce halo');
  assert.ok(Math.abs(sim('hello', 'hallo') - 0.8) < 1e-9, 'wie PHP similar_text');
  const pool = [
    { id: 1, artist: { name: 'Die Ärzte' }, title: 'Schrei nach Liebe' },
    { id: 2, artist: 'Shakira', title: 'Soltera' },
    { id: 3, artist: 'Nena', title: '99 Luftballons' },
  ];
  assert.equal(bestMatch(pool, 'Die Aerzte', 'Schrei nach Liebe (Remastered 2011)')?.id, 1);
  assert.equal(bestMatch(pool, 'Shakira x Burna Boy', 'Soltera')?.id, 2, 'Haupt-Interpret einer Kooperation');
  assert.equal(bestMatch(pool, 'Peter Fox', '99 Luftballons'), null, 'anderer Interpret = kein Treffer');
  const tries = searchTries('Shakira x Burna Boy', 'Soltera (Remix)');
  assert.equal(tries[0]!.src, 'own');
  assert.ok(tries.some((t) => t.query.artist === 'Shakira'), 'sucht auch mit Haupt-Interpret');
  assert.deepEqual(parseJsonLoose('<think>hm</think>```json\n{"a":[1,2,],}\n```'), { a: [1, 2] });
  assert.deepEqual(parseJsonLoose('[{"artist":"A","title":"B"},{"artist":"C","title":"D"', '['), [{ artist: 'A', title: 'B' }, { artist: 'C', title: 'D' }], 'abgeschnittene Antwort wird geschlossen');
  assert.deepEqual(songLines('1. Queen – Bohemian Rhapsody\n- Hello von Adele'), [{ artist: 'Queen', title: 'Bohemian Rhapsody' }, { artist: 'Adele', title: 'Hello' }]);
});

test('Plan: KI-Antwort wird geprüft, Fakten aus dem Text setzen sich durch, Regel-Planer ohne KI', () => {
  const p = normalizePlan({ playlists: [{ name: 'Hits', source: 'ai', count: 999 }, { name: 'hits' }], schedule: [{ playlist: 'HITS', days: [1, 9], from: 6, to: 3 }] }, 'Top 40 Songs aktuell');
  assert.ok(p);
  assert.equal(p.playlists.length, 1, 'doppelte Namen entfernt');
  assert.equal(p.playlists[0]!.source, 'chart_de', '„Top …“ → Charts');
  assert.equal(p.playlists[0]!.count, 40, 'genannte Anzahl gilt');
  assert.deepEqual(p.schedule, [{ playlist: 'Hits', days: [1], from: 6, to: 7 }]);
  assert.equal(normalizePlan({ playlists: [] }), null);

  const h = heuristicPlan('Morgens Pop 6-10 Uhr werktags, Abends Rock 18-22 Uhr, je 60 Songs', false);
  assert.ok(h);
  assert.deepEqual(h.playlists.map((x) => [x.name, x.count]), [['Morgens Pop werktags', 60], ['Abends Rock', 60]]);
  assert.deepEqual(h.schedule[0], { playlist: 'Morgens Pop werktags', days: [1, 2, 3, 4, 5], from: 6, to: 10 });

  const g = scheduleGrid([{ playlist_id: 5, slot: 6, duration: 4 }, { playlist_id: 9, slot: 30, duration: 2 }]);
  assert.deepEqual(gridEntries(g, 1), [{ playlist_id: 5, slot: 6, duration: 4 }, { playlist_id: 9, slot: 30, duration: 2 }]);
  assert.deepEqual(gridEntries(g, 5), [{ playlist_id: 9, slot: 30, duration: 2 }], 'Basis-Playlist steht nie in den Einträgen');
});

// ---------- Ganzer Ablauf gegen Nachbauten ----------
const TOKEN = 'abcd1234-efgh-5678-ijkl-9012mnop3456';
const ST = 7;
const pool = [
  ['Die Ärzte', 'Schrei nach Liebe', 'Punk'], ['Nena', '99 Luftballons', 'Pop'], ['Peter Fox', 'Haus am See', 'Pop'],
  ['Rammstein', 'Sonne', 'Metal'], ['Mark Forster', 'Au Revoir', 'Pop'], ['Silbermond', 'Das Beste', 'Pop'], ['AC/DC', 'Thunderstruck', 'Rock'],
].map(([artist, title, genre], i) => ({ id: 500 + i, artist: { name: artist! }, title: title!, genre: genre!, duration: 200, release_year: 2005 }));
const playlists = new Map<number, { id: number; title: string; entries: number[] }>([[1, { id: 1, title: 'Rotation', entries: [500] }]]);
let nextId = 2;
let schedule = { base_playlist_id: 1, entries: [] as { playlist_id: number; slot: number; duration: number }[] };
let aiCalls = 0;

const mock = createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const send = (code: number, body?: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const u = new URL(req.url!, 'http://x');
    const body = raw ? JSON.parse(raw) : {};
    // OpenAI-kompatible KI
    if (u.pathname === '/v1/chat/completions') {
      aiCalls++;
      const sys = String(body.messages?.[0]?.content ?? '');
      const content = sys.includes('Programmplaner')
        ? '```json\n{"summary":"Tagsüber Pop, abends Rock.","playlists":[{"name":"Pop am Tag","source":"ai","count":3,"genres":["Pop"]},{"name":"Rock am Abend","source":"artists","artists":["AC/DC","Rammstein"],"count":5}],"schedule":[{"playlist":"Rock am Abend","days":[1,2,3,4,5],"from":18,"to":22}],"base_playlist":"Pop am Tag"}\n```'
        : '[{"artist":"Nena","title":"99 Luftballons"},{"artist":"Peter Fox","title":"Haus am See (Radio Edit)"},{"artist":"Erfunden","title":"Gibt es nicht"},{"artist":"Silbermond","title":"Das Beste"}]';
      return send(200, { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });
    const p = u.pathname;
    const view = (pl: { id: number; title: string; entries: number[] }) => ({ id: pl.id, title: pl.title, size: pl.entries.length });
    let m: RegExpExecArray | null;
    if (p === '/stations') return send(200, [{ id: ST, name: 'mein-radio', role: 'owner' }]);
    if (p === `/stations/${ST}/playlists` && req.method === 'GET') return send(200, { playlists: [...playlists.values()].map(view) });
    if (p === `/stations/${ST}/playlists` && req.method === 'POST') { const pl = { id: nextId++, title: body.title, entries: [] }; playlists.set(pl.id, pl); return send(201, view(pl)); }
    if ((m = /^\/stations\/7\/playlists\/(\d+)\/tracks$/.exec(p))) return send(200, { tracks: playlists.get(Number(m[1]))!.entries.map((id) => pool.find((t) => t.id === id)), _paging: { current_page: 1, total_pages: 1 } });
    if ((m = /^\/stations\/7\/playlists\/(\d+)\/entries\/(\d+)$/.exec(p))) { const pl = playlists.get(Number(m[1]))!; pl.entries = pl.entries.filter((x) => x !== Number(m![2])); return send(200, view(pl)); }
    if ((m = /^\/stations\/7\/playlists\/(\d+)$/.exec(p))) {
      const pl = playlists.get(Number(m[1]));
      if (!pl) return send(404, {});
      if (req.method === 'DELETE') { playlists.delete(pl.id); return send(204); }
      if (req.method === 'POST') { if (pl.entries.includes(body.track_id)) return send(422, { error: 'already' }); pl.entries.push(body.track_id); return send(200, view(pl)); }
    }
    if (p === `/stations/${ST}/schedule` && req.method === 'GET') return send(200, [schedule]);
    if (p === `/stations/${ST}/schedule` && req.method === 'PATCH') { schedule = body; return send(200, [schedule]); }
    if (p === `/stations/${ST}/tracks`) {
      const q = (k: string) => (u.searchParams.get(k) ?? '').toLowerCase();
      const hits = pool.filter((t) => (!q('artist') || t.artist.name.toLowerCase().includes(q('artist'))) && (!q('title') || t.title.toLowerCase().includes(q('title'))) && (!q('genre') || t.genre.toLowerCase() === q('genre')));
      return send(200, { tracks: u.searchParams.get('own') === 'true' ? [] : hits, _paging: {} });
    }
    send(404, { error: 'nicht nachgebaut', path: p });
  });
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
const mockUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
process.env.ANMACHA_CAST_RADIOADMIN_URL = mockUrl;
const { AnMaChaCastApp } = await import('../src/server/app.ts');

test('Programmchef: Wunsch → Plan → Titelsuche → Einspielen mit Sendeplan → Rückgängig', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-pchef-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };
  try {
    // Ohne laut.fm-Verbindung: klare Meldung
    await assert.rejects(() => app.svc.programmchef.understand('main', 'Pop'), /mit laut\.fm verbinden/);
    app.secrets.set('lautfm:main', TOKEN);
    app.rt('main').data.lautfm = { stationId: ST, stationName: 'mein-radio', origin: 'http://studio.local' };
    // Ohne KI: Regel-Planer
    const rules = await app.svc.programmchef.understand('main', 'Morgens Pop 6-10 Uhr, je 20 Songs');
    assert.match(rules.model, /Regel-Planer/);
    assert.equal(rules.plan.playlists[0]!.count, 20);

    app.ai.update({ providers: [{ id: 'ki', name: 'KI', role: 'text', kind: 'openai_compat', baseUrl: `${mockUrl}/v1`, local: true }] });
    app.svc.ai.setAiConfig(admin, 'main', { text: { providerId: 'ki', model: 'test' } });
    const { plan, model } = await app.svc.programmchef.understand('main', 'Tagsüber Pop, abends Rock 18-22 Uhr');
    assert.equal(model, 'test');
    assert.deepEqual(plan.playlists.map((p) => p.name), ['Pop am Tag', 'Rock am Abend']);

    const job = app.svc.programmchef.startCollect('main', plan);
    const end = Date.now() + 30_000;
    while (job.state === 'running' && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.equal(job.state, 'done', job.error ?? '');
    const pop = job.results.find((r) => r.name === 'Pop am Tag')!;
    assert.deepEqual(pop.found.map((f) => f.title), ['99 Luftballons', 'Haus am See', 'Das Beste'], 'Radio-Edit erkannt, gefunden bis zur Anzahl');
    assert.ok(pop.missing.some((m) => m.artist === 'Erfunden'), 'Erfundenes fällt heraus');
    const rock = job.results.find((r) => r.name === 'Rock am Abend')!;
    assert.deepEqual(rock.found.map((f) => f.artist).sort(), ['AC/DC', 'Rammstein']);

    const r = await app.svc.programmchef.apply(admin, 'main', plan, job.results);
    assert.equal(r.schedule, true, 'Sendeplan gegengeprüft');
    const popId = r.playlists.find((x) => x.name === 'Pop am Tag')!.id;
    const rockId = r.playlists.find((x) => x.name === 'Rock am Abend')!.id;
    assert.equal(playlists.get(popId)!.entries.length, 3);
    assert.equal(schedule.base_playlist_id, popId, 'Hauptplaylist ist Basis');
    assert.deepEqual(schedule.entries.filter((e) => e.playlist_id === rockId).map((e) => [e.slot, e.duration]), [[18, 4], [42, 4], [66, 4], [90, 4], [114, 4]]);

    const u = await app.svc.programmchef.undo(admin, 'main');
    assert.match(u.summary, /2 Playlist\(en\) gelöscht/);
    assert.deepEqual([...playlists.keys()], [1]);
    assert.equal(schedule.base_playlist_id, 1, 'alter Sendeplan zurück');
    assert.ok(aiCalls >= 2);
  } finally {
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.after(() => new Promise<void>((r) => mock.close(() => r())));

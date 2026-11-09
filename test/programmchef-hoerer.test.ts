// KI-Programmchef Teil 4: Hörer-Funktionen für laut.fm gegen einen Radioadmin- und KI-Nachbau – Wunschstunde (Pool-Suche,
// Wunsch, Abstimmen, Sendeplan-Eintrag, Aufbau mit Jingles, Abgleich), „jederzeit wünschen“, Gruß und Sprachnachricht
// auf Sendung, Jingle-Rotation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanGreeting, firstName, nextWishSlot, pickJingles, placeJingles, plainGreeting, wishGridSlots } from '../src/server/programmchef/hoerer.ts';

test('Wunschstunde-Zeiten, Jingle-Verteilung und Grußtext als Einheiten', () => {
  const fri1930 = new Date(2026, 10, 13, 19, 30); // Freitag
  const s = nextWishSlot({ days: [5], from: 20, hours: 2 }, fri1930)!;
  assert.equal(new Date(s.start).getHours(), 20);
  assert.equal(s.end - s.start, 2 * 3600_000);
  assert.equal(s.day, '2026-11-13#20');
  // läuft gerade → dieselbe Stunde; danach → nächste Woche
  assert.equal(nextWishSlot({ days: [5], from: 20, hours: 1 }, new Date(2026, 10, 13, 20, 40))!.day, '2026-11-13#20');
  assert.equal(nextWishSlot({ days: [5], from: 20, hours: 1 }, new Date(2026, 10, 13, 21, 5))!.day, '2026-11-20#20');
  assert.equal(nextWishSlot({ days: [], from: 20, hours: 1 }, fri1930), null);
  assert.deepEqual(wishGridSlots({ days: [1, 7], from: 22, hours: 2 }), [22, 23, 166, 167]);

  assert.deepEqual(placeJingles([1, 2, 3, 4, 5, 6, 7, 8, 9], [90, 91, 92], 3), [1, 2, 90, 3, 4, 5, 91, 6, 7, 8, 92, 9]);
  // ein Jingle für sechs Songs: in der Mitte, nicht ans Ende
  assert.deepEqual(placeJingles([1, 2, 3, 4, 5, 6], [90], 2), [1, 2, 3, 90, 4, 5, 6]);
  assert.deepEqual(placeJingles([1, 2, 3], [90, 91], 4), [1, 2, 3], 'zu wenige Songs');
  assert.deepEqual(placeJingles([1, 2], [90], 0), [1, 2]);
  assert.deepEqual(pickJingles([1, 2, 3], 'rotate', 2, 2), [3, 1]);
  assert.equal(pickJingles([1, 2, 3], 'random', 0, 5).length, 3);

  assert.equal(firstName('  anna-lena Müller!'), 'anna-lena');
  assert.equal(cleanGreeting('Hallo an alle! Mehr auf https://x.de oder mail@x.de, Tel 0171 1234567'), 'Hallo an alle! Mehr auf oder , Tel');
  assert.equal(plainGreeting('Tom K.', 'Grüße an meine Oma!!', 'Radio X'), 'Ein Gruß von Tom hier bei Radio X: Grüße an meine Oma.');
});

const TOKEN = 'abcd1234-efgh-5678-ijkl-9012mnop3456';
const ST = 7;
type T = { id: number; artist: { name: string }; title: string; type: string; genre?: string };
const tr = (id: number, artist: string, title: string, type = 'song', genre = 'Pop'): T => ({ id, artist: { name: artist }, title, type, genre });
const pool: T[] = [tr(501, 'Queen', 'Bohemian Rhapsody'), tr(502, 'Queen', "Don't Stop Me Now"), tr(503, 'Nena', '99 Luftballons'), tr(504, 'Queen', 'Radio Ga Ga'),
  ...Array.from({ length: 20 }, (_, i) => tr(600 + i, `Füll ${i}`, `Popsong ${i}`))];
let own: T[] = [tr(300, 'Sender', 'Jingle A', 'jingle'), tr(301, 'Sender', 'Jingle B', 'jingle'), tr(302, 'Sender', 'Opener', 'song')];
const known = new Map<number, T>([...pool, ...own].map((t) => [t.id, t]));
const lists = new Map<number, { id: number; title: string; description: string; color: string; shuffled: boolean; tracks: number[] }>();
let schedule = { base_playlist_id: 1, entries: [{ playlist_id: 2, slot: 4 * 24 + 20, duration: 1 }] };
let stats: { id: number; listeners: number; started_at: string }[] = [];
let nextPl = 20;
let nextOwn = 900;
let tts: string[] = [];
let uploads = 0;

const mock = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (d: Buffer) => chunks.push(d));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const send = (code: number, body?: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/v1/chat/completions') {
      const msg = String(JSON.parse(raw.toString()).messages.at(-1).content);
      return send(200, { choices: [{ message: { content: /Werbung/.test(msg) ? 'SKIP' : 'Liebe Grüße von Anna an ihre Oma – schön, dass ihr zuhört!' } }] });
    }
    if (u.pathname === '/v1/audio/speech') {
      tts.push(String(JSON.parse(raw.toString()).input ?? ''));
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(4096)]));
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, {});
    const p = u.pathname;
    const body = raw.length && /json/.test(String(req.headers['content-type'])) ? JSON.parse(raw.toString()) : {};
    let m: RegExpExecArray | null;
    const out = (l: NonNullable<ReturnType<typeof lists.get>>) => ({ id: l.id, title: l.title, description: l.description, color: l.color, shuffled: l.shuffled });
    if (p === `/stations/${ST}/playlists` && req.method === 'GET') return send(200, [...lists.values()].map(out));
    if (p === `/stations/${ST}/playlists` && req.method === 'POST') { const id = nextPl++; lists.set(id, { id, title: body.title, description: body.description ?? '', color: body.color, shuffled: !!body.shuffled, tracks: [] }); return send(201, { id }); }
    if ((m = /^\/stations\/7\/playlists\/(\d+)\/tracks$/.exec(p))) return send(200, { tracks: (lists.get(Number(m[1]))?.tracks ?? []).map((id) => known.get(id)), _paging: { next_page: null } });
    if ((m = /^\/stations\/7\/playlists\/(\d+)\/entries\/(\d+)$/.exec(p))) { const l = lists.get(Number(m[1]))!; l.tracks = l.tracks.filter((x) => x !== Number(m![2])); return send(200, {}); }
    if ((m = /^\/stations\/7\/playlists\/(\d+)$/.exec(p))) {
      const l = lists.get(Number(m[1]));
      if (!l) return send(404, {});
      if (req.method === 'PATCH') { Object.assign(l, { shuffled: !!body.shuffled }); return send(200, out(l)); }
      if (req.method === 'POST') { if (l.tracks.includes(body.track_id)) return send(422, { error: 'already in playlist' }); l.tracks.push(body.track_id); return send(200, {}); }
    }
    if (p === `/stations/${ST}/schedule` && req.method === 'GET') return send(200, [schedule]);
    if (p === `/stations/${ST}/schedule` && req.method === 'PATCH') { schedule = body; return send(200, [schedule]); }
    if (p === `/stations/${ST}/tracks/stats/24h`) return send(200, stats);
    if (p === `/stations/${ST}/tracks` && req.method === 'POST') {
      uploads++;
      setTimeout(() => { const t = tr(nextOwn++, '', 'upload.mp3'); own.unshift(t); known.set(t.id, t); }, 20);
      return send(201, { id: -1 });
    }
    if ((m = /^\/stations\/7\/tracks\/(\d+)$/.exec(p))) {
      if (req.method === 'PATCH') { const t = known.get(Number(m[1])); Object.assign(t ?? {}, body); return send(200, t); }
      if (req.method === 'DELETE') { own = own.filter((x) => x.id !== Number(m![1])); return send(204); }
    }
    if (p === `/stations/${ST}/tracks`) {
      if (u.searchParams.get('own') === 'true') return send(200, { tracks: [...own].sort((a, b) => b.id - a.id), _paging: { next_page: null } });
      const q = (k: string) => (u.searchParams.get(k) ?? '').toLowerCase();
      const hits = [...pool, ...own].filter((t) => (!q('title') || t.title.toLowerCase().includes(q('title'))) && (!q('artist') || String(typeof t.artist === 'string' ? t.artist : t.artist.name).toLowerCase().includes(q('artist'))) && (!q('genre') || (t.genre ?? '').toLowerCase() === q('genre')));
      return send(200, { tracks: hits, _paging: { next_page: null } });
    }
    send(404, { path: p });
  });
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
const mockUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
process.env.ANMACHA_CAST_RADIOADMIN_URL = mockUrl;
process.env.ANMACHA_CAST_LAUTFM_API_URL = mockUrl;
const { AnMaChaCastApp } = await import('../src/server/app.ts');

const wait = async (cond: () => boolean, ms = 10_000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); };

test('Hörer-Funktionen bei laut.fm: Wunschstunde, jederzeit wünschen, Gruß, Sprachnachricht, Jingle-Rotation', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-hoerer-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };
  try {
    lists.set(1, { id: 1, title: 'Rotation', description: '', color: '#ff0000', shuffled: true, tracks: [600, 601, 602, 603, 604, 605, 606, 607] });
    lists.set(2, { id: 2, title: 'Freitagabend', description: '', color: '#00ff00', shuffled: false, tracks: [610] });
    app.secrets.set('lautfm:main', TOKEN);
    app.rt('main').data.lautfm = { stationId: ST, stationName: 'mein-radio', origin: 'http://studio.local' };
    const H = app.svc.hoerer;
    const L = app.svc.listeners;
    app.svc.pflege.gapMs = 0;
    app.svc.spots.pollMs = 20;
    // Freitag 19:30 – Wunschstunde Fr 20–21 Uhr
    let clock = new Date(2026, 10, 13, 19, 30);
    H.now = () => clock;
    app.svc.spots.now = () => clock;

    // --- Wunschstunde einrichten: Konflikt mit „Freitagabend“, dann ersetzen ---
    await assert.rejects(H.saveWish(admin, 'main', { enabled: true, days: [5], from: 20, hours: 1, jingleEvery: 2 }), /schon eine andere Playlist: Fr 20 Uhr/);
    const v = (await H.saveWish(admin, 'main', { enabled: true, days: [5], from: 20, hours: 1, jingleEvery: 2, fillGenre: 'Pop', replace: true })) as { wish: { playlistId: number } };
    const wp = v.wish.playlistId;
    assert.equal(lists.get(wp)!.title, 'Wunschstunde');
    assert.deepEqual(schedule.entries, [{ playlist_id: wp, slot: 116, duration: 1 }], 'Wunschstunde statt „Freitagabend“ im Sendeplan');
    assert.equal(L.config('main').requests, true, 'Wünsche im Hörerbereich freigeschaltet');
    assert.equal((L.publicInfo('main') as { lautfm: boolean }).lautfm, true);

    // --- Hörer suchen im Pool, wünschen, stimmen ab ---
    const hits = await L.search('main', 'queen', '1.1.1.1');
    assert.deepEqual(hits.map((x) => x.id), ['lf:501', 'lf:502', 'lf:504'], 'Titel- und Interpretensuche, ohne Jingles');
    await assert.rejects(L.requestLautfm('main', '1.1.1.1', { mediaId: 'lf:999' }), /über die Suche/);
    const r1 = await L.requestLautfm('main', '1.1.1.1', { mediaId: 'lf:502', name: 'Anna Maier' });
    assert.equal(r1.mode, 'open');
    assert.match(r1.message, /nächsten Wunschstunde/);
    await assert.rejects(L.requestLautfm('main', '2.2.2.2', { mediaId: 'lf:502' }), /schon gewünscht/);
    await L.search('main', 'nena', '2.2.2.2');
    await L.requestLautfm('main', '2.2.2.2', { mediaId: 'lf:503', name: 'Ben' });
    await L.requestLautfm('main', '3.3.3.3', { mediaId: 'lf:501' });
    await assert.rejects(L.requestLautfm('main', '3.3.3.3', { mediaId: 'lf:504' }), /schon 2 Titel/, 'höchstens 2 offene je Interpret');
    const list0 = H.publicWishes('main') as { wishes: { id: string; title: string; votes: number }[] };
    const w503 = list0.wishes.find((x) => x.title === '99 Luftballons')!;
    assert.equal(H.voteWish('main', L.who('1.1.1.1'), w503.id).votes, 2);
    assert.throws(() => H.voteWish('main', L.who('1.1.1.1'), w503.id), /schon abgestimmt/);
    assert.throws(() => H.voteWish('main', L.who('2.2.2.2'), w503.id), /schon abgestimmt/, 'eigener Wunsch');
    const inbox = L.inbox('main');
    assert.equal(inbox.items.filter((x) => x.kind === 'request' && x.wishId).length, 3, 'Wünsche stehen im Posteingang');

    // --- 19:30: Takt baut die Wunschstunde auf (meiste Stimmen zuerst, Füllmusik, Jingles alle 2 Songs) ---
    H.setJingles(admin, 'main', { ids: [300, 301], playlists: [1], every: 2 });
    await H.tick('main');
    const built = lists.get(wp)!.tracks;
    assert.equal(built[0], 503, 'meiste Stimmen zuerst');
    assert.deepEqual(built.filter((x) => x === 502 || x === 501), [502, 501], 'dann nach Eingang');
    assert.ok(built.includes(300) && built.includes(301), 'Jingles eingestreut');
    assert.equal(built.filter((x) => x !== 300 && x !== 301).length, 14, 'eine Stunde = 14 Titel');
    assert.equal(lists.get(wp)!.shuffled, false);
    assert.match(H.wishCfg('main').lastStatus ?? '', /3 Wünsche, 11 Füllsongs, 2 Jingles/);
    const before = [...built];
    await H.tick('main');
    assert.deepEqual(lists.get(wp)!.tracks, before, 'je Wunschstunde nur einmal aufgebaut');
    // Wunsch nach dem Aufbau: direkt in die Wunschstunde
    await L.search('main', 'ga ga', '4.4.4.4');
    await L.requestLautfm('main', '4.4.4.4', { mediaId: 'lf:504' }).then(
      () => assert.fail('Interpreten-Limit gilt weiter'),
      (e: Error) => assert.match(e.message, /schon 2 Titel/));
    const free = Array.from({ length: 20 }, (_, i) => 600 + i).find((id) => !before.includes(id))!;
    await L.search('main', `popsong ${free - 600}`, '4.4.4.4');
    assert.equal((await L.requestLautfm('main', '4.4.4.4', { mediaId: `lf:${free}` })).mode, 'slot');
    assert.equal(lists.get(wp)!.tracks.at(-1), free, 'an die aufgebaute Wunschstunde angehängt');

    // --- 21:30: Stunde vorbei → Wünsche gelten als gelaufen ---
    clock = new Date(2026, 10, 13, 21, 30);
    stats = [{ id: 503, listeners: 9, started_at: new Date(2026, 10, 13, 20, 1).toISOString() }];
    await H.sync('main');
    assert.ok(H.view('main') && (H.view('main') as { wishes: { status: string }[] }).wishes.filter((x) => x.status === 'queued').length === 0);

    // --- jederzeit wünschen: läuft gleich in der laufenden Playlist (Basis „Rotation“), nach dem Abspielen wieder raus ---
    await H.saveWish(admin, 'main', { enabled: false, anytime: true });
    assert.deepEqual(schedule.entries, [], 'Wunschstunde aus dem Sendeplan entfernt');
    await L.search('main', 'radio', '5.5.5.5');
    const r2 = await L.requestLautfm('main', '5.5.5.5', { mediaId: 'lf:504' });
    assert.equal(r2.mode, 'now');
    assert.ok(lists.get(1)!.tracks.includes(504));
    stats = [{ id: 504, listeners: 4, started_at: new Date(2026, 10, 13, 21, 34).toISOString() }];
    await H.sync('main');
    assert.ok(!lists.get(1)!.tracks.includes(504), 'nach dem Abspielen entfernt');

    // --- Gruß und Sprachnachricht auf Sendung ---
    app.ai.update({ providers: [
      { id: 'ki', name: 'KI', role: 'text', kind: 'openai_compat', baseUrl: `${mockUrl}/v1`, local: true },
      { id: 'tts', name: 'TTS', role: 'voice', kind: 'openai_compat', baseUrl: `${mockUrl}/v1`, local: true },
    ] });
    app.svc.ai.setAiConfig(admin, 'main', { text: { providerId: 'ki', model: 'm' }, voice: { providerId: 'tts', voice: 'v', model: 'tts' } });
    L.setConfig(admin, 'main', { messages: true, voice: true });
    L.message('main', '6.6.6.6', { name: 'Anna Schulz', text: 'Grüße an meine Oma! Ruft an: 0171 2345678' });
    const msg = L.inbox('main').items.find((x) => x.kind === 'message')!;
    const g = await H.air(admin, 'main', msg.id);
    assert.ok('spotId' in g);
    const spot = app.rt('main').data.programmchef!.spotList!.find((s) => s.id === (g as { spotId: string }).spotId)!;
    await wait(() => ['queued', 'failed'].includes(spot.status));
    assert.equal(spot.status, 'queued', spot.error ?? '');
    assert.equal(spot.kind, 'gruss');
    assert.match(tts.at(-1)!, /Liebe Grüße von Anna/);
    assert.ok(lists.get(1)!.tracks.includes(spot.trackId!), 'an die laufende Playlist gehängt');
    assert.equal(L.inbox('main').items.find((x) => x.id === msg.id)!.status, 'done');
    L.message('main', '7.7.7.7', { name: 'Spam', text: 'Werbung für mein Casino' });
    const spam = L.inbox('main').items.find((x) => x.kind === 'message' && x.status === 'new')!;
    assert.match(String((await H.air(admin, 'main', spam.id) as { skipped?: string }).skipped), /unpassend/);
    // Sprachnachricht (MP3 geht ohne Umwandlung)
    L.voice('main', '8.8.8.8', 'audio/mpeg', Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(3000)]), { name: 'Carla' });
    const vmItem = L.inbox('main').items.find((x) => x.kind === 'voice')!;
    const ttsBefore = tts.length;
    const vm = await H.air(admin, 'main', vmItem.id) as { spotId: string; title: string };
    assert.equal(vm.title, 'Hörer-Sprachnachricht Carla');
    const vspot = app.rt('main').data.programmchef!.spotList!.find((s) => s.id === vm.spotId)!;
    await wait(() => ['queued', 'failed'].includes(vspot.status));
    assert.equal(vspot.status, 'queued', vspot.error ?? '');
    assert.equal(tts.length, ttsBefore, 'Original-Aufnahme, keine Stimme');
    // gelaufen → bei laut.fm wieder gelöscht (wie die Moderationen)
    stats = [spot.trackId!, vspot.trackId!].map((id) => ({ id, listeners: 3, started_at: new Date(2026, 10, 13, 21, 40).toISOString() }));
    assert.equal(await app.svc.spots.cleanup('main'), 2);
    assert.ok(!lists.get(1)!.tracks.includes(spot.trackId!) && !own.some((t) => t.id === vspot.trackId), 'aus Playlist entfernt und gelöscht');
    // automatisch: neuer Gruß geht im Takt raus (höchstens zwei Hörer-Beiträge gleichzeitig offen)
    await H.setAir(admin, 'main', { greet: 'auto' });
    L.message('main', '9.9.9.9', { name: 'Dora', text: 'Hallo an alle Frühaufsteher' });
    const ups = uploads;
    await H.tick('main');
    await wait(() => uploads > ups);
    assert.equal(uploads, ups + 1, 'automatisch gesendet');
    const auto = app.rt('main').data.programmchef!.spotList![0]!;
    await wait(() => ['queued', 'failed'].includes(auto.status));
    assert.equal(auto.status, 'queued', auto.error ?? '');

    // --- Live-Sendung erkennen: Gruß/Sprachnachricht dann nicht in die laut.fm-Playlist ---
    await H.setAir(admin, 'main', { greet: 'manual' });
    assert.equal((await H.liveState('main', true)).mode, 'automation');
    // a) Live mit anderer Software: Playlist „Rotation“ als Live-Playlist markiert (läuft als Basis)
    H.setLivePlaylists(admin, 'main', [1]);
    const ext = await H.liveState('main', true);
    assert.equal(ext.mode, 'external');
    assert.match(ext.reason, /Live-Playlist „Rotation“/);
    L.message('main', '10.0.0.1', { name: 'Erik', text: 'Gruß an die Live-Crew' });
    const lm = L.inbox('main').items.find((x) => x.kind === 'message' && x.status === 'new')!;
    const up0 = uploads;
    const ql0 = app.rt('main').queue.list().length;
    const ra = (await H.air(admin, 'main', lm.id)) as { mode: string; mediaId: string; text: string; note: string };
    assert.equal(ra.mode, 'external');
    assert.match(ra.text, /Liebe Grüße/, 'Text zum Vorlesen');
    assert.match(ra.note, /Mediathek/);
    assert.equal(app.svc.media.media('main', ra.mediaId).folder, 'Hörer');
    assert.equal(uploads, up0, 'nichts zu laut.fm hochgeladen');
    assert.equal(app.rt('main').queue.list().length, ql0, 'nicht in die eigene Warteschlange (sendet ja andere Software)');
    // Wünsche gehen während der Live-Sendung nur ans Studio
    await L.search('main', 'popsong 18', '10.0.0.2');
    const lw = await L.requestLautfm('main', '10.0.0.2', { mediaId: 'lf:618' });
    assert.equal(lw.mode, 'open');
    assert.match(lw.message, /Live-Sendung/);
    assert.equal((L.publicInfo('main') as { live: boolean }).live, true);
    // automatische Grüße warten während einer fremden Live-Sendung
    await H.setAir(admin, 'main', { greet: 'auto' });
    L.message('main', '10.0.0.3', { name: 'Fred', text: 'Hallo Studio' });
    const up1 = uploads;
    await H.tick('main');
    assert.equal(uploads, up1, 'wartet bis nach der Sendung');
    await H.setAir(admin, 'main', { greet: 'manual' });
    H.setLivePlaylists(admin, 'main', []);
    // b) Live über AnMaCha Cast (verbundener laut.fm-Ausgang): als Nächstes in die eigene Warteschlange
    const fake = { cfg: { id: 'o1', stationId: 'main', name: 'laut.fm mein-radio', host: 'live.laut.fm', enabled: true }, state: { status: 'connected' } };
    app.outputs.set('o1', fake as never);
    assert.equal((await H.liveState('main', true)).mode, 'cast');
    L.voice('main', '10.0.0.4', 'audio/mpeg', Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(3000)]), { name: 'Gina' });
    const lv = L.inbox('main').items.find((x) => x.kind === 'voice' && x.status === 'new')!;
    const rc = (await H.air(admin, 'main', lv.id)) as { mode: string; mediaId: string };
    assert.equal(rc.mode, 'cast');
    assert.equal(app.rt('main').queue.list()[0]!.mediaId, rc.mediaId, 'läuft als Nächstes');
    app.outputs.delete('o1');
    assert.equal((await H.liveState('main', true)).mode, 'automation');

    // --- Jingle-Rotation: Jingles 300/301 alle 2 Songs in „Rotation“, Auswahl rückt weiter ---
    const cands = await H.jingleCandidates('main');
    assert.deepEqual(cands.map((x) => x.id).sort(), [300, 301], 'nur gekennzeichnete Jingles, keine Hörer-Beiträge');
    H.setJingles(admin, 'main', { ids: [300, 301], playlists: [1], every: 2, mode: 'rotate' });
    lists.get(1)!.tracks = [600, 601, 602, 603];
    const a = await H.applyJingles(admin, 'main');
    assert.match(a.summary, /„Rotation“ 2/);
    assert.deepEqual(lists.get(1)!.tracks, [600, 300, 601, 602, 301, 603]);
    // erneut: alte Rotations-Jingles raus, neue Auswahl rein, keine Doppelten
    lists.get(1)!.tracks = [600, 601, 300, 602, 603, 604, 605];
    H.setJingles(admin, 'main', { every: 3 });
    await H.applyJingles(admin, 'main');
    const t2 = lists.get(1)!.tracks;
    assert.equal(t2.filter((x) => x === 300 || x === 301).length, 2);
    assert.equal(new Set(t2).size, t2.length);
    // Rückgängig über die Playlist-Pflege
    await app.svc.pflege.undo(admin, 'main');
    assert.deepEqual(lists.get(1)!.tracks, [600, 601, 300, 602, 603, 604, 605]);
  } finally {
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.after(() => new Promise<void>((r) => mock.close(() => r())));

// KI-Programmchef Teil 3: Playlist-Pflege für laut.fm gegen einen Radioadmin- und KI-Nachbau – Smart-Mischen (Jingles
// bleiben stehen, Interpreten auseinander), laut.fm-Mischen, Songliste → Playlist (beide Reihenfolgen + KI-Korrektur),
// Aufräumen (Doppelte, Interpreten-Limit, Flops), Sicherung/Wiederherstellung samt Sendeplan und „Rückgängig“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupFindings, minGap, parseSongList, shuffleOrder, type PlTrack } from '../src/server/programmchef/pflege.ts';

const tr = (id: number, artist: string, title = `Song ${id}`, type = 'song'): PlTrack => ({ id, artist: { name: artist }, title, type });

test('Smart-Mischen: Jingles bleiben stehen, gleiche Interpreten rücken auseinander, gleicher Startwert = gleiche Reihenfolge', () => {
  // A A A B B B C C C D D D, Jingle an Position 4
  const list: PlTrack[] = [];
  let id = 1;
  for (const a of ['A', 'B', 'C', 'D']) for (let i = 0; i < 3; i++) list.push(tr(id++, a));
  list.splice(4, 0, tr(99, 'Sender', 'Jingle', 'jingle'));
  const o = shuffleOrder(list, 42);
  assert.equal(o.order.length, list.length);
  assert.deepEqual([...o.order].sort((a, b) => a - b), list.map((t) => Number(t.id)).sort((a, b) => a - b), 'kein Titel verloren');
  assert.equal(o.order[4], 99, 'Jingle an seiner Stelle');
  assert.equal(o.gapBefore, 1);
  assert.ok((o.gapAfter ?? 0) >= 3, `Abstand ${o.gapAfter}`);
  assert.deepEqual(shuffleOrder(list, 42).order, o.order);
  const byId = new Map(list.map((t) => [Number(t.id), t]));
  assert.equal(minGap(o.order, byId, new Set([99])), o.gapAfter);
  // zusätzlich fest: eine wartende Moderation
  assert.equal(shuffleOrder(list, 7, [5]).order[5], 5);
});

test('Songliste: Trenner, Nummern, Vorspann als Name, „von“/„by“ und Kommas in Titeln', () => {
  const r = parseSongList('Folge 44: Paint It, Black - The Rolling Stones\n2. bohemian rhapsody - queen\n• Stand by Me - Ben E. King\nAtemlos von Helene Fischer; „99 Luftballons“ – Nena\nbullen, schweine - sdp\nqueen - bohemian rhapsody');
  assert.equal(r.name, 'Folge 44');
  assert.deepEqual(r.items.map((x) => [x.a, x.b]), [
    ['Paint It, Black', 'The Rolling Stones'],
    ['bohemian rhapsody', 'queen'],
    ['Stand by Me', 'Ben E. King'],
    ['Atemlos', 'Helene Fischer'],
    ['99 Luftballons', 'Nena'],
    ['bullen, schweine', 'sdp'],
    ['queen', 'bohemian rhapsody'],
  ]);
  assert.equal(parseSongList('Queen: Bohemian Rhapsody').name, '', 'kein Vorspann ohne weiteren Song');
});

test('Aufräumen: Doppelte, Interpreten über dem Limit und Flops – Jingles nie', () => {
  const tracks = [tr(1, 'A', 'Hit'), tr(2, 'A', 'Hit (Remastered 2011)'), tr(3, 'A'), tr(4, 'A'), tr(5, 'B'), tr(5, 'B'), tr(6, 'C'), tr(7, 'J', 'Jingle', 'jingle'), tr(8, 'D')];
  const stats = [{ id: 6, listeners: 10 }, { id: 6, listeners: 10 }, { id: 8, listeners: 1 }, { id: 8, listeners: 1 }, { id: 7, listeners: 0 }, { id: 7, listeners: 0 }];
  const r = cleanupFindings(tracks, stats, 2);
  assert.deepEqual(r.duplicates.map((x) => [x.id, x.kind]), [[2, 'dup_song'], [5, 'dup_id']]);
  assert.deepEqual(r.overload.map((x) => x.id), [4], 'A: Hit, Song 3 erlaubt, Song 4 zu viel');
  assert.deepEqual(r.flops.map((x) => x.id), [8]);
});

const TOKEN = 'abcd1234-efgh-5678-ijkl-9012mnop3456';
const ST = 7;
type T = { id: number; artist: { name: string }; title: string; type: string };
const pool: T[] = [
  { id: 501, artist: { name: 'Queen' }, title: 'Bohemian Rhapsody', type: 'song' },
  { id: 502, artist: { name: 'Nena' }, title: '99 Luftballons', type: 'song' },
  { id: 503, artist: { name: 'Die Ärzte' }, title: 'Männer sind Schweine', type: 'song' },
];
// alle Titel des Senders (laut.fm kennt sie auch, wenn sie gerade in keiner Playlist stehen)
const known = new Map<number, T>(pool.map((t) => [t.id, t]));
const lists = new Map<number, { id: number; title: string; description: string; color: string; shuffled: boolean; tracks: T[] }>();
let schedule = { base_playlist_id: 1, entries: [{ playlist_id: 2, slot: 18, duration: 4 }] };
let nextPl = 10;
let patches = 0;
const playlistOut = (p: NonNullable<ReturnType<typeof lists.get>>) => ({ id: p.id, title: p.title, description: p.description, color: p.color, shuffled: p.shuffled });

const mock = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (d: Buffer) => chunks.push(d));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    const send = (code: number, body?: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/v1/chat/completions') {
      // KI korrigiert „mner sint schwain – di aerzte“
      const lines = String(JSON.parse(raw).messages.at(-1).content).split('\n');
      const i = lines.findIndex((l) => /mner/.test(l));
      return send(200, { choices: [{ message: { content: JSON.stringify(i >= 0 ? [{ i: Number(lines[i]!.split(':')[0]), artist: 'Die Ärzte', title: 'Männer sind Schweine' }] : []) } }] });
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, {});
    const p = u.pathname;
    const body = raw ? JSON.parse(raw) : {};
    let m: RegExpExecArray | null;
    if (p === `/stations/${ST}/playlists` && req.method === 'GET') return send(200, [...lists.values()].map(playlistOut));
    if (p === `/stations/${ST}/playlists` && req.method === 'POST') { const id = nextPl++; lists.set(id, { id, title: body.title, description: body.description ?? '', color: body.color ?? '#888888', shuffled: !!body.shuffled, tracks: [] }); return send(201, { id }); }
    if ((m = /^\/stations\/7\/playlists\/(\d+)\/tracks$/.exec(p))) { const l = lists.get(Number(m[1])); return l ? send(200, { tracks: l.tracks, _paging: { total_pages: 1, current_page: 1, next_page: null } }) : send(404, {}); }
    if ((m = /^\/stations\/7\/playlists\/(\d+)\/entries\/(\d+)$/.exec(p)) && req.method === 'DELETE') { const l = lists.get(Number(m[1]))!; l.tracks = l.tracks.filter((t) => t.id !== Number(m![2])); return send(200, {}); }
    if ((m = /^\/stations\/7\/playlists\/(\d+)$/.exec(p))) {
      const l = lists.get(Number(m[1]));
      if (!l) return send(404, {});
      if (req.method === 'PATCH') { patches++; Object.assign(l, { title: body.title, shuffled: !!body.shuffled }); return send(200, playlistOut(l)); }
      if (req.method === 'DELETE') { lists.delete(l.id); return send(204); }
      if (req.method === 'POST') {
        const t = known.get(body.track_id) ?? { id: body.track_id, artist: { name: '?' }, title: '?', type: 'song' };
        l.tracks.push(t);
        return send(200, {});
      }
    }
    if (p === `/stations/${ST}/schedule` && req.method === 'GET') return send(200, [schedule]);
    if (p === `/stations/${ST}/schedule` && req.method === 'PATCH') { schedule = body; return send(200, schedule); }
    if (p === `/stations/${ST}/tracks`) {
      const a = (u.searchParams.get('artist') ?? '').toLowerCase();
      const t = (u.searchParams.get('title') ?? '').toLowerCase();
      const hits = u.searchParams.get('own') === 'true' ? [] : pool.filter((x) => (!a || x.artist.name.toLowerCase().includes(a)) && (!t || x.title.toLowerCase().includes(t)));
      return send(200, { tracks: hits, _paging: { next_page: null } });
    }
    if (p.startsWith(`/stations/${ST}/tracks/stats/`)) return send(200, p.endsWith('/24h') ? [{ id: 304, listeners: 1, started_at: 'a' }, { id: 304, listeners: 1, started_at: 'b' }, { id: 301, listeners: 9, started_at: 'c' }, { id: 302, listeners: 9, started_at: 'd' }] : []);
    send(404, { path: p });
  });
});
await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
const mockUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
process.env.ANMACHA_CAST_RADIOADMIN_URL = mockUrl;
process.env.ANMACHA_CAST_LAUTFM_API_URL = mockUrl;
const { AnMaChaCastApp } = await import('../src/server/app.ts');

const wait = async (cond: () => boolean, ms = 10_000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); };

test('Playlist-Pflege bei laut.fm: Mischen, Songliste, Aufräumen, Sicherung und Rückgängig', { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-pflege-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };
  try {
    // Basis „Hits“: drei Interpreten je dreimal hintereinander + Jingle vorn; „Abend“ zweite Playlist
    const hits: T[] = [{ id: 300, artist: { name: 'Sender' }, title: 'Jingle', type: 'jingle' }];
    let id = 301;
    for (const a of ['X', 'Y', 'Z']) for (let i = 0; i < 3; i++) hits.push({ id: id++, artist: { name: a }, title: `${a} ${i}`, type: 'song' });
    hits.push({ ...hits[1]! }); // 301 doppelt eingetragen
    for (const t of hits) known.set(t.id, t);
    lists.set(1, { id: 1, title: 'Hits', description: '', color: '#ff0000', shuffled: true, tracks: hits });
    lists.set(2, { id: 2, title: 'Abend', description: '', color: '#00ff00', shuffled: false, tracks: [pool[1]!] });
    app.secrets.set('lautfm:main', TOKEN);
    app.rt('main').data.lautfm = { stationId: ST, stationName: 'mein-radio', origin: 'http://studio.local' };
    const pf = app.svc.pflege;
    pf.gapMs = 0;

    const v = (await pf.view('main')) as { playlists: { id: number; title: string }[]; undo: unknown };
    assert.deepEqual(v.playlists.map((x) => x.title), ['Hits', 'Abend']);

    // --- Smart-Mischen mit Vorschau-Startwert ---
    const pv = (await pf.shufflePreview('main', 1)) as { seed: number; gapBefore: number; gapAfter: number; preview: { id: number; fixed: boolean }[] };
    assert.equal(pv.preview[0]!.id, 300);
    assert.ok(pv.preview[0]!.fixed);
    const before = lists.get(1)!.tracks.map((t) => t.id);
    const r = await pf.shuffleRun(admin, 'main', 1, 'smart', pv.seed);
    assert.ok(r.ok, r.message);
    const after = lists.get(1)!.tracks.map((t) => t.id);
    assert.equal(after[0], 300, 'Jingle bleibt vorn');
    assert.equal(lists.get(1)!.shuffled, false, 'laut.fm-Mischen ausgeschaltet, damit die Reihenfolge gilt');
    assert.notDeepEqual(after, before);
    assert.deepEqual(pv.preview.map((x) => x.id), after.slice(0, pv.preview.length), 'Vorschau = Ergebnis');
    // Rückgängig stellt Reihenfolge wieder her
    await pf.undo(admin, 'main');
    assert.deepEqual(lists.get(1)!.tracks.map((t) => t.id), before);
    await assert.rejects(pf.undo(admin, 'main'), /Keine Pflege-Änderung/);

    // --- laut.fm-Mischen + automatisches Mischen ---
    const p0 = patches;
    assert.match((await pf.shuffleRun(admin, 'main', 2, 'laut')).message, /eingeschaltet/);
    assert.equal(lists.get(2)!.shuffled, true);
    assert.equal(patches, p0 + 1);
    await pf.setShuffle(admin, 'main', 1, { mode: 'smart', cadence: 'h6' });
    await pf.tick('main');
    assert.notDeepEqual(lists.get(1)!.tracks.map((t) => t.id), before, 'Takt hat gemischt');
    const cfg = (await pf.view('main')) as { playlists: { id: number; shuffle: { mode: string; lastStatus?: string } }[] };
    assert.match(cfg.playlists.find((x) => x.id === 1)!.shuffle.lastStatus ?? '', /neu gemischt/);
    const mixed = lists.get(1)!.tracks.map((t) => t.id);
    await pf.tick('main');
    assert.deepEqual(lists.get(1)!.tracks.map((t) => t.id), mixed, 'erst nach 6 Stunden wieder');

    // --- Songliste → neue Playlist (Titel-Interpret, Interpret-Titel, KI-Korrektur, nicht gefunden) ---
    assert.throws(() => pf.songlistStart('main', '   '), /kein Song/);
    let job = pf.songlistStart('main', 'Meine Liste: bohemian rhapsody - queen\nNena - 99 Luftballons\nmner sint schwain - di aerzte\ngibtsnicht - niemand', true);
    await wait(() => job.state !== 'running');
    assert.equal(job.state, 'done', job.error ?? '');
    assert.equal(job.name, 'Meine Liste');
    assert.deepEqual(job.items.map((x) => [x.match?.id ?? null, x.how]), [[501, 'titel-interpret'], [502, 'interpret-titel'], [null, ''], [null, '']], 'ohne KI-Anbieter keine Korrektur');
    assert.equal(job.ai, 'none');
    app.ai.update({ providers: [{ id: 'ki', name: 'KI', role: 'text', kind: 'openai_compat', baseUrl: `${mockUrl}/v1`, local: true }] });
    app.svc.ai.setAiConfig(admin, 'main', { text: { providerId: 'ki', model: 'm' } });
    job = pf.songlistStart('main', 'Meine Liste: bohemian rhapsody - queen\nNena - 99 Luftballons\nmner sint schwain - di aerzte\ngibtsnicht - niemand', true);
    await wait(() => job.state !== 'running');
    assert.deepEqual(job.items.map((x) => x.match?.id ?? null), [501, 502, 503, null]);
    assert.equal(job.items[2]!.how, 'ki');
    const ids = job.items.flatMap((x) => (x.match ? [x.match.id] : []));
    const ap = await pf.songlistApply(admin, 'main', { name: job.name, ids });
    assert.ok(ap.created);
    assert.deepEqual(lists.get(ap.playlistId)!.tracks.map((t) => t.id), [501, 502, 503], 'in Listen-Reihenfolge');
    // an bestehende anhängen: schon vorhandene zählen als „schon drin“
    const ap2 = await pf.songlistApply(admin, 'main', { playlistId: 2, ids: [502, 501] });
    assert.equal(ap2.added, 1);
    assert.equal(ap2.already, 1);
    // Rückgängig entfernt das Angehängte wieder
    await pf.undo(admin, 'main');
    assert.deepEqual(lists.get(2)!.tracks.map((t) => t.id), [502]);

    // --- Aufräumen: 301 doppelt, Flop 304 (1 Hörer bei 2 Ausspielungen gegenüber Schnitt 5) ---
    const sc = await pf.cleanupScan('main', 1, 5, 1);
    assert.deepEqual(sc.duplicates.map((x) => x.id), [301]);
    assert.deepEqual(sc.flops.map((x) => x.id), [304]);
    const n1 = lists.get(1)!.tracks.length;
    const cl = await pf.cleanupApply(admin, 'main', 1, [301, 304, 300]);
    assert.equal(cl.removed, 2, 'Jingle wird nie entfernt');
    const now1 = lists.get(1)!.tracks.map((t) => t.id);
    assert.equal(now1.length, n1 - 2, 'doppelter bleibt einmal, Flop weg');
    assert.equal(now1.filter((x) => x === 301).length, 1);
    assert.ok(!now1.includes(304) && now1.includes(300));

    // --- Sicherung → Änderungen → exakt wiederherstellen samt Sendeplan ---
    const bk = await pf.backup(admin, 'main', 'vor dem Umbau');
    assert.match(bk.summary, /Playlist\(en\).*Sendeplan/);
    const saved1 = lists.get(1)!.tracks.map((t) => t.id);
    lists.get(1)!.tracks = lists.get(1)!.tracks.slice(0, 3);
    lists.delete(2);
    schedule = { base_playlist_id: 1, entries: [] };
    const rs = await pf.restore(admin, 'main', bk.id, { exact: true, schedule: true });
    assert.match(rs.summary, /1 neu angelegt/);
    assert.deepEqual(lists.get(1)!.tracks.map((t) => t.id), saved1, 'Titel und Reihenfolge wie gesichert');
    const abend = [...lists.values()].find((x) => x.title === 'Abend')!;
    assert.deepEqual(abend.tracks.map((t) => t.id), [502]);
    assert.deepEqual(schedule.entries, [{ playlist_id: abend.id, slot: 18, duration: 4 }], 'Sendeplan auf die neue Playlist-ID umgeschrieben');
    assert.equal(schedule.base_playlist_id, 1);
    // Datei herunterladen und wieder einspielen
    const file = JSON.parse(JSON.stringify(pf.backupData('main', bk.id)));
    const imp = pf.importBackup(admin, 'main', file);
    assert.match(imp.summary, /gesichert/);
    assert.throws(() => pf.importBackup(admin, 'main', { playlists: [] }), /keine AnMaCha-Cast-Sicherung/);
    // höchstens 5 Sicherungen
    for (let i = 0; i < 5; i++) await pf.backup(admin, 'main', `S${i}`);
    const bl = ((await pf.view('main')) as { backups: { id: string; label: string }[] }).backups;
    assert.deepEqual(bl.map((x) => x.label), ['S4', 'S3', 'S2', 'S1', 'S0'], 'älteste fallen heraus');
    pf.deleteBackup(admin, 'main', bl[0]!.id);
    assert.throws(() => pf.backupData('main', bl[0]!.id), /nicht gefunden/);
  } finally {
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.after(() => new Promise<void>((r) => mock.close(() => r())));

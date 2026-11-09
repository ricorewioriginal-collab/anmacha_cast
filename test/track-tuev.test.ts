/**
 * Track-TÜV: Tonart (Krumhansl/Camelot) aus Chroma und aus echten Dateien (ffmpeg), Online-Tag-/Cover-Suche
 * (iTunes + MusicBrainz gemockt, Cover gespeichert), Vorher/Nachher-Bericht als CSV.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { analyzeKey, chromaFromPcm, detectFfmpeg, keyFromChroma } from '../src/server/ffmpeg.ts';

const ff = detectFfmpeg(process.cwd());

test('keyFromChroma: C-Dur-Dreiklang → C Dur / 8B, A-Moll-Profil → A Moll / 8A, leer → null', () => {
  const c = new Array(12).fill(0.05);
  c[0] = 1; c[4] = 0.8; c[7] = 0.9; c[2] = 0.3; c[9] = 0.3; // C E G (+ D, A)
  const k = keyFromChroma(c)!;
  assert.equal(k.name, 'C Dur');
  assert.equal(k.camelot, '8B');
  assert.equal(k.relative, 'A Moll');
  assert.ok(k.confidence >= 20 && k.confidence <= 97);
  const am = new Array(12).fill(0.1);
  am[9] = 1; am[0] = 0.85; am[4] = 0.8; am[11] = 0.4; am[2] = 0.35; am[5] = 0.3; am[7] = 0.3; // A C E + Leiter
  assert.equal(keyFromChroma(am)!.name, 'A Moll');
  assert.equal(keyFromChroma(am)!.camelot, '8A');
  assert.equal(keyFromChroma(new Array(12).fill(0)), null);
});

test('chromaFromPcm: synthetischer A-Moll-Akkord (A, C, E) landet auf den richtigen Pitchklassen', () => {
  const rate = 11025;
  const n = rate * 3;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    pcm[i] = Math.round(8000 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 261.63 * t) + Math.sin(2 * Math.PI * 329.63 * t)));
  }
  const chroma = chromaFromPcm(pcm, rate);
  const top = [...chroma].map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]).sort();
  assert.deepEqual(top, [0, 4, 9], 'C, E, A sind die stärksten Pitchklassen');
  assert.equal(keyFromChroma(chroma)!.name, 'A Moll');
});

test('analyzeKey mit ffmpeg: Sinus-Akkord-Datei', { skip: !ff && 'ffmpeg fehlt', timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-key-'));
  try {
    const file = join(dir, 'chord.wav');
    execFileSync(ff!.ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=261.63:d=4', '-f', 'lavfi', '-i', 'sine=f=329.63:d=4', '-f', 'lavfi', '-i', 'sine=f=392:d=4', '-filter_complex', '[0][1][2]amix=inputs=3', file]);
    const k = await analyzeKey(ff!.ffmpeg, file);
    assert.ok(k, 'Tonart erkannt');
    assert.equal(k!.name, 'C Dur');
    assert.equal(await analyzeKey(ff!.ffmpeg, join(dir, 'fehlt.wav')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Online-Suche (gemockt), Übernahme nur leerer Felder, Cover gespeichert, CSV-Bericht', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-tuev-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const media = app.svc.media;
    media.addMedia('main', { id: 'a', title: 'Believer', artist: 'Imagine Dragons', category: 'music', file: 'a.mp3', durationMs: 204_000, addedAt: 0, lufs: -9.5, truePeakDb: 0.3, check: { at: 1, clipped: 2000, bitrateKbps: 96, silent: false } });
    media.addMedia('main', { id: 'b', title: 'Unbekannt', artist: '', category: 'music', file: 'b.mp3', durationMs: 100_000, addedAt: 0 });
    media.fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('itunes')) return Response.json({ results: [{ trackName: 'Believer', artistName: 'Imagine Dragons', collectionName: 'Evolve', releaseDate: '2017-02-01T00:00:00Z', primaryGenreName: 'Rock', artworkUrl100: 'https://img.example/100x100bb.jpg' }] });
      if (u.includes('musicbrainz')) return Response.json({ recordings: [{ title: 'Believer', 'artist-credit': [{ name: 'Imagine Dragons' }], releases: [{ id: 'rel-1', title: 'Evolve', date: '2017-06-23' }] }, { title: 'Believer (Live)', 'artist-credit': [{ name: 'Imagine Dragons' }], releases: [] }] });
      if (u.includes('600x600bb')) return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      return new Response('nope', { status: 404 });
    }) as typeof fetch;

    const cands = await media.lookupTags('main', 'a');
    assert.equal(cands.length, 2, 'iTunes-Treffer und MusicBrainz-Dublette zusammengefasst, Live-Version bleibt');
    assert.equal(cands[0]!.source, 'itunes');
    assert.equal(cands[0]!.coverUrl, 'https://img.example/600x600bb.jpg');
    assert.equal(cands[1]!.title, 'Believer (Live)');
    await assert.rejects(media.lookupTags('main', 'b', { artist: '', title: '' }), /Interpret oder Titel/);

    // Übernahme: Titel/Interpret bleiben (nicht leer), Album/Genre/Jahr werden ergänzt, Cover landet in data/covers
    const m = await media.applyLookup('main', 'a', { ...cands[0]!, title: 'Anders', cover: true });
    assert.equal(m.title, 'Believer', 'vorhandener Titel bleibt ohne overwrite');
    assert.equal(m.album, 'Evolve');
    assert.equal(m.genre, 'Rock');
    assert.equal(m.year, 2017);
    assert.ok(existsSync(join(dir, 'covers', 'main', 'a.jpg')), 'Cover gespeichert');
    const m2 = await media.applyLookup('main', 'a', { title: 'Believer (Remaster)', overwrite: true, cover: false });
    assert.equal(m2.title, 'Believer (Remaster)');

    // eigenes Cover (Mediathek → Cover ändern): nur echte JPEG-Daten, ohne ffmpeg kein PNG; Entfernen merkt sich „kein Cover“
    const cover = join(dir, 'covers', 'main', 'b.jpg');
    await assert.rejects(media.setCover('main', 'b', Buffer.from('kein bild'), 'image/jpeg'), /JPEG-, PNG- oder WebP/);
    await assert.rejects(media.setCover('main', 'b', Buffer.from([0x89, 0x50]), 'image/png'), /JPEG-, PNG- oder WebP/, 'PNG braucht ffmpeg');
    await assert.rejects(media.setCover('main', 'b', Buffer.from([0xff, 0xd8, 0xff]), 'text/html'), /JPEG-, PNG- oder WebP/);
    await media.setCover('main', 'b', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]), 'image/jpeg');
    assert.ok(existsSync(cover));
    media.removeCover('main', 'b');
    assert.ok(!existsSync(cover) && existsSync(`${cover}.none`));

    // Bericht: Gain zur Ziel-Lautheit (−16), True Peak nachher, Limiter-Hinweis, Hinweise aus dem Track-Check
    media.updateMedia('main', 'a', { key: 'A Moll', camelot: '8A' });
    const rows = media.tuevReport('main');
    const ra = rows.find((r) => r.id === 'a')!;
    assert.equal(ra.gainDb, -6.5);
    assert.equal(ra.lufsAfter, -16);
    assert.equal(ra.peakAfterDb, -6.2);
    assert.equal(ra.limited, false);
    assert.equal(ra.key, 'A Moll');
    assert.ok(ra.warnings.some((w) => /Clipping/.test(w)) && ra.warnings.some((w) => /Bitrate/.test(w)));
    const rb = rows.find((r) => r.id === 'b')!;
    assert.equal(rb.gainDb, null);
    const csv = media.tuevCsv('main');
    assert.match(csv, /^"Titel";"Interpret"/);
    assert.match(csv, /"Believer \(Remaster\)";"Imagine Dragons";"music";"204";"-9,5";"0,3";"-6,5";"-16";"-6,2";"";"A Moll";"8A";"96";"übersteuert \(Clipping\), niedrige Bitrate \(96 kbit\/s\)"/);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Soundkarten-Routing der Windows-App mit echtem ffmpeg: Abgriffe je Deck/Programm als PCM, Eingang (Mikrofone/
// Mischpult) aus der App als PCM-Strom, und der Mischpult-Betrieb „extern“ (gesendet wird nur noch der Eingang).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { detectFfmpeg } from '../src/server/ffmpeg.ts';
import { SAMPLE_RATE } from '../src/core/pcm.ts';

const ff = detectFfmpeg(process.cwd());
const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FORMAT = `s16le;rate=${SAMPLE_RATE};channels=2`;

function wav(file: string, seconds: number, freq: number): void {
  const rate = 22050;
  const n = Math.floor(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2);
  writeFileSync(file, b);
}

/** Pegel (RMS) und grobe Frequenz (Nulldurchgänge, linker Kanal) eines s16le-Stereo-Blocks. */
function analyze(pcm: Buffer): { rms: number; hz: number } {
  const frames = Math.floor(pcm.length / 4);
  let sum = 0, cross = 0, prev = 0;
  for (let i = 0; i < frames; i++) {
    const v = pcm.readInt16LE(i * 4);
    sum += v * v;
    if ((v >= 0) !== (prev >= 0)) cross++;
    prev = v;
  }
  return { rms: Math.sqrt(sum / Math.max(1, frames)), hz: (cross / 2) / (frames / SAMPLE_RATE) };
}

function sine(freq: number, frames: number, offset: number): Buffer {
  const b = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(12000 * Math.sin((2 * Math.PI * freq * (offset + i)) / SAMPLE_RATE));
    b.writeInt16LE(v, i * 4);
    b.writeInt16LE(v, i * 4 + 2);
  }
  return b;
}

test('Audio-Routing: Abgriffe je Deck, Eingang aus der App, externes Mischpult', { skip: !ff && 'ffmpeg nicht installiert', timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-routing-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: ff });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const token = app.svc.auth.createToken({ name: 't', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  const auth = { Authorization: `Bearer ${token}` };
  /** Abgriff für ms Millisekunden mitschneiden */
  const tap = (name: string, ms: number) => new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = request({ host: '127.0.0.1', port, path: `/api/v1/stations/main/audio/taps/${name}`, headers: auth }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`Abgriff ${name}: ${res.statusCode}`));
      assert.equal(res.headers['x-audio-format'], FORMAT);
      res.on('data', (d: Buffer) => chunks.push(d));
      setTimeout(() => { req.destroy(); resolve(Buffer.concat(chunks)); }, ms);
    });
    req.on('error', () => {});
    req.end();
  });
  try {
    wav(join(app.mediaDir, 'main', 'a.wav'), 30, 440);
    app.svc.media.addMedia('main', { id: 'a.wav', title: 'a', artist: 'A', category: 'music', file: 'a.wav', durationMs: null, addedAt: 0 });
    app.start();
    app.startPlayout(admin, 'main', { format: 'mp3', bitrateKbps: 64, crossfadeMs: 0 });
    await wait(1500);

    // Abgriffe: genau ein Haupt-Deck (A oder B) trägt die Musik, Deck C ist still, das Programm hat die Musik
    const [a, b, c, prog] = await Promise.all([tap('A', 1500), tap('B', 1500), tap('C', 1500), tap('program', 1500)]);
    for (const x of [a, b, c, prog]) assert.ok(x.length > SAMPLE_RATE * 4 * 0.8, `Abgriff liefert im Takt (${x.length} Bytes)`);
    const deck = analyze(a).rms > analyze(b).rms ? a : b;
    assert.ok(analyze(deck).rms > 1000, 'Deck mit Musik hat Pegel');
    assert.ok(Math.abs(analyze(deck).hz - 440) < 30, `Deck trägt 440 Hz (gemessen ${analyze(deck).hz.toFixed(0)})`);
    assert.ok(analyze(c).rms < 5, 'Deck C ist still');
    assert.ok(Math.abs(analyze(prog).hz - 440) < 30, 'Programm = Musik');

    // Unbekannter Abgriff und falsches Eingangsformat werden klar abgewiesen
    const bad = await fetch(`http://127.0.0.1:${port}/api/v1/stations/main/audio/taps/Z`, { headers: auth });
    assert.equal(bad.status, 404);
    const wrong = await fetch(`http://127.0.0.1:${port}/api/v1/stations/main/audio/input`, { method: 'PUT', headers: { ...auth, 'X-Audio-Format': 's16le;rate=8000;channels=1' }, body: Buffer.alloc(16) });
    assert.equal(wrong.status, 415);

    // Eingang aus der App (z. B. Mischpult-Summe, 1 kHz) in Echtzeit senden
    const input = request({ host: '127.0.0.1', port, method: 'PUT', path: '/api/v1/stations/main/audio/input', headers: { ...auth, 'X-Audio-Format': FORMAT, 'Content-Type': 'application/octet-stream' } });
    input.on('error', () => {});
    let sent = 0;
    const block = Math.floor(SAMPLE_RATE / 20); // 50 ms
    const pacer = setInterval(() => { input.write(sine(1000, block, sent)); sent += block; }, 50);
    await wait(600);
    assert.equal((app.playoutView('main') as { status: { input: string } }).status.input, 'running', 'App-Eingang angeschlossen');

    // Externes Mischpult: gesendet wird nur der Eingang – die Decks laufen weiter auf ihren eigenen Ausgängen
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/stations/main/playout`, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ mixer: 'external' }) });
    assert.equal(r.status, 200);
    await wait(500);
    const [prog2, a2, b2] = await Promise.all([tap('program', 1500), tap('A', 1500), tap('B', 1500)]);
    const p2 = analyze(prog2);
    assert.ok(p2.rms > 1000, 'Programm hat den Eingang');
    assert.ok(Math.abs(p2.hz - 1000) < 60, `Programm = Mischpult-Eingang 1 kHz (gemessen ${p2.hz.toFixed(0)})`);
    const deck2 = analyze(a2).rms > analyze(b2).rms ? a2 : b2;
    assert.ok(Math.abs(analyze(deck2).hz - 440) < 30, 'Deck-Ausgang trägt weiter die Musik');

    clearInterval(pacer);
    input.end();
    await wait(500);
    assert.equal((app.playoutView('main') as { status: { input: string } }).status.input, 'off', 'App-Eingang wieder getrennt');
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

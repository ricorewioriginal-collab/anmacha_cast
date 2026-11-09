/**
 * Motion-Carts: Endlos-Loop mit Weiterschalten (Foster Kent „Motion Mixes“). Ein Cart mit loopEndMs
 * wiederholt den Bereich Cue-In…Loop-Ende, bis advanceLoop() aufgerufen wird - dann folgt der Rest
 * (Drop/Outro) nahtlos. Von der Automation gestartete Titel loopen nie. Braucht ffmpeg (Decoder).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { detectFfmpeg } from '../src/server/ffmpeg.ts';
import type { PlayoutStatus } from '../src/server/playout.ts';
import { rawIcecast } from './helpers.ts';

const ff = detectFfmpeg(process.cwd());
const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Timeout');
    await wait(25);
  }
}
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

test('Motion-Cart loopt bis zum Weiterschalten, Automation loopt nie', { skip: !ff && 'ffmpeg nicht installiert', timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-loop-'));
  const ice = rawIcecast();
  await new Promise<void>((r) => ice.listen(0, '127.0.0.1', r));
  const port = (ice.address() as { port: number }).port;
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: ff });
  try {
    wav(join(app.mediaDir, 'main', 'bed.wav'), 3, 440);
    wav(join(app.mediaDir, 'main', 'song.wav'), 3, 550);
    wav(join(app.mediaDir, 'main', 'song2.wav'), 40, 660); // lang genug, damit er beim Prüfen noch läuft
    app.svc.media.addMedia('main', { id: 'bed', title: 'Bett', artist: '', category: 'bed', file: 'bed.wav', durationMs: 3000, addedAt: 0, loopEndMs: 1000 });
    app.svc.media.addMedia('main', { id: 'song', title: 'Song', artist: 'A', category: 'music', file: 'song.wav', durationMs: 3000, addedAt: 0, loopEndMs: 1000 });
    app.svc.media.addMedia('main', { id: 'song2', title: 'Song 2', artist: 'B', category: 'music', file: 'song2.wav', durationMs: 40000, addedAt: 0 });
    app.setAutomation('main', { autoFill: false });
    app.queueAdd('main', 'song');
    app.queueAdd('main', 'song2');
    app.saveOutput(admin, 'main', null, { name: 'ice', host: '127.0.0.1', port, mount: '/radio', password: 'pw-123456' });
    app.start();
    app.startPlayout(admin, 'main', { format: 'mp3', bitrateKbps: 64, crossfadeMs: 200 });
    const status = () => (app.playoutView('main') as { status: PlayoutStatus }).status;
    await until(() => status()?.running);

    // Cart mit Loop: nach > 1 s steht die Stimme in der Schleife und läuft weiter (3-s-Datei wäre sonst nach 3 s vorbei)
    const slot = app.rt('main').data.cardwall[0]!;
    app.updateCart('main', slot.id, { mediaId: 'bed' });
    app.triggerCart('main', slot.id);
    await until(() => status().loops?.some((l) => l.mediaId === 'bed' && l.inLoop) === true, 15_000);
    await wait(3500);
    const l = status().loops!.find((x) => x.mediaId === 'bed')!;
    assert.ok(l, 'Cart läuft nach 4,5 s noch (Loop)');
    assert.ok(l.loopCount >= 1, `mindestens einmal wiederholt (${l.loopCount})`);
    assert.equal(status().carts, 1);

    // Weiterschalten: Rest (2 s) läuft, danach ist der Cart fertig
    assert.equal(app.advanceLoop('main', 'bed').advanced, 1);
    assert.equal(status().loops?.length ?? 0, 0);
    await until(() => status().carts === 0, 10_000);
    assert.equal(app.advanceLoop('main').advanced, 0, 'nichts mehr zum Weiterschalten');

    // Automation: „song“ hat loopEndMs, wird aber von der Automation gestartet → kein Loop, es geht zu song2 weiter
    await until(() => (app.nowPlaying('main') as { mediaId: string } | null)?.mediaId === 'song2', 15_000);
    assert.equal(status().loops?.length ?? 0, 0);
    await app.stopPlayout(admin, 'main');
  } finally {
    app.shutdown();
    ice.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

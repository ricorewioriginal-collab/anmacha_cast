/**
 * Soundboard (Cardwall): Tags, Favorit und eindeutiges Tastenkürzel je Cart; „Alle stoppen“ blendet alle
 * laufenden Carts in der Engine aus (braucht ffmpeg).
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
async function until(fn: () => boolean, ms = 8000) { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('Timeout'); await wait(25); } }
function wav(file: string, seconds: number, freq: number): void {
  const rate = 22050, n = Math.floor(rate * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2);
  writeFileSync(file, b);
}

test('Cart: Tags normalisiert, Favorit, Tastenkürzel eindeutig je Sender', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-sb-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const [a, b] = app.rt('main').data.cardwall;
    app.updateCart('main', a!.id, { tags: [' Intro', 'LACHER', 'intro', ''], favorite: true, hotkey: 'q' });
    assert.deepEqual(a!.tags, ['intro', 'lacher']);
    assert.equal(a!.favorite, true);
    assert.equal(a!.hotkey, 'q');
    app.updateCart('main', b!.id, { hotkey: 'Q' });
    assert.equal(b!.hotkey, 'Q');
    assert.equal(a!.hotkey, undefined, 'Kürzel wandert zum zuletzt gesetzten Cart');
    app.updateCart('main', b!.id, { hotkey: '', favorite: false });
    assert.equal(b!.hotkey, undefined);
    assert.equal(b!.favorite, undefined);
    assert.equal(app.stopCarts('main').stopped, 0, 'ohne Engine nichts zu stoppen');
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('„Alle stoppen“ blendet laufende Carts aus', { skip: !ff && 'ffmpeg nicht installiert', timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-sb2-'));
  const ice = rawIcecast();
  await new Promise<void>((r) => ice.listen(0, '127.0.0.1', r));
  const port = (ice.address() as { port: number }).port;
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: ff });
  try {
    wav(join(app.mediaDir, 'main', 'j.wav'), 8, 900);
    app.svc.media.addMedia('main', { id: 'j', title: 'Jingle', artist: '', category: 'jingle', file: 'j.wav', durationMs: 8000, addedAt: 0 });
    app.setAutomation('main', { autoFill: false });
    app.saveOutput(admin, 'main', null, { name: 'ice', host: '127.0.0.1', port, mount: '/radio', password: 'pw-123456' });
    app.start();
    app.startPlayout(admin, 'main', { format: 'mp3', bitrateKbps: 64 });
    const status = () => (app.playoutView('main') as { status: PlayoutStatus }).status;
    await until(() => status()?.running);
    const [slot] = app.rt('main').data.cardwall;
    app.updateCart('main', slot!.id, { mediaId: 'j' });
    app.triggerCart('main', slot!.id);
    app.triggerCart('main', slot!.id);
    await until(() => status().carts === 2);
    assert.equal(app.stopCarts('main').stopped, 2);
    await until(() => status().carts === 0, 5000);
    await app.stopPlayout(admin, 'main');
  } finally {
    app.shutdown();
    ice.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Soundboard: Tastenkürzel nur als einzelnes Zeichen oder F1–F12', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-sb-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const [a] = app.rt('main').data.cardwall;
    app.updateCart('main', a!.id, { hotkey: 'F12' });
    assert.equal(a!.hotkey, 'F12');
    assert.throws(() => app.updateCart('main', a!.id, { hotkey: 'ctrl+q' }), /Tastenkürzel/);
    assert.throws(() => app.updateCart('main', a!.id, { hotkey: 'F13' }), /Tastenkürzel/);
    assert.equal(a!.hotkey, 'F12', 'ungültige Eingabe lässt das alte Kürzel stehen');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

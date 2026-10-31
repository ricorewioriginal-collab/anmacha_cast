// Cast Tools: originale ArtCraft-Anwendungen (Web-Fassung) bei Bedarf aus dem Release laden, gegen SHA256SUMS prüfen,
// sicher entpacken und isoliert unter /tools/<id>/ ausliefern. Kein Netz: Release-Server ist ein lokaler Nachbau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { createHttpServer } from '../src/server/http.ts';
import { readZip, safeEntryName } from '../src/server/zip.ts';

/** Minimaler ZIP-Schreiber für Tests (stored/deflate, ohne ZIP64). */
function makeZip(files: { name: string; data?: string | Buffer; deflate?: boolean; badCrc?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const cens: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = f.data === undefined ? Buffer.alloc(0) : Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = f.deflate ? deflateRawSync(raw) : raw;
    const crc = (f.badCrc ? crc32(raw) ^ 1 : crc32(raw)) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(f.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(f.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, comp);
    cens.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(cens);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('ZIP: stored und deflate lesen, Zip-Slip und falsche Prüfsummen ablehnen', () => {
  const z = readZip(makeZip([{ name: 'a/' }, { name: 'a/b.txt', data: 'hallo' }, { name: 'a/c.bin', data: Buffer.alloc(5000, 7), deflate: true }]));
  assert.deepEqual(z.map((e) => [e.name, e.dir, e.data?.length ?? null]), [['a', true, null], ['a/b.txt', false, 5], ['a/c.bin', false, 5000]]);
  assert.throws(() => readZip(makeZip([{ name: '../böse.txt', data: 'x' }])), /Unzulässiger Pfad/);
  assert.throws(() => readZip(makeZip([{ name: 'a/../../x', data: 'x' }])), /Unzulässiger Pfad/);
  assert.throws(() => readZip(makeZip([{ name: '/etc/passwd', data: 'x' }])), /Unzulässiger Pfad/);
  assert.throws(() => readZip(makeZip([{ name: 'a.txt', data: 'x', badCrc: true }])), /Prüfsumme/);
  assert.throws(() => readZip(Buffer.from('kein zip')), /Keine ZIP-Datei/);
  assert.throws(() => readZip(makeZip([{ name: 'a', data: Buffer.alloc(2000) }]), { maxTotal: 1000 }), /zu groß/);
  assert.equal(safeEntryName('C:/x'), null);
  assert.equal(safeEntryName('./a/b'), 'a/b');
});

test('Cast Tools: Laden aus dem Release, Prüfsumme, Umbenennung, isolierte Auslieferung, Rechte', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-tools-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const admin = app.svc.auth.createToken({ name: 'a', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  const editor = app.svc.auth.createToken({ name: 'e', scopes: ['*'], roles: ['editor'], stationIds: ['main'] }).token;
  const call = (tok: string, m: string, p: string) => fetch(`${root}/api/v1${p}`, { method: m, headers: { Authorization: `Bearer ${tok}` } });

  const zip = makeZip([
    { name: 'photocraft-web-0.11.1/' },
    { name: 'photocraft-web-0.11.1/index.html', data: '<!DOCTYPE html><title>PhotoCraft</title><p>Loading PhotoCraft&hellip;</p><script type="module" src="./boot-0123456789abcdef.js"></script>', deflate: true },
    { name: 'photocraft-web-0.11.1/boot-0123456789abcdef.js', data: 'console.log(1)' },
    { name: 'photocraft-web-0.11.1/boot-0123456789abcdef_bg.wasm', data: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]) },
    { name: 'photocraft-web-0.11.1/LICENSE-APACHE', data: 'Apache License 2.0' },
  ]);
  let sumsFor = createHash('sha256').update(zip).digest('hex');
  let assets = [
    { name: 'photocraft-web-0.11.1.zip', size: zip.length, browser_download_url: 'https://dl.test/web.zip' },
    { name: 'photocraft-0.11.1-windows-x64-portable.zip', size: 1, browser_download_url: 'https://dl.test/win.zip' },
    { name: 'SHA256SUMS.txt', size: 1, browser_download_url: 'https://dl.test/sums' },
  ];
  const requested: string[] = [];
  app.svc.tools.fetchFn = (async (url: string) => {
    requested.push(url);
    if (url === 'https://api.github.com/repos/storytold/photocraft/releases/latest') return new Response(JSON.stringify({ tag_name: 'v0.11.1', assets }), { status: 200 });
    if (url === 'https://api.github.com/repos/storytold/soundcraft/releases/latest') return new Response('{"message":"Not Found"}', { status: 404 });
    if (url === 'https://dl.test/sums') return new Response(`${sumsFor}  photocraft-web-0.11.1.zip\n${'b'.repeat(64)}  photocraft-0.11.1-windows-x64-portable.zip\n`, { status: 200 });
    if (url === 'https://dl.test/web.zip') return new Response(new Uint8Array(zip), { status: 200 });
    return new Response('', { status: 500 });
  }) as unknown as typeof fetch;

  try {
    // Liste für alle Angemeldeten, Laden nur für globale Admins
    const list = (await (await call(editor, 'GET', '/tools')).json()) as { id: string; name: string; upstream: string; web: { installed: boolean } }[];
    assert.deepEqual(list.map((t) => t.name), ['Cast Sound', 'Cast Photo', 'Cast Film', 'Cast Vector', 'Cast Word', 'Cast Effect']);
    assert.ok(list.every((t) => !t.web.installed));
    assert.equal((await call(editor, 'POST', '/tools/cast-photo/install')).status, 403);

    // Prüfsumme falsch: nichts wird bereitgestellt
    sumsFor = 'c'.repeat(64);
    const bad = await call(admin, 'POST', '/tools/cast-photo/install');
    assert.equal(bad.status, 502);
    assert.match(((await bad.json()) as { message: string }).message, /Prüfsumme stimmt nicht/);
    assert.equal((await fetch(`${root}/tools/cast-photo/`)).status, 404);

    // Richtig: geladen, Titel umbenannt, Lizenz bleibt
    sumsFor = createHash('sha256').update(zip).digest('hex');
    const ok = await call(admin, 'POST', '/tools/cast-photo/install');
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { web: { version: string } }).web.version, 'v0.11.1');
    const page = await fetch(`${root}/tools/cast-photo/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<title>Cast Photo<\/title>/);
    assert.match(html, /Loading Cast Photo/);
    assert.ok(html.includes('./boot-0123456789abcdef.js'), 'Dateinamen bleiben unverändert');
    assert.match(page.headers.get('content-security-policy') ?? '', /^sandbox allow-scripts/);
    assert.equal(page.headers.get('access-control-allow-origin'), '*');
    const wasm = await fetch(`${root}/tools/cast-photo/boot-0123456789abcdef_bg.wasm`);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    assert.match(wasm.headers.get('cache-control') ?? '', /immutable/);
    assert.equal(await (await fetch(`${root}/tools/cast-photo/LICENSE-APACHE`)).text(), 'Apache License 2.0');
    assert.notEqual((await fetch(`${root}/tools/cast-photo/../../config/anmachacast.conf`)).status, 200);
    assert.notEqual((await fetch(`${root}/tools/cast-photo/%2e%2e/installed.json`)).status, 200);
    assert.notEqual((await fetch(`${root}/tools/cast-photo/..%2finstalled.json`)).status, 200, 'kodierte Pfadtrenner führen nicht aus dem Ordner');
    assert.equal((await fetch(`${root}/tools/cast-photo`, { redirect: 'manual' })).status, 301);

    // Ohne Release: verständliche Meldung
    const none = await call(admin, 'POST', '/tools/cast-sound/install');
    assert.equal(none.status, 404);
    assert.match(((await none.json()) as { message: string }).message, /noch keine Veröffentlichung/);

    // Release ohne Web-Fassung
    assets = assets.filter((a) => !a.name.includes('-web-'));
    rmSync(join(dir, 'tools', 'cast-photo'), { recursive: true, force: true });
    const noWeb = await call(admin, 'POST', '/tools/cast-photo/install');
    assert.equal(noWeb.status, 404);
    assert.match(((await noWeb.json()) as { message: string }).message, /keine Web-Fassung/);

    // Entfernen
    assert.equal((await call(admin, 'DELETE', '/tools/cast-photo')).status, 200);
    assert.equal(existsSync(join(dir, 'tools', 'cast-photo')), false);
    assert.ok(requested.every((u) => u.startsWith('https://api.github.com/repos/storytold/') || u.startsWith('https://dl.test/')), 'nur offizielle Release-Adressen');
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

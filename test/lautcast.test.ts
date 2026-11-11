// lautcast (laut.fm, Forum 09.11.2026): Live-Puffer und Sendebeginn zum Songwechsel als Mountpoint-Parameter,
// Status-/Ansage-Seite des Streamingservers und schnelles Neuverbinden nach einem Hänger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IcecastOutput, buildMountPath, lautfmLinks, isLautfmOutput, type OutputConfig } from '../src/server/icecast.ts';
import { rawIcecast, listenLocal } from './helpers.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('lautcast: Mountpoint-Parameter einzeln und kombiniert', () => {
  assert.equal(buildMountPath({ mount: '/ricorewi' }), '/ricorewi');
  assert.equal(buildMountPath({ mount: 'ricorewi', liveBuffer: 30 }), '/ricorewi?live_buffer=30');
  assert.equal(buildMountPath({ mount: '/ricorewi', waitForSongEnd: true }), '/ricorewi?wait_for_song_end=1');
  assert.equal(buildMountPath({ mount: '/ricorewi', waitForSongEnd: true, liveBuffer: 60 }), '/ricorewi?live_buffer=60&wait_for_song_end=1');
  assert.equal(buildMountPath({ mount: '/ricorewi', priority: 2, liveBuffer: 15, waitForSongEnd: false }), '/ricorewi?prio=2&live_buffer=15');
  for (const bad of [14, 91, 30.5]) assert.throws(() => buildMountPath({ mount: '/x', liveBuffer: bad }), /liveBuffer/);
});

test('lautcast: Status- und Ansage-Seite nur für laut.fm-Ausgänge', () => {
  assert.deepEqual(lautfmLinks({ host: 'live.laut.fm', mount: '/RicoReWi' }), {
    station: 'ricorewi',
    status: 'https://ricorewi.stream.laut.fm/admin/status/ricorewi',
    announcement: 'https://ricorewi.stream.laut.fm/admin/announcement/ricorewi',
  });
  assert.equal(lautfmLinks({ host: 'icecast.example.org', mount: '/ricorewi' }), null);
  assert.equal(lautfmLinks({ host: 'evil-laut.fm.example.org', mount: '/x' }), null, 'nur echte *.laut.fm-Hosts');
  assert.equal(lautfmLinks({ host: 'live.laut.fm', mount: '/../admin' }), null, 'kein Pfad-Trick über den Mountpoint');
  assert.equal(isLautfmOutput({ host: 'laut.fm' }), true);
  assert.equal(isLautfmOutput({ host: 'notlaut.fm' }), false);
});

test('lautcast: nach einem Abbruch einer laufenden Verbindung sofort neu verbinden (Live-Puffer überbrücken)', async () => {
  const paths: string[] = [];
  const server = rawIcecast({ onSource: (r) => paths.push(r.url) });
  const port = await listenLocal(server);
  const cfg: OutputConfig = {
    id: 'out1', stationId: 'main', name: 'laut.fm', type: 'icecast', host: '127.0.0.1', port, mount: '/ricorewi',
    username: 'source', passwordRef: 'pw', tls: false, sourceTarget: '/live', enabled: true, liveBuffer: 30, waitForSongEnd: true,
  };
  const out = new IcecastOutput(cfg, () => 'geheim');
  try {
    out.start('audio/mpeg');
    let end = Date.now() + 3000;
    while (paths.length === 0 && Date.now() < end) await wait(20);
    assert.equal(paths[0], '/ricorewi?live_buffer=30&wait_for_song_end=1', 'Parameter gehen mit an den Server');
    out.state.connectedAt = Date.now() - 60_000; // Verbindung lief schon eine Minute
    const before = Date.now();
    server.closeAllConnections(); // Hänger: der Server beendet die Verbindung
    end = Date.now() + 3000;
    while (paths.length < 2 && Date.now() < end) await wait(20);
    assert.equal(paths.length, 2, 'neu verbunden');
    assert.ok(Date.now() - before < 1500, `schnell neu verbunden (${Date.now() - before} ms), nicht erst nach 2 s Wartezeit`);
  } finally {
    out.stop();
    server.close();
  }
});

// ---------- Status- und Ansage-Seite (mit den Live-Zugangsdaten des Encoders) ----------

import { createServer, type IncomingMessage } from 'node:http';
import { LautcastAdmin, findUploadForm, htmlToText } from '../src/server/services/lautcast.ts';
import type { AnMaChaCastApp } from '../src/server/app.ts';

test('lautcast: Ansage-Formular wird eingelesen statt geraten, HTML wird zu Text', () => {
  const html = `<html><head><style>x{}</style></head><body><h1>Ansage</h1>
    <form action="/admin/announcement/ricorewi/upload" method="post" enctype="multipart/form-data">
      <input type="hidden" name="csrf" value="t0k3n"><input type="checkbox" name="opt" value="1">
      <input type="file" name="audio"><input type="submit" name="go" value="Senden"></form></body></html>`;
  assert.deepEqual(findUploadForm(html, 'https://ricorewi.stream.laut.fm/admin/announcement/ricorewi'), {
    action: 'https://ricorewi.stream.laut.fm/admin/announcement/ricorewi/upload', method: 'POST', fileField: 'audio', fields: [['csrf', 't0k3n']],
  });
  assert.equal(findUploadForm('<form><input name="q"></form>', 'https://x.stream.laut.fm/'), null, 'ohne Datei-Feld kein Upload-Formular');
  assert.equal(htmlToText('<p>Versatz: 12&nbsp;s</p><script>alert(1)</script><div>Ansagen: 2</div>'), 'Versatz: 12 s\nAnsagen: 2');
});

test('lautcast: Status und Ansage gegen einen nachgebauten laut.fm-Streamingserver', async () => {
  const seen: { method: string; url: string; auth: string; body: string }[] = [];
  let statusJson = true;
  let formAction = '/admin/announcement/ricorewi';
  const read = (req: IncomingMessage) => new Promise<string>((r) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString('latin1'))); });
  const server = createServer(async (req, res) => {
    const body = await read(req);
    seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization ?? '', body });
    if (req.headers.authorization !== 'Basic ' + Buffer.from('source:live-geheim').toString('base64')) { res.statusCode = 401; return res.end(); }
    if (req.url === '/admin/status/ricorewi') {
      if (statusJson) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ offset: 12, live_buffer: 30, announcements: 1 })); }
      res.setHeader('Content-Type', 'text/html'); return res.end('<table><tr><td>Versatz</td><td>12 s</td></tr></table>');
    }
    if (req.url === '/admin/announcement/ricorewi' && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<form method="post" enctype="multipart/form-data" action="${formAction}"><input type="hidden" name="token" value="abc"><input type="file" name="file"></form>`);
    }
    if (req.url === '/admin/announcement/ricorewi' && req.method === 'POST') { res.setHeader('Content-Type', 'text/html'); return res.end('<p>Ansage angenommen, noch 150 Sekunden möglich</p>'); }
    res.statusCode = 404; res.end();
  });
  const port = await listenLocal(server);
  const cfg = { id: 'out1', stationId: 'main', name: 'laut.fm', type: 'icecast', host: 'live.laut.fm', port: 8080, mount: '/ricorewi', username: 'source', passwordRef: 'output:out1', tls: false, sourceTarget: '/live', enabled: true };
  let pass: string | undefined = 'live-geheim';
  const audit: unknown[] = [];
  const fakeApp = {
    outputOf: (sid: string, id: string) => { if (sid !== 'main' || id !== 'out1') throw new Error('not found'); return { cfg }; },
    secrets: { get: () => pass },
    audit: { write: (e: unknown) => audit.push(e) },
  } as unknown as AnMaChaCastApp;
  const admin = new LautcastAdmin(fakeApp);
  admin.baseOverride = () => `http://127.0.0.1:${port}`;
  try {
    assert.deepEqual((await admin.status('main', 'out1')).json, { offset: 12, live_buffer: 30, announcements: 1 });
    statusJson = false;
    assert.equal((await admin.status('main', 'out1')).text, 'Versatz 12 s');

    const mp3 = Buffer.alloc(4096, 1);
    const r = await admin.announce('main', 'out1', mp3, 'Ansage 14 Uhr.mp3', 'tester');
    assert.equal(r.message, 'Ansage angenommen, noch 150 Sekunden möglich');
    const post = seen.find((s) => s.method === 'POST')!;
    assert.match(post.body, /name="token"\r\n\r\nabc/, 'versteckte Felder des Formulars gehen mit');
    assert.match(post.body, /name="file"; filename="Ansage 14 Uhr.mp3"\r\nContent-Type: audio\/mpeg/, 'Datei unter dem Feldnamen der Seite');
    assert.equal(audit.length, 1);

    await assert.rejects(admin.announce('main', 'out1', mp3, 'x.exe', 't'), /Format/);
    await assert.rejects(admin.announce('main', 'out1', Buffer.alloc(10), 'x.mp3', 't'), /leer/);
    formAction = 'https://evil.example.org/steal';
    await assert.rejects(admin.announce('main', 'out1', mp3, 'x.mp3', 't'), /anderen Server/, 'Zugangsdaten gehen nie an fremde Server');
    assert.equal(seen.filter((s) => s.method === 'POST').length, 1);
    pass = 'falsch';
    await assert.rejects(admin.status('main', 'out1'), /abgelehnt/);
    pass = undefined;
    await assert.rejects(admin.status('main', 'out1'), /kein Live-Passwort/);
    cfg.host = 'icecast.example.org';
    await assert.rejects(admin.status('main', 'out1'), /kein laut.fm-Encoder/);
  } finally {
    server.close();
  }
});

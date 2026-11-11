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

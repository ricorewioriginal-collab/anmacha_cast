// IcecastOutput gegen einen Icecast-Nachbau auf TCP-Ebene (wie Icecast 2.4: Body = roher Datenstrom).
// 1) Kein Deadlock: Manche Icecast-kompatible Server (u. a. vermutlich laut.fm, siehe Nutzerbericht
//    "Verbindung steht, aber kein Audiosignal kommt an") antworten erst, sobald Audiodaten angekommen sind.
// 2) Keine HTTP-Chunks: Icecast 2.4 entpackt sie nicht, die Kennungen landeten sonst mitten im MP3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IcecastOutput, type OutputConfig } from '../src/server/icecast.ts';
import { rawIcecast, listenLocal, type IceReq } from './helpers.ts';

const cfg = (port: number): OutputConfig => ({
  id: 'out1', stationId: 'main', name: 'Test', type: 'icecast',
  host: '127.0.0.1', port, mount: '/live', username: 'source', passwordRef: 'pw',
  tls: false, sourceTarget: '/live', enabled: true,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('IcecastOutput: kein Deadlock bei Servern, die erst nach Audiodaten antworten (laut.fm-Fall)', async () => {
  let got = 0;
  const server = rawIcecast({ respondAfterData: true, onData: (d) => (got += d.length) });
  const port = await listenLocal(server);
  try {
    const out = new IcecastOutput(cfg(port), () => 'geheim');
    out.start('audio/mpeg');
    out.write(Buffer.from('erste-audio-daten'));
    const end = Date.now() + 3000;
    while (got === 0 && Date.now() < end) await wait(20);
    assert.ok(got > 0, 'Audiodaten müssen ankommen, ohne auf die Server-Antwort zu warten');
    assert.equal(out.state.status, 'connected');
    out.stop();
  } finally {
    server.close();
  }
});

test('IcecastOutput: Body kommt als roher Datenstrom an – keine HTTP-Chunks im Audio (Icecast 2.4)', async () => {
  const chunks: Buffer[] = [];
  let source: IceReq | null = null;
  const server = rawIcecast({ onSource: (r) => (source = r), onData: (d) => chunks.push(d) });
  const port = await listenLocal(server);
  try {
    const out = new IcecastOutput(cfg(port), () => 'geheim');
    out.start('audio/mpeg');
    await wait(100);
    const audio = [Buffer.from([0xff, 0xfb, 0x92, 0x64, 1, 2, 3]), Buffer.from('mehr-audio'), Buffer.alloc(5000, 7)];
    for (const a of audio) out.write(a);
    const want = Buffer.concat(audio);
    const end = Date.now() + 3000;
    while (Buffer.concat(chunks).length < want.length && Date.now() < end) await wait(20);
    assert.ok(source, 'Quellverbindung angekommen');
    const s = source as IceReq;
    assert.equal(s.method, 'PUT');
    assert.equal(s.headers['transfer-encoding'], undefined, 'kein Transfer-Encoding');
    assert.equal(s.headers['content-type'], 'audio/mpeg');
    assert.equal(s.headers.authorization, 'Basic ' + Buffer.from('source:geheim').toString('base64'));
    assert.deepEqual(Buffer.concat(chunks), want, 'genau die Audiodaten, ohne Chunk-Kennungen');
    assert.equal(out.state.status, 'connected');
    out.stop();
  } finally {
    server.close();
  }
});

test('IcecastOutput: 401 vom Server führt zu Fehlerstatus (kein endloser Retry)', async () => {
  const server = rawIcecast({ status: () => 401 });
  const port = await listenLocal(server);
  try {
    const out = new IcecastOutput(cfg(port), () => 'falsch');
    out.start('audio/mpeg');
    await wait(300);
    assert.equal(out.state.status, 'error');
    assert.equal(out.state.errorCategory, 'auth');
    out.stop();
  } finally {
    server.close();
  }
});

test('IcecastOutput: Titel in Echtzeit – auch ein später verbundener Encoder bekommt den laufenden Titel sofort (UTF-8)', async () => {
  const meta: string[] = [];
  const server = rawIcecast({ onGet: (r) => r.url.startsWith('/admin/metadata') && meta.push(r.url) });
  const port = await listenLocal(server);
  try {
    const out = new IcecastOutput(cfg(port), () => 'geheim');
    out.updateMetadata('Die Ärzte - Schrei nach Liebe'); // läuft schon, Encoder noch nicht verbunden
    assert.equal(meta.length, 0);
    out.start('audio/mpeg');
    out.write(Buffer.from([0xff, 0xfb, 0x90, 0x64]));
    const end = Date.now() + 4000;
    while (!meta.length && Date.now() < end) await wait(20);
    assert.ok(meta.length >= 1, 'Titel nach dem Verbinden nachgereicht');
    const q = new URL(meta[0]!, 'http://x').searchParams;
    assert.equal(q.get('mount'), '/live');
    assert.equal(q.get('mode'), 'updinfo');
    assert.equal(q.get('charset'), 'UTF-8');
    assert.equal(q.get('song'), 'Die Ärzte - Schrei nach Liebe');
    // Titelwechsel geht sofort raus
    const before = meta.length;
    out.updateMetadata('Nena - 99 Luftballons');
    const end2 = Date.now() + 2000;
    while (meta.length === before && Date.now() < end2) await wait(10);
    assert.equal(new URL(meta.at(-1)!, 'http://x').searchParams.get('song'), 'Nena - 99 Luftballons');
    out.stop();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

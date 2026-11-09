// Studiomail: eigenes Postfach per IMAP lesen (nur neue Post, Auto-Antworten übersprungen, Audio-Anhang →
// Sprachnachricht) und per SMTP auf Hörerpost antworten – gegen einen IMAP- und SMTP-Nachbau ohne TLS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeWords, parseMail } from '../src/server/mail/mime.ts';
import { encodeHeader } from '../src/server/smtp.ts';

const CRLF = '\r\n';
const mail = (lines: string[]) => Buffer.from(lines.join(CRLF), 'latin1');
const qpUtf8 = (s: string) => [...Buffer.from(s, 'utf8')].map((b) => (b > 126 || b === 61 ? `=${b.toString(16).toUpperCase().padStart(2, '0')}` : String.fromCharCode(b))).join('');

const greeting = mail([
  'From: =?UTF-8?Q?Anna_M=C3=BCller?= <Anna@Example.org>',
  'To: studio@radio.example',
  'Subject: =?UTF-8?B?R3LDvMOfZSBhdXMgS8O2bG4=?=',
  'Message-ID: <abc123@example.org>',
  'Date: Mon, 09 Nov 2026 18:00:00 +0100',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  qpUtf8('Hallo Studio, viele Grüße an meine Oma in Köln!'),
  '',
  '-- ',
  'Anna',
  '--b1',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Hallo Studio</p>',
  '--b1--',
  '',
]);
const autoReply = mail(['From: Max <max@example.org>', 'Subject: Abwesend', 'Auto-Submitted: auto-replied', '', 'Bin im Urlaub.']);
const voicemail = mail([
  'From: Ben <ben@example.org>',
  'Subject: Sprachnachricht',
  'Message-ID: <v1@example.org>',
  'Content-Type: multipart/mixed; boundary="x"',
  '',
  '--x',
  'Content-Type: text/plain; charset=iso-8859-1',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Gr=FC=DFe vom Ben',
  '--x',
  'Content-Type: audio/mpeg; name="gruss.mp3"',
  'Content-Disposition: attachment; filename="gruss.mp3"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(3000, 7)]).toString('base64').replace(/(.{76})/g, `$1${CRLF}`),
  '--x--',
  '',
]);

test('MIME: kodierte Kopfzeilen, quoted-printable, Zeichensätze, Signatur weg, Auto-Antwort erkannt', () => {
  assert.equal(decodeWords('=?UTF-8?B?R3LDvMOfZQ==?= =?UTF-8?Q?_aus_K=C3=B6ln?='), 'Grüße aus Köln');
  const m = parseMail(greeting);
  assert.equal(m.fromName, 'Anna Müller');
  assert.equal(m.fromAddress, 'anna@example.org');
  assert.equal(m.subject, 'Grüße aus Köln');
  assert.equal(m.text, 'Hallo Studio, viele Grüße an meine Oma in Köln!');
  assert.equal(m.messageId, '<abc123@example.org>');
  assert.equal(m.auto, false);
  assert.equal(parseMail(autoReply).auto, true);
  const v = parseMail(voicemail);
  assert.equal(v.text, 'Grüße vom Ben');
  assert.equal(v.audio.length, 1);
  assert.equal(v.audio[0]!.data.length, 3004);
  assert.equal(encodeHeader('Re: Grüße'), '=?UTF-8?B?UmU6IEdyw7zDn2U=?=');
  assert.equal(encodeHeader('Hallo\r\nBcc: x'), 'Hallo Bcc: x', 'keine Kopfzeilen-Einschleusung');
});

// ---------- IMAP-Nachbau ----------
const box: { uid: number; raw: Buffer; seen: boolean }[] = [{ uid: 1, raw: mail(['From: alt@example.org', 'Subject: alte Post', '', 'alt']), seen: true }];
const imap = createServer((sock: Socket) => {
  sock.write(`* OK IMAP Nachbau bereit${CRLF}`);
  let buf = '';
  sock.on('data', (d) => {
    buf += d.toString('latin1');
    let i;
    while ((i = buf.indexOf(CRLF)) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const [tag, ...rest] = line.split(' ');
      const cmd = rest.join(' ');
      if (/^LOGIN /i.test(cmd)) sock.write(cmd === 'LOGIN "studio@radio.example" "geheim\\"pw"' ? `${tag} OK angemeldet${CRLF}` : `${tag} NO falsch${CRLF}`);
      else if (/^SELECT /i.test(cmd)) sock.write(`* ${box.length} EXISTS${CRLF}* OK [UIDVALIDITY 42] ok${CRLF}${tag} OK [READ-WRITE] fertig${CRLF}`);
      else if (/^UID SEARCH ALL/i.test(cmd)) sock.write(`* SEARCH ${box.map((m) => m.uid).join(' ')}${CRLF}${tag} OK${CRLF}`);
      else if (/^UID SEARCH UID (\d+):\*/i.test(cmd)) {
        const from = Number(/UID (\d+):/i.exec(cmd)![1]);
        const hits = box.filter((m) => m.uid >= from).map((m) => m.uid);
        // IMAP-Eigenheit: n:* liefert mindestens die höchste UID
        sock.write(`* SEARCH ${(hits.length ? hits : [box.at(-1)!.uid]).join(' ')}${CRLF}${tag} OK${CRLF}`);
      } else if (/^UID FETCH (\d+)/i.test(cmd)) {
        const m = box.find((x) => x.uid === Number(/FETCH (\d+)/i.exec(cmd)![1]))!;
        sock.write(`* 1 FETCH (UID ${m.uid} BODY[] {${m.raw.length}}${CRLF}`);
        sock.write(m.raw);
        sock.write(`)${CRLF}${tag} OK${CRLF}`);
      } else if (/^UID STORE (\d+)/i.test(cmd)) { box.find((x) => x.uid === Number(/STORE (\d+)/i.exec(cmd)![1]))!.seen = true; sock.write(`${tag} OK${CRLF}`); }
      else if (/^LOGOUT/i.test(cmd)) { sock.write(`* BYE${CRLF}${tag} OK${CRLF}`); sock.end(); }
      else sock.write(`${tag} BAD unbekannt${CRLF}`);
    }
  });
  sock.on('error', () => undefined);
});

// ---------- SMTP-Nachbau ----------
const sent: { from: string; to: string; data: string }[] = [];
const smtp = createServer((sock: Socket) => {
  sock.write(`220 smtp Nachbau${CRLF}`);
  let buf = '';
  let inData = false;
  let auth = 0;
  const cur = { from: '', to: '', data: '' };
  sock.on('data', (d) => {
    buf += d.toString('utf8');
    for (;;) {
      if (inData) {
        const end = buf.indexOf(`${CRLF}.${CRLF}`);
        if (end < 0) return;
        cur.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        inData = false;
        sent.push({ ...cur });
        sock.write(`250 angenommen${CRLF}`);
        continue;
      }
      const i = buf.indexOf(CRLF);
      if (i < 0) return;
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (auth === 1) { auth = 2; sock.write(`334 UGFzc3dvcmQ6${CRLF}`); continue; }
      if (auth === 2) { auth = 0; sock.write(Buffer.from(line, 'base64').toString() === 'geheim"pw' ? `235 ok${CRLF}` : `535 nein${CRLF}`); continue; }
      if (/^EHLO/i.test(line)) sock.write(`250-hallo${CRLF}250 AUTH LOGIN${CRLF}`);
      else if (/^AUTH LOGIN/i.test(line)) { auth = 1; sock.write(`334 VXNlcm5hbWU6${CRLF}`); }
      else if (/^MAIL FROM:<(.+)>/i.test(line)) { cur.from = /<(.+)>/.exec(line)![1]!; sock.write(`250 ok${CRLF}`); }
      else if (/^RCPT TO:<(.+)>/i.test(line)) { cur.to = /<(.+)>/.exec(line)![1]!; sock.write(`250 ok${CRLF}`); }
      else if (/^DATA/i.test(line)) { inData = true; sock.write(`354 los${CRLF}`); }
      else if (/^QUIT/i.test(line)) { sock.write(`221 tschüss${CRLF}`); sock.end(); }
      else sock.write(`500 ?${CRLF}`);
    }
  });
  sock.on('error', () => undefined);
});

await new Promise<void>((r) => imap.listen(0, '127.0.0.1', r));
await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
const imapPort = (imap.address() as { port: number }).port;
const smtpPort = (smtp.address() as { port: number }).port;
const { AnMaChaCastApp } = await import('../src/server/app.ts');

test('Studiomail: Postfach verbinden, neue Hörerpost abholen, per Mail antworten', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-mail-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const admin = { id: 'admin', tokenId: 't', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };
  const M = app.svc.studiomail;
  try {
    // Nachbau ohne TLS (nur in Tests; über die API nicht setzbar)
    (app.rt('main').data as { studiomail?: object }).studiomail = { plain: true };
    const base = { address: 'studio@radio.example', name: 'Radio Test', user: 'studio@radio.example', imapHost: '127.0.0.1', imapPort, imapSecure: true, smtpHost: '127.0.0.1', smtpPort, smtpSecure: true, signature: 'Euer Studio-Team' };
    await assert.rejects(M.setConfig(admin, 'main', { ...base, enabled: true, password: 'falsch' }), /Anmeldung am Postfach abgelehnt/);
    const v = (await M.setConfig(admin, 'main', { ...base, enabled: true, password: 'geheim"pw' })) as Record<string, unknown>;
    assert.equal(v.hasPassword, true);
    assert.ok(!JSON.stringify(v).includes('geheim'), 'Passwort nie in der Antwort');
    assert.equal(v.lastUid, 1, 'alte Post wird nicht übernommen');
    assert.equal(await M.poll('main'), 0);

    box.push({ uid: 2, raw: greeting, seen: false }, { uid: 3, raw: autoReply, seen: false }, { uid: 4, raw: voicemail, seen: false });
    assert.equal(await M.poll('main'), 2, 'Gruß und Sprachnachricht, keine Abwesenheitsnotiz');
    assert.ok(box[1]!.seen && box[3]!.seen, 'als gelesen markiert');
    assert.equal(await M.poll('main'), 0, 'nichts doppelt');
    const items = app.svc.listeners.inbox('main').items;
    const g = items.find((x) => x.kind === 'message')!;
    assert.equal(g.source, 'mail');
    assert.equal(g.email, 'anna@example.org');
    assert.equal(g.name, 'Anna Müller');
    assert.equal(g.text, 'Grüße aus Köln – Hallo Studio, viele Grüße an meine Oma in Köln!');
    const vm = items.find((x) => x.kind === 'voice')!;
    assert.equal(vm.bytes, 3004);
    assert.equal(vm.email, 'ben@example.org');
    assert.ok(app.svc.listeners.voiceFile('main', vm.id).path, 'Aufnahme gespeichert');

    // Antworten
    const r = (await M.reply(admin, 'main', g.id, 'Danke Anna, wir grüßen deine Oma gleich im Programm!')) as { replies: unknown[]; status: string };
    assert.equal(r.replies.length, 1);
    assert.equal(r.status, 'done');
    const out = sent.at(-1)!;
    assert.equal(out.from, 'studio@radio.example');
    assert.equal(out.to, 'anna@example.org');
    assert.match(out.data, /Subject: =\?UTF-8\?B\?/);
    assert.match(out.data, /In-Reply-To: <abc123@example\.org>/);
    assert.match(out.data, /Danke Anna/);
    assert.match(out.data, /Euer Studio-Team/);
    assert.match(out.data, /> Grüße aus Köln/);
    // Hörerseite: Adresse freiwillig – ohne Adresse keine Antwort möglich
    app.svc.listeners.setConfig(admin, 'main', { messages: true });
    app.svc.listeners.message('main', '1.2.3.4', { name: 'Carl', text: 'Ohne Adresse' });
    app.svc.listeners.message('main', '1.2.3.5', { name: 'Dora', text: 'Mit Adresse', email: 'Dora@Example.org' });
    const all = app.svc.listeners.inbox('main').items;
    await assert.rejects(M.reply(admin, 'main', all.find((x) => x.name === 'Carl')!.id, 'Hallo'), /keine Mail-Adresse/);
    await M.reply(admin, 'main', all.find((x) => x.name === 'Dora')!.id, 'Hallo Dora');
    assert.equal(sent.at(-1)!.to, 'dora@example.org');
    assert.match(sent.at(-1)!.data, /Subject: Deine Nachricht an /);
  } finally {
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test.after(async () => {
  await new Promise<void>((r) => imap.close(() => r()));
  await new Promise<void>((r) => smtp.close(() => r()));
});

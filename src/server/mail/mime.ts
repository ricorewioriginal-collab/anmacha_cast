// Kleiner MIME-Leser (kein zusätzliches Paket) für die Studiomail: Kopfzeilen (gefaltet, =?…?= kodiert),
// multipart/*, base64 und quoted-printable, Zeichensätze über TextDecoder. Liefert Absender, Betreff, Text und
// Audio-Anhänge (Sprachnachrichten). Bewusst nur das, was für Hörerpost gebraucht wird.

export interface MailPart { headers: Map<string, string>; body: Buffer }

export interface ParsedMail {
  fromName: string;
  fromAddress: string;
  replyTo: string;
  subject: string;
  messageId: string;
  date: number;
  text: string;
  audio: { filename: string; contentType: string; data: Buffer }[];
  /** automatische Antwort/Abwesenheitsnotiz oder Massenpost – nicht als Hörerpost übernehmen */
  auto: boolean;
}

function decodeCharset(buf: Buffer, charset: string): string {
  const cs = (charset || 'utf-8').trim().replace(/^"|"$/g, '').toLowerCase();
  try { return new TextDecoder(cs === 'latin1' ? 'iso-8859-1' : cs).decode(buf); } catch { return buf.toString('utf8'); }
}

function qp(s: string, header = false): Buffer {
  const src = header ? s.replace(/_/g, ' ') : s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) { out.push(parseInt(src.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(...Buffer.from(c, 'latin1'));
  }
  return Buffer.from(out);
}

/** Kodierte Wörter in Kopfzeilen (RFC 2047) entschlüsseln; Leerraum zwischen zwei kodierten Wörtern entfällt. */
export function decodeWords(s: string): string {
  return s.replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs: string, enc: string, txt: string) => {
    const buf = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : qp(txt, true);
    return decodeCharset(buf, cs.split('*')[0]!);
  });
}

function splitHeaders(raw: Buffer): { headers: Map<string, string>; body: Buffer } {
  let i = raw.indexOf('\r\n\r\n');
  let sep = 4;
  if (i < 0) { i = raw.indexOf('\n\n'); sep = 2; }
  const head = (i < 0 ? raw : raw.subarray(0, i)).toString('latin1');
  const body = i < 0 ? Buffer.alloc(0) : raw.subarray(i + sep);
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const k = line.indexOf(':');
    if (k <= 0) continue;
    const name = line.slice(0, k).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(k + 1).trim());
  }
  return { headers, body };
}

/** Parameter einer Kopfzeile wie Content-Type: text/plain; charset="utf-8" */
export function headerParams(v: string): { value: string; params: Record<string, string> } {
  const parts = v.split(';');
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const k = p.indexOf('=');
    if (k > 0) params[p.slice(0, k).trim().toLowerCase().replace(/\*$/, '')] = p.slice(k + 1).trim().replace(/^"|"$/g, '').replace(/^utf-8''/i, '');
  }
  return { value: parts[0]!.trim().toLowerCase(), params };
}

function decodeBody(body: Buffer, enc: string): Buffer {
  const e = enc.trim().toLowerCase();
  if (e === 'base64') return Buffer.from(body.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (e === 'quoted-printable') return qp(body.toString('latin1'));
  return body;
}

/** Alle Blätter eines MIME-Baums (höchstens 50, Tiefe 6). */
export function leaves(raw: Buffer, depth = 0, out: MailPart[] = []): MailPart[] {
  const { headers, body } = splitHeaders(raw);
  const ct = headerParams(headers.get('content-type') ?? 'text/plain');
  if (ct.value.startsWith('multipart/') && ct.params.boundary && depth < 6) {
    const b = Buffer.from(`--${ct.params.boundary}`, 'latin1');
    let pos = body.indexOf(b);
    while (pos >= 0 && out.length < 50) {
      const start = pos + b.length;
      if (body.subarray(start, start + 2).toString() === '--') break;
      const next = body.indexOf(b, start);
      const chunk = body.subarray(start, next < 0 ? body.length : next).toString('latin1').replace(/^\r?\n/, '').replace(/\r?\n$/, '');
      leaves(Buffer.from(chunk, 'latin1'), depth + 1, out);
      pos = next;
    }
    return out;
  }
  out.push({ headers, body: decodeBody(body, headers.get('content-transfer-encoding') ?? '7bit') });
  return out;
}

function htmlToText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

/** Adresse aus „Name <a@b.de>“ */
export function parseAddress(v: string): { name: string; address: string } {
  const d = decodeWords(v);
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(d);
  const address = (m ? m[2]! : d).trim().toLowerCase();
  return { name: (m ? m[1]! : '').trim(), address: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : '' };
}

/** Zitate und Signatur abschneiden, Länge begrenzen. */
function cleanText(t: string, max: number): string {
  const lines = t.replace(/\r/g, '').split('\n');
  const cut = lines.findIndex((l) => /^-- ?$/.test(l) || /^>/.test(l) || /^(Am|On) .{4,80}(schrieb|wrote).{0,40}:\s*$/i.test(l));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

export function parseMail(raw: Buffer, maxText = 2000): ParsedMail {
  const { headers } = splitHeaders(raw);
  const from = parseAddress(headers.get('from') ?? '');
  const reply = parseAddress(headers.get('reply-to') ?? '');
  const parts = leaves(raw);
  let text = '';
  let html = '';
  const audio: ParsedMail['audio'] = [];
  for (const p of parts) {
    const ct = headerParams(p.headers.get('content-type') ?? 'text/plain');
    const disp = headerParams(p.headers.get('content-disposition') ?? '');
    const filename = decodeWords(disp.params.filename ?? ct.params.name ?? '');
    if (ct.value.startsWith('audio/') || /\.(mp3|m4a|ogg|opus|wav|webm|aac)$/i.test(filename)) { audio.push({ filename: filename || 'nachricht', contentType: ct.value.startsWith('audio/') ? ct.value : 'audio/mpeg', data: p.body }); continue; }
    if (disp.value === 'attachment') continue;
    if (ct.value === 'text/plain' && !text) text = decodeCharset(p.body, ct.params.charset ?? 'utf-8');
    else if (ct.value === 'text/html' && !html) html = decodeCharset(p.body, ct.params.charset ?? 'utf-8');
  }
  const auto = /^auto-(replied|generated)/i.test(headers.get('auto-submitted') ?? '') || /^(bulk|list|junk)$/i.test(headers.get('precedence') ?? '') || headers.has('list-unsubscribe') || /^(mailer-daemon|postmaster|no-?reply)@/i.test(from.address);
  const date = Date.parse(headers.get('date') ?? '');
  return {
    fromName: from.name,
    fromAddress: from.address,
    replyTo: reply.address || from.address,
    subject: decodeWords(headers.get('subject') ?? '').trim().slice(0, 200),
    messageId: (headers.get('message-id') ?? '').trim().slice(0, 300),
    date: Number.isFinite(date) ? date : Date.now(),
    text: cleanText(text || htmlToText(html), maxText),
    audio,
    auto,
  };
}

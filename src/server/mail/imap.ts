// Minimaler IMAP-Client (kein zusätzliches Paket) für die Studiomail: IMAPS (993) oder STARTTLS (143), LOGIN,
// SELECT, UID SEARCH, UID FETCH BODY.PEEK[] (mit Literalen), UID STORE \Seen, LOGOUT. Nur Lesen neuer Post.

import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { Socket } from 'node:net';

export interface ImapConfig {
  host: string;
  port: number;
  /** true = implizites TLS (993), sonst STARTTLS */
  secure: boolean;
  user: string;
  pass: string;
  folder: string;
  /** nur Tests: ohne TLS (lokaler Nachbau) */
  plain?: boolean;
}

/** IMAP-String: in Anführungszeichen, \\ und " maskiert; Zeilenumbrüche sind nicht erlaubt. */
export function quote(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new Error('Ungültige Zeichen in den Zugangsdaten');
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Antwort eines Befehls: alle ungetaggten Zeilen (Literale als Buffer eingebettet) und die Abschlusszeile. */
interface Reply { untagged: { line: string; literals: Buffer[] }[]; status: string; text: string }

export class ImapSession {
  private sock!: Socket | TLSSocket;
  private buf = Buffer.alloc(0);
  private n = 0;
  private waiter: (() => void) | null = null;
  private closed = false;
  private readonly timeoutMs: number;

  constructor(timeoutMs = 20_000) {
    this.timeoutMs = timeoutMs;
  }

  private attach(s: Socket | TLSSocket): void {
    this.sock = s;
    s.on('data', (d: Buffer) => { this.buf = Buffer.concat([this.buf, d]); this.waiter?.(); });
    s.on('close', () => { this.closed = true; this.waiter?.(); });
    s.on('error', () => { this.closed = true; this.waiter?.(); });
  }

  private async more(): Promise<void> {
    if (this.closed) throw new Error('IMAP-Verbindung getrennt');
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => { this.waiter = null; reject(new Error('IMAP-Zeitüberschreitung')); }, this.timeoutMs);
      this.waiter = () => { clearTimeout(t); this.waiter = null; resolve(); };
    });
  }

  /** Eine logische Zeile lesen; Literale {n} werden mitgelesen. */
  private async readLine(): Promise<{ line: string; literals: Buffer[] }> {
    let line = '';
    const literals: Buffer[] = [];
    for (;;) {
      let i = this.buf.indexOf('\r\n');
      while (i < 0) { await this.more(); i = this.buf.indexOf('\r\n'); }
      const part = this.buf.subarray(0, i).toString('latin1');
      this.buf = this.buf.subarray(i + 2);
      line += part;
      const m = /\{(\d+)\}$/.exec(part);
      if (!m) return { line, literals };
      const n = Number(m[1]);
      if (n > 30 * 1024 * 1024) throw new Error('Mail zu groß');
      while (this.buf.length < n) await this.more();
      literals.push(Buffer.from(this.buf.subarray(0, n)));
      this.buf = this.buf.subarray(n);
      line += `{#${literals.length - 1}}`;
    }
  }

  async connect(cfg: ImapConfig): Promise<void> {
    const raw: Socket | TLSSocket = cfg.secure && !cfg.plain ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : new Socket();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => { raw.destroy(); reject(new Error('IMAP-Server nicht erreichbar (Zeitüberschreitung)')); }, this.timeoutMs);
      raw.once('error', (e) => { clearTimeout(t); reject(new Error(`IMAP-Server nicht erreichbar: ${e.message}`)); });
      const ok = () => { clearTimeout(t); resolve(); };
      if (cfg.secure && !cfg.plain) raw.once('secureConnect', ok);
      else (raw as Socket).connect(cfg.port, cfg.host, ok);
    });
    this.attach(raw);
    const greet = await this.readLine();
    if (!/^\* (OK|PREAUTH)/i.test(greet.line)) throw new Error(`IMAP-Begrüßung unerwartet: ${greet.line.slice(0, 80)}`);
    if (!cfg.secure && !cfg.plain) {
      await this.cmd('STARTTLS');
      raw.removeAllListeners('data');
      const tls = tlsConnect({ socket: raw, servername: cfg.host });
      await new Promise<void>((resolve, reject) => { tls.once('secureConnect', () => resolve()); tls.once('error', reject); });
      this.buf = Buffer.alloc(0);
      this.attach(tls);
    }
    try { await this.cmd(`LOGIN ${quote(cfg.user)} ${quote(cfg.pass)}`); } catch { throw new Error('Anmeldung am Postfach abgelehnt – Benutzer/Passwort prüfen (bei manchen Anbietern ein App-Passwort)'); }
  }

  async cmd(command: string): Promise<Reply> {
    const tag = `A${++this.n}`;
    this.sock.write(`${tag} ${command}\r\n`);
    const untagged: Reply['untagged'] = [];
    for (;;) {
      const r = await this.readLine();
      if (r.line.startsWith(`${tag} `)) {
        const m = /^\S+ (OK|NO|BAD)\s?(.*)$/i.exec(r.line);
        const status = (m?.[1] ?? 'BAD').toUpperCase();
        if (status !== 'OK') throw new Error(`IMAP ${status}: ${(m?.[2] ?? '').slice(0, 160)}`);
        return { untagged, status, text: m?.[2] ?? '' };
      }
      untagged.push(r);
    }
  }

  /** Ordner wählen → UIDVALIDITY */
  async select(folder: string): Promise<number> {
    const r = await this.cmd(`SELECT ${quote(folder || 'INBOX')}`);
    for (const u of r.untagged) { const m = /UIDVALIDITY (\d+)/i.exec(u.line); if (m) return Number(m[1]); }
    return 0;
  }

  async search(criteria: string): Promise<number[]> {
    const r = await this.cmd(`UID SEARCH ${criteria}`);
    const out: number[] = [];
    for (const u of r.untagged) { const m = /^\* SEARCH(.*)$/i.exec(u.line); if (m) out.push(...m[1]!.trim().split(/\s+/).filter(Boolean).map(Number)); }
    return out.filter((x) => Number.isInteger(x) && x > 0).sort((a, b) => a - b);
  }

  /** Ganze Nachricht lesen, ohne sie als gelesen zu markieren. */
  async fetch(uid: number): Promise<Buffer | null> {
    const r = await this.cmd(`UID FETCH ${uid} (UID BODY.PEEK[])`);
    for (const u of r.untagged) if (/FETCH/i.test(u.line) && u.literals.length) return u.literals[0]!;
    return null;
  }

  async markSeen(uid: number): Promise<void> {
    await this.cmd(`UID STORE ${uid} +FLAGS.SILENT (\\Seen)`);
  }

  async logout(): Promise<void> {
    try { await this.cmd('LOGOUT'); } catch { /* egal */ }
    this.sock?.destroy();
  }
}

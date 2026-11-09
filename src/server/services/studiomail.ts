// Studiomail: AnMaCha Cast mit dem eigenen Mail-Postfach verbinden (IMAP zum Lesen, SMTP zum Antworten) – je Sender.
// Neue Mails an die Studio-Adresse landen im Hörer-Posteingang (Gruß/Nachricht, mit Audio-Anhang als Sprachnachricht)
// und lassen sich von dort wie alle Hörerpost auf Sendung bringen. Auf Hörerpost mit Adresse (Mail oder freiwillig auf
// der Hörerseite angegeben) antwortet das Studio direkt per Mail. Ohne Zusatzpakete (mail/imap.ts, mail/mime.ts, smtp.ts).
//
// Sicherheit: Passwort nur im Geheimnis-Speicher (nie in Antworten), nur neue Mails ab dem Einschalten, automatische
// Antworten/Massenpost werden übersprungen, Texte als reiner Text gekürzt, Anhänge außer Audio werden nicht gespeichert.

import type { AnMaChaCastApp } from '../app.ts';
import { AppError, type Principal } from '../model.ts';
import { ImapSession, type ImapConfig } from '../mail/imap.ts';
import { parseMail } from '../mail/mime.ts';
import { sendMail } from '../smtp.ts';

export interface StudiomailCfg {
  enabled: boolean;
  /** Studio-Adresse (Absender der Antworten) und angezeigter Name */
  address: string;
  name: string;
  user: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  folder: string;
  /** Signatur unter Antworten */
  signature: string;
  lastUid?: number;
  uidValidity?: number;
  lastCheck?: number;
  lastError?: string;
  lastCount?: number;
  /** nur Tests: lokaler Nachbau ohne TLS (nicht über die API setzbar) */
  plain?: boolean;
}

/** Bekannte Anbieter: Server und Ports zum Vorausfüllen (eigener Server: frei eintragen). */
export const MAIL_PRESETS: Record<string, { name: string; imap: [string, number, boolean]; smtp: [string, number, boolean]; note?: string }> = {
  gmail: { name: 'Gmail', imap: ['imap.gmail.com', 993, true], smtp: ['smtp.gmail.com', 465, true], note: 'App-Passwort nötig (Google-Konto → Sicherheit → App-Passwörter).' },
  gmx: { name: 'GMX', imap: ['imap.gmx.net', 993, true], smtp: ['mail.gmx.net', 465, true], note: 'In den GMX-Einstellungen „POP3/IMAP-Abruf“ erlauben.' },
  webde: { name: 'WEB.DE', imap: ['imap.web.de', 993, true], smtp: ['smtp.web.de', 587, false], note: 'In den WEB.DE-Einstellungen „POP3/IMAP-Abruf“ erlauben.' },
  ionos: { name: 'IONOS', imap: ['imap.ionos.de', 993, true], smtp: ['smtp.ionos.de', 465, true] },
  strato: { name: 'STRATO', imap: ['imap.strato.de', 993, true], smtp: ['smtp.strato.de', 465, true] },
  tonline: { name: 'Telekom (t-online)', imap: ['secureimap.t-online.de', 993, true], smtp: ['securesmtp.t-online.de', 465, true], note: 'Eigenes E-Mail-Passwort im Telekom-Kundencenter anlegen.' },
  posteo: { name: 'Posteo', imap: ['posteo.de', 993, true], smtp: ['posteo.de', 465, true] },
  mailbox: { name: 'mailbox.org', imap: ['imap.mailbox.org', 993, true], smtp: ['smtp.mailbox.org', 465, true] },
};

const DEFAULT: StudiomailCfg = { enabled: false, address: '', name: '', user: '', imapHost: '', imapPort: 993, imapSecure: true, smtpHost: '', smtpPort: 465, smtpSecure: true, folder: 'INBOX', signature: '' };
const MAX_PER_POLL = 20;

const host = (v: unknown, d: string) => (typeof v === 'string' && /^[a-z0-9.-]{1,200}$/i.test(v.trim()) ? v.trim().toLowerCase() : v === '' ? '' : d);
const port = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 65536 ? v : d);

export class StudiomailService {
  private readonly app: AnMaChaCastApp;
  private readonly busy = new Set<string>();

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  private ref(sid: string): string { return `studiomail:${sid}`; }

  config(sid: string): StudiomailCfg {
    return { ...DEFAULT, ...(this.app.rt(sid).data as { studiomail?: StudiomailCfg }).studiomail };
  }

  view(sid: string): unknown {
    const { plain: _plain, ...c } = this.config(sid);
    return { ...c, hasPassword: this.app.secrets.has(this.ref(sid)), presets: MAIL_PRESETS };
  }

  private imapCfg(sid: string, c: StudiomailCfg): ImapConfig {
    const pass = this.app.secrets.get(this.ref(sid)) ?? '';
    if (!c.imapHost || !c.user || !pass) throw new AppError(400, 'incomplete', 'Bitte Posteingangs-Server, Benutzer und Passwort eintragen');
    return { host: c.imapHost, port: c.imapPort, secure: c.imapSecure, user: c.user, pass, folder: c.folder || 'INBOX', plain: c.plain };
  }

  async setConfig(p: Principal, sid: string, input: Record<string, unknown>): Promise<unknown> {
    const cur = this.config(sid);
    const str = (v: unknown, d: string, max: number) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : d);
    const next: StudiomailCfg = {
      ...cur,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : cur.enabled,
      address: typeof input.address === 'string' ? input.address.trim().toLowerCase().slice(0, 200) : cur.address,
      name: str(input.name, cur.name, 80),
      user: str(input.user, cur.user, 200),
      imapHost: host(input.imapHost, cur.imapHost),
      imapPort: port(input.imapPort, cur.imapPort),
      imapSecure: typeof input.imapSecure === 'boolean' ? input.imapSecure : cur.imapSecure,
      smtpHost: host(input.smtpHost, cur.smtpHost),
      smtpPort: port(input.smtpPort, cur.smtpPort),
      smtpSecure: typeof input.smtpSecure === 'boolean' ? input.smtpSecure : cur.smtpSecure,
      folder: str(input.folder, cur.folder, 100) || 'INBOX',
      signature: typeof input.signature === 'string' ? input.signature.trim().slice(0, 600) : cur.signature,
    };
    if (next.address && !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(next.address)) throw new AppError(400, 'invalid_address', 'Die Studio-Adresse sieht nicht wie eine Mail-Adresse aus');
    if (typeof input.password === 'string' && input.password) this.app.secrets.set(this.ref(sid), input.password);
    const turnedOn = next.enabled && !cur.enabled;
    const serverChanged = next.imapHost !== cur.imapHost || next.user !== cur.user || next.folder !== cur.folder;
    if (next.enabled) {
      // Verbindung prüfen und Startpunkt merken: nur Mails ab jetzt übernehmen, keine alte Post
      const s = new ImapSession();
      try {
        await s.connect(this.imapCfg(sid, next));
        next.uidValidity = await s.select(next.folder);
        if (turnedOn || serverChanged || !next.lastUid) next.lastUid = Math.max(0, ...(await s.search('ALL')));
        next.lastError = '';
      } catch (err) {
        throw err instanceof AppError ? err : new AppError(400, 'mail_failed', (err as Error).message);
      } finally {
        await s.logout();
      }
    }
    (this.app.rt(sid).data as { studiomail?: StudiomailCfg }).studiomail = next;
    this.app.audit.write({ kind: 'listener', event: 'studiomail_config', actor: p.id, stationId: sid, enabled: next.enabled, host: next.imapHost });
    this.app.changed();
    return this.view(sid);
  }

  /** Neue Mails abholen → Hörer-Posteingang. Rückgabe: Anzahl übernommener Mails. */
  async poll(sid: string): Promise<number> {
    const c = this.config(sid);
    if (!c.enabled || this.busy.has(sid)) return 0;
    this.busy.add(sid);
    const store = (this.app.rt(sid).data as { studiomail?: StudiomailCfg }).studiomail!;
    const s = new ImapSession();
    let n = 0;
    try {
      await s.connect(this.imapCfg(sid, c));
      const validity = await s.select(c.folder);
      if (store.uidValidity && validity && validity !== store.uidValidity) {
        // Postfach neu aufgebaut: Startpunkt neu setzen statt alles erneut zu übernehmen
        store.uidValidity = validity;
        store.lastUid = Math.max(0, ...(await s.search('ALL')));
        return 0;
      }
      const uids = (await s.search(`UID ${(store.lastUid ?? 0) + 1}:*`)).filter((u) => u > (store.lastUid ?? 0)).slice(0, MAX_PER_POLL);
      for (const uid of uids) {
        const raw = await s.fetch(uid);
        store.lastUid = uid;
        if (!raw) continue;
        const m = parseMail(raw);
        if (m.auto || !m.fromAddress || m.fromAddress === c.address.toLowerCase()) continue;
        const a = m.audio.find((x) => x.data.length <= 3 * 1024 * 1024);
        const ct = a ? (/mp3/.test(a.contentType) ? 'audio/mpeg' : /opus/.test(a.contentType) ? 'audio/ogg' : a.contentType) : '';
        this.app.svc.listeners.addMail(sid, { name: m.fromName, email: m.replyTo, subject: m.subject, messageId: m.messageId, text: m.text, audio: a ? { contentType: ct, data: a.data } : undefined });
        await s.markSeen(uid).catch(() => undefined);
        n++;
      }
      store.lastError = '';
      store.lastCount = n;
      return n;
    } catch (err) {
      store.lastError = (err as Error).message.slice(0, 300);
      throw err;
    } finally {
      store.lastCheck = Date.now();
      this.busy.delete(sid);
      this.app.changed();
      await s.logout();
    }
  }

  /** Auf einen Posteingangs-Eintrag mit Adresse antworten (SMTP der Studiomail). */
  async reply(p: Principal, sid: string, inboxId: string, text: string): Promise<unknown> {
    const c = this.config(sid);
    const item = (this.app.rt(sid).data.inbox ?? []).find((x) => x.id === inboxId);
    if (!item) throw new AppError(404, 'not_found', 'Eintrag nicht gefunden');
    if (!item.email) throw new AppError(409, 'no_email', 'Für diesen Eintrag ist keine Mail-Adresse bekannt');
    const body = text.replace(/\r/g, '').trim().slice(0, 10_000);
    if (body.length < 2) throw new AppError(400, 'empty', 'Bitte eine Antwort eingeben');
    const pass = this.app.secrets.get(this.ref(sid)) ?? '';
    if (!c.smtpHost || !c.address || !c.user || !pass) throw new AppError(409, 'not_configured', 'Zuerst die Studiomail einrichten (Postausgangs-Server, Studio-Adresse, Passwort)');
    const station = this.app.rt(sid).station.name;
    const subject = item.subject ? (/^(re|aw):/i.test(item.subject) ? item.subject : `Re: ${item.subject}`) : `Deine Nachricht an ${station}`;
    const quoteLines = (item.text ?? '').split('\n').slice(0, 20).map((l) => `> ${l}`).join('\n');
    const full = `${body}\n${c.signature ? `\n-- \n${c.signature}\n` : ''}${quoteLines ? `\n${item.name ?? 'Du'} schrieb:\n${quoteLines}\n` : ''}`;
    const headers: Record<string, string> = {};
    if (item.messageId) { headers['In-Reply-To'] = item.messageId; headers.References = item.messageId; }
    try {
      await sendMail({ host: c.smtpHost, port: c.smtpPort, secure: c.smtpSecure, user: c.user, pass, from: `${c.name || station} <${c.address}>`, to: item.name ? `${item.name} <${item.email}>` : item.email }, subject, full, 20_000, { headers, plain: c.plain });
    } catch (err) {
      throw new AppError(502, 'send_failed', `Antwort nicht gesendet: ${(err as Error).message.slice(0, 200)}`);
    }
    this.app.audit.write({ kind: 'listener', event: 'studiomail_reply', actor: p.id, stationId: sid, item: inboxId });
    return this.app.svc.listeners.noteReply(sid, inboxId, body, p.id);
  }

  /** Etwa alle zwei Minuten: neue Post abholen (Fehler stehen in lastError). */
  async tick(sid: string): Promise<void> {
    if (!this.config(sid).enabled) return;
    await this.poll(sid).catch(() => 0);
  }
}

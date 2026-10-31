// HTTP-Schicht: REST API v1, Server-Sent Events, Medien, Relay-Ingest, Studio-Dateien.
// Ohne Framework (node:http), um Ressourcen und Abhängigkeiten minimal zu halten.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync, rmSync } from 'node:fs';
import path, { extname, join, normalize, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { AnMaChaCastApp, AppError, canSee, newId, type Principal } from './app.ts';
import { ALL_SCOPES } from './model.ts';
import { AiError } from './ai/providers.ts';
import { HOST_RE, discoverLocal } from './ai/discover.ts';
import { AuthError, ROLES, ROLE_LABEL, ROLE_SCOPES, UserStore, type Role } from './users.ts';
import { MEDIA_CATEGORIES, parseFileName, type MediaCategory } from '../core/automation.ts';
import { OUTPUT_CAPABILITIES } from './icecast.ts';
import { DSP_PRESETS } from './playout.ts';
import { toIcecastXml, toM3u, toXspf, type StreamStatus } from './status.ts';
import { MAX_VOICE_BYTES } from './services/listeners.ts';
import { STUDIO_KINDS, STUDIO_TONES } from './services/ai.ts';
import { PUBLIC_API, RADIOADMIN, allowedPublicPath, allowedRadioadminPath, forward } from './lautfm.ts';
import { envVar } from './env.ts';
import { buildOpenApi, type RouteInfo } from './api/spec.ts';

type Params = Record<string, string>;
interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Params;
  p: Principal;
  body: () => Promise<Record<string, unknown>>;
}
type Handler = (c: Ctx) => unknown | Promise<unknown>;
interface Route {
  method: string;
  path: string;
  re: RegExp;
  keys: string[];
  scope: string | null;
  handler: Handler;
}

const AUDIO_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm',
};
/** MusikHub (Media & Jingle Exchange): zusätzlich Logos, Sendungsbilder und Dokumente - nur zum Teilen, nie zum Senden */
// kein SVG: würde als aktives Dokument mit Skripten im Senderkontext angezeigt (Token in der Vorschau-URL)
const HUB_EXTRA_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.zip': 'application/zip',
};
const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
/** Zusätzliche Typen für die Web-Fassungen der Cast Tools */
const TOOL_TYPES: Record<string, string> = {
  ...STATIC_TYPES, '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
const MAX_UPLOAD = 300 * 1024 * 1024;
const MAX_JSON = 1024 * 1024;
const MAX_CHUNK = 2 * 1024 * 1024;

/** Berechnet sha256 während des Schreibens mit, statt die Datei danach ein zweites Mal zu lesen. */
function hashingPassthrough(): { stream: Transform; digest: () => string } {
  const hash = createHash('sha256');
  const stream = new Transform({ transform(chunk: Buffer, _enc, cb) { hash.update(chunk); cb(null, chunk); } });
  return { stream, digest: () => hash.digest('hex') };
}

/**
 * Erlaubte Fremd-Origins (Android-App, eigene Frontends). Standard: Capacitor-WebView.
 * Erweiterbar über ANMACHA_CAST_CORS_ORIGINS (kommagetrennt) und im Studio
 * unter „Web-Fernsteuerung“ (network.json).
 */
const CORS_ORIGINS = new Set([
  'https://localhost', 'http://localhost', 'capacitor://localhost',
  // Mobil-Web-App der Projektseite (GitHub Pages, studio/mobil.html) – verbindet sich mit dem eigenen Server
  'https://ricorewioriginal-collab.github.io',
  ...String(envVar(process.env, 'CORS_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
]);

function applyCors(req: IncomingMessage, res: ServerResponse, extra: (origin: string) => boolean): boolean {
  const origin = req.headers.origin;
  if (!origin || (!CORS_ORIGINS.has(origin) && !extra(origin))) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length');
  res.setHeader('Access-Control-Max-Age', '600');
  // Chrome „Private Network Access“: Webseiten dürfen AnMaCha Cast auf diesem PC/im LAN nur nach ausdrücklicher Zustimmung erreichen
  if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
  return true;
}

/**
 * Bedienung im laufenden Sendebetrieb – bleibt auch bei ausgefallener Datenbank möglich
 * (die Änderungen liegen im Speicher und werden nachgeschrieben, sobald die Datenbank wieder antwortet).
 */
/**
 * Absenderadresse für Limits im Hörerbereich: hinter einem Reverse-Proxy (Caddy, nginx) kommt jede Anfrage von
 * derselben Socket-Adresse - dann steht die echte Adresse im X-Forwarded-For. Der Header wird nur geglaubt, wenn der
 * Betreiber ANMACHA_CAST_TRUST_PROXY=1 setzt (sonst könnte jeder Client ihn fälschen und Limits umgehen).
 */
export function clientIp(req: IncomingMessage): string {
  const trust = /^(1|true|yes)$/i.test(process.env.ANMACHA_CAST_TRUST_PROXY ?? '');
  if (trust) {
    // Der vertrauenswürdige Proxy hängt die echte Adresse ANS ENDE an (nginx: $proxy_add_x_forwarded_for);
    // ein vom Client mitgeschickter Anfang wäre frei wählbar - daher der letzte Eintrag.
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',').map((x) => x.trim()).filter(Boolean).pop();
    if (fwd) return fwd;
  }
  return String(req.socket.remoteAddress ?? '');
}

export const ON_AIR_OPS = new RegExp('^/api/v1/(?:' + [
  'stations/[^/]+/sources/[^/]+/(?:chunks|health|release|takeover)',
  'stations/[^/]+/playout/(?:mic|skip|start|stop|carts-stop|loop-advance)',
  'stations/[^/]+/(?:mode|onair)',
  'stations/[^/]+/(?:decks/[^/]+(?:/[a-z]+)?|now-playing|metadata)',
  'stations/[^/]+/queue(?:/.*)?',
  'stations/[^/]+/(?:cardwall/[^/]+/trigger|quick/[^/]+)',
  'stations/[^/]+/(?:playlists/[^/]+/play|clock-events/[^/]+/fire)',
  'stations/[^/]+/recorder/(?:start|stop)',
  'stations/[^/]+/ai/pending/[^/]+/(?:approve|reject)',
  'bridge/stations/[^/]+/now-playing',
  'auth/logout',
  'system/shutdown',
].join('|') + ')$');

/** HTTP-Server samt Routentabelle (für die API-Dokumentation und Tests). */
export type ApiServer = Server & { apiRoutes: RouteInfo[] };

export function createHttpServer(app: AnMaChaCastApp, studioDir: string): ApiServer {
  const routes: Route[] = [];
  let openapi: string | undefined;
  const add = (method: string, path: string, scope: string | null, handler: Handler) => {
    const keys: string[] = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, path, re, keys, scope, handler });
  };
  const sid = (c: Ctx) => {
    if (!canSee(c.p, c.params.sid!)) throw new AppError(403, 'forbidden', 'Kein Zugriff auf diesen Sender');
    return c.params.sid!;
  };

  // --- System ---
  add('GET', '/api/v1/me', null, (c) => ({ id: c.p.id, roles: c.p.roles, scopes: c.p.scopes, stationIds: c.p.stationIds, user: c.p.user ?? null }));

  // --- Benutzer & Anmeldung ---
  const authCall = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AuthError) throw new AppError(err.status, 'auth', err.message);
      throw err;
    }
  };
  add('POST', '/api/v1/auth/logout', null, (c) => {
    const tok = /^Bearer (.+)$/i.exec(String(c.req.headers.authorization ?? ''))?.[1];
    if (tok && c.p.user) app.users.logout(tok);
    app.audit.write({ kind: 'auth', event: 'logout', actor: c.p.id });
  });
  add('POST', '/api/v1/auth/password', null, async (c) => {
    if (!c.p.user) throw new AppError(400, 'no_user', 'Passwort ändern geht nur mit Benutzeranmeldung');
    const b = await c.body();
    const u = app.users.get(c.p.user.id)!;
    const { verifyPassword } = await import('./users.ts');
    if (!(await verifyPassword(String(b.current ?? ''), u.passwordHash))) throw new AppError(403, 'wrong_password', 'Aktuelles Passwort stimmt nicht');
    await authCall(() => app.users.update(u.id, { password: String(b.next ?? ''), mustChangePassword: false }));
    app.audit.write({ kind: 'auth', event: 'password_changed', actor: u.id });
    // alle Sitzungen wurden beendet – neu anmelden
    return authCall(() => app.users.login(u.username, String(b.next ?? ''), 'password-change'));
  });
  add('GET', '/api/v1/users', null, (c) => (globalAdmin(c), { users: app.users.list(), roles: ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r], scopes: ROLE_SCOPES[r] })) }));
  add('POST', '/api/v1/users', null, async (c) => {
    globalAdmin(c);
    const b = await c.body();
    const u = await authCall(() => app.users.create({ username: String(b.username ?? ''), name: str(b.name), password: String(b.password ?? ''), roles: b.roles, stationIds: b.stationIds, mustChangePassword: b.mustChangePassword !== false }));
    app.audit.write({ kind: 'auth', event: 'user_created', actor: c.p.id, user: u.id, roles: u.roles });
    return u;
  });
  add('PATCH', '/api/v1/users/:id', null, async (c) => {
    globalAdmin(c);
    const u = await authCall(async () => app.users.update(c.params.id!, await c.body()));
    app.audit.write({ kind: 'auth', event: 'user_updated', actor: c.p.id, user: u.id, roles: u.roles, disabled: !!u.disabled });
    return u;
  });
  add('DELETE', '/api/v1/users/:id', null, (c) => {
    globalAdmin(c);
    if (c.p.user?.id === c.params.id) throw new AppError(409, 'self', 'Das eigene Konto kann nicht gelöscht werden');
    return authCall(() => {
      app.users.remove(c.params.id!);
      app.audit.write({ kind: 'auth', event: 'user_deleted', actor: c.p.id, user: c.params.id });
    });
  });
  add('GET', '/api/v1/capabilities', null, () => ({ outputs: OUTPUT_CAPABILITIES, mediaTypes: Object.keys(AUDIO_EXT), categories: MEDIA_CATEGORIES }));
  // Aktivitäts-Log: neueste zuerst, filterbar nach Art (kind), Sender und Freitext (sucht in allen Feldern)
  add('GET', '/api/v1/audit', 'audit:read', (c) => {
    const q = c.url.searchParams;
    const kind = q.get('kind') ?? '';
    const station = q.get('station') ?? '';
    const text = (q.get('q') ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(Number(q.get('limit') ?? 100) || 100, 500));
    const rows = (app.audit.tail(500) as Record<string, unknown>[])
      .filter((e) => (!kind || e.kind === kind) && (!station || e.stationId === station) && (!text || JSON.stringify(e).toLowerCase().includes(text)));
    return rows.slice(-limit).reverse();
  });
  // Mein Profil (nur mit Benutzersitzung): Name, Social Links, eigene API-Schlüssel
  const sessionUser = (c: Ctx) => {
    if (!c.p.user) throw new AppError(404, 'no_session', 'Nur mit Benutzeranmeldung (nicht per API-Token)');
    return c.p.user;
  };
  add('GET', '/api/v1/me/profile', null, (c) => {
    const u = app.users.get(sessionUser(c).id);
    if (!u) throw new AppError(404, 'not_found', 'Benutzer nicht gefunden');
    const { passwordHash: _p, ...pub } = u;
    return pub;
  });
  add('PATCH', '/api/v1/me/profile', null, async (c) => {
    const me = sessionUser(c);
    const b = await c.body();
    return authCall(() => app.users.update(me.id, { name: b.name, links: b.links }));
  });
  add('GET', '/api/v1/me/tokens', null, (c) => { const me = sessionUser(c); return app.svc.auth.listTokens().filter((t) => t.userId === me.id); });
  add('POST', '/api/v1/me/tokens', null, async (c) => {
    const me = sessionUser(c);
    const b = await c.body();
    // nie mehr Rechte als die Sitzung selbst: Scopes werden auf die eigenen gekürzt; ein eingeschränkter Schlüssel
    // bekommt nur die Rollen, deren Rechte er vollständig abdeckt (sonst „viewer“) - kein Admin-Hintertürchen
    const mine = c.p.scopes.includes('*') ? [...ALL_SCOPES] : c.p.scopes;
    const wanted: string[] = Array.isArray(b.scopes) ? b.scopes.map(String) : mine;
    const scopes = wanted.includes('*') && c.p.scopes.includes('*') ? ['*'] : wanted.filter((s) => mine.includes(s) && s !== '*');
    if (!scopes.length) throw new AppError(400, 'no_scopes', 'Mindestens ein Recht wählen');
    const covers = (role: Role) => scopes.includes('*') || UserStore.scopesFor([role]).every((s) => scopes.includes(s));
    const roles = scopes.includes('*') ? c.p.roles : (c.p.roles as Role[]).filter(covers);
    const r = app.svc.auth.createToken({ name: str(b.name) || 'API-Key', scopes, roles: roles.length ? roles : ['viewer'], stationIds: c.p.stationIds, userId: me.id });
    app.audit.write({ kind: 'auth', event: 'apikey_created', actor: c.p.id, user: me.id, token: r.info.id, scopes });
    return r;
  });
  add('DELETE', '/api/v1/me/tokens/:id', null, (c) => {
    const me = sessionUser(c);
    const t = app.svc.auth.listTokens().find((x) => x.id === c.params.id && x.userId === me.id);
    if (!t) throw new AppError(404, 'not_found', 'Schlüssel nicht gefunden');
    app.svc.auth.revokeToken(t.id);
    app.audit.write({ kind: 'auth', event: 'apikey_revoked', actor: c.p.id, user: me.id, token: t.id });
    return { ok: true };
  });
  // Ankündigung & Wartung: lesen darf jeder Angemeldete, setzen nur Administratoren
  add('GET', '/api/v1/site', null, (c) => (c.p.roles.includes('admin') && c.p.stationIds.includes('*') ? { ...app.svc.system.siteView(), settings: app.svc.system.siteSettings() } : app.svc.system.siteView()));
  add('PUT', '/api/v1/site', null, async (c) => (globalAdmin(c), app.svc.system.setSiteSettings(await c.body())));
  add('GET', '/api/v1/tokens', 'tokens:write', () => app.svc.auth.listTokens());
  add('POST', '/api/v1/tokens', 'tokens:write', async (c) => {
    const b = await c.body();
    return app.svc.auth.createToken({ name: String(b.name ?? ''), scopes: arr(b.scopes), roles: arr(b.roles), stationIds: arr(b.stationIds) });
  });
  add('DELETE', '/api/v1/tokens/:id', 'tokens:write', (c) => app.svc.auth.revokeToken(c.params.id!));

  // --- Sender / Branding ---
  add('GET', '/api/v1/stations', 'branding:read', (c) => app.svc.stations.listStations(c.p));
  add('GET', '/api/v1/network', 'branding:read', (c) => app.svc.stations.network(c.p));
  add('POST', '/api/v1/stations', 'stations:write', async (c) => {
    const b = await c.body();
    if (!c.p.stationIds.includes('*')) throw new AppError(403, 'forbidden', 'Nur globale Admins legen Sender an');
    return app.svc.stations.createStation({ id: String(b.id ?? ''), name: String(b.name ?? ''), slogan: str(b.slogan), primaryColor: str(b.primaryColor), accentColor: str(b.accentColor) }, b.withDefaultSources !== false);
  });
  add('GET', '/api/v1/stations/:sid', 'branding:read', (c) => app.svc.stations.station(sid(c)));
  add('PATCH', '/api/v1/stations/:sid', 'stations:write', async (c) => app.svc.stations.updateStation(sid(c), await c.body()));
  add('DELETE', '/api/v1/stations/:sid', 'stations:write', (c) => {
    if (!c.p.stationIds.includes('*')) throw new AppError(403, 'forbidden', 'Nur globale Admins löschen Sender');
    app.svc.stations.deleteStation(c.p, sid(c));
  });
  add('PUT', '/api/v1/stations/:sid/logo', 'stations:write', async (c) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const d of c.req) {
      size += (d as Buffer).length;
      if (size > 2 * 1024 * 1024) throw new AppError(413, 'too_large', 'Logo höchstens 2 MB');
      chunks.push(d as Buffer);
    }
    return app.svc.stations.setStationLogo(sid(c), String(c.req.headers['content-type'] ?? ''), Buffer.concat(chunks));
  });
  add('DELETE', '/api/v1/stations/:sid/logo', 'stations:write', (c) => app.svc.stations.removeStationLogo(sid(c)));

  // --- Quellen / Source Priority ---
  add('GET', '/api/v1/stations/:sid/sources', 'sources:read', (c) => app.listSources(sid(c)));
  add('POST', '/api/v1/stations/:sid/sources', 'sources:write', async (c) => app.addSource(c.p, sid(c), (await c.body()) as never));
  add('PATCH', '/api/v1/stations/:sid/sources/:id', 'sources:write', async (c) => app.updateSource(c.p, sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/sources/:id', 'sources:write', (c) => app.removeSource(c.p, sid(c), c.params.id!));
  add('POST', '/api/v1/stations/:sid/sources/:id/password', 'sources:write', async (c) => app.setSourcePassword(c.p, sid(c), c.params.id!, String((await c.body()).password ?? '')));
  add('POST', '/api/v1/stations/:sid/sources/:id/takeover', 'sources:write', async (c) => app.takeover(c.p, sid(c), c.params.id!, (await c.body()).force === true));
  add('POST', '/api/v1/stations/:sid/sources/:id/release', 'sources:write', (c) => app.release(c.p, sid(c), c.params.id!));
  add('POST', '/api/v1/stations/:sid/sources/:id/health', 'sources:write', async (c) => {
    const b = await c.body();
    app.reportHealth(sid(c), c.params.id!, b.healthy === true, str(b.reason));
  });
  add('POST', '/api/v1/stations/:sid/sources/:id/chunks', 'sources:write', async (c) => {
    const chunk = await readRaw(c.req, MAX_CHUNK);
    const type = String(c.req.headers['content-type'] ?? 'audio/webm').split(';')[0]!.trim();
    if (!/^audio\/[a-z0-9.+-]+$/i.test(type)) throw new AppError(400, 'invalid_type', 'Ungültiger Content-Type');
    app.studioChunk(c.p, sid(c), c.params.id!, type, chunk, c.url.searchParams.get('start') === '1');
  });

  // --- Ausgänge (Broadcast Adapter) ---
  add('GET', '/api/v1/stations/:sid/outputs', 'outputs:read', (c) => app.listOutputs(sid(c)));
  add('POST', '/api/v1/stations/:sid/outputs', 'outputs:write', async (c) => app.saveOutput(c.p, sid(c), null, await c.body()));
  add('PATCH', '/api/v1/stations/:sid/outputs/:id', 'outputs:write', async (c) => app.saveOutput(c.p, sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/outputs/:id', 'outputs:write', (c) => app.removeOutput(c.p, sid(c), c.params.id!));
  // Verbreitung: bis zu 2 eigene Mount-Streams mit eigener Bitrate (Profil + Ausgang in einem Schritt)
  add('GET', '/api/v1/stations/:sid/own-streams', 'outputs:read', (c) => app.svc.distribution.list(sid(c)));
  add('POST', '/api/v1/stations/:sid/own-streams', 'outputs:write', async (c) => app.svc.distribution.create(c.p, sid(c), await c.body()));
  add('PATCH', '/api/v1/stations/:sid/own-streams/:id', 'outputs:write', async (c) => app.svc.distribution.update(c.p, sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/own-streams/:id', 'outputs:write', (c) => { app.svc.distribution.remove(c.p, sid(c), c.params.id!); return { ok: true }; });

  // --- Zusatz-Streams: weitere Stream-Profile (ein Programmbus, mehrere Encoder-Ausgänge) ---
  add('GET', '/api/v1/stations/:sid/stream-profiles', 'outputs:read', (c) => app.listStreamProfiles(sid(c)));
  add('POST', '/api/v1/stations/:sid/stream-profiles', 'outputs:write', async (c) => app.saveStreamProfile(c.p, sid(c), null, await c.body()));
  add('PATCH', '/api/v1/stations/:sid/stream-profiles/:id', 'outputs:write', async (c) => app.saveStreamProfile(c.p, sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/stream-profiles/:id', 'outputs:write', (c) => app.removeStreamProfile(c.p, sid(c), c.params.id!));

  // --- Medien ---
  add('GET', '/api/v1/stations/:sid/media', 'media:read', (c) => app.svc.media.library(sid(c)));
  add('PUT', '/api/v1/stations/:sid/media', 'media:write', async (c) => {
    const s = sid(c);
    const name = String(c.url.searchParams.get('name') ?? '').slice(0, 200);
    const ext = extname(name).toLowerCase();
    if (!AUDIO_EXT[ext]) throw new AppError(415, 'unsupported_media', `Dateityp nicht unterstützt (${Object.keys(AUDIO_EXT).join(', ')})`);
    const catParam = c.url.searchParams.get('category') ?? 'music';
    const category = (MEDIA_CATEGORIES as readonly string[]).includes(catParam) ? (catParam as MediaCategory) : 'music';
    const id = newId('m');
    const file = `${id}${ext}`;
    const target = join(app.mediaDir, s, file);
    const len = Number(c.req.headers['content-length'] ?? 0);
    if (len > MAX_UPLOAD) throw new AppError(413, 'too_large', 'Datei zu groß');
    let size = 0;
    c.req.on('data', (d: Buffer) => {
      size += d.length;
      if (size > MAX_UPLOAD) c.req.destroy(new Error('too_large'));
    });
    try {
      await pipeline(c.req, createWriteStream(target, { mode: 0o644 }));
    } catch {
      rmSync(target, { force: true });
      throw new AppError(413, 'upload_failed', 'Upload abgebrochen oder zu groß');
    }
    const meta = parseFileName(name);
    const folder = (c.url.searchParams.get('folder') ?? '').trim().slice(0, 80) || undefined;
    return app.svc.media.addMedia(s, { id, title: meta.title || name, artist: meta.artist, category, file, durationMs: null, addedAt: Date.now(), folder, originalName: name.replace(/^.*[\\/]/, '') });
  });
  add('PATCH', '/api/v1/stations/:sid/media/:id', 'media:write', async (c) => app.svc.media.updateMedia(sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/media/:id', 'media:write', (c) => app.svc.media.removeMedia(sid(c), c.params.id!));
  add('GET', '/api/v1/stations/:sid/media/:id/file', 'media:read', (c) => {
    const s = sid(c);
    const m = app.svc.media.media(s, c.params.id!);
    if (m.url) {
      c.res.writeHead(302, { Location: m.url });
      c.res.end();
      return STREAMED;
    }
    sendFile(c.req, c.res, app.svc.media.mediaPath(s, m), AUDIO_EXT[extname(m.file)] ?? 'application/octet-stream');
    return STREAMED;
  });

  // --- MusikHub Phase 1: geschlossener Katalog, Sammlungen und explizite Grants ---
  // Die Sender-Medien-Dateiroute oben bleibt sendergebunden. Ein Hub-Grant gibt
  // hier ausschließlich Katalogrechte frei, keine implizite Datei-URL.
  add('GET', '/api/v1/music-hub/items', 'media:read', (c) => app.svc.musikhub.listItems(
    c.p, String(c.url.searchParams.get('station') ?? ''), String(c.url.searchParams.get('q') ?? ''),
    Number(c.url.searchParams.get('offset') ?? 0), Number(c.url.searchParams.get('limit') ?? 50),
  ));
  add('POST', '/api/v1/music-hub/items', 'media:write', async (c) => {
    const b = await c.body();
    return app.svc.musikhub.registerStationMedia(c.p, String(b.stationId ?? ''), String(b.mediaId ?? ''));
  });
  add('GET', '/api/v1/music-hub/collections', 'media:read', (c) => app.svc.musikhub.listCollections(c.p, String(c.url.searchParams.get('station') ?? '')));
  add('GET', '/api/v1/music-hub/recipients', 'media:write', (c) => app.svc.musikhub.recipients(c.p, String(c.url.searchParams.get('q') ?? '')));
  add('POST', '/api/v1/music-hub/collections', 'media:write', async (c) => {
    const b = await c.body();
    return app.svc.musikhub.createCollection(c.p, b.owner, b.name);
  });
  add('PUT', '/api/v1/music-hub/collections/:id/items', 'media:write', async (c) => {
    const b = await c.body();
    return app.svc.musikhub.setCollectionItems(c.p, c.params.id!, b.itemIds, b.revision, String(b.stationId ?? ''));
  });
  add('GET', '/api/v1/music-hub/:kind/:id/grants', 'media:write', (c) => {
    if (c.params.kind !== 'item' && c.params.kind !== 'collection') throw new AppError(404, 'not_found', 'Ressource nicht gefunden');
    return app.svc.musikhub.listGrants(c.p, { kind: c.params.kind, id: c.params.id! }, String(c.url.searchParams.get('station') ?? ''));
  });
  add('POST', '/api/v1/music-hub/:kind/:id/grants', 'media:write', async (c) => {
    if (c.params.kind !== 'item' && c.params.kind !== 'collection') throw new AppError(404, 'not_found', 'Ressource nicht gefunden');
    const b = await c.body();
    return app.svc.musikhub.createGrant(c.p, { kind: c.params.kind, id: c.params.id! }, b.recipient, b.actions, b.targetStationIds, String(b.stationId ?? ''), b.expiresAt);
  });
  add('DELETE', '/api/v1/music-hub/grants/:id', 'media:write', async (c) => app.svc.musikhub.revokeGrant(c.p, c.params.id!, String(c.url.searchParams.get('station') ?? '')));
  // Privater Upload: landet nie in einem Senderarchiv, Eigentümer ist ausschließlich der hochladende
  // Nutzer. Direkt an den vorgesehenen Zielpfad streamen (keine Zwischenkopie im Speicher).
  add('GET', '/api/v1/music-hub/uploads/quota', 'media:write', (c) => app.svc.musikhub.uploadQuota(c.p));
  // Nachvollziehbare eigene Aktivität (Upload/Ersetzen/Löschen/Freigaben/...) aus dem bestehenden Audit-Log.
  add('GET', '/api/v1/music-hub/transfers', 'media:write', (c) => app.svc.musikhub.myTransfers(c.p));
  add('PUT', '/api/v1/music-hub/uploads', 'media:write', async (c) => {
    const name = String(c.url.searchParams.get('name') ?? '').slice(0, 200);
    const ext = extname(name).toLowerCase();
    const hubType = AUDIO_EXT[ext] ?? HUB_EXTRA_EXT[ext];
    if (!hubType) throw new AppError(415, 'unsupported_media', `Dateityp nicht unterstützt (${[...Object.keys(AUDIO_EXT), ...Object.keys(HUB_EXTRA_EXT)].join(', ')})`);
    const len = Number(c.req.headers['content-length'] ?? 0);
    if (len > MAX_UPLOAD) throw new AppError(413, 'too_large', 'Datei zu groß');
    // Vorabprüfung anhand der Kontingent-Zahlen von vor dem Stream-Start: spart Bandbreite bei einem
    // von vornherein aussichtslosen Upload. Die maßgebliche Prüfung folgt in registerUpload().
    const quota = app.svc.musikhub.uploadQuota(c.p);
    if (len > 0 && quota.usedBytes + len > quota.quotaBytes) throw new AppError(413, 'quota_exceeded', `Speicherkontingent überschritten (${Math.round(quota.quotaBytes / 1024 / 1024)} MB)`);
    const { id, file, absolutePath } = app.svc.musikhub.preparePrivateUpload(c.p, ext);
    let size = 0;
    c.req.on('data', (d: Buffer) => {
      size += d.length;
      if (size > MAX_UPLOAD || quota.usedBytes + size > quota.quotaBytes) c.req.destroy(new Error('too_large'));
    });
    const hasher = hashingPassthrough();
    try {
      await pipeline(c.req, hasher.stream, createWriteStream(absolutePath, { mode: 0o600 }));
    } catch {
      app.svc.musikhub.discardUpload(c.p.user?.id ?? c.p.id, file);
      throw new AppError(413, 'upload_failed', 'Upload abgebrochen, Kontingent überschritten oder zu groß');
    }
    const meta = AUDIO_EXT[ext] ? parseFileName(name) : { title: name.replace(/\.[^.]+$/, ''), artist: '' };
    return app.svc.musikhub.registerUpload(c.p, id, file, hubType, size, hasher.digest(), meta.title || name, meta.artist);
  });
  add('DELETE', '/api/v1/music-hub/items/:id', 'media:write', async (c) => app.svc.musikhub.deleteItem(c.p, c.params.id!, String(c.url.searchParams.get('station') ?? '')));
  // Sendefähigkeits-Preflight (Phase 4, erster Schritt): reine Prüfung, ob ein Hub-Titel für den Sender
  // sendefähig ist - noch kein Wiring in Queue/Planung/Cardwall, das folgt separat.
  add('GET', '/api/v1/music-hub/items/:id/preflight', 'media:read', (c) => app.svc.musikhub.broadcastPreflight(c.p, c.params.id!, String(c.url.searchParams.get('station') ?? '')));
  // lautCast-Capability-Prüfung (Phase 5, erster Schritt): stellt nur fest, ob eine Übertragung an
  // laut.fm für den Zielsender überhaupt möglich wäre (Berechtigung + laut.fm-Verbindung) - noch kein
  // Trackmapping/Upload, siehe Kommentar an lautcastCapability().
  add('GET', '/api/v1/music-hub/items/:id/lautcast-capability', 'media:read', (c) => app.svc.musikhub.lautcastCapability(c.p, c.params.id!, String(c.url.searchParams.get('station') ?? '')));
  // lautCast-Übertragung (Phase 5, zweiter Schritt): tatsächlicher Upload zu laut.fm - siehe Kommentar an lautcastTransfer().
  add('POST', '/api/v1/music-hub/items/:id/lautcast-transfer', 'media:write', async (c) => {
    const b = await c.body();
    const playlistId = b.playlistId === undefined || b.playlistId === null || b.playlistId === '' ? undefined : Number(b.playlistId);
    return app.svc.musikhub.lautcastTransfer(c.p, c.params.id!, String(b.station ?? ''), Number.isFinite(playlistId) ? playlistId : undefined);
  });
  // Bereitstellung (Phase 4, zweiter Schritt): kontrolliertes Kopieren eines eigenen privaten Uploads in
  // ein Senderarchiv, als neuer sendergebundener Hub-Eintrag - siehe Kommentar an stageToStation().
  add('POST', '/api/v1/music-hub/items/:id/stage', 'media:write', async (c) => app.svc.musikhub.stageToStation(c.p, c.params.id!, String((await c.body()).station ?? '')));
  // Neue Version einer bestehenden privaten Upload-Datei: Item-ID, Eigentümer, Sammlungsmitgliedschaften
  // und Freigaben bleiben erhalten, nur die Quelldatei wird ausgetauscht (Quellen-/Versionsmodell).
  add('PUT', '/api/v1/music-hub/items/:id/replace', 'media:write', async (c) => {
    const stationId = String(c.url.searchParams.get('station') ?? '');
    const name = String(c.url.searchParams.get('name') ?? '').slice(0, 200);
    const ext = extname(name).toLowerCase();
    const hubType = AUDIO_EXT[ext] ?? HUB_EXTRA_EXT[ext];
    if (!hubType) throw new AppError(415, 'unsupported_media', `Dateityp nicht unterstützt (${[...Object.keys(AUDIO_EXT), ...Object.keys(HUB_EXTRA_EXT)].join(', ')})`);
    const len = Number(c.req.headers['content-length'] ?? 0);
    if (len > MAX_UPLOAD) throw new AppError(413, 'too_large', 'Datei zu groß');
    const { file, absolutePath, oldSizeBytes } = app.svc.musikhub.prepareReplaceUpload(c.p, c.params.id!, stationId, ext);
    // Vorabprüfung wie beim Erst-Upload, aber um die durch das Ersetzen freiwerdende alte Größe bereinigt -
    // die maßgebliche Prüfung folgt weiterhin in replaceUpload().
    const quota = app.svc.musikhub.uploadQuota(c.p);
    const budget = quota.quotaBytes - (quota.usedBytes - oldSizeBytes);
    if (len > 0 && len > budget) throw new AppError(413, 'quota_exceeded', `Speicherkontingent überschritten (${Math.round(quota.quotaBytes / 1024 / 1024)} MB)`);
    let size = 0;
    c.req.on('data', (d: Buffer) => {
      size += d.length;
      if (size > MAX_UPLOAD || size > budget) c.req.destroy(new Error('too_large'));
    });
    const hasher = hashingPassthrough();
    try {
      await pipeline(c.req, hasher.stream, createWriteStream(absolutePath, { mode: 0o600 }));
    } catch {
      app.svc.musikhub.discardUpload(c.p.user?.id ?? c.p.id, file);
      throw new AppError(413, 'upload_failed', 'Upload abgebrochen, Kontingent überschritten oder zu groß');
    }
    return app.svc.musikhub.replaceUpload(c.p, c.params.id!, stationId, file, hubType, size, hasher.digest());
  });
  // Eigene (persönliche) Nextcloud-Quelle für "Mein Archiv" - getrennt vom bestehenden globalen
  // Sender-Nextcloud-Import (/api/v1/nextcloud). Kein geteiltes Konto, keine unbegrenzten Vollscans.
  add('GET', '/api/v1/music-hub/nextcloud', 'media:write', (c) => app.svc.musikhub.nextcloudSource(c.p));
  add('PUT', '/api/v1/music-hub/nextcloud', 'media:write', async (c) => app.svc.musikhub.setNextcloudSource(c.p, await c.body()));
  add('GET', '/api/v1/music-hub/nextcloud/list', 'media:write', (c) => app.svc.musikhub.nextcloudList(c.p, c.url.searchParams.get('path') ?? '/'));
  add('POST', '/api/v1/music-hub/nextcloud/import', 'media:write', async (c) => app.svc.musikhub.nextcloudImportFiles(c.p, (await c.body()).paths));
  // Rekursiver Ordner-Import, begrenzt auf MAX_FOLDER_IMPORT_FILES/-Tiefe - kein unbegrenzter Vollscan.
  add('POST', '/api/v1/music-hub/nextcloud/import-folder', 'media:write', async (c) => app.svc.musikhub.nextcloudImportFolder(c.p, (await c.body()).path));
  // Derselbe Ordner-Import als Hintergrundjob (Status/Neustart statt blockierender Antwort) - Paket 09, erster Schritt.
  add('POST', '/api/v1/music-hub/nextcloud/import-folder-job', 'media:write', async (c) => app.svc.musikhub.startNextcloudImportJob(c.p, (await c.body()).path));
  add('GET', '/api/v1/music-hub/nextcloud/jobs', 'media:write', (c) => app.svc.musikhub.listImportJobs(c.p));
  add('POST', '/api/v1/music-hub/nextcloud/jobs/:id/restart', 'media:write', async (c) => app.svc.musikhub.restartImportJob(c.p, c.params.id!));
  add('GET', '/api/v1/music-hub/items/:id/preview', 'media:read', (c) => {
    const { path, mimeType, title } = app.svc.musikhub.resolveFile(c.p, c.params.id!, String(c.url.searchParams.get('station') ?? ''), 'preview.play');
    void title;
    c.res.setHeader('Content-Disposition', 'inline');
    sendFile(c.req, c.res, path, mimeType || AUDIO_EXT[extname(path)] || 'application/octet-stream');
    return STREAMED;
  });
  add('GET', '/api/v1/music-hub/items/:id/download', 'media:read', (c) => {
    const { path, mimeType, title } = app.svc.musikhub.resolveFile(c.p, c.params.id!, String(c.url.searchParams.get('station') ?? ''), 'file.download');
    c.res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/["\r\n]/g, '_')}${extname(path)}"`);
    sendFile(c.req, c.res, path, mimeType || AUDIO_EXT[extname(path)] || 'application/octet-stream');
    return STREAMED;
  });
  add('GET', '/api/v1/music-hub/items/:id/cover', 'media:read', async (c) => {
    const file = await app.svc.musikhub.cover(c.p, c.params.id!, String(c.url.searchParams.get('station') ?? ''));
    if (!file) throw new AppError(404, 'no_cover', 'Kein Cover');
    c.res.setHeader('Cache-Control', 'private, max-age=86400');
    sendFile(c.req, c.res, file, 'image/jpeg');
    return STREAMED;
  });

  // --- Queue / Automation / Decks ---
  add('GET', '/api/v1/stations/:sid/queue', 'queue:read', (c) => app.queueView(sid(c), Number(c.url.searchParams.get('remainingMs') ?? 0)));
  add('POST', '/api/v1/stations/:sid/queue', 'queue:write', async (c) => {
    const b = await c.body();
    app.queueAdd(sid(c), String(b.mediaId ?? ''), typeof b.index === 'number' ? b.index : undefined);
  });
  add('POST', '/api/v1/stations/:sid/queue/next', 'queue:write', (c) => ({ media: app.queueNext(sid(c)) }));
  add('POST', '/api/v1/stations/:sid/queue/fill', 'queue:write', (c) => app.queueFill(sid(c)));
  add('POST', '/api/v1/stations/:sid/queue/clear', 'queue:write', (c) => app.queueClear(sid(c)));
  add('POST', '/api/v1/stations/:sid/queue/:uid/move', 'queue:write', async (c) => app.queueMove(sid(c), c.params.uid!, Number((await c.body()).index)));
  add('DELETE', '/api/v1/stations/:sid/queue/:uid', 'queue:write', (c) => app.queueRemove(sid(c), c.params.uid!));
  add('GET', '/api/v1/stations/:sid/automation', 'automation:read', (c) => app.automationView(sid(c)));
  add('PATCH', '/api/v1/stations/:sid/automation', 'automation:write', async (c) => app.setAutomation(sid(c), (await c.body()) as never));
  add('GET', '/api/v1/stations/:sid/now-playing', 'now_playing:read', (c) => app.nowPlaying(sid(c)));
  // Wer automatisiert diesen Sender tatsächlich (AnMaCha-Cast-Server-Playout oder laut.fm über den
  // Radioadmin)? Das Studio zeigt bei laut.fm den echten aktuellen Titel statt leerer Decks.
  add('GET', '/api/v1/stations/:sid/automation-source', 'now_playing:read', (c) => app.svc.status.automationSource(sid(c)));
  add('POST', '/api/v1/stations/:sid/now-playing', 'automation:write', async (c) => {
    const b = await c.body();
    return app.setNowPlaying(sid(c), String(b.mediaId ?? ''), String(b.deck ?? 'A') as never);
  });
  add('GET', '/api/v1/stations/:sid/decks', 'automation:read', (c) => app.decks(sid(c)));
  add('POST', '/api/v1/stations/:sid/decks/:deck/:action', 'automation:write', async (c) => app.deckAction(c.p, sid(c), c.params.deck!, c.params.action!, await c.body()));
  add('PUT', '/api/v1/stations/:sid/decks/:deck', 'automation:write', async (c) => app.setDeck(sid(c), c.params.deck!, (await c.body()) as never));

  // --- Server-Playout (24/7) ---
  add('GET', '/api/v1/stations/:sid/playout', 'automation:read', (c) => app.playoutView(sid(c)));
  add('PATCH', '/api/v1/stations/:sid/playout', 'automation:write', async (c) => {
    app.savePlayoutConfig(sid(c), (await c.body()) as never);
    return app.playoutView(sid(c));
  });
  add('POST', '/api/v1/stations/:sid/playout/start', 'automation:write', async (c) => app.startPlayout(c.p, sid(c), (await c.body()) as never));
  add('POST', '/api/v1/stations/:sid/playout/stop', 'automation:write', (c) => app.stopPlayout(c.p, sid(c)));
  add('POST', '/api/v1/stations/:sid/playout/mic', 'automation:write', async (c) => app.setMic(sid(c), (await c.body()).on === true));
  add('POST', '/api/v1/stations/:sid/stream-profiles-test', 'automation:write', (c) => app.runAnMaChaCastTest(sid(c)));
  // Zustandsberichte (angemeldet): Laufzeit, Abhängigkeiten, Datenbank, Audio, Encoder, Stream, KI
  add('GET', '/api/v1/system', null, () => ({ ...(app.svc.system.system() as object), ...app.health.system() }));
  add('GET', '/api/v1/database', null, () => app.databaseReport());
  add('GET', '/api/v1/audio', null, () => app.health.audio());
  add('GET', '/api/v1/encoder', null, (c) => app.health.encoder((s) => canSee(c.p, s)));
  add('GET', '/api/v1/stream', null, (c) => app.health.stream((s) => canSee(c.p, s)));
  add('GET', '/api/v1/ai', 'ai:read', () => app.health.ai());
  add('POST', '/api/v1/stations/:sid/playout/carts-stop', 'cardwall:trigger', (c) => app.stopCarts(sid(c)));
  add('POST', '/api/v1/stations/:sid/playout/loop-advance', 'cardwall:trigger', async (c) => app.advanceLoop(sid(c), str((await c.body()).mediaId)));
  add('POST', '/api/v1/stations/:sid/quick/:category', 'cardwall:trigger', async (c) => app.quickTrigger(sid(c), c.params.category!, str((await c.body()).mode)));
  add('GET', '/api/v1/stations/:sid/media/:id/cover', 'media:read', async (c) => {
    const file = await app.svc.media.cover(sid(c), c.params.id!);
    if (!file) throw new AppError(404, 'no_cover', 'Kein Cover');
    c.res.setHeader('Cache-Control', 'private, max-age=86400');
    sendFile(c.req, c.res, file, 'image/jpeg');
    return STREAMED;
  });
  add('GET', '/api/v1/stations/:sid/media/:id/waveform', 'media:read', async (c) => ({ peaks: await app.svc.media.waveform(sid(c), c.params.id!) }));
  // Voice Studio: Vorschau (Audio) bzw. als neuen Titel speichern
  add('POST', '/api/v1/stations/:sid/media/:id/voice-edit', 'media:write', async (c) => {
    const body = (await c.body()) as Record<string, unknown>;
    if (body.preview) {
      const file = await app.svc.voice.preview(sid(c), c.params.id!, body as never);
      c.res.setHeader('Cache-Control', 'no-store');
      sendFile(c.req, c.res, file, 'audio/mpeg');
      return STREAMED;
    }
    return app.svc.voice.save(sid(c), c.params.id!, body as never);
  });
  add('GET', '/api/v1/audio-devices', 'automation:read', () => app.inputDevices());
  add('POST', '/api/v1/stations/:sid/queue/shuffle', 'queue:write', (c) => app.shuffleQueue(sid(c)));
  add('POST', '/api/v1/stations/:sid/playout/skip', 'automation:write', (c) => app.skipPlayout(sid(c)));
  // Mode-Manager: AUTO/MANUAL setzt der Operator; LIVE/EMERGENCY ergeben sich aus dem Sendezustand
  add('GET', '/api/v1/stations/:sid/mode', 'automation:read', (c) => app.modeView(sid(c)));
  add('PUT', '/api/v1/stations/:sid/mode', 'automation:write', async (c) => app.setBaseMode(c.p, sid(c), String((await c.body()).mode ?? '')));
  add('POST', '/api/v1/stations/:sid/onair', 'automation:write', async (c) => app.playNow(c.p, sid(c), String((await c.body()).mediaId ?? '')));

  // --- Ordner, URL-Streams, M3U, Titelanzeige, Verlauf ---
  add('GET', '/api/v1/stations/:sid/folders', 'media:read', (c) => app.svc.media.folders(sid(c)));
  add('GET', '/api/v1/stations/:sid/media/integrity', 'media:read', (c) => app.svc.media.integrityCheck(sid(c)));
  add('POST', '/api/v1/stations/:sid/media/:id/relink', 'media:write', async (c) => app.svc.media.relinkMedia(sid(c), c.params.id!, String((await c.body()).file ?? '')));
  add('POST', '/api/v1/stations/:sid/media/url', 'media:write', async (c) => app.svc.media.addUrlMedia(sid(c), (await c.body()) as never));
  add('POST', '/api/v1/stations/:sid/queue/fill-from', 'queue:write', async (c) => ({ added: app.queueFillFrom(sid(c), (await c.body()) as never) }));
  add('GET', '/api/v1/stations/:sid/queue.m3u', 'queue:read', (c) => {
    const text = app.svc.media.exportQueueM3U(sid(c));
    c.res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl; charset=utf-8', 'Content-Disposition': 'attachment; filename="anmachacast-queue.m3u"' });
    c.res.end(text);
    return STREAMED;
  });
  add('POST', '/api/v1/stations/:sid/m3u/import', 'queue:write', async (c) => {
    const b = await c.body();
    return app.svc.media.importM3U(sid(c), String(b.text ?? ''), { playlistName: typeof b.playlistName === 'string' && b.playlistName ? b.playlistName : undefined });
  });
  add('POST', '/api/v1/stations/:sid/metadata', 'automation:write', async (c) => {
    const b = await c.body();
    app.sendMetadata(sid(c), String(b.artist ?? ''), String(b.title ?? ''));
  });
  add('GET', '/api/v1/stations/:sid/history', 'now_playing:read', (c) => app.history(sid(c), Number(c.url.searchParams.get('limit') ?? 200)));

  // --- Playlists ---
  add('GET', '/api/v1/stations/:sid/playlists', 'queue:read', (c) => app.svc.planning.playlists(sid(c)));
  add('POST', '/api/v1/stations/:sid/playlists', 'queue:write', async (c) => {
    const b = await c.body();
    return b.fromQueue === true ? app.svc.planning.saveQueueAsPlaylist(sid(c), String(b.name ?? 'Playlist')) : app.svc.planning.savePlaylist(sid(c), null, b);
  });
  add('PATCH', '/api/v1/stations/:sid/playlists/:id', 'queue:write', async (c) => app.svc.planning.savePlaylist(sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/playlists/:id', 'queue:write', (c) => app.svc.planning.deletePlaylist(sid(c), c.params.id!));
  add('POST', '/api/v1/stations/:sid/playlists/:id/play', 'automation:write', (c) => app.svc.planning.playPlaylist(sid(c), c.params.id!));
  add('POST', '/api/v1/stations/:sid/playlists/:id/shuffle', 'queue:write', (c) => app.svc.planning.reshufflePlaylist(sid(c), c.params.id!));

  // --- Smart Blocks & Allgemeine Rotation ---
  add('GET', '/api/v1/stations/:sid/smart-blocks', 'queue:read', (c) => app.svc.planning.smartBlocks(sid(c)));
  add('POST', '/api/v1/stations/:sid/smart-blocks', 'queue:write', async (c) => app.svc.planning.saveSmartBlock(sid(c), null, await c.body()));
  add('POST', '/api/v1/stations/:sid/smart-blocks/preview', 'queue:read', async (c) => app.svc.planning.previewSmartBlock(sid(c), await c.body()));
  add('PATCH', '/api/v1/stations/:sid/smart-blocks/:id', 'queue:write', async (c) => app.svc.planning.saveSmartBlock(sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/smart-blocks/:id', 'queue:write', (c) => app.svc.planning.deleteSmartBlock(sid(c), c.params.id!));
  add('POST', '/api/v1/stations/:sid/smart-blocks/:id/playlist', 'queue:write', async (c) => { const b = await c.body(); return app.svc.planning.smartBlockToPlaylist(sid(c), c.params.id!, b.snapshot === true, str(b.name)); });
  add('GET', '/api/v1/stations/:sid/rotation-pool', 'queue:read', (c) => app.svc.planning.rotationPool(sid(c)));
  add('PUT', '/api/v1/stations/:sid/rotation-pool', 'automation:write', async (c) => app.svc.planning.setRotationPool(sid(c), await c.body()));

  // --- Playlist-Lifehacks ---
  add('GET', '/api/v1/stations/:sid/lifehacks/health', 'queue:read', (c) => app.svc.lifehacks.healthCheck(sid(c)));
  add('GET', '/api/v1/stations/:sid/lifehacks/runtime/:id', 'queue:read', (c) => app.svc.lifehacks.runtime(sid(c), c.params.id!, Number(c.url.searchParams.get('adBufferPct') ?? 0)));
  add('POST', '/api/v1/stations/:sid/lifehacks/merge', 'queue:write', async (c) => {
    const b = await c.body();
    return app.svc.lifehacks.merge(sid(c), String(b.targetId ?? ''), String(b.sourceId ?? ''));
  });
  add('POST', '/api/v1/stations/:sid/lifehacks/top-tracks', 'queue:write', async (c) => {
    const b = await c.body();
    return app.svc.lifehacks.topTracksPlaylist(sid(c), { n: Number(b.n), name: typeof b.name === 'string' ? b.name : undefined, hours: Number(b.hours) });
  });
  add('POST', '/api/v1/stations/:sid/lifehacks/mass-tag', 'media:write', async (c) => {
    const b = await c.body();
    return app.svc.lifehacks.massTag(sid(c), String(b.playlistId ?? ''), Array.isArray(b.tags) ? b.tags.map(String) : [], b.mode === 'remove' ? 'remove' : 'add');
  });
  add('GET', '/api/v1/stations/:sid/lifehacks/analyze/:id', 'queue:read', (c) => app.svc.lifehacks.analyze(sid(c), c.params.id!));
  add('GET', '/api/v1/stations/:sid/lifehacks/find', 'media:read', (c) => app.svc.lifehacks.trackFinder(sid(c), c.url.searchParams.get('q') ?? ''));
  add('POST', '/api/v1/stations/:sid/lifehacks/fill-year', 'media:write', async (c) => {
    const b = await c.body();
    return app.svc.lifehacks.fillYear(sid(c), String(b.playlistId ?? ''), Number(b.year));
  });
  add('GET', '/api/v1/stations/:sid/lifehacks/compare', 'queue:read', (c) => app.svc.lifehacks.compare(sid(c), c.url.searchParams.get('a') ?? '', c.url.searchParams.get('b') ?? ''));
  add('POST', '/api/v1/stations/:sid/lifehacks/delete-many', 'queue:write', async (c) => {
    const b = await c.body();
    return app.svc.lifehacks.deleteMany(sid(c), Array.isArray(b.ids) ? b.ids.map(String) : []);
  });

  // --- Planung: Zeitplan, Stunden-Uhr, Sendeplan ---
  add('GET', '/api/v1/stations/:sid/planning', 'schedule:read', (c) => app.svc.planning.planning(sid(c)));
  add('GET', '/api/v1/stations/:sid/preflight', 'schedule:read', (c) => app.svc.planning.preflight(sid(c)));
  add('POST', '/api/v1/stations/:sid/jobs', 'automation:write', async (c) => app.svc.planning.saveJob(sid(c), await c.body()));
  add('DELETE', '/api/v1/stations/:sid/jobs/:id', 'automation:write', (c) => app.svc.planning.deleteJob(sid(c), c.params.id!));
  // --- Nachrichten & Wetter (laut.fm) ---
  add('GET', '/api/v1/stations/:sid/news', 'media:read', (c) => app.svc.news.summary(sid(c)));
  add('PATCH', '/api/v1/stations/:sid/news', 'automation:write', async (c) => app.svc.news.saveConfig(sid(c), await c.body()));
  add('POST', '/api/v1/stations/:sid/news/:id/fetch', 'automation:write', async (c) => { const m = await app.svc.news.latest(sid(c), Number(c.params.id) as 1 | 2 | 3, true); return { ok: true, t: m.t, changedAt: m.changedAt, bytes: m.bytes }; });
  add('GET', '/api/v1/stations/:sid/news/:id/file', 'media:read', async (c) => {
    const path = await app.svc.news.filePath(sid(c), Number(c.params.id) as 1 | 2 | 3);
    if (c.url.searchParams.get('dl') === '1') c.res.setHeader('Content-Disposition', `attachment; filename="${['', 'nachrichten-wetter', 'nachrichten', 'wetter'][Number(c.params.id)]}-${new Date().toISOString().slice(0, 13).replace('T', '_')}00.mp3"`);
    sendFile(c.req, c.res, path, 'audio/mpeg');
    return STREAMED;
  });
  // --- News-Zentrale (Show-Prep) ---
  add('GET', '/api/v1/stations/:sid/showprep/feeds', 'automation:read', (c) => app.svc.showprep.feeds(sid(c)));
  add('POST', '/api/v1/stations/:sid/showprep/feeds', 'automation:write', async (c) => app.svc.showprep.addFeed(sid(c), await c.body()));
  add('DELETE', '/api/v1/stations/:sid/showprep/feeds/:id', 'automation:write', (c) => app.svc.showprep.removeFeed(sid(c), c.params.id!));
  add('POST', '/api/v1/stations/:sid/showprep/feeds/reset', 'automation:write', (c) => app.svc.showprep.resetFeeds(sid(c)));
  add('GET', '/api/v1/stations/:sid/showprep/articles', 'automation:read', (c) => app.svc.showprep.articles(sid(c), { feedId: c.url.searchParams.get('feed') ?? undefined, category: c.url.searchParams.get('category') ?? undefined }, c.url.searchParams.get('force') === '1'));
  add('GET', '/api/v1/stations/:sid/showprep/weather', 'automation:read', (c) => app.svc.showprep.weather(c.url.searchParams.get('city') ?? ''));
  add('POST', '/api/v1/stations/:sid/showprep/notes', 'ai:write', async (c) => app.svc.showprep.notes(sid(c), await c.body()));
  add('POST', '/api/v1/stations/:sid/news/:id/air', 'automation:write', async (c) => { const b = await c.body(); return app.svc.news.air(sid(c), Number(c.params.id) as 1 | 2 | 3, b.mode === 'now' ? 'now' : 'track', 'manual'); });
  add('POST', '/api/v1/stations/:sid/clock-events', 'automation:write', async (c) => app.svc.planning.saveClockEvent(sid(c), null, await c.body()));
  add('PATCH', '/api/v1/stations/:sid/clock-events/:id', 'automation:write', async (c) => app.svc.planning.saveClockEvent(sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/clock-events/:id', 'automation:write', (c) => app.svc.planning.deleteClockEvent(sid(c), c.params.id!));
  add('POST', '/api/v1/stations/:sid/clock-events/:id/fire', 'automation:write', (c) => app.svc.planning.fireClockEvent(sid(c), c.params.id!));
  add('POST', '/api/v1/stations/:sid/plans', 'automation:write', async (c) => app.svc.planning.savePlan(sid(c), null, await c.body()));
  add('PATCH', '/api/v1/stations/:sid/plans/:id', 'automation:write', async (c) => app.svc.planning.savePlan(sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/plans/:id', 'automation:write', (c) => app.svc.planning.deletePlan(sid(c), c.params.id!));

  // --- Recorder / Replays ---
  add('GET', '/api/v1/stations/:sid/recordings', 'automation:read', (c) => app.svc.recorder.recordings(sid(c)));
  add('POST', '/api/v1/stations/:sid/recorder/start', 'automation:write', async (c) => app.svc.recorder.startRecording(sid(c), str((await c.body()).label)));
  add('POST', '/api/v1/stations/:sid/recorder/stop', 'automation:write', (c) => app.svc.recorder.stopRecording(sid(c)));
  add('GET', '/api/v1/stations/:sid/recordings/:id/file', 'automation:read', (c) => {
    const { path, rec } = app.svc.recorder.recordingFile(sid(c), c.params.id!);
    c.res.setHeader('Content-Disposition', `attachment; filename="${rec.label.replace(/[^\w .()-]/g, '_')}.${rec.file.split('.').pop()}"`);
    sendFile(c.req, c.res, path, rec.contentType || 'application/octet-stream');
    return STREAMED;
  });
  add('DELETE', '/api/v1/stations/:sid/recordings/:id', 'automation:write', (c) => app.svc.recorder.deleteRecording(sid(c), c.params.id!));
  add('POST', '/api/v1/stations/:sid/rec-plans', 'automation:write', async (c) => app.svc.recorder.saveRecPlan(sid(c), null, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/rec-plans/:id', 'automation:write', (c) => app.svc.recorder.deleteRecPlan(sid(c), c.params.id!));

  // --- Podcast: eigener Feed aus den eigenen Mitschnitten ---
  add('GET', '/api/v1/stations/:sid/podcast', 'automation:read', (c) => app.svc.podcast.overview(sid(c)));
  add('PUT', '/api/v1/stations/:sid/podcast', 'automation:write', async (c) => app.svc.podcast.saveConfig(sid(c), await c.body()));
  add('PUT', '/api/v1/stations/:sid/podcast/cover', 'automation:write', async (c) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const d of c.req) {
      size += (d as Buffer).length;
      if (size > 5 * 1024 * 1024) throw new AppError(413, 'too_large', 'Cover höchstens 5 MB');
      chunks.push(d as Buffer);
    }
    return app.svc.podcast.setCover(sid(c), String(c.req.headers['content-type'] ?? ''), Buffer.concat(chunks));
  });
  add('POST', '/api/v1/stations/:sid/podcast/episodes', 'automation:write', async (c) => {
    const b = await c.body();
    return app.svc.podcast.createEpisode(sid(c), String(b.recordingId ?? ''), b);
  });
  add('PATCH', '/api/v1/stations/:sid/podcast/episodes/:id', 'automation:write', async (c) => app.svc.podcast.updateEpisode(sid(c), c.params.id!, await c.body()));
  add('PUT', '/api/v1/stations/:sid/podcast/host', 'automation:write', async (c) => ({ host: app.svc.podcastHost.save(sid(c), await c.body()) }));
  add('POST', '/api/v1/stations/:sid/podcast/host/test', 'automation:write', (c) => app.svc.podcastHost.test(sid(c)));
  add('POST', '/api/v1/stations/:sid/podcast/check', 'automation:write', (c) => app.svc.podcastHost.check(sid(c)));
  add('POST', '/api/v1/stations/:sid/podcast/episodes/:id/push', 'automation:write', (c) => app.svc.podcastHost.push(sid(c), c.params.id!));
  add('DELETE', '/api/v1/stations/:sid/podcast/episodes/:id', 'automation:write', (c) => app.svc.podcast.deleteEpisode(sid(c), c.params.id!));

  // --- Hörerstatistik ---
  add('GET', '/api/v1/stations/:sid/stats', 'automation:read', (c) => app.svc.stats.stats(sid(c), c.url.searchParams.get('period') ?? '24h'));
  add('GET', '/api/v1/stations/:sid/stats/deep', 'automation:read', (c) => app.svc.stats.deep(sid(c), c.url.searchParams.get('period') ?? '7d'));
  add('GET', '/api/v1/stations/:sid/stats/deep.csv', 'automation:read', (c) => {
    const period = c.url.searchParams.get('period') ?? '7d';
    const csv = app.svc.stats.deepCsv(sid(c), period);
    c.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="deep-stats-${sid(c)}-${period}.csv"` });
    c.res.end('\ufeff' + csv);
    return STREAMED;
  });
  add('POST', '/api/v1/stations/:sid/stats/deep/email', 'automation:write', async (c) => { const b = await c.body(); return { ok: await app.svc.stats.emailDeep(sid(c), String(b.period ?? '7d'), str(b.recipient)) }; });

  // --- Sendungs-Rückblick ---
  add('GET', '/api/v1/stations/:sid/recap', 'automation:read', (c) => {
    const from = Number(c.url.searchParams.get('from'));
    const to = Number(c.url.searchParams.get('to'));
    return app.svc.recap.generate(sid(c), from, to);
  });
  add('GET', '/api/v1/stations/:sid/recap.csv', 'automation:read', (c) => {
    const from = Number(c.url.searchParams.get('from'));
    const to = Number(c.url.searchParams.get('to'));
    const report = app.svc.recap.generate(sid(c), from, to);
    const csv = app.svc.recap.csv(report);
    c.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sendungs-rueckblick-${sid(c)}.csv"` });
    c.res.end('﻿' + csv);
    return STREAMED;
  });
  add('POST', '/api/v1/stations/:sid/recap/email', 'automation:write', async (c) => {
    const b = await c.body();
    const ok = await app.svc.recap.email(sid(c), Number(b.from), Number(b.to), typeof b.recipient === 'string' ? b.recipient : undefined);
    return { ok };
  });

  // --- Motion-Mix-Videos (animierter Hintergrund + Wellenform + Titel-Einblendungen aus einer Playlist) ---
  add('GET', '/api/v1/stations/:sid/motion-mix/presets', 'automation:read', () => app.svc.motionMix.presets());
  add('GET', '/api/v1/stations/:sid/motion-mix/jobs', 'automation:read', (c) => app.svc.motionMix.jobs(sid(c)));
  add('POST', '/api/v1/stations/:sid/motion-mix/jobs', 'automation:write', async (c) => {
    const b = await c.body();
    return app.svc.motionMix.start(sid(c), String(b.playlistId ?? ''), String(b.preset ?? ''));
  });
  add('DELETE', '/api/v1/stations/:sid/motion-mix/jobs/:id', 'automation:write', (c) => app.svc.motionMix.deleteJob(sid(c), c.params.id!));
  add('GET', '/api/v1/stations/:sid/motion-mix/jobs/:id/file', 'automation:read', (c) => {
    const job = app.svc.motionMix.job(sid(c), c.params.id!);
    const path = app.svc.motionMix.file(sid(c), c.params.id!);
    c.res.setHeader('Content-Disposition', `attachment; filename="${job.playlistName.replace(/[^\w .()-]/g, '_')}.mp4"`);
    sendFile(c.req, c.res, path, 'video/mp4');
    return STREAMED;
  });

  // --- Datenspeicher / Sync (MySQL, Firebase) – nur globale Admins ---
  const globalAdmin = (c: Ctx) => {
    if (!c.p.stationIds.includes('*') || !c.p.roles.includes('admin')) throw new AppError(403, 'forbidden', 'Nur für Administratoren');
  };
  add('GET', '/api/v1/storage', null, (c) => (globalAdmin(c), app.sync.view()));
  add('PUT', '/api/v1/storage', null, async (c) => {
    globalAdmin(c);
    try {
      return await app.sync.configure((await c.body()) as never, true);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(400, 'storage_error', (err as Error).message);
    }
  });
  add('POST', '/api/v1/storage/sync', null, async (c) => {
    globalAdmin(c);
    app.persistNow();
    try {
      await app.sync.pushNow(app.stateJson());
    } catch (err) {
      throw new AppError(502, 'sync_failed', (err as Error).message);
    }
    return app.sync.view();
  });

  // --- Updates ---
  add('GET', '/api/v1/update', 'automation:read', (c) => app.svc.system.checkUpdate(c.url.searchParams.get('force') === '1'));
  add('GET', '/api/v1/update/settings', null, (c) => (globalAdmin(c), app.svc.system.updateSettingsView()));
  add('PUT', '/api/v1/update/settings', null, async (c) => (globalAdmin(c), app.svc.system.setUpdateSettings(await c.body())));
  add('POST', '/api/v1/update/install', null, (c) => {
    globalAdmin(c);
    return app.svc.system.installUpdate(() => {
      app.shutdown();
      process.exit(0);
    });
  });
  // APK für die Android-App über dieses AnMaCha Cast laden (funktioniert auch bei privatem Repository)
  add('GET', '/api/v1/update/apk', 'automation:read', async (c) => {
    const info = (await app.svc.system.checkUpdate()) as { assets: { apk?: import('./update.ts').UpdateAsset }; error?: string };
    if (!info.assets.apk) throw new AppError(404, 'no_apk', info.error ?? 'Keine APK im Release');
    const r = await app.updater.open(info.assets.apk, app.secrets.get('update:token'));
    c.res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="AnMaCha-Cast-Android.apk"', ...(info.assets.apk.size ? { 'Content-Length': info.assets.apk.size } : {}) });
    await pipeline(Readable.fromWeb(r.body as never), c.res);
    return STREAMED;
  });

  // --- Brücke zu bestehenden Systemen (AzuraCast, Icecast, Streams) ---
  add('GET', '/api/v1/stations/:sid/bridges', 'sources:read', (c) => app.svc.bridges.bridges(sid(c)));
  add('POST', '/api/v1/stations/:sid/bridges', 'sources:write', async (c) => app.svc.bridges.saveBridge(c.p, sid(c), null, await c.body()));
  add('PATCH', '/api/v1/stations/:sid/bridges/:id', 'sources:write', async (c) => app.svc.bridges.saveBridge(c.p, sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/bridges/:id', 'sources:write', (c) => app.svc.bridges.saveBridge(c.p, sid(c), c.params.id!, { remove: true }));

  // --- Bridge-API für Entwickler: externe Schlüssel, idempotent ---
  const bridgeKey = (c: Ctx) => decodeURIComponent(c.params.key!);
  add('GET', '/api/v1/bridge/mappings', 'bridge:write', (c) => {
    const all = app.svc.bridges.bridgeMappings();
    return Object.fromEntries(Object.entries(all).filter(([, s]) => canSee(c.p, s)));
  });
  add('PUT', '/api/v1/bridge/stations/:key', 'bridge:write', async (c) => {
    const key = bridgeKey(c);
    const known = app.svc.bridges.bridgeMappings()[key];
    if (known ? !canSee(c.p, known) : !c.p.stationIds.includes('*')) throw new AppError(403, 'forbidden', known ? 'Kein Zugriff auf diesen Sender' : 'Nur globale Tokens legen Sender an');
    return app.svc.bridges.bridgeUpsertStation(key, await c.body());
  });
  add('POST', '/api/v1/bridge/stations/:key/now-playing', 'bridge:write', async (c) => {
    const key = bridgeKey(c);
    if (!canSee(c.p, app.svc.bridges.bridgeStation(key))) throw new AppError(403, 'forbidden', 'Kein Zugriff auf diesen Sender');
    return app.svc.bridges.bridgeNowPlaying(key, await c.body());
  });
  // Für Sendesoftware, die nur einfache HTTP-GET-Aufrufe kann (SAM, mAirList, RadioDJ): Parameter in der URL, Token als ?token=
  add('GET', '/api/v1/bridge/stations/:key/now-playing', 'bridge:write', (c) => {
    const key = bridgeKey(c);
    if (!canSee(c.p, app.svc.bridges.bridgeStation(key))) throw new AppError(403, 'forbidden', 'Kein Zugriff auf diesen Sender');
    const q = c.url.searchParams;
    const n = (k: string) => (q.get(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
    const dur = n('durationMs') ?? (n('duration') !== undefined ? n('duration')! * 1000 : undefined);
    return app.svc.bridges.bridgeNowPlaying(key, { artist: q.get('artist') ?? '', title: q.get('title') ?? '', album: q.get('album') ?? undefined, durationMs: dur, listeners: n('listeners'), startedAt: q.get('startedAt') ?? undefined });
  });

  // --- Liquidsoap-Skript (ohne Passwörter) ---
  add('GET', '/api/v1/stations/:sid/liquidsoap', 'outputs:read', (c) => {
    const q = c.url.searchParams;
    const r = app.svc.system.liquidsoap(sid(c), { port: q.get('port') ? Number(q.get('port')) : undefined, mount: q.get('mount') ?? undefined, processing: q.get('processing') !== '0' });
    if (q.get('format') === 'json') return r;
    c.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="anmachacast-${sid(c)}.liq"` });
    c.res.end(r.script);
    return STREAMED;
  });

  // --- Lautheitsanalyse & Klangprofile ---
  add('GET', '/api/v1/dsp/presets', 'automation:read', () => DSP_PRESETS);
  add('GET', '/api/v1/stations/:sid/media/loudness', 'media:read', (c) => app.svc.media.loudnessStatus(sid(c)));
  // Track-TÜV: Tonart, Online-Tags/Cover, Vorher/Nachher-Bericht
  add('GET', '/api/v1/stations/:sid/media/tuev', 'media:read', (c) => app.svc.media.tuevReport(sid(c)));
  add('GET', '/api/v1/stations/:sid/media/tuev.csv', 'media:read', (c) => {
    c.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="track-tuev-${sid(c)}.csv"` });
    c.res.end('\ufeff' + app.svc.media.tuevCsv(sid(c)));
    return STREAMED;
  });
  add('POST', '/api/v1/stations/:sid/media/:id/key', 'media:write', (c) => app.svc.media.analyzeKeyNow(sid(c), c.params.id!));
  add('GET', '/api/v1/stations/:sid/media/:id/lookup', 'media:read', (c) => app.svc.media.lookupTags(sid(c), c.params.id!, { artist: c.url.searchParams.get('artist') ?? undefined, title: c.url.searchParams.get('title') ?? undefined }));
  add('POST', '/api/v1/stations/:sid/media/:id/lookup', 'media:write', async (c) => app.svc.media.applyLookup(sid(c), c.params.id!, await c.body()));
  add('POST', '/api/v1/stations/:sid/media/loudness', 'media:write', async (c) => app.svc.media.analyzeLibrary(sid(c), (await c.body()).force === true));

  // --- Nextcloud-Brücke ---
  add('GET', '/api/v1/nextcloud', null, (c) => (globalAdmin(c), app.svc.nextcloud.nextcloudConfig()));
  add('PUT', '/api/v1/nextcloud', null, async (c) => (globalAdmin(c), app.svc.nextcloud.setNextcloud(await c.body())));
  add('GET', '/api/v1/nextcloud/list', 'media:read', (c) => app.svc.nextcloud.nextcloudList(c.url.searchParams.get('path') ?? '/'));
  add('POST', '/api/v1/stations/:sid/nextcloud/import', 'media:write', async (c) => {
    const b = await c.body();
    return app.svc.nextcloud.nextcloudImport(sid(c), Array.isArray(b.paths) ? b.paths.map(String) : [], { category: str(b.category), folder: str(b.folder) });
  });
  add('POST', '/api/v1/stations/:sid/recordings/:id/nextcloud', 'media:write', async (c) => app.svc.nextcloud.nextcloudUploadRecording(sid(c), c.params.id!, String((await c.body()).dir ?? '')));

  // --- Programm beenden (Windows-Hintergrundprozess, Tray, „AnMaCha Cast beenden“) ---
  add('POST', '/api/v1/system/shutdown', null, (c) => {
    globalAdmin(c);
    if (!app.requestShutdown) throw new AppError(501, 'unsupported', 'Beenden ist hier nicht möglich');
    setTimeout(() => app.requestShutdown?.(), 300).unref();
    return { stopping: true };
  });

  // --- Android-App / Netzwerk ---
  add('GET', '/api/v1/app/connect', null, (c) => (globalAdmin(c), app.svc.system.appConnect()));
  // Geräte koppeln und verwalten
  add('POST', '/api/v1/pairing', 'tokens:write', async (c) => {
    const b = await c.body();
    return { ...app.svc.devices.createPairing(c.p, { role: b.role as string, stationIds: b.stationIds }), ...(app.svc.system.appConnect() as object) };
  });
  add('GET', '/api/v1/devices', 'tokens:write', () => app.svc.devices.list());
  // Hörer-Posteingang und Einstellungen
  add('GET', '/api/v1/stations/:sid/inbox', 'queue:read', (c) => app.svc.listeners.inbox(sid(c)));
  add('POST', '/api/v1/stations/:sid/inbox/:id/:action', 'queue:write', (c) => app.svc.listeners.action(c.p, sid(c), c.params.id!, c.params.action!));
  add('GET', '/api/v1/stations/:sid/inbox/:id/audio', 'queue:read', (c) => {
    const f = app.svc.listeners.voiceFile(sid(c), c.params.id!);
    sendFile(c.req, c.res, f.path, f.type);
    return STREAMED;
  });
  // Community: Umfragen, Formulare (mit Einträgen), Auslosung
  const C = app.svc.community;
  add('GET', '/api/v1/stations/:sid/polls', 'queue:read', (c) => C.polls(sid(c)));
  add('POST', '/api/v1/stations/:sid/polls', 'stations:write', async (c) => C.savePoll(c.p, sid(c), null, await c.body()));
  add('PATCH', '/api/v1/stations/:sid/polls/:id', 'stations:write', async (c) => C.savePoll(c.p, sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/polls/:id', 'stations:write', (c) => { C.deletePoll(c.p, sid(c), c.params.id!); return { ok: true }; });
  add('GET', '/api/v1/stations/:sid/polls/:id/csv', 'queue:read', (c) => {
    const csv = C.pollCsv(sid(c), c.params.id!); // erst rechnen (404 bei unbekannter ID), dann Kopf senden
    c.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="umfrage-${c.params.id}.csv"` });
    c.res.end('\ufeff' + csv);
    return STREAMED;
  });
  add('GET', '/api/v1/stations/:sid/forms', 'queue:read', (c) => C.forms(sid(c)));
  add('POST', '/api/v1/stations/:sid/forms', 'stations:write', async (c) => C.saveForm(c.p, sid(c), null, await c.body()));
  add('PATCH', '/api/v1/stations/:sid/forms/:id', 'stations:write', async (c) => C.saveForm(c.p, sid(c), c.params.id!, await c.body()));
  add('DELETE', '/api/v1/stations/:sid/forms/:id', 'stations:write', (c) => { C.deleteForm(c.p, sid(c), c.params.id!); return { ok: true }; });
  add('GET', '/api/v1/stations/:sid/forms/:id/entries', 'queue:read', (c) => C.entries(sid(c), c.params.id!));
  add('GET', '/api/v1/stations/:sid/forms/:id/entries/csv', 'queue:read', (c) => {
    const csv = C.entriesCsv(sid(c), c.params.id!);
    c.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="formular-${c.params.id}.csv"` });
    c.res.end('\ufeff' + csv);
    return STREAMED;
  });
  add('DELETE', '/api/v1/stations/:sid/form-entries/:id', 'queue:write', (c) => { C.deleteEntry(c.p, sid(c), c.params.id!); return { ok: true }; });
  add('POST', '/api/v1/stations/:sid/draw', 'queue:write', async (c) => C.draw(c.p, sid(c), await c.body()));
  add('GET', '/api/v1/stations/:sid/draws', 'queue:read', (c) => C.draws(sid(c)));
  add('DELETE', '/api/v1/stations/:sid/draws', 'queue:write', (c) => { C.clearDraws(c.p, sid(c)); return { ok: true }; });
  add('GET', '/api/v1/stations/:sid/draws/csv', 'queue:read', (c) => {
    c.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="auslosung-${sid(c)}.csv"` });
    c.res.end('\ufeff' + C.drawsCsv(sid(c)));
    return STREAMED;
  });
  add('GET', '/api/v1/stations/:sid/listener', 'queue:read', (c) => app.svc.listeners.config(sid(c)));
  add('PUT', '/api/v1/stations/:sid/listener', 'stations:write', async (c) => app.svc.listeners.setConfig(c.p, sid(c), await c.body()));
  // Setup-Assistent (nur Administration)
  add('GET', '/api/v1/setup', null, (c) => (globalAdmin(c), app.svc.setup.status()));
  add('POST', '/api/v1/setup/installer-welcome/ack', null, (c) => (globalAdmin(c), app.svc.setup.acknowledgeInstallerWelcome(), { ok: true }));
  add('PUT', '/api/v1/setup/:step', null, async (c) => (globalAdmin(c), app.svc.setup.apply(c.p, c.params.step!, await c.body())));
  add('POST', '/api/v1/system/restart', null, (c) => {
    globalAdmin(c);
    if (!app.requestRestart) throw new AppError(501, 'unsupported', 'Neustart ist hier nicht möglich – bitte AnMaCha Cast von Hand neu starten');
    app.audit.write({ kind: 'system', event: 'restart', actor: c.p.id });
    setTimeout(() => app.requestRestart?.(), 300).unref();
    return { restarting: true };
  });
  // LAN-Erkennung vom Browser aus anstoßen (der Browser selbst kann kein UDP - der Server sucht stellvertretend
  // in seinem eigenen Netz. Nützlich z. B. auf einem Docker-/Server-Host, um weitere AnMaCha-Cast-Instanzen im
  // selben Netz zum Wechseln/Koppeln zu finden, s. "Server wechseln").
  add('GET', '/api/v1/discover', null, async (c) => {
    globalAdmin(c);
    const { discover } = await import('./discovery.ts');
    return { found: await discover() };
  });
  // Sicherung/Wiederherstellung (nur Administration - betrifft die gesamte Installation, nicht nur einen Sender)
  add('GET', '/api/v1/backup', null, (c) => (globalAdmin(c), app.svc.backup.list()));
  add('POST', '/api/v1/backup', null, (c) => (globalAdmin(c), app.svc.backup.create()));
  add('POST', '/api/v1/backup/:file/restore', null, (c) => (globalAdmin(c), app.svc.backup.restore(c.params.file!)));
  // Eingebundene Musikordner (Serverpfade – nur Administration)
  add('GET', '/api/v1/stations/:sid/folders/linked', 'media:read', (c) => app.svc.media.linkedFolders(sid(c)));
  add('POST', '/api/v1/stations/:sid/folders/linked', null, async (c) => (globalAdmin(c), app.svc.media.linkFolder(sid(c), await c.body())));
  add('POST', '/api/v1/stations/:sid/folders/linked/scan', null, async (c) => {
    globalAdmin(c);
    const path = String((await c.body()).path ?? '');
    const f = app.svc.media.linkedFolders(sid(c)).find((x) => x.path === path);
    if (!f) throw new AppError(404, 'not_found', 'Ordner ist nicht eingebunden');
    return app.svc.media.scanFolder(sid(c), f);
  });
  add('DELETE', '/api/v1/stations/:sid/folders/linked', null, async (c) => (globalAdmin(c), app.svc.media.unlinkFolder(sid(c), String((await c.body()).path ?? ''))));
  add('DELETE', '/api/v1/devices/:id', 'tokens:write', (c) => app.svc.devices.revoke(c.p, c.params.id!));
  // andere AnMaCha-Cast-Server im Netz finden (für „Server hinzufügen“ auf dem Desktop)
  add('GET', '/api/v1/discover', null, async () => {
    const { discover } = await import('./discovery.ts');
    return (await discover()).filter((f) => f.id !== app.sync.instance);
  });
  add('PUT', '/api/v1/app/network', null, async (c) => (globalAdmin(c), app.svc.system.setNetwork((await c.body()).lan === true)));
  // Webseiten, die AnMaCha Cast im Browser fernsteuern dürfen (CORS); Anmeldung bleibt trotzdem per Token/Kopplungscode nötig
  add('GET', '/api/v1/app/origins', null, (c) => (globalAdmin(c), { webOrigins: app.svc.system.webOrigins() }));
  add('PUT', '/api/v1/app/origins', null, async (c) => (globalAdmin(c), app.svc.system.setWebOrigins((await c.body()).webOrigins)));
  // Fernzugriff über einen Vermittler (ausgehende Verbindung, keine Portfreigabe nötig)
  add('GET', '/api/v1/app/remote-link', null, (c) => (globalAdmin(c), app.svc.remoteLink.view()));
  add('PUT', '/api/v1/app/remote-link', null, async (c) => (globalAdmin(c), app.svc.remoteLink.configure(c.p, await c.body())));
  add('DELETE', '/api/v1/app/remote-link', null, (c) => (globalAdmin(c), app.svc.remoteLink.remove(c.p)));

  // --- KI-Automation ---
  const aiErr = (err: unknown) => (err instanceof AppError ? err : new AppError(err instanceof AiError && err.code === 'not_found' ? 404 : err instanceof AiError && ['invalid', 'unknown_provider'].includes(err.code) ? 400 : 502, 'ai_error', (err as Error).message));
  const aiCall = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw aiErr(err);
    }
  };
  add('GET', '/api/v1/ai/settings', null, (c) => (globalAdmin(c), app.ai.view()));
  add('PUT', '/api/v1/ai/settings', null, async (c) => {
    globalAdmin(c);
    const b = await c.body();
    return aiCall(() => app.ai.update(b));
  });
  add('GET', '/api/v1/ai/usage', null, (c) => (globalAdmin(c), app.ai.usageView()));
  add('GET', '/api/v1/ai/health', null, (c) => (globalAdmin(c), app.ai.healthView()));
  add('POST', '/api/v1/ai/providers/:id/release', null, (c) => (globalAdmin(c), app.ai.releaseProvider(c.params.id!)));
  add('GET', '/api/v1/ai/providers/:id/models', null, (c) => (globalAdmin(c), aiCall(() => app.ai.models(c.params.id!))));
  add('GET', '/api/v1/ai/providers/:id/voices', null, (c) => (globalAdmin(c), aiCall(() => app.ai.voices(c.params.id!))));
  // Cast Tools (originale ArtCraft-Anwendungen unter eigenem Namen): Liste für alle Angemeldeten, Laden/Entfernen nur globale Admins
  add('GET', '/api/v1/tools', null, () => app.svc.tools.list());
  add('POST', '/api/v1/tools/:id/install', null, async (c) => (globalAdmin(c), app.svc.tools.install(c.params.id!)));
  add('DELETE', '/api/v1/tools/:id', null, (c) => (globalAdmin(c), app.svc.tools.remove(c.params.id!)));
  // Lokale KI-Server suchen: dieser PC/Server (im Docker-Container zusätzlich der Docker-Host), optional ein weiterer Rechner im eigenen Netz
  add('POST', '/api/v1/ai/discover', null, async (c) => {
    globalAdmin(c);
    const b = (await c.body()) as { host?: unknown };
    const extra = typeof b?.host === 'string' ? b.host.trim() : '';
    if (extra && !HOST_RE.test(extra)) throw new AppError(400, 'invalid_host', 'Rechner bitte als Name oder IP-Adresse angeben (ohne http:// und ohne Port)');
    const hosts = ['127.0.0.1', ...(existsSync('/.dockerenv') ? ['host.docker.internal'] : []), ...(extra ? [extra] : [])];
    return { hosts, found: await discoverLocal(hosts) };
  });
  add('GET', '/api/v1/stations/:sid/ai', 'ai:read', (c) => ({ config: app.svc.ai.aiConfig(sid(c)), state: app.director.view(sid(c)) }));
  add('PUT', '/api/v1/stations/:sid/ai', 'ai:write', async (c) => app.svc.ai.setAiConfig(c.p, sid(c), await c.body()));
  add('POST', '/api/v1/stations/:sid/ai/moderation', 'ai:write', async (c) => {
    const kind = (await c.body()).kind === 'news' ? 'news' : 'break';
    const r = await app.director.produce(sid(c), kind);
    if (!r) throw new AppError(502, 'ai_failed', (app.director.view(sid(c)) as { log: { detail: string }[] }).log[0]?.detail ?? 'KI-Moderation fehlgeschlagen oder läuft bereits');
    return r;
  });
  add('POST', '/api/v1/stations/:sid/ai/music', 'ai:write', async (c) => ({ added: await app.director.maintainMusic(sid(c), true) }));
  add('POST', '/api/v1/stations/:sid/ai/pending/:id/approve', 'ai:write', (c) => aiCall(() => app.director.approve(sid(c), c.params.id!)));
  add('POST', '/api/v1/stations/:sid/ai/pending/:id/reject', 'ai:write', (c) => aiCall(() => app.director.reject(sid(c), c.params.id!)));
  add('POST', '/api/v1/stations/:sid/ai/text', 'ai:write', async (c) => {
    const b = await c.body();
    return app.svc.ai.aiText(sid(c), String(b.prompt ?? ''), typeof b.system === 'string' ? b.system : undefined);
  });
  add('POST', '/api/v1/stations/:sid/ai/speech', 'ai:write', async (c) => app.svc.ai.aiSpeech(sid(c), await c.body()));
  // KI-Werkstatt (Assistent mit Verlauf, Spot-Werkstatt, Sendeablauf-Planer, Transkription)
  add('GET', '/api/v1/stations/:sid/ai/chat', 'ai:read', (c) => app.svc.ai.chat(sid(c)));
  add('DELETE', '/api/v1/stations/:sid/ai/chat', 'ai:write', (c) => app.svc.ai.chatClear(sid(c)));
  add('POST', '/api/v1/stations/:sid/ai/chat', 'ai:write', async (c) => { const b = await c.body(); return app.svc.ai.chatSend(sid(c), String(b.prompt ?? ''), str(b.instruction)); });
  add('POST', '/api/v1/stations/:sid/ai/improve', 'ai:write', async (c) => app.svc.ai.improvePrompt(sid(c), String((await c.body()).prompt ?? '')));
  add('POST', '/api/v1/stations/:sid/ai/rewrite', 'ai:write', async (c) => { const b = await c.body(); return app.svc.ai.rewrite(sid(c), String(b.text ?? ''), String(b.tone ?? '')); });
  add('POST', '/api/v1/stations/:sid/ai/spot-mix', 'ai:write', async (c) => app.svc.ai.spotMix(sid(c), await c.body()));
  add('POST', '/api/v1/stations/:sid/ai/plan', 'ai:write', async (c) => app.svc.ai.planShow(sid(c), await c.body()));
  add('POST', '/api/v1/stations/:sid/ai/transcribe', 'ai:write', async (c) => app.svc.ai.transcribe(sid(c), await c.body()));
  add('GET', '/api/v1/stations/:sid/ai/studio', 'ai:read', () => ({ kinds: STUDIO_KINDS, tones: STUDIO_TONES }));
  add('POST', '/api/v1/stations/:sid/ai/studio/write', 'ai:write', async (c) => app.svc.ai.studioWrite(sid(c), await c.body()));
  add('POST', '/api/v1/stations/:sid/ai/studio/playlist', 'ai:write', async (c) => app.svc.ai.studioPlaylist(sid(c), await c.body()));

  // --- Benachrichtigungen / Webhooks / Now-Playing-Export ---
  add('GET', '/api/v1/stations/:sid/integrations', 'stations:write', (c) => app.svc.notifications.integrations(sid(c)));
  add('PUT', '/api/v1/stations/:sid/integrations', 'stations:write', async (c) => app.svc.notifications.setIntegrations(c.p, sid(c), await c.body()));
  add('POST', '/api/v1/stations/:sid/integrations/test', 'stations:write', (c) => app.svc.notifications.testIntegrations(sid(c)));

  // --- laut.fm ---
  add('GET', '/api/v1/stations/:sid/lautfm', 'lautfm:read', (c) => app.svc.lautfm.lautfmConfig(sid(c)));
  add('PUT', '/api/v1/stations/:sid/lautfm', 'lautfm:write', async (c) => app.svc.lautfm.setLautfmConfig(c.p, sid(c), await c.body()));
  add('POST', '/api/v1/stations/:sid/lautfm/connect', 'lautfm:write', async (c) => app.svc.lautfm.connect(c.p, sid(c), await c.body()));
  add('POST', '/api/v1/stations/:sid/lautfm/check', 'lautfm:read', (c) => app.svc.lautfm.check(sid(c)));
  add('POST', '/api/v1/stations/:sid/lautfm/live-output', 'outputs:write', async (c) => {
    const b = await c.body();
    const prio = b.priority === undefined || b.priority === null || b.priority === '' ? undefined : Number(b.priority);
    return app.svc.lautfm.lautfmCreateOutput(c.p, sid(c), prio);
  });
  // Eigener Sender (keine laut.fm-Identität) zusätzlich live auf laut.fm senden: eigenes Token je Aufruf,
  // unabhängig von einer eventuellen „laut.fm“-Verbindung dieses Senders (siehe Ausgänge im Studio).
  add('POST', '/api/v1/stations/:sid/lautfm/relay-output', 'outputs:write', async (c) => app.svc.lautfm.connectRelayOutput(c.p, sid(c), await c.body()));

  // --- Cardwall ---
  add('GET', '/api/v1/stations/:sid/cardwall', 'cardwall:read', (c) => app.cardwall(sid(c)));
  add('PATCH', '/api/v1/stations/:sid/cardwall/:slot', 'automation:write', async (c) => app.updateCart(sid(c), c.params.slot!, await c.body()));
  add('POST', '/api/v1/stations/:sid/cardwall/:slot/trigger', 'cardwall:trigger', (c) => app.triggerCart(sid(c), c.params.slot!));

  // --- Echtzeit-Events (SSE) ---
  add('GET', '/api/v1/events', null, (c) => {
    const filter = c.url.searchParams.get('station');
    if (filter && !canSee(c.p, filter)) throw new AppError(403, 'forbidden', 'Kein Zugriff');
    c.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    c.res.write('retry: 2000\n\n');
    const unsub = app.subscribe((e) => {
      if (e.stationId && (!canSee(c.p, e.stationId) || (filter && e.stationId !== filter))) return;
      if (c.res.writableLength > 1024 * 1024) return; // langsamer Client: Events verwerfen statt Speicher zu fressen
      c.res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`);
    });
    const ping = setInterval(() => c.res.write(': ping\n\n'), 20_000);
    c.req.on('close', () => {
      unsub();
      clearInterval(ping);
    });
    return STREAMED;
  });

  // --- Rate Limit pro Token (Token Bucket) ---
  const buckets = new Map<string, { tokens: number; at: number }>();
  const allow = (key: string) => {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: 120, at: now };
    b.tokens = Math.min(120, b.tokens + ((now - b.at) / 1000) * 40);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    buckets.set(key, b);
    return true;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    setSecurityHeaders(res);
    const cors = applyCors(req, res, (o) => app.svc.system.isWebOrigin(o));
    // Hörerbereich beantwortet seine Vorabanfrage (CORS) selbst – er ist absichtlich von überall erreichbar
    if (req.method === 'OPTIONS' && !path.startsWith('/api/v1/public/')) {
      res.writeHead(cors ? 204 : 403);
      return void res.end();
    }

    if (path.startsWith('/ingest/')) return handleIngest(app, req, res, path);
    // öffentlich, ohne Details (NETWORK.md); `ok` bleibt für ältere Clients erhalten
    if (path === '/api/v1/health') {
      res.setHeader('Cache-Control', 'no-store');
      const h = app.health.summary();
      return json(res, h.status === 'error' ? 503 : 200, { ok: h.status !== 'error', ...h });
    }
    // Maschinenlesbare API-Beschreibung (OpenAPI 3.1), öffentlich und aus der Routentabelle erzeugt
    if (path === '/api/v1/openapi.json' && req.method === 'GET') {
      openapi ??= JSON.stringify(buildOpenApi((server as ApiServer).apiRoutes, app.version));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' });
      return void res.end(openapi);
    }
    // Anmeldung (öffentlich): Benutzername + Passwort → Sitzungs-Token; Sperre nach Fehlversuchen im UserStore
    // pairing: Geräte können sich immer per Kopplungscode verbinden (auch ohne Benutzerkonten, z. B. Desktop)
    if (path === '/api/v1/auth/status' && req.method === 'GET') return json(res, 200, { users: app.users.count > 0, pairing: true });
    // Kopplungscode einlösen (öffentlich; Sperre nach wiederholten Fehlversuchen je Adresse)
    if (path === '/api/v1/pair' && req.method === 'POST') {
      try {
        const b = JSON.parse((await readRaw(req, 4 * 1024)).toString('utf8') || '{}') as { code?: string; name?: string; platform?: string };
        return json(res, 200, app.svc.devices.redeem(String(b.code ?? ''), b, String(req.socket.remoteAddress ?? '')));
      } catch (err) {
        if (err instanceof AppError) return json(res, err.status, { error: err.code, message: err.message });
        return json(res, 400, { error: 'invalid', message: 'Ungültige Anfrage' });
      }
    }
    if (path === '/api/v1/auth/login' && req.method === 'POST') {
      try {
        const b = JSON.parse((await readRaw(req, 16 * 1024)).toString('utf8') || '{}') as { username?: string; password?: string };
        const ip = String(req.socket.remoteAddress ?? '');
        const r = await app.users.login(String(b.username ?? ''), String(b.password ?? ''), ip);
        app.audit.write({ kind: 'auth', event: 'login', actor: r.user.id, ip });
        return json(res, 200, r);
      } catch (err) {
        if (err instanceof AuthError) {
          app.audit.write({ kind: 'auth', event: 'login_failed', ip: String(req.socket.remoteAddress ?? ''), status: err.status });
          return json(res, err.status, { error: 'auth', message: err.message });
        }
        return json(res, 400, { error: 'invalid', message: 'Ungültige Anfrage' });
      }
    }
    // Ankündigungs-Banner / Wartungsmeldung für öffentliche Seiten (ohne Login, CORS offen)
    if (path === '/api/v1/public/site' && req.method === 'GET') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache', 'Content-Type': 'application/json; charset=utf-8' });
      return void res.end(JSON.stringify(app.svc.system.siteView()));
    }
    // Hörerbereich (öffentlich, je Sender einzeln freizuschalten): Info, Suche, Wunsch, Gruß, Stimme, Charts, Sprachnachricht
    const lp = /^\/api\/v1\/public\/stations\/([a-z0-9-]{1,40})\/listener(?:\/(search|request|message|vote|charts|voice|poll|poll\/vote|form|form\/submit))?$/.exec(path);
    if (lp) {
      // von der Senderseite einbettbar: jede Herkunft, aber ohne Anmeldedaten
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      const [, lsid, action] = lp;
      const ip = clientIp(req);
      const L = app.svc.listeners;
      try {
        if (req.method === 'GET' && !action) return json(res, 200, L.publicInfo(lsid!));
        if (req.method === 'GET' && action === 'search') return json(res, 200, L.search(lsid!, url.searchParams.get('q') ?? '', ip));
        if (req.method === 'GET' && action === 'charts') return json(res, 200, L.publicCharts(lsid!));
        if (req.method === 'GET' && action === 'poll') return json(res, 200, app.svc.community.publicPoll(lsid!));
        if (req.method === 'GET' && action === 'form') return json(res, 200, app.svc.community.publicForm(lsid!, url.searchParams.get('id')));
        if (req.method === 'POST' && (action === 'poll/vote' || action === 'form/submit')) {
          // 20 Felder × 2000 Zeichen plus JSON-Hülle passen in 96 KiB
          const b = JSON.parse((await readRaw(req, 192 * 1024)).toString('utf8') || '{}') as Record<string, unknown>;
          return json(res, 200, action === 'poll/vote' ? app.svc.community.votePoll(lsid!, ip, b) : app.svc.community.submitForm(lsid!, ip, b));
        }
        if (req.method === 'POST' && action === 'voice') {
          // zu große Uploads sofort ablehnen, bevor Daten gelesen werden (sauberes 413 statt Verbindungsabbruch)
          if (Number(req.headers['content-length'] ?? 0) > MAX_VOICE_BYTES) {
            res.setHeader('Connection', 'close');
            return json(res, 413, { error: 'too_large', message: 'Sprachnachricht zu groß' });
          }
          const data = await readRaw(req, MAX_VOICE_BYTES + 1);
          return json(res, 200, L.voice(lsid!, ip, String(req.headers['content-type'] ?? ''), data, { name: url.searchParams.get('name'), text: url.searchParams.get('text') }));
        }
        if (req.method === 'POST' && (action === 'request' || action === 'message' || action === 'vote')) {
          const b = JSON.parse((await readRaw(req, 8 * 1024)).toString('utf8') || '{}') as Record<string, unknown>;
          return json(res, 200, action === 'request' ? L.request(lsid!, ip, b) : action === 'message' ? L.message(lsid!, ip, b) : L.vote(lsid!, ip, b));
        }
        return json(res, 405, { error: 'method_not_allowed' });
      } catch (err) {
        if (err instanceof AppError) return json(res, err.status, { error: err.code, message: err.message });
        if (err instanceof SyntaxError) return json(res, 400, { error: 'invalid_json', message: 'Ungültige Anfrage' });
        const e = err as { status?: number; message?: string };
        return json(res, e.status === 413 ? 413 : 400, { error: 'invalid', message: e.status === 413 ? 'Zu groß' : 'Ungültige Anfrage' });
      }
    }
    // Öffentliche Chart-Cover (ohne Login), nur für Titel aus den aktuellen Charts
    const pc = /^\/api\/v1\/public\/stations\/([a-z0-9-]{1,40})\/cover\/([A-Za-z0-9_-]{1,60})$/.exec(path);
    if (pc && req.method === 'GET') {
      try {
        const file = await app.svc.status.publicCover(pc[1]!, pc[2]!);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        sendFile(req, res, file, 'image/jpeg');
        return;
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        return json(res, e.status ?? 404, { error: e.code ?? 'not_found', message: e.message ?? 'Kein Cover' });
      }
    }
    // Öffentliche Seiten (ohne Login): Senderseite, Sendeplan, Charts, Netzwerk
    const pp = /^\/api\/v1\/public\/(?:(network)|stations\/([a-z0-9-]{1,40})\/(page|schedule|charts))$/.exec(path);
    if (pp && req.method === 'GET') {
      const pub = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache', 'Content-Type': 'application/json; charset=utf-8' };
      try {
        const host = String(req.headers.host ?? 'localhost');
        const data = pp[1] ? await app.svc.status.publicNetwork(host)
          : pp[3] === 'page' ? await app.svc.status.publicPage(pp[2]!, host)
          : pp[3] === 'schedule' ? app.svc.status.publicSchedule(pp[2]!)
          : app.svc.status.publicCharts(pp[2]!, url.searchParams.get('period') ?? '7d');
        res.writeHead(200, pub);
        return void res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(err instanceof AppError ? err.status : 502, pub);
        return void res.end(JSON.stringify({ error: 'public_failed', message: (err as Error).message }));
      }
    }
    // Öffentlicher Stream-Status (wie Icecast): /status.json, /status/<sender>.<fmt>, /status/lautfm/<name>.<fmt>
    const st = /^\/status(?:\.json|\/(lautfm\/)?([a-z0-9_-]{1,60})\.(json|xml|m3u|xspf))$/.exec(path);
    if (st && req.method === 'GET') {
      const pub = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
      if (!st[2]) {
        res.writeHead(200, { ...pub, 'Content-Type': 'application/json; charset=utf-8' });
        return void res.end(JSON.stringify({ stations: app.svc.status.publicStations() }));
      }
      try {
        const data: StreamStatus = st[1] ? await app.svc.status.lautfmPublicStatus(st[2]) : await app.svc.status.streamStatus(st[2], String(req.headers.host ?? 'localhost'));
        const fmt = st[3];
        const [type, body] = fmt === 'xml' ? ['application/xml; charset=utf-8', toIcecastXml(data)]
          : fmt === 'm3u' ? ['audio/x-mpegurl; charset=utf-8', toM3u(data)]
          : fmt === 'xspf' ? ['application/xspf+xml; charset=utf-8', toXspf(data)]
          : ['application/json; charset=utf-8', JSON.stringify(data)];
        res.writeHead(200, { ...pub, 'Content-Type': type, ...(fmt === 'm3u' || fmt === 'xspf' ? { 'Content-Disposition': `inline; filename="${st[2]}.${fmt}"` } : {}) });
        return void res.end(body);
      } catch (err) {
        res.writeHead(err instanceof AppError ? err.status : 502, { ...pub, 'Content-Type': 'application/json' });
        return void res.end(JSON.stringify({ status: 'error', message: (err as Error).message }));
      }
    }
    // Offizielle Android-App: mitgelieferte APK (Windows-Paket) oder aus dem Release – öffentlich, damit das Handy sie direkt laden kann.
    if (path === '/download/AnMaCha-Cast-Android.apk' && req.method === 'GET') {
      const local = app.svc.system.localApk();
      if (local) {
        res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="AnMaCha-Cast-Android.apk"', 'Content-Length': statSync(local).size });
        return void createReadStream(local).pipe(res);
      }
      try {
        const info = (await app.svc.system.checkUpdate()) as { assets: { apk?: import('./update.ts').UpdateAsset }; error?: string };
        if (!info.assets.apk) return json(res, 404, { error: 'no_apk', message: info.error ?? 'Keine APK verfügbar' });
        const r = await app.updater.open(info.assets.apk, app.secrets.get('update:token'));
        res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="AnMaCha-Cast-Android.apk"', ...(info.assets.apk.size ? { 'Content-Length': info.assets.apk.size } : {}) });
        return void Readable.fromWeb(r.body as never).pipe(res);
      } catch (err) {
        return json(res, 502, { error: 'apk_unavailable', message: (err as Error).message });
      }
    }
    // Senderlogo ist Branding und öffentlich (Studio, Widgets, Android-App)
    const logo = /^\/api\/v1\/stations\/([a-z0-9-]{1,40})\/logo$/.exec(path);
    if (logo && req.method === 'GET') {
      const l = app.svc.stations.stationLogo(logo[1]!);
      if (!l) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, { 'Content-Type': l.type, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
      return void createReadStream(l.path).pipe(res);
    }

    // Eigener Podcast-Feed: öffentlich erreichbar, damit Podcast-Apps (Apple Podcasts, Spotify, …) ihn abonnieren können
    const podcastFeed = /^\/api\/v1\/public\/stations\/([a-z0-9-]{1,40})\/podcast\.xml$/.exec(path);
    if (podcastFeed && req.method === 'GET') {
      try {
        const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim() || ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
        const xml = app.svc.podcast.feedXml(podcastFeed[1]!, `${proto}://${req.headers.host ?? 'localhost'}`);
        res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' });
        return void res.end(xml);
      } catch (err) {
        return json(res, err instanceof AppError ? err.status : 500, { error: 'podcast_feed_failed', message: (err as Error).message });
      }
    }
    const podcastCover = /^\/api\/v1\/public\/stations\/([a-z0-9-]{1,40})\/podcast\/cover$/.exec(path);
    if (podcastCover && req.method === 'GET') {
      const c = app.svc.podcast.cover(podcastCover[1]!);
      if (!c) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, { 'Content-Type': c.type, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' });
      return void createReadStream(c.path).pipe(res);
    }
    const podcastAudio = /^\/api\/v1\/public\/stations\/([a-z0-9-]{1,40})\/podcast\/episodes\/([a-z0-9_-]{1,60})\/audio$/.exec(path);
    if (podcastAudio && req.method === 'GET') {
      try {
        const stationId = podcastAudio[1]!;
        const episodeId = podcastAudio[2]!;
        const ep = app.stations.get(stationId)?.data.episodes?.find((e) => e.id === episodeId);
        if (!ep?.publishedAt) return json(res, 404, { error: 'not_found' });
        const { path: file, rec } = app.svc.recorder.recordingFile(stationId, ep.recordingId);
        res.setHeader('Access-Control-Allow-Origin', '*');
        sendFile(req, res, file, rec.contentType || 'application/octet-stream');
        return;
      } catch (err) {
        return json(res, err instanceof AppError ? err.status : 404, { error: 'not_found' });
      }
    }

    if (path.startsWith('/listen/')) {
      const p = auth(app, req, url);
      if (!p || !AnMaChaCastApp.hasScope(p, 'stream:read')) return json(res, 401, { error: 'unauthorized' });
      const [, , station, ...rest] = path.split('/');
      if (!station || !canSee(p, station)) return json(res, 403, { error: 'forbidden' });
      try {
        if (!app.addListener(station, '/' + rest.join('/'), res)) json(res, 404, { error: 'off_air', message: 'Keine aktive Quelle' });
      } catch (err) {
        sendError(res, err);
      }
      return;
    }

    // Zusatz-Streams: HLS-Playlist + -Segmente, direkt vom AnMaCha-Cast-Server ausgeliefert (kein externer Icecast nötig)
    if (path.startsWith('/hls/')) {
      const p = auth(app, req, url);
      if (!p || !AnMaChaCastApp.hasScope(p, 'stream:read')) return json(res, 401, { error: 'unauthorized' });
      const [, , station, file] = path.split('/');
      if (!station || !canSee(p, station)) return json(res, 403, { error: 'forbidden' });
      if (!file || !/^[a-zA-Z0-9_.-]+$/.test(file)) return json(res, 404, { error: 'not_found' });
      const base = resolve(join(app.hlsDir, station));
      const full = resolve(base, file);
      if (!isInside(base, full)) return json(res, 403, { error: 'forbidden' });
      if (!existsSync(full) || !statSync(full).isFile()) return json(res, 404, { error: 'not_found' });
      const type = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : file.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return void createReadStream(full).pipe(res);
    }

    // Cast Tools: Web-Fassungen der Werkzeuge, isoliert vom Studio (eigener, „null“-Ursprung über CSP-Sandbox):
    // ihre Skripte können weder das Anmelde-Token des Studios lesen noch die API mit Studio-Rechten aufrufen.
    const tool = /^\/tools\/(cast-[a-z]+)(\/.*)?$/.exec(path);
    if (tool) return serveTool(req, res, app.svc.tools.webRoot(tool[1]!), tool[2]);
    if (!path.startsWith('/api/')) return serveStatic(req, res, studioDir, path);

    // laut.fm-Weiterleitung (Radioadmin mit gespeichertem Token bzw. öffentliche API)
    const ra = /^\/api\/v1\/stations\/([^/]+)\/lautfm\/ra(\/.*)$/.exec(path);
    const pub = /^\/api\/v1\/lautfm\/public(\/.*)$/.exec(path);
    if (ra || pub) {
      const p = auth(app, req, url);
      if (!p) return json(res, 401, { error: 'unauthorized' });
      if (!allow(p.tokenId)) return json(res, 429, { error: 'rate_limited' });
      if (pub) {
        if (req.method !== 'GET' || !allowedPublicPath(pub[1]!)) return json(res, 403, { error: 'forbidden_path' });
        return forward(req, res, PUBLIC_API + pub[1] + url.search, undefined, 15_000);
      }
      const station = decodeURIComponent(ra![1]!);
      const scope = req.method === 'GET' ? 'lautfm:read' : 'lautfm:write';
      if (!AnMaChaCastApp.hasScope(p, scope)) return json(res, 403, { error: 'insufficient_scope', scope });
      if (!canSee(p, station)) return json(res, 403, { error: 'forbidden' });
      try {
        const cfg = app.svc.lautfm.lautfmConfig(station);
        if (!allowedRadioadminPath(ra![2]!, cfg.stationId)) return json(res, 403, { error: 'forbidden_path', message: 'Pfad nicht erlaubt oder laut.fm-Station nicht gewählt' });
        const token = app.svc.lautfm.lautfmToken(station);
        if (!token) return json(res, 409, { error: 'no_token', message: 'Kein laut.fm-Radioadmin-Token hinterlegt' });
        return forward(req, res, RADIOADMIN + ra![2] + url.search, token, 300_000, cfg.origin, () => app.svc.lautfm.reorigin(station));
      } catch (err) {
        return sendError(res, err);
      }
    }

    const route = routes.find((r) => r.method === req.method && r.re.test(path));
    if (!route) {
      const exists = routes.some((r) => r.re.test(path));
      return json(res, exists ? 405 : 404, { error: exists ? 'method_not_allowed' : 'not_found' });
    }
    const p = auth(app, req, url);
    if (!p) return json(res, 401, { error: 'unauthorized', message: 'Gültiges API-Token erforderlich' });
    // Erst neues Passwort setzen (Erstanmeldung/Zurücksetzen) – vorher nur Passwort ändern, Abmelden, /me
    if (p.user?.mustChangePassword && !['/api/v1/auth/password', '/api/v1/auth/logout', '/api/v1/me'].includes(path)) {
      return json(res, 403, { error: 'password_change_required', message: 'Bitte zuerst ein eigenes Passwort festlegen' });
    }
    if (route.scope && !AnMaChaCastApp.hasScope(p, route.scope)) return json(res, 403, { error: 'insufficient_scope', scope: route.scope });
    if (!route.re.source.includes('chunks') && !allow(p.tokenId)) return json(res, 429, { error: 'rate_limited' });
    // Datenbank ausgefallen: Sendebetrieb läuft aus dem Speicher weiter, Konfigurationsänderungen werden abgelehnt
    if (req.method !== 'GET' && req.method !== 'HEAD' && app.docs.status().state === 'error' && !ON_AIR_OPS.test(path)) {
      res.setHeader('Retry-After', '15');
      return json(res, 503, { error: 'database_unavailable', message: `Datenbank nicht erreichbar – Änderungen an der Konfiguration sind gerade nicht möglich. Der Sendebetrieb läuft weiter. (${app.docs.status().lastError ?? ''})` });
    }

    const m = route.re.exec(path)!;
    const params: Params = {};
    route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
    const body = async () => {
      const raw = await readRaw(req, MAX_JSON);
      if (raw.length === 0) return {};
      try {
        const v = JSON.parse(raw.toString('utf8'));
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        return v as Record<string, unknown>;
      } catch {
        throw new AppError(400, 'invalid_json', 'Body muss ein JSON-Objekt sein');
      }
    };
    try {
      const out = await route.handler({ req, res, url, params, p, body });
      if (out === STREAMED) return;
      if (out === undefined) {
        res.writeHead(204);
        res.end();
      } else json(res, 200, out);
    } catch (err) {
      sendError(res, err);
    }
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => sendError(res, err));
  }) as ApiServer;
  server.apiRoutes = routes.map(({ method, path, scope }) => ({ method, path, scope }));
  return server;
}

// ---------- Relay-Ingest (Icecast-kompatibel: PUT oder SOURCE) ----------

function handleIngest(app: AnMaChaCastApp, req: IncomingMessage, res: ServerResponse, path: string): void {
  if (req.method !== 'PUT' && req.method !== 'SOURCE') return json(res, 405, { error: 'method_not_allowed' });
  const [, , station, ...rest] = path.split('/');
  const mount = '/' + rest.join('/');
  const basic = /^Basic (.+)$/i.exec(String(req.headers.authorization ?? ''));
  const [user, ...passParts] = basic ? Buffer.from(basic[1]!, 'base64').toString('utf8').split(':') : [];
  let src;
  try {
    src = station && user !== undefined ? app.authenticateIngest(station, mount, user, passParts.join(':')) : null;
  } catch (err) {
    return sendError(res, err);
  }
  if (!src) {
    app.audit.write({ kind: 'ingest', event: 'auth_failed', station, mount });
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AnMaCha Cast"' });
    return void res.end();
  }
  const contentType = String(req.headers['content-type'] ?? 'audio/mpeg').split(';')[0]!.trim();
  try {
    app.ingestOpen(src, contentType);
  } catch (err) {
    return sendError(res, err);
  }
  app.audit.write({ kind: 'ingest', event: 'connected', sourceId: src.id, contentType });
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.flushHeaders();
  req.on('data', (chunk: Buffer) => app.ingestData(src, chunk));
  let closed = false;
  const done = () => {
    if (closed) return;
    closed = true;
    app.ingestClose(src);
    if (!res.writableEnded) res.end();
  };
  req.on('end', done);
  req.on('close', done);
  req.on('error', done);
}

// ---------- Hilfsfunktionen ----------

const STREAMED = Symbol('streamed');

function auth(app: AnMaChaCastApp, req: IncomingMessage, url: URL): Principal | null {
  const h = /^Bearer (.+)$/i.exec(String(req.headers.authorization ?? ''));
  // Query-Token nur für GET (EventSource, <audio>), damit Tokens nicht in schreibenden Requests landen.
  const token = h?.[1] ?? (req.method === 'GET' ? url.searchParams.get('token') ?? undefined : undefined);
  return app.svc.auth.authenticate(token);
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return void res.end();
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof AppError) return json(res, err.status, { error: err.code, message: err.message });
  console.error('[http]', err);
  json(res, 500, { error: 'internal', message: 'Interner Fehler' });
}

function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (d: Buffer) => {
      size += d.length;
      if (size > limit) {
        fail(new AppError(413, 'too_large', 'Anfrage zu groß'));
        req.destroy();
        return;
      }
      parts.push(d);
    });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', fail);
  });
}

function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string): void {
  if (!existsSync(file)) return json(res, 404, { error: 'not_found' });
  const size = statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return void res.end();
    }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
  createReadStream(file).pipe(res);
}

function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, path: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' });
  const rel = path === '/' ? 'index.html' : decodeURIComponent(path).replace(/^\/+/, '');
  const base = resolve(root);
  const file = resolve(base, normalize(rel));
  if (!isInside(base, file)) return json(res, 403, { error: 'forbidden' });
  if (!existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not_found' });
  // Öffentliche Seiten: Statusseite und Player-Widget dürfen fremde Streams abspielen, das Widget auch eingebettet werden
  const PUBLIC_PAGES = ['status.html', 'widget.html', 'hoerer.html', 'sender.html', 'sendeplan.html', 'charts.html', 'netzwerk.html', 'public.css', 'js/public-pages.js'];
  const publicPage = PUBLIC_PAGES.includes(rel);
  // Widget und Hörerseite dürfen auf der Senderseite eingebettet werden
  const embeddable = rel === 'widget.html' || rel === 'hoerer.html' || rel === 'sendeplan.html' || rel === 'charts.html';
  if (embeddable) res.removeHeader('X-Frame-Options');
  res.setHeader(
    'Content-Security-Policy',
    publicPage
      ? `default-src 'self'; media-src 'self' http: https: blob:; img-src 'self' data: http: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors ${embeddable ? '*' : "'self'"}`
      : "default-src 'self'; media-src 'self' blob:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  );
  res.writeHead(200, { 'Content-Type': STATIC_TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).pipe(res);
}

function serveTool(req: IncomingMessage, res: ServerResponse, root: string | null, sub: string | undefined): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' });
  if (!root) return json(res, 404, { error: 'not_installed', message: 'Werkzeug ist auf diesem Server nicht geladen' });
  if (!sub) {
    res.writeHead(301, { Location: `${req.url?.split('?')[0]}/` });
    return void res.end();
  }
  const rel = sub === '/' ? 'index.html' : decodeURIComponent(sub).replace(/^\/+/, '');
  const base = resolve(root);
  const file = resolve(base, normalize(rel));
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-downloads allow-forms allow-modals allow-popups allow-pointer-lock; frame-ancestors 'self'");
  // Die Seite läuft mit „null“-Ursprung; ihre Module/WebAssembly lädt sie mit crossorigin – daher CORS für die eigenen Dateien
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (!isInside(base, file) && file !== base) return json(res, 403, { error: 'forbidden' });
  if (!existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not_found' });
  const immutable = /\.part-[a-z]+$|-[0-9a-f]{12,}(_bg)?\.(js|wasm)$/.test(file);
  res.writeHead(200, { 'Content-Type': TOOL_TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).pipe(res);
}

/**
 * Liegt `file` innerhalb von `base`? Plattformunabhängig (Windows nutzt "\\" als Trenner).
 * @param p Pfadmodul (für Tests: path.win32 / path.posix)
 */
export function isInside(base: string, file: string, p: typeof path = path): boolean {
  const rel = p.relative(base, file);
  return rel !== '' && !rel.startsWith('..') && !p.isAbsolute(rel);
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

// Gemeinsame Typen und Hilfsfunktionen des Servers (Sender, Laufzeitzustand, Fehler, Rechte).
// Kein Zustand, keine Seiteneffekte – von app.ts und den Diensten unter services/ genutzt.

import { createHash, randomBytes } from 'node:crypto';
import type { WriteStream } from 'node:fs';
import { PriorityError, type Actor, type SourceConfig } from '../core/source-priority.ts';
import type { CartSlot, ClockTemplate, DeckId, DeckState, MediaItem, PlayQueue, QueueEntry, RotationRules } from '../core/automation.ts';
import type { ClockEvent, ProgramPlan, RecordingPlan, ScheduledJob, TimeWindow } from '../core/scheduler.ts';
import type { PlayoutOptions, StreamFormat } from './playout.ts';
import type { LautfmConfig } from './lautfm.ts';
import type { IntegrationsConfig } from './notify.ts';
import type { AiStationConfig } from './ai/director.ts';
import type { RelayTap } from './relay.ts';
import type { BroadcastOutput, OutputConfig } from './icecast.ts';
import type { SecretStore } from './secrets.ts';
import type { BaseMode } from '../core/mode.ts';

export const AUDIO_FILE_RE = /\.(mp3|ogg|opus|wav|flac|m4a|aac|webm)$/i;

/** Anbindung eines bestehenden Systems (AzuraCast, Icecast, beliebiger Stream) an einen AnMaCha-Cast-Sender. */
export interface BridgeConfig {
  id: string;
  name: string;
  kind: 'azuracast' | 'icecast' | 'stream';
  /** Basis-URL (AzuraCast/Icecast) bzw. Stream-URL (stream) */
  url: string;
  /** AzuraCast: Kurzname oder ID des Senders; Icecast: Mount */
  station?: string;
  /** Status spiegeln (Now Playing, Hörer, Verlauf) */
  mirror: boolean;
  /** Stream als Quelle übernehmen (Pull-Relay) */
  pull: boolean;
  /** Explizite Stream-URL für das Relay (sonst aus dem Status) */
  pullUrl?: string;
  /** Quelle, die das Relay speist (wird automatisch angelegt) */
  sourceId?: string;
  priority: number;
}

export interface Station {
  id: string;
  name: string;
  slogan: string;
  primaryColor: string;
  accentColor: string;
  /** Eigenes Logo: Dateiendung + Version (z. B. "png:lq3x"), Datei liegt in data/logos */
  logo?: string;
  /** Öffentliche Statusseite/Widget (Standard: an) */
  publicStatus?: boolean;
  genre?: string;
}

export interface StationData {
  library: MediaItem[];
  queue: QueueEntry[];
  cardwall: CartSlot[];
  clock: ClockTemplate;
  rotation: RotationRules;
  history: string[];
  clockCursor: number;
  autoFill: boolean;
  minQueue: number;
  playout?: PlayoutConfig;
  playlists?: Playlist[];
  smartBlocks?: import('../core/smartblocks.ts').SmartBlock[];
  rotationPool?: RotationPool;
  /** Zähler je Playlist für die Allgemeine Rotation (Reihenfolge innerhalb einer Playlist) */
  poolCursor?: Record<string, number>;
  jobs?: ScheduledJob[];
  clockEvents?: ClockEvent[];
  /** Einschübe „nach N Songs aus Ordner“ (Regeln & Sicherung) + Zähler je Regel */
  inserts?: import('../core/automation.ts').InsertRule[];
  insertCounters?: Record<string, number>;
  /** Nachrichten & Wetter (laut.fm): gewählter Ausgang als Zugangsquelle */
  news?: import('./services/news.ts').NewsConfig;
  /** News-Zentrale (Show-Prep): eigene Feeds + ausgeblendete Standard-Feeds */
  prepFeeds?: { custom: import('./services/showprep.ts').PrepFeed[]; removed: string[] };
  plans?: ProgramPlan[];
  recPlans?: RecordingPlan[];
  recordings?: Recording[];
  playLog?: PlayLogEntry[];
  planCursor?: Record<string, number>;
  lautfm?: LautfmConfig;
  /** KI-Programmchef für laut.fm: Rückgängig-Stand, Autopilot, Protokoll */
  programmchef?: import('./services/programmchef.ts').ProgrammchefData;
  integrations?: IntegrationsConfig;
  ai?: AiStationConfig;
  /** KI-Assistent: Chatverlauf je Sender (Studio-Werkzeug), gekappt */
  aiChat?: { at: number; role: 'user' | 'assistant'; text: string }[];
  bridges?: BridgeConfig[];
  /** Hörer-Interaktion: Einstellungen, Posteingang (Wünsche, Grüße, Sprachnachrichten), Stimmen je Titel */
  listener?: import('./services/listeners.ts').ListenerConfig;
  inbox?: import('./services/listeners.ts').InboxItem[];
  votes?: Record<string, { up: number; down: number }>;
  /** Community: Umfragen, Formulare mit Einträgen, Auslosungs-Protokoll */
  polls?: import('./services/community.ts').Poll[];
  forms?: import('./services/community.ts').FormDef[];
  formEntries?: import('./services/community.ts').FormEntry[];
  draws?: import('./services/community.ts').DrawEntry[];
  /** Eingebundene Musikordner (werden indiziert und überwacht, nicht kopiert) */
  linkedFolders?: LinkedFolder[];
  /** Grundbetriebsart des Mode-Managers (AUTO/MANUAL); LIVE/EMERGENCY ergeben sich aus dem Sendezustand */
  mode?: BaseMode;
  /** Zusatz-Streams: benannte Zusatzprofile (z. B. "Mobile AAC 64k"), die Ausgänge per profileId referenzieren können */
  streamProfiles?: StreamProfileConfig[];
  podcast?: PodcastConfig;
  episodes?: Episode[];
  /** Stichproben für den Sendungs-Rückblick (alle 30 s: aktuelle Hörerzahl + gesendete Bytes über alle Ausgänge). */
  recapSamples?: RecapSample[];
  /** Hörerzahl je Stunde (Ø/Spitze), 100 Tage - Grundlage der Hörerstatistik über 7/30/90 Tage. */
  listenerHours?: ListenerHour[];
  /** Motion-Mix-Videos (animierter Hintergrund + Wellenform + Titel-Einblendungen aus einer Playlist). */
  motionMixJobs?: MotionMixJob[];
}

/**
 * Motion-Mix-Video: aus einer Playlist erzeugtes MP4 (animierter, senderfarbener Hintergrund,
 * Audio-Wellenform, Titel-Einblendungen je Track) - eigene, generative Visuals, kein fremdes Material.
 * Läuft als Hintergrundjob (ffmpeg braucht bei längeren Mixes etwas Zeit), gleiches
 * queued/running/succeeded/failed-Muster wie die MusikHub-Importjobs.
 */
export interface MotionMixJob {
  id: string;
  playlistId: string;
  playlistName: string;
  preset: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  trackCount: number;
  durationMs: number | null;
  file?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Eine Stichprobe für den Sendungs-Rückblick (Hörer-Spitze, gesendete Datenmenge über einen Zeitraum). */
export interface RecapSample {
  at: number;
  listeners: number;
  bytesTotal: number;
}

/** Zusatz-Streams-Profil: eigenes Format/Bitrate, gespeist aus demselben Programmbus wie der Hauptencoder. */
export interface StreamProfileConfig {
  id: string;
  name: string;
  format: StreamFormat;
  bitrateKbps: number;
  mp3Mode?: 'cbr' | 'vbr';
  mp3Quality?: number;
  /** Encoder unabhängig von den Stream-Ausgängen aktivieren/deaktivieren (Standard: aktiv). */
  enabled?: boolean;
  /** Zeitfenster: läuft nur innerhalb dieser Wochentage/Uhrzeit (z. B. Simulcast nur zur Sendezeit). Fehlt es, läuft das Profil durchgehend. */
  window?: TimeWindow;
}

export interface LinkedFolder {
  /** absoluter Pfad auf dem Server/PC */
  path: string;
  category: import('../core/automation.ts').MediaCategory;
  /** Zeitpunkt der letzten vollständigen Durchsicht */
  scannedAt?: number;
  files?: number;
  error?: string;
}

export interface Playlist {
  id: string;
  name: string;
  color: string;
  items: string[];
  /** Manuell: feste Reihenfolge (items). Shuffle: gemischte Reihenfolge (shuffleOrder), Interpreten getrennt. */
  mode?: 'manual' | 'shuffle';
  /** Zuletzt gemischte Reihenfolge (Item-IDs), damit "Abspielen" nicht bei jedem Aufruf neu mischt. */
  shuffleOrder?: string[];
  /** Dynamische Playlist: Titel kommen bei jedem Durchlauf frisch aus diesem Smart Block (items bleiben leer) */
  block?: string;
}

/** Allgemeine Rotation: mehrere Playlisten nach Gewicht mischen, wenn der Sendeplan nichts vorgibt. */
export interface RotationPool {
  on: boolean;
  entries: { playlistId: string; weight: number }[];
}

export interface Recording {
  id: string;
  label: string;
  startedAt: number;
  endedAt?: number;
  bytes: number;
  contentType: string;
  file: string;
  planId?: string;
}

/** Eigener Podcast-Feed aus den eigenen Mitschnitten (RSS 2.0 + iTunes-Namensraum, kein externer Dienst nötig). */
export interface PodcastConfig {
  title: string;
  description: string;
  author: string;
  /** Sprachcode, z. B. "de-de" */
  language: string;
  /** Freitext-Kategorie (iTunes-Kategorien sind nicht genormt genug für eine feste Auswahl) */
  category?: string;
  explicit: boolean;
  /** Cover: Dateiendung + Version (z. B. "png:lq3x"), Datei liegt in data/podcast-covers, wie Station.logo */
  cover?: string;
  /** Auto-Veröffentlichung: fertige Mitschnitte werden nach Vorlage zur Episode (und auf Wunsch sofort in den Feed) */
  auto?: PodcastAuto;
  /** Nächste Episodennummer der Auto-Veröffentlichung (steigt monoton, auch nach Löschen) */
  nextEpisodeNumber?: number;
  /** Öffentliche Adresse des Servers (z. B. Tunnel), die in Feed, Enclosures und Cover steht statt des Anfrage-Hosts */
  publicBaseUrl?: string;
  /** Externer kostenloser Podcast-Hoster, zu dem Episoden hochgeladen werden (Zugangsdaten im Secret-Store) */
  host?: PodcastHost;
}

export interface PodcastHost {
  kind: 'buzzsprout' | 'podbean';
  /** Buzzsprout: numerische Podcast-ID */
  podcastId?: string;
  /** Öffentlicher Feed beim Hoster (Buzzsprout automatisch, Podbean zum Eintragen) */
  feedUrl?: string;
  /** Neue, im Feed veröffentlichte Auto-Episoden sofort hochladen */
  autoPush?: boolean;
}

/** Platzhalter in den Vorlagen: {label} {station} {date} {time} {weekday} {duration} {n} (nächste Episodennummer) */
export interface PodcastAuto {
  enabled: boolean;
  titleTemplate: string;
  descriptionTemplate: string;
  /** true = direkt im Feed, false = als Entwurf */
  publish: boolean;
  /** Kürzere Mitschnitte (Minuten) werden übersprungen, 0 = alle */
  minMinutes: number;
  /** Nur Mitschnitte aus Aufnahme-Zeitfenstern (keine manuellen) */
  onlyPlanned: boolean;
}

/** Eine veröffentlichte (oder noch im Entwurf befindliche) Episode, aus einem bestehenden Mitschnitt erzeugt. */
export interface Episode {
  id: string;
  recordingId: string;
  title: string;
  description: string;
  createdAt: number;
  /** Fehlt = Entwurf, noch nicht im Feed sichtbar */
  publishedAt?: number;
  season?: number;
  episodeNumber?: number;
  /** Stabile GUID im Feed (ändert sich nie, auch wenn der Titel sich ändert) */
  guid: string;
  /** Beim externen Hoster angelegt (Hoster, ID dort, Zeitpunkt) */
  hosted?: { kind: 'buzzsprout' | 'podbean'; id: string; at: number; url?: string };
}

export interface PlayLogEntry {
  at: number;
  mediaId: string;
  title: string;
  artist: string;
  category: string;
  /** Hörer über alle verbundenen Ausgänge beim Start des Titels (Statistik: Ø Hörer/Song) */
  listeners?: number;
  /** Lief, während eine Live-Quelle (Moderator, Studio-App) auf Sendung war */
  live?: boolean;
}

/** Stunden-Aggregat der Hörerzahl (für Zeiträume jenseits der 48-h-Stichproben), 100 Tage. */
export interface ListenerHour {
  /** Stundenbeginn (ms) */
  at: number;
  sum: number;
  n: number;
  peak: number;
}

export interface ActiveRecording {
  rec: Recording;
  stream: WriteStream | null;
  tap: RelayTap;
  target: string;
}

export interface PlayoutConfig extends PlayoutOptions {
  /** Nach Serverstart automatisch wieder senden (24/7) */
  autostart: boolean;
  /** Quelle, als die das Playout sendet (Standard: Automation-Quelle des Senders) */
  sourceId?: string;
  /** Notfall-Ordner: spielt, wenn Queue, Sendeuhr und Sendeplan nichts liefern */
  emergencyFolder?: string;
  /** Zusatz-Streams: zusätzlich als HLS (m3u8 + Segmente) ausliefern, direkt vom AnMaCha-Cast-Server */
  hls?: HlsConfig;
}

/** HLS-Ausgabe (Apple HTTP Live Streaming): eigener AAC-Encode desselben Programmbusses, in Segmente geteilt. */
export interface HlsConfig {
  enabled: boolean;
  bitrateKbps?: number;
  segmentSeconds?: number;
}

export interface PersistedState {
  version: 1;
  stations: Station[];
  sources: SourceConfig[];
  outputs: OutputConfig[];
  data: Record<string, StationData>;
}

export interface ApiToken {
  id: string;
  name: string;
  hash: string;
  scopes: string[];
  roles: string[];
  stationIds: string[];
  createdAt: string;
  /** Gekoppeltes Gerät (Handy, weiterer PC) statt frei erzeugtem API-Token */
  device?: { platform: string; pairedAt: string; lastSeenAt?: string; ip?: string };
  /** Vom Benutzer selbst erzeugter API-Schlüssel (Profil → Meine API-Keys) */
  userId?: string;
}

export interface Principal extends Actor {
  scopes: string[];
  tokenId: string;
  /** Angemeldeter Benutzer (Sitzung), sonst API-Token */
  user?: { id: string; username: string; name: string; mustChangePassword?: boolean };
}

export interface NowPlaying {
  mediaId: string | null;
  deck: DeckId | null;
  startedAt: number | null;
}

export interface StationRuntime {
  station: Station;
  data: StationData;
  queue: PlayQueue;
  decks: Record<DeckId, DeckState>;
  nowPlaying: NowPlaying;
  /** Sendebus spielt Notfall-Material (Queue, Sendeuhr und Sendeplan lieferten nichts) */
  emergencyPlaying?: boolean;
}

export type HubEvent = { type: string; stationId?: string; payload: unknown };

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const ALL_SCOPES = [
  'now_playing:read', 'schedule:read', 'stream:read', 'branding:read', 'queue:read', 'queue:write',
  'cardwall:read', 'cardwall:trigger', 'sources:read', 'sources:write', 'automation:read', 'automation:write',
  'media:read', 'media:write', 'stations:write', 'outputs:read', 'outputs:write', 'audit:read', 'tokens:write',
  'lautfm:read', 'lautfm:write', 'ai:read', 'ai:write', 'bridge:write',
] as const;

export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

// ---------- Hilfsfunktionen ----------

export const SYSTEM_PRINCIPAL: Principal = { id: 'system', tokenId: 'system', roles: ['admin'], stationIds: ['*'], scopes: ['*'] };

export function canSee(p: Principal, stationId: string): boolean {
  return p.stationIds.includes('*') || p.stationIds.includes(stationId);
}

export function relayKey(stationId: string, target: string): string {
  return `${stationId}${target}`;
}

export function normalizeMount(m: unknown): string {
  const s = String(m ?? '').trim();
  const withSlash = s.startsWith('/') ? s : `/${s}`;
  if (!/^\/[a-zA-Z0-9._\-/]{1,100}$/.test(withSlash) || withSlash.includes('..')) {
    throw new AppError(400, 'invalid_mount', 'Ungültiger Mountpoint/Target');
  }
  return withSlash;
}

export function posInt(v: unknown): number | undefined {
  const n = Number(v);
  return v !== null && v !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export function safeColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i]! ^ hb[i]!;
  return diff === 0;
}

export function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof PriorityError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'forbidden' ? 403 : err.code.startsWith('invalid') ? 400 : 409;
      throw new AppError(status, err.code, err.message);
    }
    throw err;
  }
}

export function publicSource<T extends SourceConfig>(s: T, secrets: SecretStore): Omit<T, 'credentialRef'> & { hasPassword: boolean } {
  const { credentialRef, ...rest } = s;
  return { ...rest, hasPassword: !!credentialRef && secrets.has(credentialRef) };
}

export function publicOutput(o: BroadcastOutput, secrets: SecretStore): Record<string, unknown> {
  const { passwordRef, ...cfg } = o.cfg;
  return { ...cfg, hasPassword: secrets.has(passwordRef), state: { ...o.state } };
}

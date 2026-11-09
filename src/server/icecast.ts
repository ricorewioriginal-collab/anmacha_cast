// Broadcast Adapter: Icecast-kompatibler Source-Client (HTTP PUT, Icecast >= 2.4).
// Optionaler "?prio=<n>"-Parameter für Server, die Source Priority per Query unterstützen
// (z. B. laut.fm laut Forum-Ankündigung).

import { request as httpRequest, type ClientRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export type OutputType = 'icecast' | 'shoutcast';

export interface OutputConfig {
  id: string;
  stationId: string;
  name: string;
  type: OutputType;
  host: string;
  port: number;
  mount: string;
  username: string;
  passwordRef: string;
  tls: boolean;
  /** Relay-Ziel dieser Ausgabe (Source-Target, z. B. "/live") */
  sourceTarget: string;
  /** Optional: Priorität per Query-Parameter "?prio=" */
  priority?: number;
  /** SHOUTcast v2: Stream-ID (sid); leer = SHOUTcast v1 */
  streamId?: number;
  /** Angezeigte Bitrate (icy-br) */
  bitrateKbps?: number;
  /** Zusatz-Streams: statt des Hauptencoders ein benanntes Zusatzprofil (z. B. "Mobile AAC 64k") senden */
  profileId?: string;
  /** Zusatz-Streams-Failover: id eines anderen Ausgangs; springt nur ein, solange dieser nicht "connected" ist */
  failoverFor?: string;
  /** Von „Verbreitung → Eigene Streams“ angelegt (zählt zum Limit von 2 je Sender) */
  own?: boolean;
  enabled: boolean;
}

/** Gemeinsame Schnittstelle aller Sende-Ausgänge. */
export interface BroadcastOutput {
  readonly cfg: OutputConfig;
  readonly state: OutputState;
  start(contentType: string, init?: Buffer): void;
  stop(): void;
  write(chunk: Buffer): void;
  updateMetadata(song: string): void;
}

export type OutputStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'unsupported';

export interface OutputState {
  status: OutputStatus;
  error?: string;
  errorCategory?: 'auth' | 'mount_in_use' | 'network' | 'server' | 'unsupported';
  bytesSent: number;
  droppedChunks: number;
  connectedAt?: number;
  contentType?: string;
  /** Hörerzahl laut Server-Statistik (null = unbekannt) */
  listeners?: number | null;
}

export const OUTPUT_CAPABILITIES: Record<OutputType, { streaming: boolean; metadata: boolean; note: string }> = {
  icecast: { streaming: true, metadata: true, note: 'HTTP PUT Source-Protokoll (Icecast 2.4+), optional ?prio=' },
  shoutcast: { streaming: true, metadata: true, note: 'Legacy-Source-Protokoll (Port+1), v1 und v2 (mit Stream-ID); nur MP3/AAC' },
};

export function buildMountPath(cfg: Pick<OutputConfig, 'mount' | 'priority'>): string {
  const mount = cfg.mount.startsWith('/') ? cfg.mount : `/${cfg.mount}`;
  if (cfg.priority === undefined) return mount;
  if (!Number.isSafeInteger(cfg.priority) || cfg.priority < 1) throw new Error('priority muss eine positive Ganzzahl sein');
  return `${mount}?prio=${cfg.priority}`;
}

const MAX_BUFFERED = 512 * 1024;

export class IcecastOutput implements BroadcastOutput {
  readonly cfg: OutputConfig;
  readonly state: OutputState = { status: 'idle', bytesSent: 0, droppedChunks: 0 };
  private req: ClientRequest | null = null;
  private readonly password: () => string | undefined;
  private readonly onChange: (s: OutputState) => void;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelay = 2000;
  private wanted: { contentType: string; init?: Buffer } | null = null;
  private song: string | null = null;
  private metaTimer: NodeJS.Timeout | null = null;

  constructor(cfg: OutputConfig, password: () => string | undefined, onChange: (s: OutputState) => void = () => {}) {
    this.cfg = cfg;
    this.password = password;
    this.onChange = onChange;
  }

  /** Startet (oder startet neu) mit neuem Format, z. B. nach einem Source-Takeover. */
  start(contentType: string, init?: Buffer): void {
    if (!this.cfg.enabled) return;
    this.wanted = { contentType, init };
    this.retryDelay = 2000;
    this.open();
  }

  stop(): void {
    this.wanted = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.close();
    this.set({ status: 'idle', error: undefined, errorCategory: undefined });
  }

  write(chunk: Buffer): void {
    const req = this.req;
    if (!req || this.state.status !== 'connected') return;
    // Live-Audio: lieber Chunks verwerfen als unbegrenzt puffern.
    if (req.writableLength > MAX_BUFFERED) {
      this.state.droppedChunks++;
      return;
    }
    req.write(chunk);
    this.state.bytesSent += chunk.length;
  }

  /**
   * Titel-Metadaten über die Icecast-Admin-Schnittstelle (wirksam für MP3/AAC-Streams). Der Titel wird
   * gemerkt: Verbindet der Encoder erst später (oder neu nach einem Abbruch), bekommt Icecast ihn sofort,
   * statt bis zum nächsten Titel ohne Anzeige zu bleiben.
   */
  updateMetadata(song: string): void {
    this.song = song;
    this.sendMetadata();
  }

  private sendMetadata(): void {
    const pass = this.password();
    const song = this.song;
    if (this.state.status !== 'connected' || !pass || !song) return;
    const mount = this.cfg.mount.startsWith('/') ? this.cfg.mount : `/${this.cfg.mount}`;
    const doRequest = this.cfg.tls ? httpsRequest : httpRequest;
    const req = doRequest({
      host: this.cfg.host,
      port: this.cfg.port,
      method: 'GET',
      // charset=UTF-8: sonst liest Icecast 2.4 den Titel als ISO-8859-1 (Umlaute kaputt)
      path: `/admin/metadata?mount=${encodeURIComponent(mount)}&mode=updinfo&charset=UTF-8&song=${encodeURIComponent(song)}`,
      headers: { Authorization: 'Basic ' + Buffer.from(`${this.cfg.username}:${pass}`).toString('base64'), 'User-Agent': 'AnMaCha Cast' },
      timeout: 5000,
    });
    req.on('response', (res) => res.resume());
    req.on('timeout', () => req.destroy());
    req.on('error', () => {}); // Metadaten sind best effort
    req.end();
  }

  private open(): void {
    this.close();
    const wanted = this.wanted;
    if (!wanted) return;
    const pass = this.password();
    if (!pass) {
      this.set({ status: 'error', error: 'Kein Passwort hinterlegt', errorCategory: 'auth' });
      return;
    }
    this.set({ status: 'connecting', error: undefined, errorCategory: undefined, contentType: wanted.contentType });
    const doRequest = this.cfg.tls ? httpsRequest : httpRequest;
    const req = doRequest({
      host: this.cfg.host,
      port: this.cfg.port,
      method: 'PUT',
      path: buildMountPath(this.cfg),
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.cfg.username}:${pass}`).toString('base64'),
        'Content-Type': wanted.contentType,
        'Ice-Public': '0',
        'Ice-Name': this.cfg.name,
        'User-Agent': 'AnMaCha Cast/0.3',
      },
    });
    // Audio als rohen Datenstrom senden, nicht „chunked“: Icecast 2.4 entpackt keine Chunks und reicht sonst
    // die Chunk-Kennungen (z. B. „\r\n1a2\r\n“) mitten im MP3/AAC/Ogg an die Hörer weiter (Aussetzer,
    // Decoderfehler). Ohne Transfer-Encoding und ohne Länge endet der Body mit der Verbindung.
    req.removeHeader('Transfer-Encoding');
    this.req = req;
    req.on('response', (res) => {
      res.resume();
      if (res.statusCode === 200) {
        this.retryDelay = 2000;
        // Status ist meist schon "connected" (siehe unten) - hier nur der Zeitstempel, falls die
        // Antwort doch vor dem ersten Schreiben kam.
        if (this.state.status !== 'connected') this.set({ status: 'connected', connectedAt: Date.now() });
        // Jetzt existiert der Mountpoint sicher: aktuellen Titel nachreichen
        this.sendMetadata();
        return;
      }
      const code = res.statusCode ?? 0;
      const category = code === 401 || code === 403 ? 'auth' : code === 409 ? 'mount_in_use' : 'server';
      this.fail(`Server antwortete ${code}`, category, category !== 'auth');
    });
    req.on('error', (err) => this.fail(err.message, 'network', true));
    req.on('close', () => {
      if (this.req === req && (this.state.status === 'connected' || this.state.status === 'connecting')) this.fail('Verbindung getrennt', 'network', true);
    });
    req.flushHeaders();
    // Nicht auf die HTTP-Antwort warten, bevor Audiodaten geschickt werden: Manche Icecast-kompatible
    // Server (u. a. vermutlich laut.fm) antworten selbst erst, sobald Audiodaten ankommen - wer hier
    // wartet, blockiert sich mit dem Server gegenseitig (Deadlock, siehe test/icecast.test.ts). Ein
    // späterer Fehlerstatus (401/403/409/5xx) wirft trotzdem in den Fehlerzustand zurück.
    this.set({ status: 'connected', connectedAt: Date.now() });
    if (wanted.init) this.write(wanted.init);
    // Für Server, die erst spät (oder nie) mit 200 antworten: Titel kurz nach dem Verbinden nachreichen,
    // sobald Icecast den Mountpoint angelegt hat.
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null;
      if (this.req === req) this.sendMetadata();
    }, 1500);
    this.metaTimer.unref();
  }

  private fail(message: string, category: OutputState['errorCategory'], retry: boolean): void {
    this.close();
    this.set({ status: 'error', error: message, errorCategory: category });
    // Auth-Fehler nicht endlos wiederholen.
    if (retry && this.wanted && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.open();
      }, this.retryDelay);
      this.retryTimer.unref();
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    }
  }

  private close(): void {
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.metaTimer = null;
    const req = this.req;
    this.req = null;
    if (req) {
      req.removeAllListeners('close');
      req.on('error', () => {});
      req.destroy();
    }
  }

  private set(patch: Partial<OutputState>): void {
    Object.assign(this.state, patch);
    this.onChange(this.state);
  }
}

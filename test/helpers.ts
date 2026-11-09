import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import type { AnMaChaCastApp } from '../src/server/app.ts';

/** Alles, was im Datenordner liegt (Datenbank samt WAL, JSON, Logs) als Text – für „nie im Klartext“-Prüfungen. */
export function storedText(app: AnMaChaCastApp): string {
  app.docs.flushSync();
  return readdirSync(app.dataDir)
    .filter((f) => statSync(join(app.dataDir, f)).isFile())
    .map((f) => readFileSync(join(app.dataDir, f)).toString('latin1'))
    .join('\n');
}

export interface IceReq { method: string; url: string; headers: Record<string, string> }

/**
 * Icecast-Nachbau auf TCP-Ebene wie der echte Icecast 2.4: liest den Body einer PUT/SOURCE-Verbindung
 * als rohen Datenstrom (keine HTTP-Chunks!). GET-Anfragen (Status, /admin/metadata) werden mit 200
 * beantwortet und über `onGet` gemeldet. `status` entscheidet über die Antwort der Quellverbindung,
 * `respondAfterData` antwortet erst nach den ersten Audiodaten (laut.fm-Verhalten).
 */
export function rawIcecast(opts: {
  status?: (r: IceReq) => number;
  onSource?: (r: IceReq) => void;
  onData?: (d: Buffer, r: IceReq) => void;
  onGet?: (r: IceReq) => void;
  respondAfterData?: boolean;
} = {}): IceServer {
  const socks = new Set<Socket>();
  const server = createNetServer((sock) => {
    socks.add(sock);
    sock.on('close', () => socks.delete(sock));
    let head = Buffer.alloc(0);
    let req: IceReq | null = null;
    let answered = false;
    sock.on('error', () => {});
    const answer = () => {
      if (answered) return;
      answered = true;
      sock.write('HTTP/1.0 200 OK\r\nServer: Icecast 2.4.4\r\n\r\n');
    };
    const data = (d: Buffer, r: IceReq) => {
      if (opts.respondAfterData) answer();
      opts.onData?.(d, r);
    };
    sock.on('data', (d: Buffer) => {
      if (req) return data(d, req);
      head = Buffer.concat([head, d]);
      const i = head.indexOf('\r\n\r\n');
      if (i < 0) return;
      const [line = '', ...lines] = head.subarray(0, i).toString('latin1').split('\r\n');
      const [method = '', url = ''] = line.split(' ');
      const headers: Record<string, string> = {};
      for (const l of lines) {
        const k = l.indexOf(':');
        if (k > 0) headers[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim();
      }
      const r: IceReq = { method, url, headers };
      if (method === 'GET' || url.startsWith('/admin/')) {
        opts.onGet?.(r);
        sock.end('HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n{}');
        return;
      }
      const code = opts.status?.(r) ?? 200;
      if (code !== 200) {
        sock.end(`HTTP/1.0 ${code} Error\r\n\r\n`);
        return;
      }
      req = r;
      opts.onSource?.(r);
      if (!opts.respondAfterData) answer();
      const rest = head.subarray(i + 4);
      if (rest.length) data(rest, r);
    });
  }) as IceServer;
  server.closeAllConnections = () => { for (const s of socks) s.destroy(); };
  return server;
}

export type IceServer = NetServer & { closeAllConnections(): void };

/** Server auf 127.0.0.1 mit freiem Port starten. */
export function listenLocal(s: NetServer): Promise<number> {
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)));
}

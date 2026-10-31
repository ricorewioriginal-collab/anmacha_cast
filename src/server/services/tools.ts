// Cast Tools: originale Open-Source-Anwendungen von ArtCraft (github.com/storytold, Apache-2.0) als Werkzeuge für AnMaCha Cast,
// unter eigenen Namen. Nichts wird nachgebaut oder mitgeliefert: die Web-Fassung einer Anwendung lädt der Server erst bei Bedarf
// aus dem offiziellen GitHub-Release, prüft sie gegen SHA256SUMS.txt desselben Releases und stellt sie unter /tools/<id>/ bereit.
// Die Windows-App lädt die Desktop-Fassung (portable ZIP) genauso direkt auf den PC.
//
// Lizenz: Apache-2.0 (bzw. MIT/Apache-2.0); LICENSE-Dateien bleiben im entpackten Ordner. Geändert wird nur der Seitentitel/
// Ladehinweis der index.html (Name in AnMaCha Cast) – das steht in THIRD_PARTY_COMPONENTS.md.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AnMaChaCastApp } from '../app.ts';
import { AppError } from '../model.ts';
import { envVar } from '../env.ts';
import { readZip, ZipError } from '../zip.ts';

export interface CastTool {
  id: string;
  /** Name in AnMaCha Cast */
  name: string;
  /** Wofür im Radioalltag */
  purpose: string;
  /** Originalanwendung und Quelle */
  upstream: string;
  repo: string;
  license: string;
}

export const CAST_TOOLS: readonly CastTool[] = [
  { id: 'cast-sound', name: 'Cast Sound', purpose: 'Mehrspur-Audio: Jingles, Trailer, Mitschnitte und Voicetracks schneiden und mischen', upstream: 'SoundCraft', repo: 'storytold/soundcraft', license: 'Apache-2.0' },
  { id: 'cast-photo', name: 'Cast Photo', purpose: 'Bilder: Cover, Senderlogo, Podcast- und Social-Media-Grafiken bearbeiten', upstream: 'PhotoCraft', repo: 'storytold/photocraft', license: 'Apache-2.0' },
  { id: 'cast-film', name: 'Cast Film', purpose: 'Video: Video-Podcasts, Clips und Motion-Mix-Videos schneiden', upstream: 'FilmCraft', repo: 'storytold/filmcraft', license: 'Apache-2.0' },
  { id: 'cast-vector', name: 'Cast Vector', purpose: 'Vektorgrafik: Logos, Sender-Branding und Banner in jeder Größe', upstream: 'VectorCraft', repo: 'storytold/vectorcraft', license: 'Apache-2.0' },
  { id: 'cast-word', name: 'Cast Word', purpose: 'Texte: Moderationstexte, Sendeablauf und Show-Prep als Dokument', upstream: 'WordCraft', repo: 'storytold/wordcraft', license: 'Apache-2.0' },
  { id: 'cast-effect', name: 'Cast Effect', purpose: 'Motion Graphics: bewegte Intros, Bauchbinden und Visuals für Videos und Streams', upstream: 'EffectCraft', repo: 'storytold/effectcraft', license: 'Apache-2.0' },
];

export const TOOL_ID = /^cast-[a-z]+$/;

interface Installed {
  version: string;
  installedAt: string;
  sha256: string;
  size: number;
  /** Ordner mit index.html, relativ zu tools/<id>/ */
  dir: string;
}

type Fetch = typeof fetch;

const MAX_DOWNLOAD = 150 * 1024 * 1024;

export class ToolsService {
  private readonly app: AnMaChaCastApp;
  private readonly busy = new Set<string>();
  fetchFn: Fetch = fetch;
  /** Für Tests: eigener Release-Server statt api.github.com */
  apiBase = envVar(process.env, 'TOOLS_API_URL') || 'https://api.github.com';

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  private root(id: string): string {
    return join(this.app.dataDir, 'tools', id);
  }

  tool(id: string): CastTool {
    const t = CAST_TOOLS.find((x) => x.id === id);
    if (!t) throw new AppError(404, 'not_found', 'Werkzeug nicht gefunden');
    return t;
  }

  installed(id: string): Installed | null {
    try {
      const m = JSON.parse(readFileSync(join(this.root(id), 'installed.json'), 'utf8')) as Installed;
      return existsSync(join(this.root(id), m.dir, 'index.html')) ? m : null;
    } catch {
      return null;
    }
  }

  /** Ordner mit der bereitgestellten Web-Fassung (für /tools/<id>/…) oder null. */
  webRoot(id: string): string | null {
    if (!TOOL_ID.test(id)) return null;
    const m = this.installed(id);
    return m ? join(this.root(id), m.dir) : null;
  }

  list(): unknown[] {
    return CAST_TOOLS.map((t) => {
      const m = this.installed(t.id);
      return { ...t, source: `https://github.com/${t.repo}`, web: m ? { installed: true, version: m.version, size: m.size, url: `/tools/${t.id}/` } : { installed: false }, installing: this.busy.has(t.id) };
    });
  }

  private async get(url: string, accept: string, timeoutMs: number): Promise<Response> {
    let r: Response;
    try {
      r = await this.fetchFn(url, { headers: { Accept: accept, 'User-Agent': 'AnMaCha Cast' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new AppError(502, 'upstream_unreachable', `GitHub nicht erreichbar: ${(err as Error).message}`);
    }
    if (r.status === 403 || r.status === 429) throw new AppError(503, 'rate_limited', 'GitHub begrenzt gerade die Anfragen – bitte in einer Stunde erneut versuchen');
    if (!r.ok) throw new AppError(502, 'upstream_error', `GitHub antwortete mit HTTP ${r.status}`);
    return r;
  }

  /** Neueste Web-Fassung aus dem offiziellen Release laden, prüfen und bereitstellen. */
  async install(id: string): Promise<unknown> {
    const t = this.tool(id);
    if (this.busy.has(id)) throw new AppError(409, 'busy', `${t.name} wird gerade geladen`);
    this.busy.add(id);
    try {
      const rel = await (await this.get(`${this.apiBase}/repos/${t.repo}/releases/latest`, 'application/vnd.github+json', 20_000).catch((e: AppError) => {
        if (e.message.includes('404')) throw new AppError(404, 'no_release', `${t.name}: Für ${t.upstream} gibt es noch keine Veröffentlichung – bitte später erneut versuchen`);
        throw e;
      })).json() as { tag_name?: string; assets?: { name: string; size: number; browser_download_url: string }[] };
      const assets = rel.assets ?? [];
      const repoName = t.repo.split('/')[1]!;
      const zip = assets.find((a) => new RegExp(`^${repoName}-web-[0-9][0-9A-Za-z.+-]*\\.zip$`).test(a.name));
      const sums = assets.find((a) => a.name === 'SHA256SUMS.txt');
      if (!zip) throw new AppError(404, 'no_web_build', `${t.name}: Das aktuelle Release (${rel.tag_name ?? '?'}) enthält keine Web-Fassung – die Desktop-Fassung gibt es in der Windows-App`);
      if (!sums) throw new AppError(502, 'no_checksums', `${t.name}: Das Release enthält keine Prüfsummen – aus Sicherheitsgründen nicht geladen`);
      if (zip.size > MAX_DOWNLOAD) throw new AppError(413, 'too_large', `${t.name}: Web-Fassung ist ungewöhnlich groß (${Math.round(zip.size / 1e6)} MB)`);
      const sumText = await (await this.get(sums.browser_download_url, 'text/plain', 30_000)).text();
      const expected = sumText.split(/\r?\n/).map((l) => l.trim().split(/\s+\*?/)).find((p) => p[1] === zip.name)?.[0]?.toLowerCase();
      if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new AppError(502, 'no_checksum', `${t.name}: Keine Prüfsumme für ${zip.name}`);
      const buf = Buffer.from(await (await this.get(zip.browser_download_url, 'application/octet-stream', 300_000)).arrayBuffer());
      if (buf.length > MAX_DOWNLOAD) throw new AppError(413, 'too_large', `${t.name}: Download zu groß`);
      const got = createHash('sha256').update(buf).digest('hex');
      if (got !== expected) throw new AppError(502, 'checksum_mismatch', `${t.name}: Prüfsumme stimmt nicht – Download verworfen`);

      let entries;
      try {
        entries = readZip(buf);
      } catch (err) {
        throw new AppError(502, 'bad_archive', `${t.name}: ${(err as ZipError).message}`);
      }
      const index = entries.filter((e) => !e.dir && /(^|\/)index\.html$/.test(e.name)).sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
      if (!index) throw new AppError(502, 'bad_archive', `${t.name}: Web-Fassung ohne index.html`);
      const prefix = index.name.slice(0, -'index.html'.length);
      const version = (rel.tag_name ?? zip.name).replace(/[^0-9A-Za-z.+-]/g, '').replace(/^\.+|\.+$/g, '').slice(0, 40) || 'unbekannt';
      const root = this.root(id);
      const tmp = join(root, `.neu-${Date.now()}`);
      mkdirSync(tmp, { recursive: true });
      try {
        for (const e of entries) {
          if (e.dir || !e.name.startsWith(prefix)) continue;
          const rel = e.name.slice(prefix.length);
          if (!rel) continue;
          const file = join(tmp, rel);
          mkdirSync(dirname(file), { recursive: true });
          let data = e.data!;
          // Nur der Name in Titel und Ladehinweis wird angepasst; Skripte, WebAssembly und Lizenzen bleiben unverändert
          if (rel === 'index.html') data = Buffer.from(data.toString('utf8').split(t.upstream).join(t.name), 'utf8');
          writeFileSync(file, data);
        }
        const dir = `v-${version}`;
        rmSync(join(root, dir), { recursive: true, force: true });
        renameSync(tmp, join(root, dir));
        const info: Installed = { version, installedAt: new Date().toISOString(), sha256: got, size: buf.length, dir };
        writeFileSync(join(root, 'installed.json'), JSON.stringify(info, null, 1));
        // Ältere Fassungen entfernen
        for (const old of readdirSync(root)) if (old.startsWith('v-') && old !== dir) rmSync(join(root, old), { recursive: true, force: true });
        this.app.audit.write({ kind: 'tools', event: 'installed', tool: id, version, sha256: got });
        return { ...this.list().find((x) => (x as CastTool).id === id) as object };
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    } finally {
      this.busy.delete(id);
    }
  }

  remove(id: string): unknown {
    this.tool(id);
    rmSync(this.root(id), { recursive: true, force: true });
    this.app.audit.write({ kind: 'tools', event: 'removed', tool: id });
    return this.list().find((x) => (x as CastTool).id === id);
  }
}

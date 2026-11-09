// Lokale KI auf diesem PC/Server – ohne Cloud und ohne Key, Modelle immer aktuell von den offiziellen Quellen:
//  • Text: Ollama (ollama.com). Modelle lädt Ollama selbst aus der offiziellen Bibliothek („ollama pull“ über die API) –
//    „name“ ohne Version holt immer die aktuelle Fassung. Ollama selbst installiert die Windows-App (offizielles Setup).
//  • Sprache: Piper (offline-TTS). Programm aus dem offiziellen Release (github.com/rhasspy/piper), Stimmen aus dem
//    offiziellen Stimmenkatalog (huggingface.co/rhasspy/piper-voices, voices.json) – deutsche Stimmen zuerst.
// Was installiert ist, legt automatisch einen passenden Anbieter an (Ollama lokal, Piper lokal).

import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AppError } from '../model.ts';
import { readZip, safeEntryName } from '../zip.ts';

type Fetch = typeof fetch;

/** Ollama-Modellname wie in der Bibliothek: „qwen3“, „llama3.2:3b“, „hf.co/…“ – nichts, was die URL verbiegt. */
export const MODEL_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+)*(?::[a-z0-9._-]+)?$/i;
/** Piper-Stimme im Katalog, z. B. „de_DE-thorsten-medium“. */
export const VOICE_RE = /^[a-z]{2,3}_[A-Z]{2}-[a-z0-9_]+-(?:x_low|low|medium|high)$/;

const OLLAMA = 'http://127.0.0.1:11434';
const PIPER_RELEASE = 'https://api.github.com/repos/rhasspy/piper/releases/latest';
const VOICES = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

export interface PullJob { model: string; status: string; completed: number; total: number; done: boolean; error?: string; startedAt: number }
export interface CatalogVoice { key: string; name: string; language: string; quality: string; sizeMb: number; installed: boolean }

/** Asset des Piper-Release für dieses System (null = keine fertige Fassung). */
export function piperAsset(platform: string, arch: string): string | null {
  if (platform === 'win32' && (arch === 'x64' || arch === 'arm64')) return 'piper_windows_amd64.zip'; // läuft auf ARM per Emulation
  if (platform === 'linux' && arch === 'x64') return 'piper_linux_x86_64.tar.gz';
  if (platform === 'linux' && arch === 'arm64') return 'piper_linux_aarch64.tar.gz';
  if (platform === 'linux' && arch === 'arm') return 'piper_linux_armv7l.tar.gz';
  if (platform === 'darwin') return arch === 'arm64' ? 'piper_macos_aarch64.tar.gz' : 'piper_macos_x64.tar.gz';
  return null;
}

export class LocalAi {
  readonly jobs = new Map<string, PullJob>();
  private catalog: { at: number; voices: Record<string, any> } | null = null;
  piperBusy = '';

  private readonly dataDir: string;
  fetchFn: Fetch;
  private readonly ollama: string;
  private readonly platform: string;
  private readonly arch: string;

  constructor(dataDir: string, fetchFn: Fetch = fetch, ollama = OLLAMA, platform: string = process.platform, arch: string = process.arch) {
    this.dataDir = dataDir;
    this.fetchFn = fetchFn;
    this.ollama = ollama;
    this.platform = platform;
    this.arch = arch;
  }

  get piperDir(): string { return join(this.dataDir, 'ai', 'piper'); }
  get voicesDir(): string { return join(this.piperDir, 'voices'); }

  /** Programmdatei von Piper, wenn installiert. */
  piperBin(): string | null {
    const bin = join(this.piperDir, 'piper', this.platform === 'win32' ? 'piper.exe' : 'piper');
    return existsSync(bin) ? bin : null;
  }

  /** Installierte Stimmen (Pfad zur .onnx = Stimmen-ID für den Piper-Anbieter). */
  piperVoices(): { id: string; name: string }[] {
    if (!existsSync(this.voicesDir)) return [];
    return readdirSync(this.voicesDir).filter((f) => f.endsWith('.onnx') && existsSync(join(this.voicesDir, `${f}.json`)))
      .sort().map((f) => ({ id: join(this.voicesDir, f), name: f.replace(/\.onnx$/, '') }));
  }

  // ---------- Ollama ----------

  private async ollamaGet(path: string): Promise<any> {
    const r = await this.fetchFn(this.ollama + path, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async status(): Promise<unknown> {
    let ollama: { running: boolean; version?: string; models: { name: string; sizeMb: number; modifiedAt?: string }[] } = { running: false, models: [] };
    try {
      const v = await this.ollamaGet('/api/version');
      const t = await this.ollamaGet('/api/tags');
      ollama = {
        running: true, version: String(v?.version ?? ''),
        models: (Array.isArray(t?.models) ? t.models : []).map((m: any) => ({ name: String(m.name ?? ''), sizeMb: Math.round(Number(m.size ?? 0) / 1e6), modifiedAt: m.modified_at })).filter((m: { name: string }) => m.name),
      };
    } catch { /* Ollama nicht installiert oder nicht gestartet */ }
    return {
      platform: this.platform,
      ollama,
      pulls: [...this.jobs.values()],
      piper: { installed: !!this.piperBin(), supported: !!piperAsset(this.platform, this.arch), busy: this.piperBusy, error: this.piperError, voices: this.piperVoices().map((v) => v.name) },
    };
  }

  /** Modell aus der offiziellen Ollama-Bibliothek laden (läuft im Hintergrund, Fortschritt über status()). */
  pull(model: string): PullJob {
    const name = model.trim();
    if (!MODEL_RE.test(name) || name.length > 120) throw new AppError(400, 'invalid_model', 'Modellname wie in der Ollama-Bibliothek angeben, z. B. „qwen3“ oder „llama3.2:3b“');
    const running = this.jobs.get(name);
    if (running && !running.done) return running;
    const job: PullJob = { model: name, status: 'startet', completed: 0, total: 0, done: false, startedAt: Date.now() };
    this.jobs.set(name, job);
    void this.runPull(job);
    return job;
  }

  private async runPull(job: PullJob): Promise<void> {
    try {
      const r = await this.fetchFn(`${this.ollama}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: job.model, stream: true }) });
      if (!r.ok || !r.body) throw new Error(r.status === 404 ? 'Modell nicht gefunden' : `Ollama antwortete mit HTTP ${r.status}`);
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const j = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
          if (j.error) throw new Error(j.error);
          if (j.status) job.status = j.status;
          if (typeof j.total === 'number') { job.total = j.total; job.completed = j.completed ?? 0; }
        }
      }
      if (job.status !== 'success') throw new Error(job.status || 'abgebrochen');
    } catch (err) {
      const msg = (err as Error).message;
      job.error = /fetch failed|ECONNREFUSED/i.test(msg) ? 'Ollama läuft nicht – zuerst Ollama installieren/starten' : msg.slice(0, 200);
    } finally {
      job.done = true;
      // erledigte Aufträge nach 10 Minuten vergessen
      setTimeout(() => { if (this.jobs.get(job.model) === job) this.jobs.delete(job.model); }, 600_000).unref?.();
    }
  }

  async deleteModel(model: string): Promise<void> {
    if (!MODEL_RE.test(model)) throw new AppError(400, 'invalid_model', 'Ungültiger Modellname');
    let r: Response;
    try {
      r = await this.fetchFn(`${this.ollama}/api/delete`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(15_000) });
    } catch { throw new AppError(502, 'ollama_down', 'Ollama läuft nicht'); }
    if (!r.ok) throw new AppError(r.status === 404 ? 404 : 502, 'ollama_error', r.status === 404 ? 'Modell nicht vorhanden' : `Ollama antwortete mit HTTP ${r.status}`);
  }

  // ---------- Piper ----------

  private async get(url: string, timeoutMs: number, what: string): Promise<Response> {
    let r: Response;
    try {
      r = await this.fetchFn(url, { headers: { 'User-Agent': 'AnMaCha Cast', Accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) { throw new AppError(502, 'upstream_unreachable', `${what} nicht erreichbar: ${(err as Error).message}`); }
    if (r.status === 403 || r.status === 429) throw new AppError(503, 'rate_limited', `${what} begrenzt gerade die Anfragen – bitte später erneut versuchen`);
    if (!r.ok) throw new AppError(502, 'upstream_error', `${what} antwortete mit HTTP ${r.status}`);
    return r;
  }

  /** Stimmenkatalog (offiziell, eine Stunde zwischengespeichert); Sprache z. B. „de“, leer = alle. */
  async voiceCatalog(lang = 'de'): Promise<CatalogVoice[]> {
    if (!this.catalog || Date.now() - this.catalog.at > 3_600_000) {
      const r = await this.get(`${VOICES}/voices.json`, 30_000, 'Piper-Stimmenkatalog (Hugging Face)');
      this.catalog = { at: Date.now(), voices: (await r.json()) as Record<string, any> };
    }
    const installed = new Set(this.piperVoices().map((v) => v.name));
    return Object.entries(this.catalog.voices)
      .filter(([key, v]) => VOICE_RE.test(key) && (!lang || String(v?.language?.family ?? '') === lang))
      .map(([key, v]) => {
        const onnx = Object.entries((v?.files ?? {}) as Record<string, { size_bytes?: number }>).find(([f]) => f.endsWith('.onnx'));
        return {
          key, name: String(v?.name ?? key), language: String(v?.language?.name_native ?? v?.language?.code ?? ''), quality: String(v?.quality ?? ''),
          sizeMb: Math.round((onnx?.[1]?.size_bytes ?? 0) / 1e6), installed: installed.has(key),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Piper-Programm aus dem offiziellen Release laden und entpacken. */
  async installPiper(): Promise<string> {
    const asset = piperAsset(this.platform, this.arch);
    if (!asset) throw new AppError(501, 'unsupported', 'Für dieses System gibt es kein fertiges Piper – bitte einen OpenAI-kompatiblen Sprachdienst nutzen');
    if (this.piperBusy) throw new AppError(409, 'busy', 'Piper wird gerade eingerichtet');
    this.piperBusy = 'Piper wird geladen';
    try {
      const rel = (await (await this.get(PIPER_RELEASE, 20_000, 'GitHub')).json()) as { assets?: { name: string; browser_download_url: string; size?: number }[] };
      const a = rel.assets?.find((x) => x.name === asset);
      if (!a || !a.browser_download_url.startsWith('https://github.com/rhasspy/piper/releases/download/')) throw new AppError(502, 'no_asset', 'Im offiziellen Piper-Release fehlt die Fassung für dieses System');
      const data = Buffer.from(await (await this.get(a.browser_download_url, 600_000, 'GitHub')).arrayBuffer());
      if (data.length > 200 * 1024 * 1024) throw new AppError(502, 'too_large', 'Piper-Paket unerwartet groß');
      const tmp = join(this.piperDir, '.neu');
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true });
      if (asset.endsWith('.zip')) {
        for (const e of readZip(data, { maxEntries: 5000, maxTotal: 500 * 1024 * 1024 })) {
          const name = safeEntryName(e.name);
          if (!name || e.dir || !e.data) continue;
          const dst = join(tmp, name);
          if (relative(tmp, dst).startsWith('..')) continue;
          mkdirSync(join(dst, '..'), { recursive: true });
          writeFileSync(dst, e.data);
        }
      } else {
        const file = join(tmp, asset);
        writeFileSync(file, data);
        await new Promise<void>((resolve, reject) => {
          const p = spawn('tar', ['-xzf', file, '-C', tmp, '--no-same-owner'], { windowsHide: true });
          p.on('error', reject);
          p.on('close', (code) => (code === 0 ? resolve() : reject(new AppError(500, 'extract_failed', 'Piper ließ sich nicht entpacken'))));
        });
        rmSync(file, { force: true });
      }
      const inner = join(tmp, 'piper');
      if (!existsSync(join(inner, this.platform === 'win32' ? 'piper.exe' : 'piper'))) throw new AppError(502, 'bad_package', 'Piper-Paket ohne Programm');
      if (this.platform !== 'win32') chmodSync(join(inner, 'piper'), 0o755);
      rmSync(join(this.piperDir, 'piper'), { recursive: true, force: true });
      renameSync(inner, join(this.piperDir, 'piper'));
      rmSync(tmp, { recursive: true, force: true });
      return this.piperBin()!;
    } finally {
      this.piperBusy = '';
    }
  }

  /** Eine Stimme (Modell + Konfiguration) aus dem offiziellen Katalog laden. */
  async installVoice(key: string): Promise<string> {
    if (!VOICE_RE.test(key)) throw new AppError(400, 'invalid_voice', 'Unbekannte Stimme');
    const cat = await this.voiceCatalog('');
    if (!cat.some((v) => v.key === key)) throw new AppError(404, 'not_found', 'Stimme nicht im offiziellen Katalog');
    const files = Object.keys(this.catalog!.voices[key].files ?? {}).filter((f) => /^[a-z]{2,3}\/[a-z]{2,3}_[A-Z]{2}\/[a-z0-9_]+\/(?:x_low|low|medium|high)\/[^/]+\.onnx(?:\.json)?$/.test(f));
    const onnx = files.find((f) => f.endsWith('.onnx'));
    const conf = files.find((f) => f.endsWith('.onnx.json'));
    if (!onnx || !conf) throw new AppError(502, 'bad_catalog', 'Stimme im Katalog unvollständig');
    if (this.piperBusy) throw new AppError(409, 'busy', 'Piper lädt gerade');
    this.piperBusy = `Stimme ${key} wird geladen`;
    try {
      mkdirSync(this.voicesDir, { recursive: true });
      const model = Buffer.from(await (await this.get(`${VOICES}/${onnx}`, 900_000, 'Hugging Face')).arrayBuffer());
      const json = Buffer.from(await (await this.get(`${VOICES}/${conf}`, 60_000, 'Hugging Face')).arrayBuffer());
      JSON.parse(json.toString('utf8'));
      writeFileSync(join(this.voicesDir, `${key}.onnx.json`), json);
      writeFileSync(join(this.voicesDir, `${key}.onnx`), model);
      return join(this.voicesDir, `${key}.onnx`);
    } finally {
      this.piperBusy = '';
    }
  }

  /** Fehler der letzten Piper-Einrichtung (Anzeige), leer = alles gut. */
  piperError = '';

  /**
   * Piper einrichten (Programm, falls es fehlt, plus Stimme) im Hintergrund; danach onReady(Programm, Stimme).
   * Der Fortschritt steht in status().piper.busy, ein Fehler in piperError.
   */
  setupPiper(voice: string, onReady: (bin: string, voicePath: string | null) => void): void {
    if (voice && !VOICE_RE.test(voice)) throw new AppError(400, 'invalid_voice', 'Unbekannte Stimme');
    if (!piperAsset(this.platform, this.arch)) throw new AppError(501, 'unsupported', 'Für dieses System gibt es kein fertiges Piper');
    if (this.piperBusy) throw new AppError(409, 'busy', 'Piper wird gerade eingerichtet');
    this.piperError = '';
    this.piperBusy = 'startet';
    void (async () => {
      try {
        this.piperBusy = '';
        const bin = this.piperBin() ?? (await this.installPiper());
        const path = voice ? await this.installVoice(voice) : null;
        onReady(bin, path);
      } catch (err) {
        this.piperError = (err as Error).message.slice(0, 200);
      } finally {
        this.piperBusy = '';
      }
    })();
  }

  removeVoice(key: string): void {
    if (!VOICE_RE.test(key)) throw new AppError(400, 'invalid_voice', 'Unbekannte Stimme');
    for (const f of [`${key}.onnx`, `${key}.onnx.json`]) rmSync(join(this.voicesDir, f), { force: true });
  }

}

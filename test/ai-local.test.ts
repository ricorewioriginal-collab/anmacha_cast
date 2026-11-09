// Lokale KI auf diesem PC: Ollama-Status und Modell-Laden (Fortschritt aus der NDJSON-Antwort), Piper-Stimmen aus dem
// offiziellen Katalog (deutsche zuerst, nur gültige Dateipfade), Anbieter werden automatisch angelegt. Netz gemockt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAi, MODEL_RE, piperAsset } from '../src/server/ai/local.ts';
import { AnMaChaCastApp } from '../src/server/app.ts';

const catalog = {
  'de_DE-thorsten-medium': { name: 'thorsten', language: { family: 'de', code: 'de_DE', name_native: 'Deutsch' }, quality: 'medium', files: { 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx': { size_bytes: 63_000_000 }, 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json': { size_bytes: 5000 } } },
  'en_US-amy-low': { name: 'amy', language: { family: 'en', code: 'en_US' }, quality: 'low', files: { 'en/en_US/amy/low/en_US-amy-low.onnx': {}, 'en/en_US/amy/low/en_US-amy-low.onnx.json': {} } },
  'de_DE-boese-high': { name: 'boese', language: { family: 'de' }, quality: 'high', files: { '../../etc/passwd.onnx': {}, 'x.onnx.json': {} } },
};

function ndjson(lines: object[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200 });
}

test('Modellnamen und Piper-Fassung je System', () => {
  for (const ok of ['qwen3', 'llama3.2:3b', 'hf.co/bartowski/Llama-3.2-1B-GGUF:Q4_K_M', 'gemma3:latest']) assert.ok(MODEL_RE.test(ok), ok);
  for (const bad of ['', '../x', 'a b', 'x:y:z', 'http://evil', '-rm']) assert.ok(!MODEL_RE.test(bad), bad);
  assert.equal(piperAsset('win32', 'x64'), 'piper_windows_amd64.zip');
  assert.equal(piperAsset('linux', 'arm64'), 'piper_linux_aarch64.tar.gz');
  assert.equal(piperAsset('freebsd', 'x64'), null);
});

test('Ollama: Status, Modell laden mit Fortschritt, Fehler verständlich', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-localai-'));
  try {
    let up = true;
    const ai = new LocalAi(dir, (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (!up) throw new TypeError('fetch failed');
      if (u.endsWith('/api/version')) return Response.json({ version: '0.12.0' });
      if (u.endsWith('/api/tags')) return Response.json({ models: [{ name: 'qwen3:latest', size: 5_200_000_000 }] });
      if (u.endsWith('/api/pull')) {
        const model = JSON.parse(String(init?.body)).model;
        if (model === 'gibtsnicht') return ndjson([{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }]);
        return ndjson([{ status: 'pulling manifest' }, { status: 'pulling abc', total: 100, completed: 40 }, { status: 'pulling abc', total: 100, completed: 100 }, { status: 'success' }]);
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch);
    const st = (await ai.status()) as any;
    assert.equal(st.ollama.running, true);
    assert.equal(st.ollama.version, '0.12.0');
    assert.deepEqual(st.ollama.models, [{ name: 'qwen3:latest', sizeMb: 5200, modifiedAt: undefined }]);

    assert.throws(() => ai.pull('../evil'), /Modellname/);
    const job = ai.pull('gemma3');
    assert.equal(ai.pull('gemma3'), job, 'läuft schon – derselbe Auftrag');
    while (!job.done) await new Promise((r) => setTimeout(r, 5));
    assert.equal(job.error, undefined);
    assert.equal(job.status, 'success');
    assert.equal(job.completed, 100);

    const bad = ai.pull('gibtsnicht');
    while (!bad.done) await new Promise((r) => setTimeout(r, 5));
    assert.match(bad.error!, /does not exist/);

    up = false;
    assert.equal(((await ai.status()) as any).ollama.running, false);
    const down = ai.pull('qwen3');
    while (!down.done) await new Promise((r) => setTimeout(r, 5));
    assert.match(down.error!, /Ollama läuft nicht/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Piper: Stimmenkatalog, Stimme laden/entfernen, Anbieter wird angelegt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-localai-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const fetched: string[] = [];
    app.localAi.fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      fetched.push(u);
      if (u.endsWith('/voices.json')) return Response.json(catalog);
      if (u.endsWith('de_DE-thorsten-medium.onnx')) return new Response(Buffer.alloc(1024, 1));
      if (u.endsWith('de_DE-thorsten-medium.onnx.json')) return Response.json({ audio: { sample_rate: 22050 } });
      return new Response('nope', { status: 404 });
    }) as typeof fetch;

    const de = await app.localAi.voiceCatalog('de');
    assert.deepEqual(de.map((v) => v.key), ['de_DE-boese-high', 'de_DE-thorsten-medium']);
    assert.equal(de.find((v) => v.key === 'de_DE-thorsten-medium')!.sizeMb, 63);
    assert.equal((await app.localAi.voiceCatalog('')).length, 3);

    await assert.rejects(app.localAi.installVoice('de_DE-boese-high'), /unvollständig/, 'Pfade außerhalb des Katalogs werden nicht geladen');
    await assert.rejects(app.localAi.installVoice('de_DE-gibtsnicht-low'), /nicht im offiziellen Katalog/);
    const path = await app.localAi.installVoice('de_DE-thorsten-medium');
    assert.ok(existsSync(path) && existsSync(`${path}.json`));
    assert.ok(fetched.every((u) => u.startsWith('https://huggingface.co/rhasspy/piper-voices/resolve/main/')));
    assert.equal((await app.localAi.voiceCatalog('de')).find((v) => v.key === 'de_DE-thorsten-medium')!.installed, true);

    // Anbieter automatisch, Stimmenliste = installierte Stimmen
    app.ai.ensureProvider({ id: 'piper', name: 'Piper (dieser PC, offline)', role: 'voice', kind: 'piper', binPath: join(dir, 'piper.exe'), preset: 'piper', local: true });
    app.ai.ensureProvider({ id: 'piper', name: 'Piper (dieser PC, offline)', role: 'voice', kind: 'piper', binPath: join(dir, 'piper.exe'), preset: 'piper', local: true });
    const view = app.ai.view() as { providers: { id: string; binPath?: string }[] };
    assert.equal(view.providers.filter((p) => p.id === 'piper').length, 1);
    assert.deepEqual(await app.ai.voices('piper'), [{ id: path, name: 'de_DE-thorsten-medium' }]);

    app.localAi.removeVoice('de_DE-thorsten-medium');
    assert.ok(!existsSync(path));
    assert.throws(() => app.localAi.removeVoice('../x'), /Unbekannte Stimme/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

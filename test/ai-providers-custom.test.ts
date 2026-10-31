// KI-Anbieter frei konfigurierbar: lokale KI (eigener PC/Server), Cloud-Anbieter über Vorlagen und eigene Anbieter mit
// eigenem Key-Header, Zusatz-Headern ({key}-Platzhalter) und Query-Parametern; Suche nach lokalen KI-Servern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';
import { authHeaders, chat, listModels, type ProviderConfig } from '../src/server/ai/providers.ts';
import { PRESETS } from '../src/server/ai/presets.ts';
import { discoverLocal, HOST_RE } from '../src/server/ai/discover.ts';

const prov = (x: Partial<ProviderConfig>): ProviderConfig => ({ id: 'x', name: 'X', role: 'text', kind: 'openai_compat', enabled: true, baseUrl: 'http://ki.local/v1', ...x });

test('Key-Header: Standard Bearer, eigener Header ohne Vorsatz, {key} in Zusatz-Headern', () => {
  assert.deepEqual(authHeaders(prov({}), 'k1'), { Authorization: 'Bearer k1' });
  assert.deepEqual(authHeaders(prov({}), undefined), {}, 'lokal ohne Key: kein Authorization-Header');
  assert.deepEqual(authHeaders(prov({ authHeader: 'api-key', authScheme: '' }), 'k2'), { 'api-key': 'k2' });
  assert.deepEqual(authHeaders(prov({ headers: { 'HTTP-Referer': 'https://radio.example', 'X-Key': '{key}' } }), 'k3'), { 'HTTP-Referer': 'https://radio.example', 'X-Key': 'k3', Authorization: 'Bearer k3' });
  assert.deepEqual(authHeaders(prov({ headers: { 'X-Key': '{key}' } }), undefined), {}, 'Platzhalter-Header entfällt ohne Key');
});

test('Eigener Anbieter: Adresse mit Query, Key im eigenen Header, Antwort wird gelesen', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify({ choices: [{ message: { content: ' Hallo ' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = prov({ baseUrl: 'https://res.openai.azure.com/openai/deployments/radio', authHeader: 'api-key', authScheme: '', query: 'api-version=2024-10-21' });
  const r = await chat(p, 'geheim', { model: 'radio', system: 's', prompt: 'p', maxTokens: 10, timeoutMs: 1000 }, fake);
  assert.equal(r.text, 'Hallo');
  assert.equal(seen[0]!.url, 'https://res.openai.azure.com/openai/deployments/radio/chat/completions?api-version=2024-10-21');
  assert.equal(seen[0]!.headers['api-key'], 'geheim');
  assert.equal(seen[0]!.headers.Authorization, undefined);
});

test('Modelle: ältere Ollama-Version ohne /v1/models → /api/tags', async () => {
  const fake = (async (url: string) => {
    if (url.endsWith('/models')) return new Response('404 page not found', { status: 404 });
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'llama3.2:latest' }, { name: 'gemma3:4b' }] }), { status: 200 });
    return new Response('', { status: 500 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await listModels(prov({ baseUrl: 'http://localhost:11434/v1' }), undefined, fake), ['gemma3:4b', 'llama3.2:latest']);
  // Ohne /v1 in der Adresse gibt es keinen Ausweichweg – der echte Fehler bleibt
  await assert.rejects(listModels(prov({ baseUrl: 'http://localhost:11434' }), undefined, fake), /404/);
});

test('Vorlagen: eindeutige IDs, lokale ohne Key, Cloud mit https', () => {
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
  for (const p of PRESETS) {
    if (p.local) assert.equal(p.needsKey, false, p.id);
    if (!p.local && p.baseUrl) assert.match(p.baseUrl, /^https:\/\//, p.id);
  }
  assert.ok(PRESETS.some((p) => p.id === 'ollama' && p.probe?.port === 11434));
});

test('Einstellungen: eigene Header/Query geprüft, gesperrte Header und Platzhalter-Adressen abgelehnt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-ai-custom-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  try {
    const save = (p: Record<string, unknown>) => app.ai.update({ providers: [{ id: 'eigen', name: 'Eigen', role: 'text', kind: 'openai_compat', baseUrl: 'https://gw.example/v1', ...p }] }) as { providers: Array<ProviderConfig & { hasKey: boolean }>; presets: unknown[] };
    const v = save({ headers: 'HTTP-Referer: https://radio.example\nX-Title: AnMaCha Cast\nX-Key: {key}', query: 'api-version=1&tier=a', authHeader: 'api-key', authScheme: '', key: 'sk-geheim' });
    const p = v.providers[0]!;
    assert.deepEqual(p.headers, { 'HTTP-Referer': 'https://radio.example', 'X-Title': 'AnMaCha Cast', 'X-Key': '{key}' });
    assert.equal(p.query, 'api-version=1&tier=a');
    assert.equal(p.authHeader, 'api-key');
    assert.equal(p.authScheme, '');
    assert.equal(p.hasKey, true);
    assert.equal(JSON.stringify(v).includes('sk-geheim'), false, 'Key taucht in den Einstellungen nicht auf');
    assert.ok(v.presets.length > 10, 'Vorlagen werden mitgeliefert');

    assert.throws(() => save({ headers: 'Host: evil.example' }), /nicht erlaubt/);
    assert.throws(() => save({ headers: 'kaputt' }), /Name: Wert/);
    assert.throws(() => save({ authHeader: 'Content-Length' }), /nicht erlaubt/);
    assert.throws(() => save({ query: 'a b' }), /Query/);
    assert.throws(() => save({ baseUrl: 'https://{resource}.openai.azure.com/openai' }), /Platzhalter/);

    // Lokal: aus Vorlage oder an der Adresse erkannt
    const local = app.ai.update({ providers: [
      { id: 'ollama', name: 'Ollama', role: 'text', kind: 'openai_compat', baseUrl: 'http://localhost:11434/v1', preset: 'ollama' },
      { id: 'lan', name: 'LAN', role: 'text', kind: 'openai_compat', baseUrl: 'http://192.168.1.20:11434/v1', local: true },
      { id: 'cloud', name: 'Mistral', role: 'text', kind: 'openai_compat', baseUrl: 'https://api.mistral.ai/v1', preset: 'mistral' },
    ] }) as { providers: ProviderConfig[] };
    assert.deepEqual(local.providers.map((x) => [x.id, !!x.local, x.preset ?? null]), [['ollama', true, 'ollama'], ['lan', true, null], ['cloud', false, 'mistral']]);
  } finally {
    app.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Lokale Suche: meldet nur echte KI-Server mit ihren Modellen', async () => {
  const fake = (async (url: string) => {
    if (url === 'http://127.0.0.1:11434/v1/models') return new Response(JSON.stringify({ object: 'list', data: [{ id: 'llama3.2' }] }), { status: 200 });
    if (url === 'http://127.0.0.1:8880/v1/models') return new Response(JSON.stringify({ data: [{ id: 'kokoro' }] }), { status: 200 });
    if (url === 'http://127.0.0.1:8080/v1/models') return new Response('<html>Router</html>', { status: 200 });
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const found = await discoverLocal(['127.0.0.1'], { fetchFn: fake, timeoutMs: 200 });
  assert.deepEqual(found.map((f) => [f.preset, f.role, f.baseUrl, f.models]), [
    ['ollama', 'text', 'http://127.0.0.1:11434/v1', ['llama3.2']],
    ['kokoro', 'voice', 'http://127.0.0.1:8880/v1', ['kokoro']],
  ]);
  assert.ok(HOST_RE.test('192.168.1.20') && HOST_RE.test('ki-server.lan') && HOST_RE.test('[::1]'));
  assert.ok(!HOST_RE.test('http://evil') && !HOST_RE.test('a:1234') && !HOST_RE.test('a/b'));
});

test('Lokale Suche über die API: nur für globale Admins, Rechnername wird geprüft', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-ai-disc-'));
  const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
  const { createHttpServer } = await import('../src/server/http.ts');
  const server = createHttpServer(app, join(import.meta.dirname, '../studio'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const admin = app.svc.auth.createToken({ name: 'a', scopes: ['*'], roles: ['admin'], stationIds: ['*'] }).token;
  const editor = app.svc.auth.createToken({ name: 'e', scopes: ['*'], roles: ['editor'], stationIds: ['main'] }).token;
  const post = (tok: string, body: unknown) => fetch(`${root}/api/v1/ai/discover`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(editor, {})).status, 403);
    assert.equal((await post(admin, { host: 'http://evil.example:80/x' })).status, 400);
    const ok = await post(admin, {});
    assert.equal(ok.status, 200);
    const j = (await ok.json()) as { hosts: string[]; found: unknown[] };
    assert.equal(j.hosts[0], '127.0.0.1');
    assert.ok(Array.isArray(j.found));
  } finally {
    app.shutdown();
    server.closeAllConnections();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Echter lokaler Server als Gegenprobe (kein Mock von fetch): Ollama-Nachbau auf zufälligem Port
test('Lokale KI ohne Key: Text über einen echten lokalen Server', async () => {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/v1/models' ? { data: [{ id: 'llama3.2' }] } : { choices: [{ message: { content: 'Lokal geantwortet' } }], usage: {} }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`;
  try {
    const p = prov({ baseUrl, local: true });
    assert.deepEqual(await listModels(p, undefined), ['llama3.2']);
    assert.equal((await chat(p, undefined, { model: 'llama3.2', system: 's', prompt: 'p', maxTokens: 20, timeoutMs: 2000 })).text, 'Lokal geantwortet');
  } finally {
    srv.close();
  }
});

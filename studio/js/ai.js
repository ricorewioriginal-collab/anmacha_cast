// @ts-check
// KI-Automation im Studio: AI Radio Director pro Sender, Anbieter & API-Keys, Kosten/Budgets, Werkzeuge.
// Alle KI-Aufrufe laufen über den AnMaCha Cast-Server – Keys verlassen ihn nie.

import { clockTime, formDialog, h, run, status } from './ui.js';

const TABS = /** @type {const} */ ([['director', 'Director'], ['tools', 'KI-Werkstatt'], ['providers', 'Anbieter & Keys'], ['costs', 'Kosten & Budget']]);
const KIND_LABEL = /** @type {Record<string,string>} */ ({
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google Gemini', openai_compat: 'OpenAI-kompatibel (Ollama, LM Studio, Kokoro …)',
  elevenlabs: 'ElevenLabs', piper: 'Piper (lokal, offline)',
});
const DECISION = /** @type {Record<string,string>} */ ({ break: 'Moderation', news: 'Nachrichten', music: 'Musikplanung', approved: 'Freigegeben', rejected: 'Verworfen', source: 'Quelle' });

/** @typedef {{ api: import('./api.js').Api, url: (p: string) => string, mediaUrl: (id: string) => string, library?: () => any[], me?: () => any }} Ctx */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountAi(root, ctx) {
  let tab = 'director';
  /** @type {any} */ let settings = null;
  /** @type {any} */ let station = null;
  /** @type {HTMLAudioElement|null} */ let pre = null;
  const content = h('div', { class: 'lf-content' });

  /** @param {string} title @param {...(Node|string|null|false)} body */
  const card = (title, ...body) => h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, title)), ...body);
  /** @param {string} k @param {any} v */
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v === null || v === undefined || v === '' ? '–' : String(v)));
  const money = (/** @type {number} */ v) => `${(v ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${settings?.currency ?? 'EUR'}`;
  const byRole = (/** @type {'text'|'voice'} */ r) => (settings?.providers ?? []).filter((/** @type {any} */ p) => p.role === r);

  /** @type {any[]} */ let health = [];

  async function load() {
    // Einstellungen sind nur für globale Admins sichtbar; Sender-Ansicht auch für Redakteure
    const m = ctx.me?.();
    const globalAdmin = !m || ((m.roles ?? []).includes('admin') && (m.stationIds ?? []).includes('*'));
    settings = globalAdmin ? await ctx.api.get('/ai/settings').catch(() => null) : null;
    station = await ctx.api.get(ctx.url('/ai'));
    health = settings ? await ctx.api.get('/ai/health').catch(() => []) : [];
  }

  function render() {
    const head = h('div', { class: 'lf-head' },
      h('div', { class: 'lf-title' }, h('strong', {}, 'KI-Automation'),
        h('span', { class: 'muted' }, station?.config.enabled ? ` · aktiv${station.config.music.enabled ? ' · plant Musik' : ''}${station.config.approval ? ' · mit Freigabe' : ''}` : ' · aus')),
      h('div', { class: 'tabs' }, ...TABS.map(([id, label]) => h('button', { 'aria-pressed': String(tab === id), disabled: !settings && (id === 'providers' || id === 'costs'), onclick: () => { tab = id; render(); } }, label))));
    root.replaceChildren(head, content);
    content.replaceChildren(h('div', { class: 'empty' }, 'Lade …'));
    const fn = { director, providers, costs, tools }[tab];
    run(async () => content.replaceChildren(...(await fn()).filter((x) => x)));
  }

  const refresh = () => run(async () => { await load(); render(); });

  // ---------- Director ----------

  async function director() {
    const c = station.config;
    const st = station.state;
    const textP = settings?.providers.find((/** @type {any} */ p) => p.id === c.text.providerId);
    const voiceP = settings?.providers.find((/** @type {any} */ p) => p.id === c.voice.providerId);
    const noProviders = settings && !settings.providers.length;
    return [
      noProviders ? card('Erste Schritte',
        h('p', {}, 'Die KI-Automation nutzt deine eigenen API-Keys oder lokale Modelle. So geht es los:'),
        h('ol', {},
          h('li', {}, 'Unter „Anbieter & Keys“ einen Text-Anbieter (z. B. OpenAI, Anthropic, Gemini oder lokal Ollama) und einen Sprach-Anbieter (z. B. OpenAI TTS, ElevenLabs, Piper) anlegen.'),
          h('li', {}, 'Hier unter „Einstellungen“ Modell, Stimme, Moderator-Persona und Quellen (Nachrichten/Wetter als RSS/JSON) wählen.'),
          h('li', {}, 'KI-Automation einschalten. Optional „Freigabe“ aktivieren, dann geht nichts ungeprüft auf Sendung.')),
        h('button', { class: 'btn primary', onclick: () => { tab = 'providers'; render(); } }, 'Anbieter einrichten')) : null,
      h('div', { class: 'view-grid' },
        card('Director',
          kv('Status', c.enabled ? 'aktiv' : 'aus'),
          kv('Moderation', c.everySongs ? `nach jedem ${c.everySongs}. Titel (max. ${c.maxWords} Wörter)` : 'aus'),
          kv('Nachrichten', c.topOfHourNews ? 'zur vollen Stunde (aus Quellen)' : 'aus'),
          kv('Musikplanung', c.music.enabled ? `KI, ${c.music.lookahead} Titel voraus${c.music.jingleEvery ? `, Jingle alle ${c.music.jingleEvery}` : ''}` : 'Sendeuhr'),
          kv('Text', c.text.providerId ? `${textP?.name ?? c.text.providerId} · ${c.text.model || '–'}${c.text.fallback ? ` (Fallback: ${c.text.fallback.providerId} · ${c.text.fallback.model})` : ''}` : 'nicht gewählt'),
          kv('Stimme', c.voice.providerId ? `${voiceP?.name ?? c.voice.providerId} · ${c.voice.voice || '–'}` : 'nicht gewählt'),
          kv('Persona', c.persona),
          kv('Quellen', c.sources.map((/** @type {any} */ s) => s.name).join(', ')),
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', onclick: editDirector }, 'Einstellungen …'),
            h('button', { class: 'btn', disabled: st.busy, onclick: () => produce('break') }, 'Jetzt moderieren'),
            h('button', { class: 'btn', disabled: st.busy, onclick: () => produce('news') }, 'Nachrichten jetzt'),
            h('button', { class: 'btn', disabled: st.musicBusy, onclick: planMusic }, 'Musik planen'))),
        card(`Freigaben (${st.pending.length})`,
          st.pending.length ? null : h('div', { class: 'empty' }, c.approval ? 'Keine offenen Freigaben.' : 'Freigabe ist aus – Moderationen gehen direkt in die Queue.'),
          ...st.pending.map((/** @type {any} */ p) => h('div', { class: 'ai-pending' },
            h('div', {}, h('strong', {}, p.kind === 'news' ? 'Nachrichten' : 'Moderation'), h('span', { class: 'muted' }, ` · ${clockTime(p.createdAt)}`)),
            h('p', {}, p.text),
            h('div', { class: 'row' },
              h('button', { class: 'btn small', onclick: () => preview(p.mediaId) }, '▶ Anhören'),
              h('button', { class: 'btn small primary', onclick: () => decide(p.id, 'approve') }, 'Freigeben'),
              h('button', { class: 'btn small danger', onclick: () => decide(p.id, 'reject') }, 'Verwerfen'))))),
      ),
      card('Protokoll',
        st.log.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Art'), h('th', {}, 'Ergebnis'), h('th', {}, 'Kosten'), h('th', {}, 'Dauer'))),
          h('tbody', {}, ...st.log.map((/** @type {any} */ d) => h('tr', {},
            h('td', { class: 'num muted' }, clockTime(d.at)),
            h('td', {}, DECISION[d.kind] ?? d.kind),
            h('td', { class: d.ok ? '' : 'err' }, `${d.ok ? '' : '⚠ '}${d.detail}`),
            h('td', { class: 'num' }, d.cost ? money(d.cost) : ''),
            h('td', { class: 'num muted' }, d.ms ? `${(d.ms / 1000).toFixed(1)} s` : '')))))) : h('div', { class: 'empty' }, 'Noch keine KI-Entscheidungen.')),
    ];
  }

  /** @param {'break'|'news'} kind */
  async function produce(kind) {
    status(kind === 'news' ? 'KI schreibt Nachrichten …' : 'KI moderiert …');
    const r = await run(() => ctx.api.post(ctx.url('/ai/moderation'), { kind }));
    if (r) status(r.text ? 'Moderation wartet auf Freigabe' : `„${r.title}“ ist als Nächstes in der Queue`);
    refresh();
  }

  async function planMusic() {
    status('KI plant Musik …');
    const r = await run(() => ctx.api.post(ctx.url('/ai/music')));
    if (r) status(r.added ? `${r.added} Titel von der KI eingeplant` : 'KI-Musikplanung ohne Ergebnis – siehe Protokoll', !r.added);
    refresh();
  }

  /** @param {string} id @param {'approve'|'reject'} what */
  async function decide(id, what) {
    await run(() => ctx.api.post(ctx.url(`/ai/pending/${encodeURIComponent(id)}/${what}`)));
    refresh();
  }

  /** @param {string} mediaId */
  function preview(mediaId) {
    pre?.pause();
    pre = new Audio(ctx.mediaUrl(mediaId));
    pre.play().catch(() => status('Anhören nicht möglich', true));
  }

  /** Modellvorschläge vom Anbieter laden (still, wenn nicht möglich). @param {string} id */
  async function modelsOf(id) {
    if (!id) return [];
    return /** @type {string[]} */ (await ctx.api.get(`/ai/providers/${encodeURIComponent(id)}/models`).catch(() => []));
  }

  async function editDirector() {
    const c = station.config;
    const texts = byRole('text');
    const voices = byRole('voice');
    const opts = (/** @type {any[]} */ list) => /** @type {[string,string][]} */ ([['', '– keiner –'], ...list.map((p) => [p.id, `${p.name} (${KIND_LABEL[p.kind] ?? p.kind})`])]);
    const [m1, m2] = await Promise.all([modelsOf(c.text.providerId), modelsOf(c.text.fallback?.providerId ?? '')]);
    const vp = voices.find((/** @type {any} */ p) => p.id === c.voice.providerId);
    const voiceList = vp?.kind === 'elevenlabs' ? /** @type {any[]} */ (await ctx.api.get(`/ai/providers/${vp.id}/voices`).catch(() => [])) : [];
    const v = await formDialog('KI-Director · Einstellungen', [
      { name: 'enabled', label: 'KI-Automation für diesen Sender aktiv', type: 'checkbox', value: c.enabled },
      { name: 'approval', label: 'Freigabe: Moderationen erst nach Prüfung senden', type: 'checkbox', value: c.approval },
      { name: 'everySongs', label: 'Moderation nach jedem n-ten Musiktitel (0 = aus)', type: 'number', value: c.everySongs },
      { name: 'maxWords', label: 'Höchstlänge einer Moderation (Wörter)', type: 'number', value: c.maxWords },
      { name: 'topOfHourNews', label: 'Nachrichten zur vollen Stunde (nur mit Nachrichtenquelle)', type: 'checkbox', value: c.topOfHourNews },
      { name: 'persona', label: 'Moderator / Persona', value: c.persona, hint: 'z. B. „Mia, Morgenmoderatorin, gut gelaunt, kennt die Region“' },
      { name: 'style', label: 'Stil', value: c.style },
      { name: 'language', label: 'Sprache', value: c.language },
      { name: 'textProvider', label: 'Text: Anbieter', value: c.text.providerId, options: opts(texts) },
      { name: 'textModel', label: 'Text: Modell', value: c.text.model, suggest: m1, hint: m1.length ? `${m1.length} Modelle vom Anbieter` : 'Modell-ID eintragen (Liste nach dem Speichern des Anbieters verfügbar)' },
      { name: 'temperature', label: 'Kreativität (0–2, leer = Standard des Modells)', type: 'number', value: c.text.temperature ?? '' },
      { name: 'fbProvider', label: 'Text: Fallback-Anbieter', value: c.text.fallback?.providerId ?? '', options: opts(texts) },
      { name: 'fbModel', label: 'Text: Fallback-Modell', value: c.text.fallback?.model ?? '', suggest: m2 },
      { name: 'voiceProvider', label: 'Stimme: Anbieter', value: c.voice.providerId, options: opts(voices) },
      { name: 'voice', label: 'Stimme', value: c.voice.voice, suggest: voiceList.map((x) => x.id), hint: vp?.kind === 'piper' ? 'Pfad zur .onnx-Stimme, z. B. C:\\Piper\\de_DE-thorsten-high.onnx' : vp?.kind === 'elevenlabs' ? voiceList.map((x) => `${x.name}: ${x.id}`).slice(0, 8).join(' · ') : 'z. B. alloy, nova, onyx (OpenAI) bzw. Stimmname des lokalen Servers' },
      { name: 'voiceModel', label: 'Sprachmodell (optional)', value: c.voice.model ?? '', hint: 'z. B. tts-1 / gpt-4o-mini-tts (OpenAI), eleven_multilingual_v2 (ElevenLabs)' },
      { name: 'speed', label: 'Sprechtempo (0.5–2, leer = normal)', type: 'number', value: c.voice.speed ?? '' },
      { name: 'music', label: 'KI plant die Musik (Sendeuhr nur noch als Rückfall)', type: 'checkbox', value: c.music.enabled },
      { name: 'lookahead', label: 'KI-Musik: Titel im Voraus', type: 'number', value: c.music.lookahead },
      { name: 'jingleEvery', label: 'KI-Musik: Station-ID/Jingle alle n Titel (0 = aus)', type: 'number', value: c.music.jingleEvery },
      { name: 'instructions', label: 'KI-Musik: Vorgaben', type: 'textarea', value: c.music.instructions, hint: 'z. B. „morgens ruhiger Einstieg, ab 16 Uhr mehr Tempo, keine zwei Balladen hintereinander“' },
      { name: 'sources', label: 'Quellen (eine pro Zeile: Name | URL | rss/json/text | news/weather/info)', type: 'textarea', value: c.sources.map((/** @type {any} */ s) => `${s.name} | ${s.url} | ${s.kind} | ${s.use}`).join('\n'), hint: 'Wetter z. B. Open-Meteo: Wetter | https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,weather_code | json | weather' },
      { name: 'keepGenerated', label: 'KI-Sprachdateien behalten (ältere werden gelöscht)', type: 'number', value: c.keepGenerated },
    ], 'Speichern');
    if (!v) return;
    const sources = String(v.sources ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, url, kind, use] = l.split('|').map((x) => x.trim());
      return { name, url, kind: kind || 'rss', use: use || 'info' };
    });
    const body = {
      enabled: v.enabled, approval: v.approval, everySongs: v.everySongs ?? 0, maxWords: v.maxWords ?? 45, topOfHourNews: v.topOfHourNews,
      persona: v.persona, style: v.style, language: v.language, keepGenerated: v.keepGenerated ?? 30, sources,
      text: { providerId: v.textProvider, model: v.textModel, ...(v.temperature !== null ? { temperature: v.temperature } : {}), fallback: v.fbProvider ? { providerId: v.fbProvider, model: v.fbModel } : null },
      voice: { providerId: v.voiceProvider, voice: v.voice, model: v.voiceModel, ...(v.speed !== null ? { speed: v.speed } : {}) },
      music: { enabled: v.music, lookahead: v.lookahead ?? 3, jingleEvery: v.jingleEvery ?? 0, instructions: v.instructions },
    };
    if (await run(() => ctx.api.put(ctx.url('/ai'), body))) status('KI-Einstellungen gespeichert');
    refresh();
  }

  // ---------- Anbieter ----------

  async function providers() {
    const list = settings.providers;
    const healthOf = (/** @type {string} */ id) => health.find((/** @type {any} */ x) => x.providerId === id);
    const statusCell = (/** @type {any} */ p) => {
      const hp = healthOf(p.id);
      if (hp?.quarantinedUntil && hp.quarantinedUntil > Date.now()) {
        return h('span', { class: 'pill failed', title: hp.lastError ?? '' }, `⛔ Quarantäne bis ${clockTime(hp.quarantinedUntil)}`);
      }
      if (hp?.consecutiveFailures) return h('span', { class: 'pill', title: hp.lastError ?? '' }, `⚠ ${hp.consecutiveFailures}× fehlgeschlagen`);
      return h('span', { class: 'pill connected' }, 'OK');
    };
    return [
      card('Anbieter & API-Keys',
        h('p', { class: 'muted' }, 'Eigene Keys werden verschlüsselt auf diesem AnMaCha Cast gespeichert und nie angezeigt. Lokale KI auf dem eigenen PC oder Server (Ollama, LM Studio, llama.cpp, vLLM, Kokoro, Piper …) funktioniert ohne Key und offline – „Lokale KI suchen“ findet laufende Server selbst. Cloud-Anbieter gibt es als Vorlage; alles andere legst du als „Eigener Anbieter“ an (OpenAI-kompatible Adresse, eigener Key-Header, Zusatz-Header, Query). Nach mehreren Fehlern in Folge wird ein Anbieter automatisch für eine Weile übersprungen (Quarantäne) - der Fallback-Anbieter springt dann sofort ein, statt bei jeder Sendung erneut auf einen Timeout zu warten.'),
        list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Art'), h('th', {}, 'Typ'), h('th', {}, 'Key'), h('th', {}, 'Status'), h('th', {}, ''))),
          h('tbody', {}, ...list.map((/** @type {any} */ p) => h('tr', {},
            h('td', {}, p.name, p.local ? h('span', { class: 'tag', title: 'Läuft auf dem eigenen PC/Server' }, ' lokal') : null, p.enabled ? '' : h('span', { class: 'muted' }, ' (aus)')),
            h('td', {}, p.role === 'voice' ? 'Sprache' : 'Text'),
            h('td', {}, typeLabel(p), p.baseUrl ? h('div', { class: 'muted small' }, p.baseUrl) : null),
            h('td', {}, p.hasKey ? '🔒 hinterlegt' : p.local || p.kind === 'piper' ? 'nicht nötig' : p.kind === 'openai_compat' && !presetOf(p)?.needsKey ? '– (ohne)' : '⚠ fehlt'),
            h('td', {}, statusCell(p)),
            h('td', { class: 'act' },
              h('button', { class: 'btn small', onclick: () => testProvider(p) }, 'Testen'),
              healthOf(p.id)?.consecutiveFailures ? h('button', { class: 'btn small', onclick: () => run(async () => { await ctx.api.post(`/ai/providers/${encodeURIComponent(p.id)}/release`); status(`${p.name}: Quarantäne aufgehoben`); await refresh(); }) }, 'Freigeben') : null,
              h('button', { class: 'btn small', onclick: () => editProvider(p) }, 'Bearbeiten'))))))) : h('div', { class: 'empty' }, 'Noch kein Anbieter angelegt.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => addProvider('text') }, '＋ Text-Anbieter'),
          h('button', { class: 'btn', onclick: () => addProvider('voice') }, '＋ Sprach-Anbieter'),
          h('button', { class: 'btn', onclick: () => discoverLocal() }, '🔍 Lokale KI suchen'))),
      found ? card('Gefundene lokale KI-Server', found.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Server'), h('th', {}, 'Art'), h('th', {}, 'Adresse'), h('th', {}, 'Modelle'), h('th', {}, ''))),
          h('tbody', {}, ...found.map((/** @type {any} */ f) => {
            const known = list.some((/** @type {any} */ p) => (p.baseUrl ?? '').replace(/\/+$/, '') === f.baseUrl);
            return h('tr', {},
              h('td', {}, f.label),
              h('td', {}, f.role === 'voice' ? 'Sprache' : 'Text'),
              h('td', { class: 'muted small' }, f.baseUrl),
              h('td', { title: f.models.join(', ') }, f.models.length ? `${f.models.length}: ${f.models.slice(0, 3).join(', ')}${f.models.length > 3 ? ' …' : ''}` : 'keine geladen'),
              h('td', { class: 'act' }, known ? h('span', { class: 'muted' }, 'schon angelegt') : h('button', { class: 'btn small primary', onclick: () => adoptFound(f) }, 'Übernehmen')));
          }))))
        : h('div', { class: 'empty' }, `Kein laufender KI-Server gefunden (${(foundHosts ?? []).join(', ')}). Läuft Ollama/LM Studio? Bei einem anderen Rechner dessen Namen oder IP angeben.`)) : null,
    ];
  }

  /** @param {any} p */
  const presetOf = (p) => (settings?.presets ?? []).find((/** @type {any} */ x) => x.id === p.preset);
  /** Typ in der Liste: Vorlage + Schnittstelle, eigene Anbieter mit Kennzeichen @param {any} p */
  const typeLabel = (p) => {
    const pre = presetOf(p);
    const api = p.kind === 'openai_compat' ? 'OpenAI-kompatibel' : KIND_LABEL[p.kind] ?? p.kind;
    if (pre && pre.kind === 'openai_compat') return `${pre.label} · ${api}`;
    if (pre) return api;
    return p.kind === 'openai_compat' ? `Eigener Anbieter · ${api}${p.authHeader || p.headers || p.query ? ' (eigene Anmeldung)' : ''}` : api;
  };

  /** @type {any[]|null} */ let found = null;
  /** @type {string[]|null} */ let foundHosts = null;

  /** Lokale KI-Server auf diesem PC/Server (und optional einem Rechner im Netz) suchen. */
  async function discoverLocal() {
    const v = await formDialog('Lokale KI suchen', [
      { type: 'info', label: 'Gesucht wird', value: 'Ollama, LM Studio, llama.cpp, vLLM, Jan, KoboldCpp, text-generation-webui und Kokoro auf diesem PC/Server.' },
      { name: 'host', label: 'Zusätzlich auf Rechner (optional)', value: '', hint: 'Name oder IP im eigenen Netz, z. B. 192.168.1.20 – ohne http:// und Port. Der KI-Server muss dort im Netz erreichbar sein (Ollama: OLLAMA_HOST=0.0.0.0).' },
    ], 'Suchen');
    if (!v) return;
    status('Suche lokale KI-Server …');
    const r = await run(() => ctx.api.post('/ai/discover', v.host ? { host: v.host } : {}));
    if (!r) return;
    found = r.found;
    foundHosts = r.hosts;
    status(found?.length ? `${found.length} KI-Server gefunden` : 'Kein KI-Server gefunden');
    render();
  }

  /** @param {any} f Gefundenen Server als Anbieter anlegen */
  async function adoptFound(f) {
    const pre = (settings.presets ?? []).find((/** @type {any} */ x) => x.id === f.preset);
    const local = /^(127\.0\.0\.1|localhost|host\.docker\.internal)$/.test(f.host);
    await editProvider(null, f.role, { ...(pre ?? {}), label: local ? f.label : `${f.label} (${f.host})`, baseUrl: f.baseUrl, local: true, needsKey: false });
  }

  /** Neuen Anbieter anlegen: Vorlage wählen (lokal oder Cloud) oder eigenen Anbieter. @param {'text'|'voice'} role */
  async function addProvider(role) {
    const presets = (settings.presets ?? []).filter((/** @type {any} */ p) => p.role === role);
    const v = await formDialog(role === 'voice' ? 'Sprach-Anbieter anlegen' : 'Text-Anbieter anlegen', [
      { name: 'preset', label: 'Vorlage', value: presets[0]?.id ?? '', options: [
        ...presets.filter((/** @type {any} */ p) => p.local).map((/** @type {any} */ p) => /** @type {[string,string]} */ ([p.id, `Lokal · ${p.label}`])),
        ...presets.filter((/** @type {any} */ p) => !p.local).map((/** @type {any} */ p) => /** @type {[string,string]} */ ([p.id, `Cloud · ${p.label}`])),
        ['custom', 'Eigener Anbieter (frei konfigurierbar)'],
      ] },
    ], 'Weiter');
    if (!v) return;
    const pre = presets.find((/** @type {any} */ p) => p.id === v.preset);
    await editProvider(null, role, pre ?? { label: '', kind: role === 'voice' ? 'openai_compat' : 'openai_compat', custom: true });
  }

  /** @param {any} p */
  async function testProvider(p) {
    if (p.role === 'voice' && p.kind !== 'elevenlabs') return status('Sprach-Anbieter testen: unter „Werkzeuge“ einen kurzen Text vertonen');
    status(`Teste ${p.name} …`);
    const list = await run(() => ctx.api.get(`/ai/providers/${encodeURIComponent(p.id)}/${p.kind === 'elevenlabs' ? 'voices' : 'models'}`));
    if (list) status(`${p.name}: Verbindung OK – ${list.length} ${p.kind === 'elevenlabs' ? 'Stimmen' : 'Modelle'} verfügbar`);
  }

  /** @param {any} p bestehender Anbieter oder null @param {'text'|'voice'} [role] @param {any} [pre] Vorlage für einen neuen Anbieter */
  async function editProvider(p, role = p?.role, pre = null) {
    const kinds = /** @type {string[]} */ (settings.kinds[role]);
    const src = p ?? { name: pre?.label ?? '', kind: pre?.kind ?? kinds[0], baseUrl: pre?.baseUrl ?? '', authHeader: pre?.authHeader, authScheme: pre?.authScheme, query: pre?.query, local: pre?.local, enabled: true };
    const headersText = Object.entries(src.headers ?? {}).map(([k, val]) => `${k}: ${val}`).join('\n');
    const advanced = !!(pre?.custom || src.authHeader || src.authScheme !== undefined || src.query || headersText);
    const v = await formDialog(p ? `Anbieter: ${p.name}` : pre?.label ? `${pre.label} einrichten` : role === 'voice' ? 'Eigener Sprach-Anbieter' : 'Eigener Text-Anbieter', [
      ...(pre?.hint ? [{ type: 'info', label: 'Hinweis', value: pre.hint }] : []),
      { name: 'name', label: 'Name', value: src.name ?? '', required: true },
      { name: 'kind', label: 'Typ', value: src.kind ?? kinds[0], options: kinds.map((k) => /** @type {[string,string]} */ ([k, KIND_LABEL[k] ?? k])) },
      { name: 'key', label: p?.hasKey ? 'API-Key (leer = unverändert, "-" = löschen)' : pre?.needsKey === false ? 'API-Key (nicht nötig)' : 'API-Key', type: 'password', value: '' },
      { name: 'baseUrl', label: 'Adresse (Basis-URL)', value: src.baseUrl ?? '', showIf: { field: 'kind', values: ['openai_compat', 'openai', 'anthropic', 'google'] }, hint: 'Lokal z. B. http://localhost:11434/v1 (Ollama) · http://localhost:1234/v1 (LM Studio) · anderer Rechner: http://192.168.1.20:11434/v1. Bei OpenAI/Anthropic/Google leer lassen (offizielle Adresse).' },
      ...(role === 'voice' ? [{ name: 'binPath', label: 'Piper: Pfad zu piper(.exe)', value: src.binPath ?? '', showIf: { field: 'kind', values: ['piper'] }, hint: 'leer = „piper“ aus dem PATH' }] : []),
      { name: 'local', label: 'Läuft auf dem eigenen PC/Server (lokal, ohne Key)', type: 'checkbox', value: !!src.local },
      { name: 'enabled', label: 'Aktiv', type: 'checkbox', value: src.enabled ?? true },
      { type: 'section', label: 'Erweitert (eigener Anbieter)', hint: advanced ? 'Für Gateways und Anbieter mit eigener Anmeldung' : 'Nur nötig, wenn der Anbieter den Key anders erwartet als „Authorization: Bearer …“' },
      { name: 'authHeader', label: 'Header für den Key', value: src.authHeader ?? '', hint: 'leer = Authorization; Azure: api-key', suggest: ['Authorization', 'api-key', 'x-api-key'] },
      { name: 'authScheme', label: 'Vorsatz vor dem Key', value: src.authScheme ?? 'Bearer', hint: 'z. B. Bearer; leer = nur der Key' },
      { name: 'headers', label: 'Zusatz-Header (je Zeile „Name: Wert“)', type: 'textarea', value: headersText, hint: '{key} wird durch den gespeicherten Key ersetzt, z. B. „X-Api-Key: {key}“ – so bleibt der Key geheim' },
      { name: 'query', label: 'Query-Parameter', value: src.query ?? '', hint: 'z. B. api-version=2024-10-21' },
      ...(p ? [{ name: 'remove', label: 'Anbieter löschen (Key wird entfernt)', type: 'checkbox', value: false }] : []),
    ], 'Speichern', { wide: true });
    if (!v) return;
    const slug = (v.name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'ki');
    const id = p?.id ?? (settings.providers.some((/** @type {any} */ x) => x.id === slug) ? `${slug}-${Date.now().toString(36).slice(-3)}` : slug);
    const strip = (/** @type {any} */ x) => { const { hasKey, ...rest } = x; return { ...rest, key: undefined }; };
    const entry = {
      id, role, name: v.name, kind: v.kind, baseUrl: v.baseUrl, binPath: v.binPath, enabled: v.enabled, local: v.local, key: v.key || undefined,
      preset: p?.preset ?? (pre && !pre.custom ? pre.id : undefined),
      authHeader: v.authHeader, authScheme: v.authHeader || v.authScheme !== 'Bearer' ? v.authScheme : undefined, headers: v.headers, query: v.query,
    };
    // Reihenfolge beibehalten: bearbeiteter Anbieter bleibt an seiner Stelle
    const next = p
      ? (v.remove ? settings.providers.filter((/** @type {any} */ x) => x.id !== p.id).map(strip) : settings.providers.map((/** @type {any} */ x) => (x.id === p.id ? entry : strip(x))))
      : [...settings.providers.map(strip), entry];
    if (await run(() => ctx.api.put('/ai/settings', { providers: next }))) {
      status(v.remove ? 'Anbieter gelöscht' : 'Anbieter gespeichert');
      if (found && !v.remove) found = found.filter((/** @type {any} */ f) => f.baseUrl !== (v.baseUrl ?? '').replace(/\/+$/, ''));
    }
    refresh();
  }

  // ---------- Kosten ----------

  async function costs() {
    const u = await ctx.api.get('/ai/usage');
    const rows = (/** @type {Record<string, any>} */ m, /** @type {(k:string)=>string} */ name) => Object.entries(m).map(([k, r]) => h('tr', {},
      h('td', {}, name(k)), h('td', { class: 'num' }, String(r.calls)), h('td', { class: 'num' }, `${r.inputTokens.toLocaleString('de-DE')} / ${r.outputTokens.toLocaleString('de-DE')}`),
      h('td', { class: 'num' }, r.chars.toLocaleString('de-DE')), h('td', { class: 'num' }, money(r.cost)), h('td', { class: 'num' }, String(r.errors))));
    const provName = (/** @type {string} */ id) => settings.providers.find((/** @type {any} */ p) => p.id === id)?.name ?? id;
    const table = (/** @type {Node[]} */ body) => h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Aufrufe'), h('th', {}, 'Token ein/aus'), h('th', {}, 'Zeichen'), h('th', {}, 'Kosten'), h('th', {}, 'Fehler'))), h('tbody', {}, ...body)));
    return [
      h('div', { class: 'view-grid' },
        card(`Verbrauch ${u.month}`, table(rows(u.byProvider, provName)), h('p', { class: 'muted' }, 'Kosten werden nur berechnet, wenn unten ein Preis hinterlegt ist (keine geschätzten Preise).')),
        card('Pro Sender', table(rows(u.byStation, (k) => k)))),
      card('Preise & Budgets',
        kv('Währung', settings.currency),
        ...settings.pricing.map((/** @type {any} */ p) => kv(`${provName(p.providerId)} · ${p.model}`, `${p.inPerM ?? 0} / ${p.outPerM ?? 0} je 1 Mio. Token${p.perMChars ? ` · ${p.perMChars} je 1 Mio. Zeichen` : ''}`)),
        ...Object.entries(settings.budgets.providers).map(([k, b]) => kv(`Budget ${provName(k)}`, `Warnung ${b.soft ?? '–'} · Stopp ${b.hard ?? '–'}`)),
        ...Object.entries(settings.budgets.stations).map(([k, b]) => kv(`Budget Sender ${k}`, `Warnung ${b.soft ?? '–'} · Stopp ${b.hard ?? '–'}`)),
        h('button', { class: 'btn', onclick: editCosts }, 'Preise & Budgets bearbeiten …')),
      card('Letzte Aufrufe', table(u.recent.slice(0, 40).map((/** @type {any} */ e) => h('tr', {},
        h('td', {}, `${clockTime(e.at)} · ${provName(e.providerId)} · ${e.model || e.kind} · ${e.purpose}${e.ok ? '' : ` ⚠ ${e.error}`}`),
        h('td', { class: 'num' }, `${(e.ms / 1000).toFixed(1)} s`), h('td', { class: 'num' }, `${e.inputTokens} / ${e.outputTokens}`), h('td', { class: 'num' }, String(e.chars)),
        h('td', { class: 'num' }, money(e.cost)), h('td', {}, e.ok ? '' : '1'))))),
    ];
  }

  async function editCosts() {
    const v = await formDialog('Preise & Budgets', [
      { name: 'currency', label: 'Währung (ISO, z. B. EUR, USD)', value: settings.currency },
      { name: 'pricing', label: 'Preise (eine Zeile: Anbieter-ID | Modell oder * | Eingabe je 1 Mio. Token | Ausgabe je 1 Mio. Token | je 1 Mio. Zeichen)', type: 'textarea',
        value: settings.pricing.map((/** @type {any} */ p) => [p.providerId, p.model, p.inPerM ?? '', p.outPerM ?? '', p.perMChars ?? ''].join(' | ')).join('\n'), hint: `Anbieter-IDs: ${settings.providers.map((/** @type {any} */ p) => p.id).join(', ') || '–'} · Preise aus der Preisliste deines Anbieters übernehmen` },
      { name: 'budgets', label: 'Monatsbudgets (eine Zeile: provider:<id> oder station:<id> | Warnung | Stopp)', type: 'textarea',
        value: [...Object.entries(settings.budgets.providers).map(([k, b]) => `provider:${k} | ${b.soft ?? ''} | ${b.hard ?? ''}`), ...Object.entries(settings.budgets.stations).map(([k, b]) => `station:${k} | ${b.soft ?? ''} | ${b.hard ?? ''}`)].join('\n'),
        hint: 'Bei „Stopp“ wird der Anbieter bzw. der Sender für den Rest des Monats nicht mehr genutzt – der Fallback oder die Sendeuhr übernimmt' },
    ], 'Speichern');
    if (!v) return;
    const num = (/** @type {string|undefined} */ x) => (x === undefined || x.trim() === '' ? undefined : Number(x.replace(',', '.')));
    const pricing = String(v.pricing).split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0] && x[1]).map(([providerId, model, i, o, c]) => ({ providerId, model, inPerM: num(i), outPerM: num(o), perMChars: num(c) }));
    /** @type {{providers: Record<string, any>, stations: Record<string, any>}} */
    const budgets = { providers: {}, stations: {} };
    for (const l of String(v.budgets).split('\n')) {
      const [key, soft, hard] = l.split('|').map((x) => x.trim());
      const m = /^(provider|station):(.+)$/.exec(key ?? '');
      if (m) budgets[m[1] === 'provider' ? 'providers' : 'stations'][m[2]] = { soft: num(soft), hard: num(hard) };
    }
    if (await run(() => ctx.api.put('/ai/settings', { currency: v.currency.toUpperCase(), pricing, budgets }))) status('Preise & Budgets gespeichert');
    refresh();
  }

  // ---------- KI-Werkstatt (nach ki-tools.html im Control Center) ----------

  /** @type {any[]} */ let planRows = [];
  /** @type {string} */ let spotText = '';
  /** @type {any|null} */ let spotVoice = null;
  /** @type {any|null} */ let transcript = null;
  /** WebVTT aus Segmenten (Sekunden) - Punkt statt Komma, Kopfzeile, keine Nummern nötig. @param {{start:number,end:number,text:string}[]} segs */
  const toVtt = (segs) => {
    const ts = (/** @type {number} */ t) => { const ms = Math.max(0, Math.round(t * 1000)); const p = (/** @type {number} */ n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms % 3600000 / 60000))}:${p(Math.floor(ms % 60000 / 1000))}.${p(ms % 1000, 3)}`; };
    return `WEBVTT\n\n${segs.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text}\n`).join('\n')}`;
  };
  /** @type {string} */ let studioKind = 'mod';
  /** @type {string} */ let studioTopic = '';
  /** @type {string} */ let studioText = '';
  /** @type {any|null} */ let studioSaved = null;
  /** @type {any|null} */ let studioPl = null;

  /** @param {string} id @param {string} title @param {string} color @param {string} desc @param {...any} body */
  const tool = (id, title, color, desc, ...body) => h('section', { class: 'panel kt-tool', style: `--c:${color}`, id: `kt-${id}` },
    h('div', { class: 'kt-head' }, h('span', { class: 'kt-badge' }, title.slice(0, 1)), h('div', {}, h('h2', {}, title), h('p', { class: 'muted small' }, desc))), ...body);
  const libMedia = () => /** @type {any[]} */ (ctx.library?.() ?? []);
  /** @param {(m: any) => boolean} filter @param {string} empty */
  const mediaSelect = (filter, empty) => /** @type {HTMLSelectElement} */ (h('select', {}, h('option', { value: '' }, empty), ...libMedia().filter(filter).sort((a, b) => `${a.artist ?? ''} ${a.title}`.localeCompare(`${b.artist ?? ''} ${b.title}`, 'de')).slice(0, 2000).map((m) => h('option', { value: m.id }, `${m.artist ? `${m.artist} – ` : ''}${m.title}`))));

  async function tools() {
    // --- KI-Studio: Ansage-Typen als Knöpfe, Text → Stimme → Bibliothek → Queue/Senden (nach relay-pro6) ---
    const studioMeta = await ctx.api.get(ctx.url('/ai/studio')).catch(() => ({ kinds: {}, tones: [] }));
    const kindRow = h('div', { class: 'kt-chips' });
    const drawKinds = () => kindRow.replaceChildren(...Object.entries(studioMeta.kinds).map(([k, v]) => h('button', { class: `kt-chip${studioKind === k ? ' active' : ''}`, onclick: () => { studioKind = k; drawKinds(); stTopic.placeholder = k === 'news' ? 'Meldungen hier einfügen – die KI fasst sie sprechbar zusammen' : k === 'an' ? 'Stichpunkte (leer lassen = nächster Titel aus der Warteschlange)' : 'Stichpunkte / Thema …'; } }, v[0])));
    const stTone = /** @type {HTMLSelectElement} */ (h('select', {}, ...studioMeta.tones.map((/** @type {string} */ t) => h('option', { value: t }, t))));
    const stLen = /** @type {HTMLInputElement} */ (h('input', { type: 'number', value: '25', min: '5', max: '180', class: 'kt-num', title: 'Ziel-Länge in Sekunden' }));
    const stTopic = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: '3', placeholder: 'Stichpunkte / Thema …', value: studioTopic, oninput: () => { studioTopic = stTopic.value; } }));
    const stText = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: '6', placeholder: 'Sprechertext (hier auch von Hand bearbeitbar)', value: studioText, oninput: () => { studioText = stText.value; } }));
    const stCount = h('span', { class: 'muted small' }, studioText ? `${(studioText.match(/\S+/g) ?? []).length} Wörter` : '');
    const stTitle = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Name in der Bibliothek', value: '' }));
    const stCat = /** @type {HTMLSelectElement} */ (h('select', {}, ...[['voice_track', 'Voice Track'], ['station_id', 'Station ID'], ['news', 'News'], ['tts', 'TTS'], ['ad', 'Werbung'], ['jingle', 'Jingle']].map(([v, l]) => h('option', { value: v }, l))));
    const stSaved = h('div', { class: 'kt-row' });
    const drawSaved = () => stSaved.replaceChildren(...(studioSaved ? [
      h('span', { class: 'muted small' }, `„${studioSaved.title}“ liegt in der Bibliothek`),
      h('button', { class: 'btn small', onclick: () => preview(studioSaved.id) }, '▶ Anhören'),
      h('button', { class: 'btn small', onclick: async () => { if (await run(() => ctx.api.post(ctx.url('/queue'), { mediaId: studioSaved.id, index: 0 }))) status('Läuft als Nächstes'); } }, '⏭ Als Nächstes einreihen'),
      h('button', { class: 'btn small primary', title: 'Sofort einblenden (Playout muss laufen)', onclick: async () => { if (await run(() => ctx.api.post(ctx.url('/onair'), { mediaId: studioSaved.id }))) status('Wird eingeblendet'); } }, '📡 Jetzt senden'),
    ] : [h('span', { class: 'muted small' }, 'Erst vertonen & speichern – dann einreihen oder senden.')]));
    drawKinds(); drawSaved();
    const studio = tool('studio', 'KI-Studio', '#f97316', 'Ansage-Typen als Knöpfe: Text erstellen → Stimme → Bibliothek → als Nächstes einreihen oder sofort senden. KI-Texte immer kurz gegenlesen.',
      kindRow,
      h('div', { class: 'kt-row' }, h('label', { class: 'kt-lbl' }, 'Ton', stTone), h('label', { class: 'kt-lbl' }, 'Länge', stLen, 's'),
        h('button', { class: 'btn small primary', onclick: async () => { status('KI schreibt …'); const r = await run(() => ctx.api.post(ctx.url('/ai/studio/write'), { kind: studioKind, topic: stTopic.value, tone: stTone.value, seconds: Number(stLen.value) })); if (r) { stText.value = r.text; studioText = r.text; stCount.textContent = `${r.words} Wörter · ca. ${r.seconds} s`; status('Text erstellt – gern anpassen, dann „Vertonen“'); } } }, '✍️ Text erstellen'), stCount),
      stTopic, stText,
      h('div', { class: 'kt-row' }, stTitle, stCat,
        h('button', { class: 'btn small primary', onclick: async () => { if (!stText.value.trim()) { status('Erst einen Text erstellen oder schreiben', true); return; } status('KI spricht …'); const m = await run(() => ctx.api.post(ctx.url('/ai/speech'), { text: stText.value, title: stTitle.value || `${(studioMeta.kinds[studioKind]?.[0] ?? 'KI-Beitrag').replace(/^\S+\s/, '')} ${new Date().toLocaleDateString('de-DE')}`, category: stCat.value })); if (m) { studioSaved = m; drawSaved(); status(`„${m.title}“ gespeichert`); } } }, '🔊 Vertonen & speichern')),
      stSaved);

    // --- KI-Playlist: erstellen oder bestehende neu ordnen/ergänzen ---
    const playlists = /** @type {any[]} */ ((await ctx.api.get(ctx.url('/playlists')).catch(() => [])) ?? []);
    const folders = /** @type {string[]} */ ((await ctx.api.get(ctx.url('/folders')).catch(() => [])) ?? []);
    const plPrompt = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: '2', placeholder: 'Beschreibe die Playlist, z. B. „fröhlicher Schlager für den Sonntagnachmittag“ oder „Party-Klassiker, ab der Mitte mehr Tempo“' }));
    const plMin = /** @type {HTMLInputElement} */ (h('input', { type: 'number', value: '60', min: '10', max: '600', class: 'kt-num' }));
    const plFolder = /** @type {HTMLSelectElement} */ (h('select', {}, h('option', { value: '' }, 'Alle Musik-Ordner'), ...folders.map((f) => h('option', { value: f }, f))));
    const plUniq = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: true }));
    const plEx = /** @type {HTMLSelectElement} */ (h('select', {}, h('option', { value: '' }, 'Bestehende verbessern …'), ...playlists.filter((p) => !p.block).map((p) => h('option', { value: p.id }, p.name))));
    const plOut = h('div', { class: 'kt-plist' });
    const plName = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Name der Playlist' }));
    const plReplace = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' }));
    const mmss = (/** @type {number} */ ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    const drawPl = () => {
      if (!studioPl) { plOut.replaceChildren(); return; }
      const items = studioPl.items;
      plOut.replaceChildren(
        h('div', { class: 'kt-row' }, h('b', {}, `${items.length} Titel · ${mmss(items.reduce((/** @type {number} */ a, /** @type {any} */ i) => a + i.durationMs, 0))} min`), plName,
          studioPl.playlistId ? h('label', { class: 'kt-lbl' }, plReplace, 'bestehende ersetzen') : null,
          h('button', { class: 'btn small primary', onclick: async () => {
            const name = plName.value.trim(); if (!name) { status('Bitte einen Namen angeben', true); return; }
            const body = { name, items: items.map((/** @type {any} */ i) => i.id) };
            const r = await run(() => studioPl.playlistId && plReplace.checked ? ctx.api.patch(ctx.url(`/playlists/${studioPl.playlistId}`), body) : ctx.api.post(ctx.url('/playlists'), body));
            if (r) { status('Playlist gespeichert – zu finden unter „Playlisten“'); studioPl = null; drawPl(); }
          } }, '💾 Playlist speichern')),
        h('div', { class: 'kt-pl-rows' }, ...items.map((/** @type {any} */ i, /** @type {number} */ n) => h('div', { class: 'kt-pl-row' },
          h('span', { class: 'muted num' }, String(n + 1)), h('span', { class: 'kt-pl-title' }, h('b', {}, i.title), ' ', h('span', { class: 'muted' }, i.artist)), h('span', { class: 'muted num' }, mmss(i.durationMs)),
          h('button', { class: 'btn small', disabled: n === 0, onclick: () => { [items[n - 1], items[n]] = [items[n], items[n - 1]]; drawPl(); } }, '↑'),
          h('button', { class: 'btn small', disabled: n === items.length - 1, onclick: () => { [items[n + 1], items[n]] = [items[n], items[n + 1]]; drawPl(); } }, '↓'),
          h('button', { class: 'btn small danger', onclick: () => { items.splice(n, 1); drawPl(); } }, '✕')))));
      plName.value = plName.value || studioPl.name;
    };
    drawPl();
    const gen = async (/** @type {boolean} */ fix) => {
      if (fix && !plEx.value) { status('Bitte eine bestehende Playlist wählen', true); return; }
      status('KI stellt die Playlist zusammen …');
      const r = await run(() => ctx.api.post(ctx.url('/ai/studio/playlist'), { prompt: plPrompt.value, minutes: Number(plMin.value), folder: plFolder.value, playlistId: fix ? plEx.value : undefined, uniqueArtists: plUniq.checked }));
      if (r) { studioPl = r; plName.value = r.name; drawPl(); status(`${r.items.length} Titel gewählt (${r.model})`); }
    };
    const kiPlaylist = tool('playlist', 'KI-Playlist', '#22c55e', `Die KI wählt nur Titel aus deiner Bibliothek (${libMedia().filter((m) => m.category === 'music').length} Musiktitel) – nichts wird erfunden. Erstellen nach Beschreibung oder bestehende neu ordnen und ergänzen.`,
      plPrompt,
      h('div', { class: 'kt-row' }, h('label', { class: 'kt-lbl' }, 'Dauer', plMin, 'Min.'), plFolder, h('label', { class: 'kt-lbl' }, plUniq, 'Interpreten trennen')),
      h('div', { class: 'kt-row' }, h('button', { class: 'btn primary', onclick: () => gen(false) }, '✨ Playlist erstellen'), plEx, h('button', { class: 'btn small', onclick: () => gen(true) }, '🔁 Neu ordnen / ergänzen')),
      plOut);

    // --- Automatische KI-Ansagen (Stunden-Uhr, Art „KI-Ansage“) ---
    const planning = await ctx.api.get(ctx.url('/planning')).catch(() => null);
    const aiEvents = /** @type {any[]} */ (planning?.clockEvents?.filter((/** @type {any} */ e) => e.kind === 'ai') ?? []);
    const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    const autoCard = tool('auto', 'Automatische KI-Ansagen', '#a78bfa', 'Läuft ohne dein Zutun zur eingestellten Zeit: Moderation oder KI-Nachrichten als Uhr-Event mit Minuten, Stunden und Wochentagen.',
      aiEvents.length ? h('table', { class: 'tbl kt-tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Bezeichnung'), h('th', {}, 'Art'), h('th', {}, 'Wann'), h('th', {}, 'Status'), h('th', {}))),
        h('tbody', {}, ...aiEvents.map((e) => h('tr', { style: e.enabled ? '' : 'opacity:.5' },
          h('td', {}, h('b', {}, e.label || 'KI-Ansage')), h('td', {}, e.aiKind === 'news' ? 'KI-Nachrichten' : 'Moderation'),
          h('td', {}, `${e.minutes.map((/** @type {number} */ m) => `:${String(m).padStart(2, '0')}`).join(' ')} · ${e.hours.length ? `${e.hours.join(', ')} Uhr` : 'jede Stunde'} · ${!e.days?.length || e.days.length === 7 ? 'täglich' : e.days.map((/** @type {number} */ d) => DAYS[d]).join(' ')}`),
          h('td', {}, e.enabled ? 'aktiv' : 'aus'),
          h('td', { class: 'kt-actions' }, h('button', { class: 'btn small', title: 'Jetzt erzeugen und einreihen', onclick: async () => { if (await run(() => ctx.api.post(ctx.url(`/clock-events/${e.id}/fire`)))) status('KI-Ansage wird erzeugt und eingereiht'); } }, '▶ Jetzt')))))) : h('div', { class: 'empty' }, 'Noch keine automatischen KI-Ansagen geplant.'),
      h('div', { class: 'kt-row' }, h('button', { class: 'btn small', onclick: () => document.querySelector('[data-view="planning"][data-sub="events"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) }, '＋ In der Stunden-Uhr planen (Art „KI-Ansage“)')));

    // --- KI-Assistent mit Verlauf ---
    const chatLog = h('div', { class: 'kt-chat' });
    const chatIn = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: '3', placeholder: 'Frag die KI: Moderationstext, Social-Media-Post, Gewinnspiel-Idee, Recherche …' }));
    const instr = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Eigene Anweisung (optional, z. B. „immer per Du, max. 60 Wörter“)' }));
    const drawChat = (/** @type {any[]} */ msgs) => {
      chatLog.replaceChildren(...(msgs.length ? msgs.map((m) => h('div', { class: `kt-msg ${m.role}` }, h('div', { class: 'kt-msg-text' }, m.text), h('span', { class: 'muted small' }, clockTime(m.at)))) : [h('div', { class: 'empty' }, 'Noch kein Verlauf – stell die erste Frage.')]));
      chatLog.scrollTop = chatLog.scrollHeight;
    };
    drawChat(await ctx.api.get(ctx.url('/ai/chat')).catch(() => []));
    const send = async () => {
      const prompt = chatIn.value.trim(); if (!prompt) return;
      status('KI antwortet …');
      const r = await run(() => ctx.api.post(ctx.url('/ai/chat'), { prompt, instruction: instr.value }));
      if (r) { chatIn.value = ''; status(`Fertig (${r.model}${r.cost ? ` · ${money(r.cost)}` : ''})`); drawChat(await ctx.api.get(ctx.url('/ai/chat'))); }
    };
    const assistant = tool('assistant', 'KI-Assistent', '#38bdf8', 'Chat mit Verlauf für Moderation, Social Media und Sendeplanung – Verlauf bleibt je Sender gespeichert.',
      chatLog,
      h('div', { class: 'kt-row' }, chatIn),
      h('div', { class: 'kt-row' }, instr,
        h('button', { class: 'btn small', title: 'Aus einer knappen Idee eine präzise Anweisung machen', onclick: async () => { const r = await run(() => ctx.api.post(ctx.url('/ai/improve'), { prompt: chatIn.value })); if (r) chatIn.value = r.text; } }, '✨ Prompt verbessern'),
        h('button', { class: 'btn small', onclick: async () => { if (confirm('Verlauf löschen?')) { await run(() => ctx.api.del(ctx.url('/ai/chat'))); drawChat([]); } } }, 'Verlauf löschen'),
        h('button', { class: 'btn primary', onclick: send }, 'Senden')));

    // --- Spot-Werkstatt: 4 Schritte ---
    const spotPrompt = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: '2', placeholder: 'Stichpunkte: Was, für wen, Angebot, Datum … z. B. „Bäckerei Müller, 3 Brötchen 1 €, nur Samstag“' }));
    const spotKind = /** @type {HTMLSelectElement} */ (h('select', {}, ...[['Werbespot (ca. 20 s)', 'Radio-Werbespot, gesprochen, ca. 20 Sekunden'], ['Ansage / Hinweis', 'kurze Senderansage'], ['Event-Trailer', 'Event-Trailer mit Datum, Ort, Call-to-Action'], ['Wetter-Ansage', 'Wetter-Ansage im Moderationston'], ['Gewinnspiel', 'Gewinnspiel-Aufruf mit Teilnahmehinweis']].map(([l, v]) => h('option', { value: v }, l))));
    const spotOut = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: '6', placeholder: 'Sprechertext – hier auch direkt eingeben oder nachbearbeiten', value: spotText, oninput: () => { spotText = spotOut.value; } }));
    const toneBtn = (/** @type {string} */ tone, /** @type {string} */ label) => h('button', { class: 'btn small', onclick: async () => { const r = await run(() => ctx.api.post(ctx.url('/ai/rewrite'), { text: spotOut.value, tone })); if (r) { spotOut.value = r.text; spotText = r.text; } } }, label);
    const spotTitle = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Titel in der Bibliothek', value: '' }));
    const spotVoiceInfo = h('span', { class: 'muted small' }, spotVoice ? `Stimme: „${spotVoice.title}“` : 'noch keine Sprecher-Datei');
    const bedSel = mediaSelect((m) => ['bed', 'music', 'jingle'].includes(m.category) && !m.url, '– Musikbett wählen (Kategorie Bett/Musik) –');
    const bedDb = /** @type {HTMLInputElement} */ (h('input', { type: 'number', value: '-6', min: '-30', max: '0', class: 'kt-num', title: 'Bett-Pegel (dB)' }));
    const duckDb = /** @type {HTMLInputElement} */ (h('input', { type: 'number', value: '-12', min: '-30', max: '-2', class: 'kt-num', title: 'Absenkung unter der Stimme (dB)' }));
    const spot = tool('spot', 'Spot-Werkstatt', '#f59e0b', 'Vom Stichpunkt zum fertigen Spot in vier Schritten: Text → Ton → Stimme → Musikbett mit automatischer Absenkung.',
      h('div', { class: 'kt-step' }, h('b', {}, '1'), h('span', {}, 'Text schreiben lassen'), spotKind, spotPrompt,
        h('button', { class: 'btn small primary', onclick: async () => { status('KI schreibt …'); const r = await run(() => ctx.api.post(ctx.url('/ai/text'), { prompt: `Schreibe einen ${spotKind.value} für: ${spotPrompt.value}. Nur den Sprechertext ausgeben.` })); if (r) { spotOut.value = r.text; spotText = r.text; status('Text fertig'); } } }, 'Text erzeugen')),
      h('div', { class: 'kt-step' }, h('b', {}, '2'), h('span', {}, 'Ton anpassen'), h('div', { class: 'kt-row' }, toneBtn('kuerzer', 'Kürzer'), toneBtn('laenger', 'Länger'), toneBtn('witziger', 'Witziger'), toneBtn('serioeser', 'Seriöser'), toneBtn('radio', 'Radio-Moderation')), spotOut),
      h('div', { class: 'kt-step' }, h('b', {}, '3'), h('span', {}, 'Stimme'), h('div', { class: 'kt-row' }, spotTitle,
        h('button', { class: 'btn small primary', onclick: async () => { status('KI spricht …'); const m = await run(() => ctx.api.post(ctx.url('/ai/speech'), { text: spotOut.value, title: spotTitle.value, category: 'tts' })); if (m) { spotVoice = m; spotVoiceInfo.textContent = `Stimme: „${m.title}“`; status('Sprecher-Datei liegt in der Bibliothek'); preview(m.id); } } }, 'Vertonen'), spotVoiceInfo)),
      h('div', { class: 'kt-step' }, h('b', {}, '4'), h('span', {}, 'Musikbett mit Ducking'), h('div', { class: 'kt-row' }, bedSel, h('label', { class: 'kt-lbl' }, 'Bett', bedDb, 'dB'), h('label', { class: 'kt-lbl' }, 'Absenkung', duckDb, 'dB'),
        h('button', { class: 'btn small primary', onclick: async () => {
          if (!spotVoice) { status('Zuerst vertonen (Schritt 3)', true); return; }
          if (!bedSel.value) { status('Musikbett wählen', true); return; }
          status('Mische …');
          const m = await run(() => ctx.api.post(ctx.url('/ai/spot-mix'), { voiceMediaId: spotVoice.id, bedMediaId: bedSel.value, bedDb: Number(bedDb.value), duckDb: Number(duckDb.value), title: spotTitle.value ? `${spotTitle.value} (mit Bett)` : '', category: 'ad' }));
          if (m) { status(`„${m.title}“ liegt in der Bibliothek (Werbung)`); preview(m.id); }
        } }, 'Mischen & speichern'))));

    // --- Sendeablauf-Planer ---
    const planTopic = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Sendung / Thema, z. B. „Samstags-Frühstück mit Oldies“' }));
    const planMin = /** @type {HTMLInputElement} */ (h('input', { type: 'number', value: '60', min: '15', max: '360', class: 'kt-num' }));
    const planStart = /** @type {HTMLInputElement} */ (h('input', { type: 'time', value: '10:00' }));
    const planNotes = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Hinweise (Rubriken, Gäste, feste Termine …)' }));
    const planTable = h('div', { class: 'kt-plan' });
    const drawPlan = () => {
      const total = planRows.reduce((a, r) => a + (Number(r.minutes) || 0), 0);
      planTable.replaceChildren(planRows.length ? h('table', { class: 'tbl kt-tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Uhrzeit'), h('th', {}, 'Min.'), h('th', {}, 'Segment'), h('th', {}, 'Inhalt'), h('th', {}))),
        h('tbody', {}, ...planRows.map((r, i) => h('tr', { draggable: 'true', ondragstart: (/** @type {DragEvent} */ e) => e.dataTransfer?.setData('text/plain', String(i)), ondragover: (/** @type {DragEvent} */ e) => e.preventDefault(), ondrop: (/** @type {DragEvent} */ e) => { e.preventDefault(); const from = Number(e.dataTransfer?.getData('text/plain')); if (Number.isInteger(from) && from !== i) { const [x] = planRows.splice(from, 1); planRows.splice(i, 0, x); drawPlan(); } } },
          h('td', {}, h('input', { value: r.time, class: 'kt-cell kt-time', oninput: (/** @type {Event} */ e) => { r.time = /** @type {HTMLInputElement} */ (e.target).value; } })),
          h('td', {}, h('input', { type: 'number', value: String(r.minutes), class: 'kt-cell kt-num', oninput: (/** @type {Event} */ e) => { r.minutes = Number(/** @type {HTMLInputElement} */ (e.target).value) || 0; } })),
          h('td', {}, h('input', { value: r.segment, class: 'kt-cell', oninput: (/** @type {Event} */ e) => { r.segment = /** @type {HTMLInputElement} */ (e.target).value; } })),
          h('td', {}, h('input', { value: r.content, class: 'kt-cell kt-wide', oninput: (/** @type {Event} */ e) => { r.content = /** @type {HTMLInputElement} */ (e.target).value; } })),
          h('td', { class: 'kt-actions' },
            h('button', { class: 'btn small', title: 'Text in die Spot-Werkstatt übernehmen', onclick: () => { spotText = r.content; spotOut.value = r.content; document.getElementById('kt-spot')?.scrollIntoView({ behavior: 'smooth' }); } }, '→ Spot'),
            h('button', { class: 'btn small danger', onclick: () => { planRows.splice(i, 1); drawPlan(); } }, '✕'))))),
        h('div', { class: 'muted small' }, `Summe ${total} Minuten · Zeilen per Drag & Drop verschieben`)) : h('div', { class: 'empty' }, 'Noch kein Ablauf – Thema eingeben und planen lassen.'));
    };
    drawPlan();
    const plan = tool('plan', 'Sendeablauf-Planer', '#818cf8', 'Die KI plant die Sendung Stunde für Stunde – Musikuhr, Moderation, Rubriken – als bearbeitbare Tabelle mit Export.',
      h('div', { class: 'kt-row' }, planTopic, h('label', { class: 'kt-lbl' }, 'Länge', planMin, 'Min.'), h('label', { class: 'kt-lbl' }, 'Start', planStart)),
      h('div', { class: 'kt-row' }, planNotes,
        h('button', { class: 'btn primary', onclick: async () => { status('KI plant …'); const r = await run(() => ctx.api.post(ctx.url('/ai/plan'), { topic: planTopic.value, minutes: Number(planMin.value), startTime: planStart.value, notes: planNotes.value })); if (r) { planRows = r.rows; if (!r.rows.length) status('Keine Tabelle erkannt – Rohtext in der Konsole', true); drawPlan(); } } }, 'Ablauf planen'),
        h('button', { class: 'btn small', onclick: () => { planRows.push({ time: '', minutes: 3, segment: 'Musik', content: '' }); drawPlan(); } }, '＋ Zeile'),
        h('button', { class: 'btn small', onclick: () => { if (!planRows.length) return status('Noch kein Ablauf - erst planen oder eine Zeile anlegen', true); const csv = ['Uhrzeit;Minuten;Segment;Inhalt', ...planRows.map((r) => [r.time, r.minutes, r.segment, r.content].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';'))].join('\r\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `sendeablauf-${(planTopic.value || 'sendung').replace(/[^\w-]+/g, '_')}.csv`; a.click(); } }, '⬇ CSV'),
        h('button', { class: 'btn small', onclick: () => { if (!planRows.length) return status('Noch kein Ablauf - erst planen oder eine Zeile anlegen', true); window.print(); } }, '🖨 Drucken')),
      planTable);

    // --- Transkription ---
    const trSel = mediaSelect((m) => !m.url, '– Aufnahme / Titel wählen –');
    const trLang = /** @type {HTMLSelectElement} */ (h('select', {}, ...[['de', 'Deutsch'], ['en', 'Englisch'], ['fr', 'Französisch'], ['es', 'Spanisch'], ['it', 'Italienisch'], ['tr', 'Türkisch']].map(([v, l]) => h('option', { value: v }, l))));
    const trOut = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: '8', placeholder: 'Transkript erscheint hier – Text editierbar', value: transcript?.text ?? '' }));
    const trInfo = h('span', { class: 'muted small' }, transcript ? `Engine: ${transcript.engine} · ${transcript.segments.length} Abschnitte` : 'Whisper lokal (ANMACHA_CAST_WHISPER) oder OpenAI-/kompatibler Provider');
    const dl = (/** @type {string} */ text, /** @type {string} */ name, /** @type {string} */ type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
    const trans = tool('transcribe', 'Transkription', '#22d3ee', 'Aus Audio wird Text mit Zeitmarken – lokal per Whisper oder über deinen Provider. Export als TXT/SRT, Zusammenfassung per KI.',
      h('div', { class: 'kt-row' }, trSel, trLang,
        h('button', { class: 'btn primary', onclick: async () => { if (!trSel.value) { status('Datei wählen', true); return; } status('Transkribiere … (kann einige Minuten dauern)'); const r = await run(() => ctx.api.post(ctx.url('/ai/transcribe'), { mediaId: trSel.value, language: trLang.value })); if (r) { transcript = r; trOut.value = r.text; trInfo.textContent = `Engine: ${r.engine} · ${r.segments.length} Abschnitte`; status('Transkript fertig'); } } }, 'Transkribieren'), trInfo),
      trOut,
      h('div', { class: 'kt-row' },
        h('button', { class: 'btn small', onclick: () => dl(trOut.value, 'transkript.txt', 'text/plain') }, '⬇ TXT'),
        h('button', { class: 'btn small', onclick: () => dl(transcript?.srt ?? '', 'transkript.srt', 'text/plain') }, '⬇ SRT'),
        h('button', { class: 'btn small', title: 'WebVTT für Web-Player, YouTube und Podcast-Kapitel', onclick: () => dl(toVtt(transcript?.segments ?? []), 'transkript.vtt', 'text/vtt') }, '⬇ VTT'),
        h('button', { class: 'btn small', onclick: () => dl(JSON.stringify(transcript?.segments ?? [], null, 2), 'transkript.json', 'application/json') }, '⬇ JSON'),
        h('button', { class: 'btn small', onclick: async () => { const r = await run(() => ctx.api.post(ctx.url('/ai/text'), { prompt: `Fasse dieses Transkript zusammen (5 Stichpunkte), dann Kapitelmarken und 2 Social-Media-Posts:\n\n${trOut.value.slice(0, 12000)}` })); if (r) { chatIn.value = r.text; document.getElementById('kt-assistant')?.scrollIntoView({ behavior: 'smooth' }); } } }, '✨ Zusammenfassung & Show-Notes')));

    // --- Voice Studio (bestehend) ---
    const vsText = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: '4', placeholder: 'Text zum Vertonen – Station-ID, Ansage, Moderation …' }));
    const vsTitle = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Titel in der Bibliothek' }));
    const vsCat = /** @type {HTMLSelectElement} */ (h('select', {}, ...[['tts', 'TTS'], ['ad', 'Werbung'], ['jingle', 'Jingle'], ['station_id', 'Station ID'], ['news', 'News'], ['voice_track', 'Voice Track'], ['drop', 'Drop']].map(([v, l]) => h('option', { value: v }, l))));
    const voiceStudio = tool('voice', 'Voice Studio', '#ec4899', 'Text → Sprache mit der Stimme aus „Anbieter & Keys“ (OpenAI, ElevenLabs, Piper lokal) direkt in die Bibliothek.',
      vsText, h('div', { class: 'kt-row' }, vsTitle, vsCat,
        h('button', { class: 'btn primary', onclick: async () => { status('KI spricht …'); const m = await run(() => ctx.api.post(ctx.url('/ai/speech'), { text: vsText.value, title: vsTitle.value, category: vsCat.value })); if (m) { status(`„${m.title}“ liegt in der Bibliothek (Ordner KI-Studio)`); preview(m.id); } } }, 'Vertonen & speichern')),
      h('p', { class: 'muted small' }, 'Aufnahme, Schnitt und Effekte: unter „Aufnahmen“ (Mitschnitt) bzw. im Track-TÜV. Stimm-Klonen nur mit lokaler Engine (ElevenLabs-Voice-ID unter Anbieter eintragen).'));

    const notYet = h('section', { class: 'panel kt-tool kt-dim', style: '--c:#64748b' },
      h('div', { class: 'kt-head' }, h('span', { class: 'kt-badge' }, '…'), h('div', {}, h('h2', {}, 'Musik-Studio (Suno) & Office-Studio'), h('p', { class: 'muted small' }, 'Bewusst nicht enthalten: Songs komponieren (Suno) und Word/Excel/PowerPoint erzeugen brauchen externe Dienste mit eigenem Vertrag. Jingles und Betten entstehen über die Sendeuhr-Elemente, Berichte über „Berichte“ (CSV/E-Mail).'))));

    return [h('div', { class: 'kt-grid' }, studio, kiPlaylist, autoCard, assistant, spot, plan, trans, voiceStudio, notYet)];
  }

  return {
    show: () => run(async () => { await load(); render(); }),
    /** SSE: neue Entscheidungen/Freigaben live anzeigen */
    onEvent(/** @type {string} */ type) {
      if ((type === 'ai.decision' || type === 'ai.pending') && tab === 'director' && root.isConnected && !root.closest('[hidden]')) refresh();
    },
  };
}

// @ts-check
// Anbindungen an bestehende Systeme: AzuraCast, Icecast, beliebige Streams (SAM, mAirList, RadioDJ, eigene Automation).
import { formDialog, h, run, status } from './ui.js';

const KIND = /** @type {Record<string,string>} */ ({ azuracast: 'AzuraCast', icecast: 'Icecast-Server', stream: 'Stream-Adresse (Relay)' });

/** @typedef {{ api: import('./api.js').Api, url: (p: string) => string, stationId: () => string }} Ctx */

/** Öffentliche Seiten (ohne Login) mit Kurzbeschreibung - gespiegelt nach senderpage/sendeplan/charts/network im Control Center. */
const PAGES = /** @type {[string, string, string][]} */ ([
  ['sender.html', 'Senderseite', 'Marke, Jetzt läuft, Hörer, aktuelle Sendung, Top 5, Podcast'],
  ['sendeplan.html', 'Sendeplan', 'Wochenplan aus den Sendezeitfenstern'],
  ['charts.html', 'Charts', 'Meistgespielte Titel (heute, 7 oder 30 Tage)'],
  ['netzwerk.html', 'Netzwerk', 'Alle öffentlichen Sender dieser Installation'],
  ['status.html', 'Stream-Status', 'Adressen, Formate, Verlauf (wie Icecast)'],
]);

/**
 * Widget-Konfigurator: Layout (Player/Senderseite/Charts/Sendeplan), Theme, Akzent und Verlauf → fertiger Einbettungscode mit Vorschau.
 * @param {Ctx} ctx
 */
function widgetCard(ctx) {
  const base = `${ctx.api.base || location.origin + location.pathname.replace(/[^/]*$/, '').replace(/\/$/, '')}/`;
  const st = { layout: 'widget', theme: 'dark', accent: '', history: 3, height: 200 };
  const LAYOUTS = /** @type {[string, string, number][]} */ ([['widget', 'Player (kompakt)', 200], ['sender', 'Senderseite', 760], ['charts', 'Charts', 640], ['sendeplan', 'Sendeplan', 640]]);
  const code = h('pre', { class: 'wc-code' });
  const frame = /** @type {HTMLIFrameElement} */ (h('iframe', { class: 'wc-preview', title: 'Vorschau' }));
  const openLink = /** @type {HTMLAnchorElement} */ (h('a', { class: 'btn small', target: '_blank', rel: 'noopener' }, '↗ Öffnen'));
  function src() {
    const q = new URLSearchParams({ station: ctx.stationId() });
    if (st.theme === 'light') q.set('theme', 'light');
    if (/^[0-9a-f]{6}$/i.test(st.accent)) q.set('accent', st.accent.toLowerCase());
    if (st.layout === 'widget') q.set('history', String(st.history));
    return `${base}${st.layout}.html?${q}`;
  }
  function draw() {
    const url = src();
    const extra = st.layout === 'widget' ? ' allow="autoplay"' : '';
    code.textContent = `<iframe src="${url}" width="100%" height="${st.height}" style="border:0;max-width:${st.layout === 'widget' ? 460 : 960}px" loading="lazy"${extra}></iframe>`;
    frame.src = url; frame.style.height = `${st.height}px`; frame.style.maxWidth = st.layout === 'widget' ? '460px' : '960px';
    openLink.href = url;
  }
  const sel = (/** @type {string} */ label, /** @type {[string,string][]} */ opts, /** @type {string} */ val, /** @type {(v: string) => void} */ on) =>
    h('label', { class: 'wc-field' }, h('span', {}, label), h('select', { onchange: (/** @type {Event} */ e) => { on(/** @type {HTMLSelectElement} */ (e.target).value); draw(); } }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l))));
  const accentIn = /** @type {HTMLInputElement} */ (h('input', { type: 'color', value: '#38bdf8', oninput: (/** @type {Event} */ e) => { st.accent = /** @type {HTMLInputElement} */ (e.target).value.slice(1); draw(); } }));
  const histIn = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: 0, max: 10, value: String(st.history), oninput: (/** @type {Event} */ e) => { st.history = Math.max(0, Math.min(10, Number(/** @type {HTMLInputElement} */ (e.target).value) || 0)); draw(); } }));
  const heightIn = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: 120, max: 1200, step: 20, value: String(st.height), oninput: (/** @type {Event} */ e) => { st.height = Math.max(120, Math.min(1200, Number(/** @type {HTMLInputElement} */ (e.target).value) || 200)); draw(); } }));
  const histField = h('label', { class: 'wc-field' }, h('span', {}, 'Verlauf (Titel)'), histIn);
  const form = h('div', { class: 'wc-form' },
    sel('Layout', LAYOUTS.map(([v, l]) => /** @type {[string,string]} */ ([v, l])), st.layout, (v) => { st.layout = v; st.height = LAYOUTS.find((x) => x[0] === v)?.[2] ?? 200; heightIn.value = String(st.height); histField.hidden = v !== 'widget'; }),
    sel('Theme', [['dark', 'Dunkel'], ['light', 'Hell']], st.theme, (v) => { st.theme = v; }),
    h('label', { class: 'wc-field' }, h('span', {}, 'Akzentfarbe'), h('div', { class: 'row' }, accentIn, h('button', { class: 'btn small', title: 'Senderfarbe verwenden', onclick: () => { st.accent = ''; accentIn.value = '#38bdf8'; draw(); } }, 'Standard'))),
    histField,
    h('label', { class: 'wc-field' }, h('span', {}, 'Höhe (px)'), heightIn));
  draw();
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Widget-Konfigurator'),
      h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: async () => { try { await navigator.clipboard.writeText(code.textContent ?? ''); status('Einbettungscode kopiert'); } catch { status('Kopieren nicht möglich - Code markieren und kopieren', true); } } }, '⎘ Code kopieren'), openLink)),
    h('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Player, Senderseite, Charts oder Sendeplan als iframe in die eigene Webseite einbetten. Theme, Akzent und Verlauf stecken in der Adresse - kein Login nötig, solange „Öffentliche Statusseite & Player-Widget“ in den Einstellungen an ist.'),
    h('div', { class: 'wc-grid' }, form, h('div', {}, code, frame)));
}

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountBridges(root, ctx) {
  /** @param {string} title @param {...(Node|string|null|false)} body */
  const card = (title, ...body) => h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, title)), ...body);
  /** @param {string} k @param {any} v */
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v === null || v === undefined || v === '' ? '–' : String(v)));

  const STATE = /** @type {Record<string,[string,string]>} */ ({ connected: ['ok', 'sendet'], connecting: ['warn', 'verbindet …'], error: ['danger', 'Fehler'], idle: ['muted', 'wartet'], unsupported: ['danger', 'nicht unterstützt'] });

  /** Eigene Streams: bis zu 2 Mounts auf dem eigenen Icecast mit eigener Bitrate und öffentlichem Link.
   * @param {{ max: number, source: any, items: any[] }} d */
  function ownStreamsCard(d) {
    const rows = d.items.map((o) => {
      const [cls, label] = o.enabled ? (STATE[o.status] ?? ['muted', o.status]) : ['muted', 'aus'];
      return h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line)' },
        h('span', { class: `pill ${cls}` }, label),
        h('div', { style: 'flex:1;min-width:200px' }, h('b', {}, o.name), ' ', h('span', { class: 'muted small' }, `${String(o.format).toUpperCase()} · ${o.bitrateKbps} kbit/s${o.listeners != null ? ` · ${o.listeners} Hörer` : ''}`),
          h('div', { class: 'small' }, h('a', { href: o.link, target: '_blank', rel: 'noopener' }, o.link)), o.error ? h('div', { class: 'small', style: 'color:var(--danger,#f87171)' }, o.error) : null),
        h('button', { class: 'btn small', title: 'Link kopieren', onclick: () => navigator.clipboard?.writeText(o.link).then(() => status('Link kopiert'), () => status(o.link)) }, 'Link'),
        h('button', { class: 'btn small', onclick: () => editOwn(o) }, 'Ändern'),
        h('button', { class: 'btn small', onclick: () => run(async () => { await ctx.api.patch(ctx.url(`/own-streams/${o.id}`), { enabled: !o.enabled }); await show(); }) }, o.enabled ? 'Aus' : 'An'),
        h('button', { class: 'btn small danger', onclick: () => confirm(`Eigenen Stream „${o.name}“ löschen?`) && run(async () => { await ctx.api.del(ctx.url(`/own-streams/${o.id}`)); await show(); }) }, 'Löschen'));
    });
    return card('Eigene Streams',
      h('p', { class: 'muted small', style: 'margin:0 0 8px' }, `Bis zu ${d.max} zusätzliche Streams auf deinem Icecast${d.source ? ` (${d.source.host}:${d.source.port})` : ''}, jeweils mit eigener Bitrate und eigenem Link, zum Beispiel für mobile Hörer mit wenig Datenvolumen. Server und Zugang kommen vom vorhandenen Icecast-Ausgang.`),
      ...(rows.length ? rows : [h('div', { class: 'empty' }, 'Noch kein eigener Stream.')]),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn small primary', disabled: d.items.length >= d.max || !d.source, title: !d.source ? 'Zuerst einen Icecast-Ausgang auf dem eigenen Server einrichten (nicht laut.fm)' : '', onclick: () => editOwn(null) }, '＋ Eigener Stream'),
        d.items.length >= d.max ? h('span', { class: 'muted small' }, `Limit von ${d.max} erreicht`) : null,
        !d.source ? h('span', { class: 'muted small' }, 'Voraussetzung: Icecast-Ausgang auf dem eigenen Server (Stream & Encoder → ＋)') : null));
  }

  /** @param {any} o */
  async function editOwn(o) {
    const v = await formDialog(o ? `Eigener Stream: ${o.name}` : 'Neuer eigener Stream', [
      { name: 'name', label: 'Name', value: o?.name ?? '', required: true, hint: 'Daraus entsteht der Mountpoint, z. B. „Mobil“ → /mobil' },
      ...(o ? [] : [{ name: 'format', label: 'Format', value: 'mp3', options: /** @type {[string,string][]} */ ([['mp3', 'MP3 (überall abspielbar)'], ['aac', 'AAC (effizient bei niedriger Bitrate)'], ['opus', 'Opus (sehr effizient, Browser/Apps)']]) }]),
      { name: 'bitrateKbps', label: 'Bitrate (kbit/s, 32 bis 320)', type: 'number', value: o?.bitrateKbps ?? 64, required: true, hint: '48 bis 64 für mobile Hörer, 128 für den Standard, 192 und mehr für HiFi' },
    ], o ? 'Speichern' : 'Anlegen');
    if (!v) return;
    const r = await run(() => (o ? ctx.api.patch(ctx.url(`/own-streams/${o.id}`), { name: v.name, bitrateKbps: Number(v.bitrateKbps) }) : ctx.api.post(ctx.url('/own-streams'), { name: v.name, format: v.format, bitrateKbps: Number(v.bitrateKbps) })));
    if (r) status(`Eigener Stream „${r.name}“ gespeichert`);
    await run(show);
  }

  async function show() {
    const [list, own] = await Promise.all([
      /** @type {Promise<any[]>} */ (ctx.api.get(ctx.url('/bridges'))),
      ctx.api.get(ctx.url('/own-streams')).catch(() => null),
    ]);
    root.replaceChildren(
      h('div', { class: 'bridge-hero' },
        h('div', {}, h('span', { class: 'ov-kicker' }, 'VERBINDUNGEN'), h('h1', {}, 'Streams & Anbindungen'), h('p', {}, 'Icecast, AzuraCast, Relays und externe Systeme mit AnMaCha Cast verbinden.')),
        h('button', { class: 'btn small primary', onclick: () => edit(null) }, '＋ Anbindung')),
      card('Öffentliche Seiten',
        h('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Ohne Login erreichbar, Daten live aus diesem Server (CORS offen). Adresse mit ?station=… wählt den Sender, theme=light und accent=rrggbb passen das Aussehen an.'),
        h('div', { class: 'pp-links' }, ...PAGES.map(([file, label, desc]) => h('a', { class: 'pp-link', href: `${ctx.api.base || '.'}/${file}${file === 'netzwerk.html' ? '' : `?station=${encodeURIComponent(ctx.stationId())}`}`, target: '_blank', rel: 'noopener' }, h('b', {}, label), h('span', { class: 'muted small' }, desc))))),
      own ? ownStreamsCard(own) : null,
      widgetCard(ctx),
      card('So funktioniert die Brücke',
        h('p', {}, 'Deine bestehende Technik läuft weiter, zum Beispiel AzuraCast mit Icecast, SAM Broadcaster, mAirList, RadioDJ oder ein reines Web-Relay. AnMaCha Cast verbindet sich damit, statt alles neu aufzubauen:'),
        h('ul', {},
          h('li', {}, h('b', {}, 'Relay übernehmen: '), 'Der vorhandene Stream wird zur AnMaCha Cast-Quelle mit eigener Priorität. Priorität 5 macht ihn zum Hauptprogramm vor der AnMaCha Cast-Automation (10), 20 zum Notfall-Programm dahinter. Live-Sendungen (1–3) übernehmen wie gewohnt.'),
          h('li', {}, h('b', {}, 'Status spiegeln: '), 'Titel, Hörer und Verlauf aus AzuraCast oder Icecast erscheinen in AnMaCha Cast, auf der Statusseite, im Widget und in den Webhooks.'),
          h('li', {}, h('b', {}, 'Für Entwickler: '), 'Die Bridge-API ordnet externe Schlüssel fest einem Sender zu. Wiederholte Synchronisierungen legen nichts doppelt an. Details in docs/BRIDGE.md.'))),
      ...(list.length ? list.map((b) => card(`${b.name} · ${KIND[b.kind] ?? b.kind}`,
        kv('Adresse', b.url + (b.station ? ` · ${b.station}` : '')),
        kv('Relay', b.pull ? `aktiv, Priorität ${b.priority}${b.relay ? ` · ${({ streaming: 'empfängt', connecting: 'verbindet …', retrying: 'neuer Versuch', stopped: 'gestoppt' })[b.relay.state] ?? b.relay.state}${b.relay.error ? ` (${b.relay.error})` : ''} · ${(b.relay.bytes / 1048576).toFixed(1)} MB` : ''}` : 'aus'),
        kv('Status-Spiegel', b.mirror ? (b.status?.error ? `Fehler: ${b.status.error}` : b.status?.data ? `${b.status.data.now ? `${b.status.data.now.artist} – ${b.status.data.now.title}` : 'kein Titel'} · ${b.status.data.listeners ?? '?'} Hörer${b.status.data.live?.active ? ` · LIVE: ${b.status.data.live.streamer ?? ''}` : ''}` : 'wird abgefragt …') : 'aus'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => edit(b) }, 'Bearbeiten'),
          h('button', { class: 'btn small danger', onclick: () => confirm(`Anbindung „${b.name}“ entfernen? Die Relay-Quelle wird ebenfalls entfernt.`) && run(async () => { await ctx.api.del(ctx.url(`/bridges/${b.id}`)); show(); }) }, 'Entfernen'))))
        : [h('div', { class: 'empty' }, 'Noch keine Anbindung.')]),
    );
  }

  /** @param {any} b */
  async function edit(b) {
    const v = await formDialog(b ? `Anbindung: ${b.name}` : 'Neue Anbindung', [
      { name: 'kind', label: 'System', value: b?.kind ?? 'azuracast', options: Object.entries(KIND).map(([k, l]) => /** @type {[string,string]} */ ([k, l])) },
      { name: 'name', label: 'Name', value: b?.name ?? '', required: true },
      { name: 'url', label: 'Adresse', value: b?.url ?? 'https://', required: true, hint: 'AzuraCast: https://radio.example · Icecast: http://server:8000 · Stream: vollständige Stream-URL (auch SAM/mAirList/RadioDJ-Encoder-Ausgang)' },
      { name: 'station', label: 'AzuraCast: Sender-Kurzname/ID · Icecast: Mount', value: b?.station ?? '', hint: 'z. B. azuratest_radio bzw. /live' },
      { name: 'apiKey', label: `AzuraCast-API-Key (optional${b?.hasKey ? ', leer = unverändert, "-" = löschen' : ''})`, type: 'password', value: '', hint: 'Nur für nicht öffentliche Sender nötig – AzuraCast → Mein Konto → API-Schlüssel' },
      { name: 'mirror', label: 'Status spiegeln (Titel, Hörer, Verlauf)', type: 'checkbox', value: b?.mirror ?? true },
      { name: 'pull', label: 'Stream als AnMaCha Cast-Quelle übernehmen (Relay)', type: 'checkbox', value: b?.pull ?? false },
      { name: 'pullUrl', label: 'Stream-Adresse fürs Relay (optional, sonst aus dem Status)', value: b?.pullUrl ?? '' },
      { name: 'priority', label: 'Priorität der Relay-Quelle (kleiner = wichtiger)', type: 'number', value: b?.priority ?? 20, hint: '5 = Hauptprogramm vor der AnMaCha Cast-Automation, 20 = Notfall dahinter' },
    ], 'Speichern & verbinden');
    if (!v) return;
    const body = { ...v, ...(v.apiKey ? { apiKey: v.apiKey === '-' ? '' : v.apiKey } : { apiKey: undefined }) };
    const r = await run(() => (b ? ctx.api.patch(ctx.url(`/bridges/${b.id}`), body) : ctx.api.post(ctx.url('/bridges'), body)));
    if (r) status(`Anbindung „${r.name}“ gespeichert`);
    setTimeout(() => run(show), 1500);
  }

  return { show: () => run(show) };
}

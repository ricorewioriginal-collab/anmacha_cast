// @ts-check
// Dashboard (Senderübersicht, Abschnitt 5 des Masterprompts): zeigt jeden Sender als Karte mit Logo,
// Status, aktuellem Titel und Betriebsmodus - KEINE komplette Studiooberfläche. Die bisherige "Dashboard"-
// Arbeitsfläche (Decks/Cardwall/Queue/Live) bleibt unter "Studio" erreichbar, nur eine Ansicht weiter.

import { h, run } from './ui.js';

/** @typedef {{ api: import('./api.js').Api, stations: () => any[], openStudio: (id: string) => Promise<void>, manage: (id: string) => Promise<void> }} Ctx */

const MODE_LABEL = /** @type {Record<string, string>} */ ({ AUTO: '24/7 AutoDJ', MANUAL: 'Manuell', LIVE: 'LIVE', EMERGENCY: 'Notfall' });
/** Sortierung der Senderkarten wie im Control Center: Live (Meiste/Wenigste), Ø 24h, Ø 7 Tage, A–Z */
const SORTS = /** @type {[string, string][]} */ ([['live', '● Live (Meiste)'], ['live_asc', 'Live (Wenigste)'], ['avg_24h', 'Ø 24h'], ['avg_7d', 'Ø 7 Tage'], ['name', 'A–Z']]);
const SORT_KEY = 'anmachacast.overviewSort';
const num = (/** @type {number|null|undefined} */ v) => (v == null ? '–' : String(Number.isInteger(v) ? v : v.toFixed(1)).replace('.', ','));

/** @param {any[]} cards @param {string} mode */
export function sortCards(cards, mode) {
  const by = (/** @type {(c: any) => number} */ f, desc = true) => (/** @type {any} */ a, /** @type {any} */ b) => (desc ? f(b) - f(a) : f(a) - f(b)) || a.st.name.localeCompare(b.st.name, 'de');
  const live = (/** @type {any} */ c) => c.net?.live ?? 0;
  const cmp =
    mode === 'live_asc' ? by(live, false) :
    mode === 'avg_24h' ? by((c) => c.net?.avg24h ?? -1) :
    mode === 'avg_7d' ? by((c) => c.net?.avg7d ?? -1) :
    mode === 'name' ? (/** @type {any} */ a, /** @type {any} */ b) => a.st.name.localeCompare(b.st.name, 'de') :
    by(live);
  return [...cards].sort(cmp);
}

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountOverview(root, ctx) {
  let sortMode = (() => { try { return localStorage.getItem(SORT_KEY) || 'live'; } catch { return 'live'; } })();
  /** @type {any[]} */ let cards = [];
  let syncedAt = 0;

  /** @param {any} st @param {any} net */
  async function cardData(st, net) {
    const p = `/stations/${encodeURIComponent(st.id)}`;
    const [auto, mode, outputs] = await Promise.all([
      ctx.api.get(`${p}/automation-source`).catch(() => null),
      ctx.api.get(`${p}/mode`).catch(() => null),
      ctx.api.get(`${p}/outputs`).catch(() => []),
    ]);
    return { st, auto, mode, outputs: outputs ?? [], net };
  }

  function card({ st, auto, mode, outputs, net }) {
    const onAir = !!mode?.bus;
    const live = outputs.some((/** @type {any} */ o) => o.enabled && o.state?.status === 'connected');
    const now = auto?.now;
    const nowText = auto?.source === 'none' || !now ? (auto?.source === 'lautfm' ? 'Kein Titel gemeldet' : 'Keine Automation aktiv') : `${now.artist ? `${now.artist} – ` : ''}${now.title || 'Kein Titel gemeldet'}`;
    const logo = st.logo
      ? h('img', { src: `${ctx.api.base}/api/v1/stations/${encodeURIComponent(st.id)}/logo?v=${encodeURIComponent(st.logo)}`, alt: '' })
      : h('span', {}, st.name.split(/\s+/).map((/** @type {string} */ w) => w[0]).join('').slice(0, 3).toUpperCase());
    return h('div', { class: `ov-card${onAir ? ' is-onair' : ''}` },
      h('div', { class: 'ov-head' },
        h('div', { class: `ov-logo${st.logo ? ' has-img' : ''}` }, logo),
        h('div', { class: 'ov-title' }, h('strong', {}, st.name), h('span', { class: 'muted' }, st.slogan || (auto?.source === 'lautfm' ? 'laut.fm Automation' : ''))),
        h('span', { class: `pill ${onAir ? 'active' : ''}` }, onAir ? '● ON AIR' : 'OFF AIR')),
      h('div', { class: 'ov-now-card' },
        h('span', { class: 'ov-now-label' }, 'Jetzt läuft'),
        h('strong', { class: 'ov-now' }, nowText)),
      h('div', { class: 'ov-nums' },
        h('div', { class: live ? 'is-live' : '' }, h('strong', {}, num(net?.live ?? 0)), h('span', {}, 'Live')),
        h('div', {}, h('strong', {}, num(net?.avg24h)), h('span', {}, 'Ø 24h')),
        h('div', {}, h('strong', {}, num(net?.avg7d)), h('span', {}, 'Ø 7 Tage'))),
      h('div', { class: 'ov-meta' },
        h('span', { class: 'tag' }, MODE_LABEL[mode?.mode] ?? mode?.mode ?? '–'),
        h('span', { class: `tag${live ? ' live' : ''}` }, live ? `${outputs.length} Ausgang/Ausgänge · aktiv` : outputs.length ? `${outputs.length} Ausgang/Ausgänge` : 'kein Ausgang')),
      h('div', { class: 'ov-actions' },
        h('button', { class: 'btn small', onclick: () => ctx.manage(st.id) }, 'Verwalten'),
        h('button', { class: 'btn small primary', onclick: () => ctx.openStudio(st.id) }, 'Studio öffnen')));
  }

  async function show() {
    root.replaceChildren(h('div', { class: 'empty' }, 'Lade Sender …'));
    const list = ctx.stations();
    const net = /** @type {any[]} */ ((await ctx.api.get('/network').catch(() => [])) ?? []);
    const loaded = await run(() => Promise.all(list.map((st) => cardData(st, net.find((n) => n.id === st.id)))));
    if (!loaded) return;
    cards = loaded;
    syncedAt = Date.now();
    render();
  }

  function setSort(/** @type {string} */ mode) {
    sortMode = mode;
    try { localStorage.setItem(SORT_KEY, mode); } catch { /* privat */ }
    render();
  }

  function render() {
    const active = cards.filter((x) => x.mode?.bus).length;
    const connected = cards.reduce((n, x) => n + x.outputs.filter((/** @type {any} */ o) => o.enabled && o.state?.status === 'connected').length, 0);
    root.replaceChildren(
      h('section', { class: 'ov-hero' },
        h('div', { class: 'ov-hero-copy' },
          h('span', { class: 'ov-kicker' }, 'ANMACHA CAST CONTROL'),
          h('h1', {}, 'Dein Radio. Deine Kontrolle.'),
          h('p', {}, 'Sender, Automation, Streams und Studio auf einen Blick – ohne erfundene Statuswerte.')),
        h('div', { class: 'ov-hero-stats' },
          h('div', { class: 'ov-stat' }, h('span', {}, 'Sender'), h('strong', {}, String(cards.length))),
          h('div', { class: 'ov-stat' }, h('span', {}, 'On Air'), h('strong', {}, String(active))),
          h('div', { class: 'ov-stat' }, h('span', {}, 'Encoder on air'), h('strong', {}, String(connected))))),
      h('section', { class: 'panel ov-stations-panel' },
        h('div', { class: 'panel-head' },
          h('h2', {}, 'Senderübersicht'),
          h('span', { class: 'muted' }, `Live-Daten aus der aktuellen AnMaCha Cast-Instanz · Stand ${new Date(syncedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`),
          h('button', { class: 'btn small', onclick: show, title: 'Hörerzahlen und Status neu laden' }, '⟳ Sync')),
        h('div', { class: 'ov-sort' }, h('span', {}, 'Sortieren:'),
          ...SORTS.map(([k, l]) => h('button', { class: `ov-sort-btn${sortMode === k ? ' active' : ''}`, onclick: () => setSort(k) }, l))),
        h('div', { class: 'ov-grid' }, ...sortCards(cards, sortMode).map(card))));
  }

  return { show, onEvent: () => {} };
}

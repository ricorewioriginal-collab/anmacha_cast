// @ts-check
// Cast Tools: originale Open-Source-Anwendungen von ArtCraft (Apache-2.0) unter eigenem Namen – Audio, Bild, Video, Vektor,
// Text und Motion Graphics für den Radioalltag. Die Web-Fassung lädt der Server bei Bedarf aus dem offiziellen Release
// (geprüft per SHA256SUMS) und stellt sie isoliert unter /tools/<id>/ bereit; geöffnet wird sie in einem eigenen Tab.

import { h, run, status } from './ui.js';

/** @typedef {{ api: import('./api.js').Api, me?: () => any }} Ctx */

const ICON = /** @type {Record<string,string>} */ ({ 'cast-sound': '🎚️', 'cast-photo': '🖼️', 'cast-film': '🎬', 'cast-vector': '✒️', 'cast-word': '📝', 'cast-effect': '✨' });

/** @param {number} b */
const mb = (b) => `${(b / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountTools(root, ctx) {
  /** @type {any[]} */ let tools = [];
  /** @type {Set<string>} */ const busy = new Set();

  const isAdmin = () => {
    const m = ctx.me?.();
    return !m || ((m.roles ?? []).includes('admin') && (m.stationIds ?? []).includes('*'));
  };

  async function load() {
    tools = (await ctx.api.get('/tools')) ?? [];
  }

  /** @param {any} t */
  async function install(t) {
    busy.add(t.id);
    render();
    status(`${t.name} wird aus dem offiziellen Release geladen und geprüft …`);
    const r = await run(() => ctx.api.post(`/tools/${encodeURIComponent(t.id)}/install`));
    busy.delete(t.id);
    if (r) status(`${t.name} ${r.web?.version ?? ''} ist bereit`);
    await load().catch(() => {});
    render();
  }

  /** @param {any} t */
  async function remove(t) {
    if (!confirm(`${t.name} von diesem Server entfernen? Es lässt sich jederzeit neu laden.`)) return;
    if (await run(() => ctx.api.del(`/tools/${encodeURIComponent(t.id)}`))) status(`${t.name} entfernt`);
    await load().catch(() => {});
    render();
  }

  /** @param {any} t */
  const open = (t) => window.open(`${ctx.api.base ?? ''}${t.web.url}`, `cast-tool-${t.id}`, 'noopener');

  function render() {
    const admin = isAdmin();
    root.replaceChildren(
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', {}, 'Cast Tools')),
        h('p', { class: 'muted' }, 'Werkzeuge für Audio, Bilder, Video, Logos, Texte und bewegte Grafiken – die originalen Open-Source-Anwendungen, geprüft aus dem offiziellen Release geladen, sobald du sie brauchst. Sie öffnen sich in einem eigenen Tab und laufen ganz in deinem Browser: Dateien öffnest und speicherst du dort über „Öffnen“ und „Exportieren“, danach in AnMaCha Cast hochladen (z. B. unter Tracks oder Jingles & IDs). Am Windows-PC gibt es dieselben Werkzeuge als Desktop-Programme in der AnMaCha-Cast-App.'),
        h('div', { class: 'tools-grid' }, ...tools.map((t) => {
          const loading = busy.has(t.id) || t.installing;
          return h('div', { class: 'tool-card' },
            h('div', { class: 'tool-head' }, h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, ICON[t.id] ?? '🧰'), h('div', {}, h('strong', {}, t.name), h('div', { class: 'muted small' }, t.web.installed ? `bereit · ${t.web.version} · ${mb(t.web.size)}` : 'noch nicht geladen'))),
            h('p', { class: 'small' }, t.purpose),
            h('div', { class: 'row-btns' },
              t.web.installed ? h('button', { class: 'btn small primary', onclick: () => open(t) }, 'Öffnen') : null,
              admin ? h('button', { class: `btn small${t.web.installed ? '' : ' primary'}`, disabled: loading, onclick: () => install(t) }, loading ? 'Lädt …' : t.web.installed ? 'Aktualisieren' : 'Laden') : null,
              admin && t.web.installed ? h('button', { class: 'btn small ghost', onclick: () => remove(t) }, 'Entfernen') : null,
              !admin && !t.web.installed ? h('span', { class: 'muted small' }, 'Laden kann ein Administrator') : null),
            h('div', { class: 'muted small tool-license' }, `Basiert auf ${t.upstream} · ${t.license} · `, h('a', { href: t.source, target: '_blank', rel: 'noopener' }, 'Quelle')));
        }))));
  }

  return {
    async show() {
      await run(async () => { await load(); render(); });
    },
  };
}

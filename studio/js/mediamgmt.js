// @ts-check
// Medienverwaltung (Masterprompt V1 Beta, Abschnitt 9): eigenständiger Arbeitsbereich, der die
// bestehende Mediathek (MediaService) nutzt - keine zweite, konkurrierende Mediendatenbank. Die
// bisherige "kompakte Medienansicht innerhalb der Automation" (Archiv-Tabelle im Studio-Arbeitsbereich)
// bleibt unverändert bestehen; diese Ansicht ergänzt Suche/Filter/Sortierung über die ganze Bibliothek,
// Mehrfach-Upload/Ordner-Import, Metadaten-Bearbeitung, Integritätsprüfung (fehlende Dateien, Duplikate,
// Relink) sowie Aktionen zum Senden an Deck/Queue/Playlist/Cardwall.
//
// Abschnitt 10 (Nextcloud): Nextcloud steht ausschließlich als Quellen-Reiter direkt hier neben
// der AnMaCha Cast-Bibliothek. Es gibt keinen separaten Sidebar-Menüpunkt mehr; dieselbe Browse-/Import-
// Logik wird wiederverwendet (keine zweite Nextcloud-Anbindung).

import { $, CATEGORY_STYLE, clockTime, download, fmt, formDialog, h, mediaTitle, run, status } from './ui.js';
import { mountNextcloud } from './nextcloud.js';
import { mountMusicHub } from './musikhub.js';

const CATEGORY_LABEL = /** @type {Record<string,string>} */ ({
  music: 'Musik', jingle: 'Jingle', sweeper: 'Sweeper', station_id: 'Station-ID', drop: 'Drop', news: 'Nachrichten',
  ad: 'Werbung', voice_track: 'Voicetrack', tts: 'TTS', bed: 'Bett', stream: 'Stream',
});

const SORTS = /** @type {Record<string, (a: any, b: any) => number>} */ ({
  added: (a, b) => b.addedAt - a.addedAt,
  title: (a, b) => mediaTitle(a).localeCompare(mediaTitle(b), 'de'),
  artist: (a, b) => (a.artist || '').localeCompare(b.artist || '', 'de'),
  duration: (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0),
});

/**
 * @typedef {{ api: import('./api.js').Api, url: (p: string) => string, library: () => any[], folders: () => Promise<string[]>,
 *   stationId: () => string, mediaUrl: (id: string) => string, sendToDeck: (deckId: string, media: any) => void, upload: (files: File[]) => Promise<any[]>, me: () => any }} Ctx
 */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountMediaManagement(root, ctx) {
  let q = '';
  let cat = '';
  let folder = '';
  let sort = 'added';
  const selected = new Set();
  // Eigener Zwischenspeicher statt direkt ctx.library() (= S.library in app.js): S.library wird bei
  // 'library.changed' erst asynchron nachgeladen, NACHDEM alle Views (also auch dieser hier) informiert
  // wurden - ein sofortiges refresh() aus onEvent() würde sonst mit veralteten Daten rendern.
  let items = ctx.library();

  async function reload() {
    items = (await run(() => ctx.api.get(ctx.url('/media')))) ?? items;
    refresh();
  }

  async function pickCart(media) {
    const carts = await run(() => ctx.api.get(ctx.url('/cardwall')));
    if (!carts) return;
    const v = await formDialog('An Cardwall senden', [
      { name: 'cart', label: 'Slot', value: carts[0]?.id ?? '', options: carts.map((/** @type {any} */ c) => /** @type {[string,string]} */ ([c.id, `${c.label || c.id}${c.mediaId ? ' (belegt)' : ''}`])) },
    ], 'Zuweisen');
    if (!v) return;
    await run(() => ctx.api.patch(ctx.url(`/cardwall/${encodeURIComponent(v.cart)}`), { mediaId: media.id, label: media.title?.slice(0, 40) }));
  }

  async function pickPlaylist(media) {
    const lists = await run(() => ctx.api.get(ctx.url('/playlists')));
    if (!lists) return;
    const v = await formDialog('Zu Playlist hinzufügen', [
      { name: 'pl', label: 'Playlist', value: lists[0]?.id ?? '', options: [...lists.map((/** @type {any} */ p) => /** @type {[string,string]} */ ([p.id, p.name])), ['', 'Neue Playlist …']] },
      { name: 'name', label: 'Name (bei „Neue Playlist“)', value: '' },
    ], 'Hinzufügen');
    if (!v) return;
    if (v.pl) {
      const pl = lists.find((/** @type {any} */ p) => p.id === v.pl);
      await run(() => ctx.api.patch(ctx.url(`/playlists/${encodeURIComponent(v.pl)}`), { items: [...(pl?.items ?? []), media.id] }));
    } else if (v.name?.trim()) {
      await run(() => ctx.api.post(ctx.url('/playlists'), { name: v.name.trim(), items: [media.id] }));
    } else return;
    status(`„${media.title}“ zur Playlist hinzugefügt`);
  }

  /**
   * Aktionen je Titel: drei Haupt-Knöpfe (Vorhören, Warteschlange, Bearbeiten) und ein ⋯-Menü mit beschrifteten
   * Einträgen für alles Weitere – statt zwölf Kürzel nebeneinander.
   */
  function actions(m) {
    const del = () => confirm(`„${m.title}“ endgültig löschen?`) && run(() => ctx.api.del(ctx.url(`/media/${encodeURIComponent(m.id)}`)).then(reload));
    const measureKey = () => run(async () => { status('Messe Tonart …'); const r = await ctx.api.post(ctx.url(`/media/${encodeURIComponent(m.id)}/key`), {}); status(`Tonart: ${r.key} (${r.camelot})`); await reload(); });
    const SEP = /** @type {const} */ ({ sep: true });
    /** @type {({ label: string, icon: string, run: () => void, danger?: boolean } | { sep: true })[]} */
    const items = [
      ...['A', 'B', 'C', 'D'].map((d) => ({ label: `An Deck ${d} senden`, icon: d, run: () => ctx.sendToDeck(d, m) })),
      SEP,
      { label: 'Zu Playlist hinzufügen …', icon: '♫', run: () => pickPlaylist(m) },
      { label: 'Auf die Cardwall legen …', icon: '▦', run: () => pickCart(m) },
      ...(m.url ? [] : [
        SEP,
        { label: 'Tags & Cover online suchen', icon: '🔎', run: () => lookupOnline(m) },
        { label: 'Eigenes Cover wählen …', icon: '🖼', run: () => pickCover(m) },
        { label: 'Cover entfernen', icon: '✕', run: () => run(() => ctx.api.del(ctx.url(`/media/${encodeURIComponent(m.id)}/cover`)).then(reload)) },
        { label: m.key ? `Tonart neu messen (${m.key}${m.camelot ? ` · ${m.camelot}` : ''})` : 'Tonart messen', icon: '♪', run: measureKey },
      ]),
      SEP,
      { label: 'Löschen', icon: '🗑', run: del, danger: true },
    ];
    return h('div', { class: 'row act' },
      h('button', { class: 'act-main', title: 'Vorhören', onclick: () => preview(m) }, '▶'),
      h('button', { class: 'act-main', title: 'In die Warteschlange', onclick: () => run(async () => { await ctx.api.post(ctx.url('/queue'), { mediaId: m.id }); status('In der Warteschlange'); }) }, '＋'),
      h('button', { class: 'act-main', title: 'Bearbeiten', onclick: () => editMeta(m) }, '✎'),
      actionMenu(items));
  }

  /** ⋯-Menü: öffnet eine Liste unter dem Knopf, schließt bei Klick daneben oder Esc. @param {any[]} items */
  function actionMenu(items) {
    const menu = h('div', { class: 'act-menu', hidden: true, role: 'menu' },
      ...items.map((it) => 'sep' in it ? h('div', { class: 'act-sep' }) : h('button', { class: `act-item${it.danger ? ' danger' : ''}`, role: 'menuitem', onclick: () => { close(); it.run(); } }, h('span', { class: 'act-ico' }, it.icon), it.label)));
    const btn = h('button', { class: 'act-more', title: 'Weitere Aktionen', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (/** @type {Event} */ e) => { e.stopPropagation(); menu.hidden ? open() : close(); } }, '⋯');
    const onDoc = (/** @type {Event} */ e) => { if (!menu.contains(/** @type {Node} */ (e.target))) close(); };
    const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') close(); };
    function open() {
      document.querySelectorAll('.act-menu:not([hidden])').forEach((el) => { /** @type {HTMLElement} */ (el).hidden = true; });
      menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
      // fest positioniert (Tabellenzellen schneiden sonst ab); nach oben aufklappen, wenn unten kein Platz ist
      const r = btn.getBoundingClientRect();
      const up = window.innerHeight - r.bottom < 280;
      menu.style.left = `${Math.max(8, r.right - 236)}px`;
      menu.style.top = up ? '' : `${r.bottom + 4}px`;
      menu.style.bottom = up ? `${window.innerHeight - r.top + 4}px` : '';
      setTimeout(() => { document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey); }, 0);
    }
    function close() {
      menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey);
    }
    return h('span', { class: 'act-wrap' }, btn, menu);
  }

  /** @type {HTMLAudioElement|null} */ let previewEl = null;
  function preview(m) {
    if (m.url) return void window.open(m.url, '_blank');
    if (!previewEl) { previewEl = /** @type {HTMLAudioElement} */ (h('audio', { controls: true, style: 'position:fixed;bottom:12px;right:12px;z-index:50;background:#0a1524;border-radius:8px' })); document.body.append(previewEl); }
    previewEl.src = ctx.mediaUrl(m.id);
    previewEl.play().catch(() => {});
  }

  async function editMeta(m) {
    const v = await formDialog('Metadaten bearbeiten', [
      { name: 'title', label: 'Titel', value: m.title },
      { name: 'artist', label: 'Interpret', value: m.artist },
      { name: 'album', label: 'Album', value: m.album ?? '' },
      { name: 'genre', label: 'Genre', value: m.genre ?? '' },
      { name: 'year', label: 'Jahr', type: 'number', value: m.year ?? '' },
      { name: 'key', label: 'Tonart (Track-TÜV, z. B. „A Moll“)', value: m.key ?? '', hint: m.camelot ? `Camelot ${m.camelot}` : 'leer = unbekannt; „Tonart messen“ in den Aktionen' },
      { name: 'category', label: 'Kategorie', value: m.category, options: Object.entries(CATEGORY_LABEL) },
      { name: 'folder', label: 'Ordner/Tag', value: m.folder ?? '' },
      { name: 'bpm', label: 'BPM', type: 'number', value: m.bpm ?? '' },
      { name: 'cueInMs', label: 'Cue-In (ms)', type: 'number', value: m.cueInMs ?? '' },
      { name: 'cueOutMs', label: 'Cue-Out (ms)', type: 'number', value: m.cueOutMs ?? '' },
      { name: 'loopEndMs', label: 'Loop-Ende (ms) – für Jingle/Bett/Sweeper: Rest ab hier ist Drop/Outro', type: 'number', value: m.loopEndMs ?? '' },
      { name: 'gainDb', label: 'Gain (dB)', type: 'number', value: m.gainDb ?? '' },
    ]);
    if (v) await run(() => ctx.api.patch(ctx.url(`/media/${encodeURIComponent(m.id)}`), v).then(reload));
  }

  async function lookupOnline(m) {
    status('Suche online …');
    const cands = await run(() => ctx.api.get(ctx.url(`/media/${encodeURIComponent(m.id)}/lookup`)));
    if (!cands) return;
    const label = (/** @type {any} */ c) => `${c.artist ? `${c.artist} – ` : ''}${c.title}${c.album ? ` · ${c.album}` : ''}${c.year ? ` (${c.year})` : ''}${c.genre ? ` · ${c.genre}` : ''}${c.coverUrl ? ' · 🖼 Cover' : ''} [${c.source}]`;
    const v = await formDialog('Tags & Cover online', [
      { name: 'pick', label: `Treffer für „${m.artist ? `${m.artist} – ` : ''}${m.title}“`, value: '0', options: cands.map((/** @type {any} */ c, /** @type {number} */ i) => /** @type {[string,string]} */ ([String(i), label(c)])) },
      { name: 'overwrite', label: 'Vorhandene Felder überschreiben (sonst nur leere ergänzen)', type: 'checkbox', value: false },
      { name: 'cover', label: 'Cover herunterladen', type: 'checkbox', value: true },
    ], 'Übernehmen');
    if (!v) return;
    const c = cands[Number(v.pick)];
    await run(() => ctx.api.post(ctx.url(`/media/${encodeURIComponent(m.id)}/lookup`), { ...c, overwrite: v.overwrite, cover: v.cover }));
    status('Metadaten übernommen');
    await reload();
  }

  /** Eigenes Cover-Bild hochladen (JPEG, PNG, WebP bis 5 MB). @param {any} m */
  function pickCover(m) {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' }));
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) return status('Das Bild ist größer als 5 MB', true);
      const ok = await run(() => ctx.api.req('PUT', ctx.url(`/media/${encodeURIComponent(m.id)}/cover`), f, { 'Content-Type': f.type || 'image/jpeg' }));
      if (ok) { status('Cover gespeichert'); await reload(); }
    });
    input.click();
  }

  /** Album-Cover (eingebettet oder online geholt); ohne Cover ein Platzhalter mit Note. @param {any} m */
  function coverBox(m) {
    const box = h('div', { class: 'mm-cover', title: m.album ? `Album: ${m.album}` : '' }, '♪');
    if (!m.url) {
      const img = /** @type {HTMLImageElement} */ (h('img', { alt: '', loading: 'lazy', src: ctx.api.coverUrl(ctx.stationId(), m.id) }));
      img.addEventListener('load', () => { box.replaceChildren(img); box.classList.add('has-img'); });
      img.addEventListener('error', () => { /* kein Cover – Platzhalter bleibt */ });
    }
    return box;
  }

  function row(m) {
    const format = (m.linkedPath ?? m.file ?? '').split('.').pop()?.toUpperCase() || (m.url ? 'URL' : '–');
    const tr = h('tr', {},
      h('td', {}, h('input', { type: 'checkbox', checked: selected.has(m.id), onchange: (/** @type {Event} */ e) => { if (/** @type {HTMLInputElement} */ (e.target).checked) selected.add(m.id); else selected.delete(m.id); } })),
      h('td', { class: 'mm-cover-cell' }, coverBox(m)),
      h('td', {}, m.title, m.check?.silent ? h('span', { class: 'track-warn', title: 'Datei ist still' }, ' ⚠') : null),
      h('td', {}, m.artist),
      h('td', {}, h('span', { class: 'tag cat', style: `--c:${CATEGORY_STYLE[m.category]?.color ?? '#2f8cff'}` }, CATEGORY_LABEL[m.category] ?? m.category)),
      h('td', {}, m.folder ?? ''),
      h('td', { class: 'num' }, fmt(m.durationMs)),
      h('td', { class: 'num muted' }, format),
      h('td', { class: 'num muted' }, m.lufs != null ? `${m.lufs.toFixed(1)} LUFS` : '–', m.key ? h('div', { class: 'small', title: 'Tonart (Camelot)' }, `${m.key}${m.camelot ? ` · ${m.camelot}` : ''}`) : null),
      h('td', {}, actions(m)));
    return tr;
  }

  function renderIntegrity(data) {
    if (!data) return h('div', { class: 'muted' }, 'Integritätsprüfung nicht verfügbar');
    if (!data.missing.length && !data.duplicates.length) return h('div', { class: 'muted' }, 'Keine fehlenden Dateien, keine Duplikate gefunden.');
    return h('div', {},
      data.missing.length ? h('div', {},
        h('strong', {}, `Fehlende Dateien (${data.missing.length})`),
        h('ul', { class: 'plain-list' }, ...data.missing.map((/** @type {any} */ m) => h('li', {},
          `${mediaTitle(m)} `,
          data.orphans.length
            ? h('span', {}, h('select', { 'data-relink': m.id }, ...data.orphans.map((/** @type {string} */ f) => h('option', { value: f }, f))),
                h('button', { onclick: (/** @type {Event} */ e) => relink(m.id, /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).previousElementSibling)) }, 'Verknüpfen'))
            : h('span', { class: 'muted' }, ' (keine passende Datei im Medienordner gefunden)')))))
        : null,
      data.duplicates.length ? h('div', {},
        h('strong', {}, `Mögliche Duplikate (${data.duplicates.length} Gruppen)`),
        h('ul', { class: 'plain-list' }, ...data.duplicates.map((/** @type {any[]} */ g) => h('li', {}, g.map((/** @type {any} */ m) => mediaTitle(m)).join('  ·  ')))))
        : null);
  }

  async function relink(id, select) {
    const file = /** @type {HTMLSelectElement} */ (select).value;
    if (!file) return;
    await run(() => ctx.api.post(ctx.url(`/media/${encodeURIComponent(id)}/relink`), { file }));
    status('Titel neu verknüpft');
    await refreshIntegrity();
    await reload();
  }

  const tuevBox = h('div', { class: 'panel', style: 'margin-top:12px' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Track-TÜV'),
      h('button', { class: 'btn small', title: 'Alle noch ungeprüften Titel messen (Lautheit, Stille, Übersteuerung, Tonart)', onclick: () => run(async () => { const r = await ctx.api.post(ctx.url('/media/loudness'), {}); status(r.queued ? `${r.queued} Titel eingereiht` : 'Alles schon geprüft'); }) }, 'Ungeprüfte messen'),
      h('button', { class: 'btn small', title: 'Bericht: LUFS/True Peak vorher, Gain und Werte nach Angleichung, Tonart, Hinweise', onclick: async () => { const blob = await run(() => ctx.api.blob(ctx.url('/media/tuev.csv'))); if (blob) download(blob, `track-tuev-${ctx.stationId()}.csv`); } }, '⬇ Vorher/Nachher-Bericht (CSV)')),
    h('p', { class: 'muted small', style: 'margin:0' }, 'Lautheit (EBU R128), True Peak, Stille/Cue-Punkte, Übersteuerung, Bitrate und Tonart (Krumhansl, Camelot) je Titel. Im ⋯-Menü eines Titels: Tags & Cover online suchen, Tonart messen.'));

  const integrityBox = h('div', { class: 'panel', style: 'margin-top:12px' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Integritätsprüfung'), h('button', { class: 'btn small', onclick: () => refreshIntegrity() }, 'Prüfen')),
    h('div', { id: 'mm-integrity' }, h('span', { class: 'muted' }, 'Noch nicht geprüft')));

  async function refreshIntegrity() {
    const data = await run(() => ctx.api.get(ctx.url('/media/integrity')));
    integrityBox.querySelector('#mm-integrity')?.replaceWith(h('div', { id: 'mm-integrity' }, renderIntegrity(data)));
  }

  const tbody = h('tbody', {});
  const searchInput = h('input', { type: 'search', placeholder: 'Suche: Titel, Interpret, Ordner …', value: q, oninput: (/** @type {Event} */ e) => { q = /** @type {HTMLInputElement} */ (e.target).value; refresh(); } });
  const catSel = h('select', {}, h('option', { value: '' }, 'Alle Kategorien'), ...Object.entries(CATEGORY_LABEL).map(([k, l]) => h('option', { value: k }, l)));
  catSel.addEventListener('change', () => { cat = /** @type {HTMLSelectElement} */ (catSel).value; refresh(); });
  const folderSel = h('select', {}, h('option', { value: '' }, 'Alle Ordner'));
  folderSel.addEventListener('change', () => { folder = /** @type {HTMLSelectElement} */ (folderSel).value; refresh(); });
  const sortSel = h('select', {}, h('option', { value: 'added' }, 'Neueste zuerst'), h('option', { value: 'title' }, 'Titel A–Z'), h('option', { value: 'artist' }, 'Interpret A–Z'), h('option', { value: 'duration' }, 'Länge'));
  sortSel.addEventListener('change', () => { sort = /** @type {HTMLSelectElement} */ (sortSel).value; refresh(); });

  const fileInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', multiple: true, accept: 'audio/*', hidden: true, onchange: (/** @type {Event} */ e) => { const inp = /** @type {HTMLInputElement} */ (e.target); if (inp.files?.length) ctx.upload([...inp.files]).then(reload).finally(() => (inp.value = '')); } }));
  const folderInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', multiple: true, webkitdirectory: true, hidden: true, onchange: (/** @type {Event} */ e) => { const inp = /** @type {HTMLInputElement} */ (e.target); if (inp.files?.length) ctx.upload([...inp.files]).then(reload).finally(() => (inp.value = '')); } }));

  const dropZone = h('div', { class: 'panel drop-hint', id: 'mm-drop' }, 'Dateien oder Ordner per Ziehen & Ablegen hierher, oder: ',
    h('button', { class: 'btn small', onclick: () => fileInput.click() }, 'Dateien wählen …'),
    ' ', h('button', { class: 'btn small', onclick: () => folderInput.click() }, 'Ordner importieren …'), fileInput, folderInput);
  dropZone.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dropZone.classList.add('drop'); } });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drop');
    if (e.dataTransfer?.files.length) ctx.upload([...e.dataTransfer.files]).then(reload);
  });

  const bulkBar = h('div', { class: 'row', id: 'mm-bulk' },
    h('button', { class: 'btn small', onclick: async () => {
      if (!selected.size || !confirm(`${selected.size} Titel endgültig löschen?`)) return;
      for (const id of [...selected]) await run(() => ctx.api.del(ctx.url(`/media/${encodeURIComponent(id)}`)));
      selected.clear();
      await reload();
    } }, 'Auswahl löschen'));

  function refresh() {
    const list = items
      .filter((m) => (!cat || m.category === cat) && (!folder || (m.folder ?? '') === folder) && (!q || `${m.title} ${m.artist} ${m.folder ?? ''} ${m.album ?? ''}`.toLowerCase().includes(q.toLowerCase())))
      .sort(SORTS[sort])
      .slice(0, 1000);
    tbody.replaceChildren(...list.map(row));
    $('mm-count') && ($('mm-count').textContent = `${list.length} von ${items.length} Titel${selected.size ? ` · ${selected.size} ausgewählt` : ''}`);
  }

  // ---------- Quellen-Reiter: AnMaCha Cast-Bibliothek / Nextcloud (Abschnitt 10, nebeneinander statt isoliert) ----------

  let source = 'library';
  const nextcloudPane = h('div', { hidden: true });
  const musicHubPane = h('div', { hidden: true });
  let nextcloudView = null;
  let musicHubView = null;

  const libraryPane = h('div', {},
    dropZone,
    h('div', { class: 'row', style: 'margin:8px 0' }, searchInput, catSel, folderSel, sortSel),
    bulkBar,
    h('div', { class: 'table-wrap', id: 'mm-drop-table' },
      h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', {}), h('th', {}), h('th', {}, 'Titel'), h('th', {}, 'Interpret'), h('th', {}, 'Kategorie'), h('th', {}, 'Ordner'), h('th', {}, 'Länge'), h('th', {}, 'Format'), h('th', {}, 'Lautheit'), h('th', {}, 'Aktionen'))),
        tbody)),
    tuevBox,
    integrityBox);

  function tabBtn(id, label) {
    return h('button', { class: `btn small${source === id ? ' primary' : ''}`, onclick: () => selectSource(id) }, label);
  }
  const tabBar = h('div', { class: 'row' });
  function renderTabs() {
    tabBar.replaceChildren(tabBtn('library', 'AnMaCha Cast-Bibliothek'), tabBtn('musikhub', 'MusikHub'), tabBtn('nextcloud', 'Nextcloud'));
  }

  async function selectSource(id) {
    source = id;
    renderTabs();
    libraryPane.hidden = id !== 'library';
    musicHubPane.hidden = id !== 'musikhub';
    nextcloudPane.hidden = id !== 'nextcloud';
    if (id === 'musikhub') {
      if (!musicHubView) musicHubView = mountMusicHub(musicHubPane, ctx);
      await musicHubView.show();
    }
    if (id === 'nextcloud') {
      if (!nextcloudView) nextcloudView = mountNextcloud(nextcloudPane, ctx);
      await nextcloudView.show();
    }
  }

  async function show() {
    const folders = await ctx.folders();
    const cur = /** @type {HTMLSelectElement} */ (folderSel).value;
    folderSel.replaceChildren(h('option', { value: '' }, 'Alle Ordner'), ...folders.map((f) => h('option', { value: f, selected: f === cur }, f)));
    renderTabs();
    root.replaceChildren(
      h('div', { class: 'media-hero' },
        h('div', {},
          h('span', { class: 'ov-kicker' }, 'MEDIEN'),
          h('h1', {}, 'Musikarchiv'),
          h('p', {}, 'Titel, Jingles, Station-IDs und Cloud-Quellen zentral verwalten.')),
        h('div', { class: 'media-hero-actions' },
          h('span', { class: 'media-count', id: 'mm-count' }, ''))),
      h('section', { class: 'panel media-workspace' },
        h('div', { class: 'panel-head' }, h('h2', {}, 'Bibliothek & Quellen')),
        tabBar,
        libraryPane,
        musicHubPane,
        nextcloudPane));
    libraryPane.hidden = source !== 'library';
    musicHubPane.hidden = source !== 'musikhub';
    nextcloudPane.hidden = source !== 'nextcloud';
    items = ctx.library();
    refresh();
    void refreshIntegrity();
    if (source === 'nextcloud' && nextcloudView) await nextcloudView.show();
    if (source === 'musikhub' && musicHubView) await musicHubView.show();
  }

  return { show, onEvent: (/** @type {string} */ kind) => { if (kind === 'library.changed') void reload(); } };
}

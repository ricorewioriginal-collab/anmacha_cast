// @ts-check
// laut.fm Radioadmin in AnMaCha Cast: Playlists, Titel, Sendeplan, Statistik, Benutzer, Station, Live.
// Alle Aufrufe laufen über den lokalen AnMaCha Cast-Server (Token bleibt verschlüsselt dort), nur dokumentierte
// Endpunkte der Radioadmin-API. Kein eigener PHP-Server nötig.

import { DAYS, clockTime, fmt, formDialog, h, icon, run, status } from './ui.js';
import { ALGO_TEMPLATES } from './lautfm-algos.js';
import { LAUTFM_PENDING } from './api.js';

const TABS = /** @type {const} */ ([
  ['overview', 'Übersicht'], ['playlists', 'Playlists'], ['tracks', 'Titel'], ['algos', 'Algorithmen'], ['schedule', 'Sendeplan'],
  ['stats', 'Statistik'], ['ads', 'Werbe-Log'], ['users', 'Benutzer'], ['station', 'Station'], ['live', 'Live'],
]);
const ROLES = /** @type {Array<[string,string]>} */ ([['owner', 'Inhaber'], ['editor', 'Editor'], ['dj', 'DJ']]);

/** @typedef {{ api: import('./api.js').Api, url: (p: string) => string, onLautfmConnected?: () => void }} Ctx */

/**
 * Weitere Seite vorhanden? Die Radioadmin-API meldet das je Endpunkt verschieden (Spezifikation 1.0.1):
 * Titelsuche mit `_paging.next_page`, Playlist-Titel (PagingInfo) mit `_paging.total_pages/current_page`, dazu ggf. `_links.next`.
 * @param {any} j @param {number} page
 */
export function hasNextPage(j, page) {
  const p = j && typeof j === 'object' && j._paging && typeof j._paging === 'object' ? j._paging : {};
  if (p.next_page) return true;
  if (p.total_pages !== undefined) return Number(p.current_page ?? page) < Number(p.total_pages);
  return !!j?._links?.next?.href;
}

/**
 * Alle Seiten einer Titel-Liste lesen (höchstens 60). Bricht ab, wenn eine Seite keine neuen Titel bringt –
 * dann ignoriert laut.fm „page“ und es würde endlos weitergeblättert. Doppelte IDs werden zusammengefasst.
 * @param {(page: number) => Promise<any>} get @returns {Promise<any[]>}
 */
export async function collectTrackPages(get) {
  /** @type {Map<number, any>} */ const seen = new Map();
  for (let page = 1; page <= 60; page++) {
    const j = await get(page);
    const before = seen.size;
    for (const t of j?.tracks ?? []) if (t && t.id !== undefined && !seen.has(t.id)) seen.set(t.id, t);
    if (!hasNextPage(j, page) || seen.size === before) break;
  }
  return [...seen.values()];
}

/**
 * Sendeplan-Einträge aus einem Stundenraster (Slot = Tag·24 + Stunde, Montag 0 Uhr = 0): zusammenhängende Stunden
 * gleicher Playlist werden ein Eintrag; die Basis-Playlist darf laut laut.fm nicht in `entries` stehen.
 * @param {Record<number, number>} grid @param {number|undefined} baseId
 */
export function scheduleEntries(grid, baseId) {
  /** @type {Array<{playlist_id:number, slot:number, duration:number}>} */ const entries = [];
  for (let i = 0; i < 168; i++) {
    const id = grid[i];
    if (id === undefined || id === baseId) continue;
    const last = entries[entries.length - 1];
    if (last && last.playlist_id === id && last.slot + last.duration === i) last.duration++;
    else entries.push({ playlist_id: id, slot: i, duration: 1 });
  }
  return entries;
}

/**
 * Wartet auf den Abschluss der laut.fm-Verarbeitung eines gerade hochgeladenen Titels (Referenz:
 * automation.html waitForNewTrack()). Exponentielles Backoff (800 ms Start, ×1,4 je Versuch, Deckel
 * 4000 ms), max. 90 s Gesamtwartezeit. Ab dem zweiten Versuch zusätzlich gegen `;queued`/`;incomplete`
 * geprüft: ist die negative Upload-ID dort nicht mehr gelistet, gilt die Verarbeitung als abgeschlossen,
 * auch wenn die neueste eigene Track-ID aus irgendeinem Grund noch nicht aktualisiert wirkt.
 * Reine Logik, unabhängig von DOM/Netzwerk - `deps` kapselt die beiden einzigen Seiteneffekte (API-Abruf,
 * Verzögerung), damit dies ohne echte Zeit/Netzwerk testbar ist.
 * @param {number} snapshotId @param {number} negId
 * @param {{ ownDesc: () => Promise<{tracks?: {id: number}[]}|null>, queuedIncomplete: () => Promise<[{tracks?: {id:number}[]}|null, {tracks?: {id:number}[]}|null]>, onWaiting?: () => void, sleep?: (ms: number) => Promise<void>, maxWaitMs?: number, now?: () => number }} deps
 * @returns {Promise<number|null>}
 */
export async function waitForNewTrackLogic(snapshotId, negId, deps) {
  const { ownDesc, queuedIncomplete, onWaiting, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxWaitMs = 90000, now = () => Date.now() } = deps;
  const start = now();
  let delay = 800;
  let attempts = 0;
  while (now() - start < maxWaitMs) {
    attempts++;
    onWaiting?.();
    const r = await ownDesc();
    const top = r?.tracks?.[0];
    if (top && typeof top.id === 'number' && top.id > snapshotId) return top.id;
    if (attempts >= 2) {
      const [q, inc] = await queuedIncomplete();
      const stillPending = [...(q?.tracks ?? []), ...(inc?.tracks ?? [])].some((x) => x.id === negId);
      if (!stillPending) {
        const again = await ownDesc();
        const top2 = again?.tracks?.[0];
        if (top2 && typeof top2.id === 'number' && top2.id > snapshotId) return top2.id;
      }
    }
    await sleep(delay);
    delay = Math.min(4000, Math.round(delay * 1.4));
  }
  return null;
}

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountLautfm(root, ctx) {
  let tab = 'overview';
  /** @type {any} */ let cfg = null;
  /** @type {any[]} */ let playlists = [];
  /** @type {HTMLAudioElement|null} */ let pre = null;

  /** Radioadmin-Aufruf über den AnMaCha Cast-Proxy; bei Ablehnung einmal die Verbindung prüfen (Origin neu ermitteln) und wiederholen. @param {string} method @param {string} path @param {any} [body] */
  const ra = async (method, path, body) => {
    try {
      return await ctx.api.req(method, ctx.url(`/lautfm/ra${path}`), body);
    } catch (e) {
      const code = /** @type {any} */ (e)?.status;
      if (code !== 401 && code !== 403) throw e;
      const c = await ctx.api.post(ctx.url('/lautfm/check')).catch(() => null);
      if (!c?.ok) throw new Error('laut.fm hat den Zugriff abgelehnt – bitte unter „Verbindung …“ neu verbinden');
      return ctx.api.req(method, ctx.url(`/lautfm/ra${path}`), body);
    }
  };
  const st = () => `/stations/${cfg.stationId}`;
  /** @param {string} title @param {...(Node|string|null|false)} body */
  const card = (title, ...body) => h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, title)), ...body);
  /** @param {string} k @param {any} v */
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v === null || v === undefined || v === '' ? '–' : String(v)));
  const content = h('div', { class: 'lf-content' });

  async function show() {
    cfg = await ctx.api.get(ctx.url('/lautfm'));
    let pending = null;
    try {
      pending = sessionStorage.getItem(LAUTFM_PENDING);
      sessionStorage.removeItem(LAUTFM_PENDING);
    } catch {}
    if (pending) return connect({ token: pending });
    render();
  }

  /** Bei laut.fm anmelden: laut.fm schickt uns mit dem Token im Adress-Anker zurück (siehe api.js). */
  function login() {
    const back = location.origin + location.pathname + location.search;
    location.assign(`https://radioadmin.laut.fm/login?callback_url=${encodeURIComponent(back)}`);
  }

  /** Token prüfen (Origin ermittelt der Server selbst), dann ggf. Station wählen. @param {{ token?: string, origin?: string }} input */
  async function connect(input) {
    const r = await run(() => ctx.api.post(ctx.url('/lautfm/connect'), { ...input, pageOrigin: location.origin }));
    if (!r) return render();
    cfg = r;
    /** @type {any[]} */ const list = r.stations ?? [];
    if (!list.length) status('Token gültig, aber diesem laut.fm-Konto ist keine Station zugeordnet', true);
    else if (!r.stationId || (list.length > 1 && input.token)) {
      const pick = await formDialog('Station wählen', [
        { name: 'stationId', label: 'Station', value: String(r.stationId ?? list[0].id), options: list.map((s) => /** @type {[string,string]} */ ([String(s.id), `${s.displayName || s.name} (${s.role})`])) },
      ], 'Übernehmen');
      if (pick) {
        const chosen = list.find((s) => String(s.id) === pick.stationId);
        cfg = (await run(() => ctx.api.put(ctx.url('/lautfm'), { stationId: Number(pick.stationId), stationName: chosen?.name ?? '' }))) ?? cfg;
      }
    }
    if (cfg?.hasToken && cfg?.stationId) { status(`Mit laut.fm verbunden: ${cfg.stationName ?? cfg.stationId}`); ctx.onLautfmConnected?.(); }
    render();
  }

  function render() {
    const connected = cfg?.hasToken && cfg?.stationId;
    const head = h('div', { class: 'lf-head' },
      h('div', { class: 'lf-title' }, h('strong', {}, 'lautCast'), h('span', { class: 'muted' }, connected ? ` · Station ${cfg.stationName ?? cfg.stationId}` : ' · nicht verbunden')),
      h('div', { class: 'tabs' }, ...TABS.map(([id, label]) => h('button', { 'aria-pressed': String(tab === id), disabled: !connected, onclick: () => { tab = id; renderTab(); } }, label))),
      h('button', { class: 'btn small', onclick: configure }, connected ? 'Verbindung …' : 'Verbinden …'));
    root.replaceChildren(head, content);
    if (connected) renderTab();
    else content.replaceChildren(card('Mit laut.fm verbinden',
      h('p', {}, 'AnMaCha Cast verwaltet deine laut.fm-Station direkt über die offizielle Radioadmin-API.'),
      h('ol', {},
        h('li', {}, h('b', {}, 'Mit laut.fm anmelden: '), 'Du meldest dich bei laut.fm an und kommst automatisch hierher zurück.'),
        h('li', {}, h('b', {}, 'Oder Token einfügen: '), 'ein vorhandenes Token (z. B. von radioadmin.laut.fm/tokens) einfügen. Welcher Origin dazu gehört, findet AnMaCha Cast selbst heraus.')),
      h('p', { class: 'muted' }, 'Das Token wird verschlüsselt auf diesem Gerät gespeichert und nie an den Browser zurückgegeben.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: login }, 'Mit laut.fm anmelden'),
        h('button', { class: 'btn', onclick: configure }, 'Token einfügen …'),
        h('button', { class: 'btn ghost', onclick: () => window.open(cfg?.loginUrl ?? 'https://radioadmin.laut.fm/login?callback_url=airdeck', '_blank', 'noopener') }, 'Skript-Token erzeugen'))));
  }

  async function configure() {
    const v = await formDialog('laut.fm-Verbindung', [
      { name: 'token', label: cfg?.hasToken ? 'Radioadmin-Token (leer = gespeichertes prüfen)' : 'Radioadmin-Token', type: 'password', value: '', hint: 'Übersicht deiner Tokens: radioadmin.laut.fm/tokens' },
      { name: 'origin', label: 'Origin (optional)', value: cfg?.origin && cfg.origin !== 'airdeck' ? cfg.origin : '', hint: 'Leer lassen = automatisch. Nur nötig bei einem Token mit eigenem Namen aus „callback_url=…“.' },
      ...(cfg?.hasToken ? [{ name: 'remove', label: 'Verbindung trennen (Token löschen)', type: 'checkbox', value: false }] : []),
    ], 'Verbinden');
    if (!v) return;
    if (v.remove) {
      cfg = await run(() => ctx.api.put(ctx.url('/lautfm'), { token: '', stationId: null }));
      ctx.onLautfmConnected?.();
      return render();
    }
    if (!v.token && !cfg?.hasToken) return status('Bitte ein Token einfügen', true);
    await connect({ ...(v.token ? { token: v.token } : {}), ...(v.origin ? { origin: v.origin } : {}) });
  }

  function renderTab() {
    root.querySelectorAll('.lf-head .tabs button').forEach((b, i) => b.setAttribute('aria-pressed', String(TABS[i][0] === tab)));
    content.replaceChildren(h('div', { class: 'empty' }, 'Lade …'));
    const fn = { overview, playlists: playlistsTab, tracks, algos, schedule, stats, ads, users, station, live }[tab];
    run(async () => content.replaceChildren(...(await fn())));
  }

  async function loadPlaylists() {
    const r = await ra('GET', `${st()}/playlists`);
    playlists = r?.playlists ?? [];
    return playlists;
  }

  // ---------- Übersicht ----------
  async function overview() {
    const pub = (/** @type {string} */ path) => (cfg.stationName ? ctx.api.get(`/lautfm/public/station/${cfg.stationName}${path}`).catch(() => null) : null);
    const [apiState, last, nextArtists] = await Promise.all([ra('GET', '/server_status').catch(() => null), pub('/last_songs'), pub('/next_artists')]);
    const [info, state, statsNow, current, song] = await Promise.all([
      ra('GET', st()), ra('GET', `${st()}/state`).catch(() => null), ra('GET', `${st()}/stats`).catch(() => null),
      ra('GET', `${st()}/current_playlist`).catch(() => null),
      cfg.stationName ? ctx.api.get(`/lautfm/public/station/${cfg.stationName}/current_song`).catch(() => null) : null,
    ]);
    return [h('div', { class: 'view-grid' },
      card('Station', kv('Name', info.name), kv('Beschreibung', info.description), kv('Format', info.format), kv('DJs', info.djs), kv('Genres', (info.genres ?? []).join(', ')),
        kv('Streaming-Server', state?.active ? 'aktiv ✔' : 'inaktiv'),
        !state?.active ? h('button', { class: 'btn primary', onclick: () => run(async () => { await ra('POST', `${st()}/state`); status('Station aktiviert'); renderTab(); }) }, 'Station aktivieren') : null),
      card('Jetzt', kv('Titel', song ? `${song.artist?.name ?? ''} – ${song.title ?? ''}` : null), kv('Hörer jetzt', statsNow?.listeners_now), kv('Position', statsNow?.position_now),
        kv('Playlist', current?.playlist_info?.title), kv('Grund', current?.playlist_info?.reason)),
      card('laut.fm-Dienste',
        kv('Radioadmin-API', apiState ? (apiState.running ? 'läuft ✔' : `gestört: ${apiState.message ?? ''}`) : 'nicht erreichbar'),
        kv('Nächste Interpreten', Array.isArray(nextArtists) ? nextArtists.map((/** @type {any} */ a) => a.name ?? a).slice(0, 6).join(', ') : null),
        ...(Array.isArray(last) ? last.slice(0, 6).map((/** @type {any} */ t) => kv(t.started_at ? clockTime(new Date(t.started_at).getTime()) : '', `${t.artist?.name ?? ''} – ${t.title ?? ''}`)) : [])),
      card('Nächste Titel', ...(current?.tracks ?? []).slice(0, 12).map((/** @type {any} */ t) => h('div', { class: 'kv' }, h('span', {}, `${t.artist ?? ''} – ${t.title ?? ''}`), h('span', { class: 'muted num' }, fmt((t.length ?? t.duration ?? 0) * 1000)))))),
    ];
  }

  // ---------- Playlists ----------
  async function playlistsTab() {
    await loadPlaylists();
    const detail = h('div', {});
    const list = h('div', { class: 'lf-pl' }, ...playlists.map((p) => h('button', { class: 'lf-pl-item', onclick: () => run(async () => detail.replaceChildren(...(await plDetail(p)))) },
      h('span', { class: 'pl-dot', style: `background:${/^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#666'}` }), h('span', {}, p.title), h('span', { class: 'muted num' }, `${p.size ?? 0} · ${fmt((p.duration ?? 0) * 1000)}`))));
    return [h('div', { class: 'lf-split' },
      card('Playlists', h('button', { class: 'btn small primary', onclick: newPlaylist }, '＋ Neue Playlist'), list), detail)];
  }

  async function newPlaylist() {
    const v = await formDialog('Neue laut.fm-Playlist', [
      { name: 'title', label: 'Name', required: true },
      { name: 'color', label: 'Farbe', type: 'color', value: '#19c3e6' },
      { name: 'description', label: 'Beschreibung' },
      { name: 'shuffled', label: 'Gemischt abspielen', type: 'checkbox', value: true },
    ]);
    if (v) await run(async () => { await ra('POST', `${st()}/playlists`, v); status('Playlist angelegt'); renderTab(); });
  }

  /** @param {any} p */
  async function plDetail(p) {
    // alle Seiten – bei großen Playlists lieferte die erste Seite nur einen Teil der Titel
    const tracks = await collectTrackPages((page) => ra('GET', `${st()}/playlists/${p.id}/tracks?page=${page}`));
    return [card(`Playlist: ${p.title}`,
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn small', onclick: () => editPlaylist(p) }, 'Bearbeiten'),
        h('button', { class: 'btn small', onclick: () => addTrackById(p) }, '＋ Titel-ID'),
        h('button', { class: 'btn small danger', onclick: () => confirm(`Playlist „${p.title}“ bei laut.fm löschen?`) && run(async () => { await ra('DELETE', `${st()}/playlists/${p.id}`); renderTab(); }) }, 'Löschen')),
      trackTable(tracks, (t) => h('button', { title: 'Aus Playlist entfernen', onclick: () => run(async () => { await ra('DELETE', `${st()}/playlists/${p.id}/entries/${t.id}`); status('Entfernt'); renderTab(); }) }, '✕'), () => renderTab()))];
  }

  /** @param {any} p */
  async function editPlaylist(p) {
    const v = await formDialog('Playlist bearbeiten', [
      { name: 'title', label: 'Name', value: p.title, required: true },
      { name: 'color', label: 'Farbe', type: 'color', value: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#19c3e6' },
      { name: 'description', label: 'Beschreibung', value: p.description ?? '' },
      { name: 'shuffled', label: 'Gemischt abspielen', type: 'checkbox', value: !!p.shuffled },
      { name: 'algo', label: 'Automations-Algorithmus (beim Mischen)', value: p.automation_algorithm_name ?? '', options: [['', '– Standard von laut.fm –'], ...(await installedAlgos()).map((n) => /** @type {[string,string]} */ ([n, ALGO_TEMPLATES.find((t) => t.name === n)?.label ?? n]))], hint: 'Neue Algorithmen unter „Algorithmen“ speichern' },
    ]);
    if (!v) return;
    const { algo, ...rest } = v;
    await run(async () => { await ra('PATCH', `${st()}/playlists/${p.id}`, { ...rest, automation_algorithm_name: algo || null }); status('Playlist gespeichert'); renderTab(); });
  }

  /** @param {any} p */
  async function addTrackById(p) {
    const v = await formDialog('Titel hinzufügen', [{ name: 'track_id', label: 'Titel-ID (aus „Titel“-Suche)', type: 'number', required: true }], 'Hinzufügen');
    if (v?.track_id) await run(async () => { await ra('POST', `${st()}/playlists/${p.id}`, { track_id: v.track_id }); status('Hinzugefügt'); renderTab(); });
  }

  /** @param {any[]} tracks @param {(t: any) => HTMLElement} [action] @param {() => void} [onChanged] Nach Bearbeiten/Löschen aufgerufen, um die Ansicht neu zu laden. */
  function trackTable(tracks, action, onChanged) {
    if (!tracks.length) return h('div', { class: 'empty' }, 'Keine Titel.');
    return h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, h('th', {}, 'ID'), h('th', {}, 'Interpret'), h('th', {}, 'Titel'), h('th', {}, 'Genre'), h('th', { class: 'num' }, 'Dauer'), h('th', {}, 'Tags'), h('th', {}))),
      h('tbody', {}, ...tracks.map((t) => (t._tagCell = h('td', {}, ...(t.tags ?? []).map((/** @type {string} */ g) => h('span', { class: 'tag' }, g)))) && h('tr', {},
        h('td', { class: 'num muted' }, String(t.id)), h('td', {}, typeof t.artist === 'object' ? t.artist?.name ?? '' : t.artist ?? ''), h('td', {}, t.title ?? ''),
        h('td', {}, t.genre ?? ''), h('td', { class: 'num' }, fmt((t.duration ?? t.length ?? 0) * 1000)),
        t._tagCell,
        h('td', { class: 'act' },
          h('button', { title: 'Vorhören', onclick: () => prelisten(t) }, '▶'),
          h('button', { title: 'Tags bearbeiten', onclick: () => editTags(t) }, '#'),
          h('button', { title: 'Titel bearbeiten', onclick: () => editTrack(t, onChanged) }, '✎'),
          h('button', { title: 'Titel bei laut.fm löschen', onclick: () => deleteTrack(t, onChanged) }, '🗑'),
          action ? action(t) : null))))));
  }

  /**
   * Künstler/Titel/Genre/Jahr/Privat/Typ eines bestehenden Titels bearbeiten (Referenz: automation.html
   * Tracks-Tab → Bearbeiten-Dialog). `type` (song/jingle) entscheidet über mehrere Algorithmus-Vorlagen
   * (z. B. Song-Song-Song-Jingle-Muster), `private` blendet den Titel aus der öffentlichen
   * laut.fm-Songdatenbank aus, ohne das Abspielen durch den eigenen Sender einzuschränken.
   * @param {any} t @param {() => void} [onChanged]
   */
  async function editTrack(t, onChanged) {
    const v = await formDialog(`Titel bearbeiten: ${t.title ?? t.id}`, [
      { name: 'artist', label: 'Interpret', value: typeof t.artist === 'object' ? t.artist?.name ?? '' : t.artist ?? '' },
      { name: 'title', label: 'Titel', value: t.title ?? '' },
      { name: 'genre', label: 'Genre', value: t.genre ?? '' },
      { name: 'release_year', label: 'Jahr', type: 'number', value: t.release_year ?? '' },
      { name: 'type', label: 'Typ', options: [['song', 'Song'], ['jingle', 'Jingle']], value: t.type ?? 'song' },
      { name: 'private', label: 'Privat (nicht in der öffentlichen laut.fm-Songdatenbank)', type: 'checkbox', value: !!t.private },
    ]);
    if (!v) return;
    await run(async () => {
      await ra('PATCH', `${st()}/tracks/${t.id}`, {
        artist: v.artist, title: v.title, genre: v.genre,
        release_year: v.release_year ? Number(v.release_year) : null,
        type: v.type, private: !!v.private,
      });
      status('Titel aktualisiert');
      onChanged?.();
    });
  }

  /** @param {any} t @param {() => void} [onChanged] */
  async function deleteTrack(t, onChanged) {
    if (!confirm(`„${t.title ?? t.id}“ bei laut.fm endgültig löschen?`)) return;
    await run(async () => { await ra('DELETE', `${st()}/tracks/${t.id}`); status('Titel gelöscht'); onChanged?.(); });
  }

  /** Tags eines Titels (Radioadmin: GET/POST/DELETE …/tracks/{id}/tags). @param {any} t */
  async function editTags(t) {
    const [cur, all] = await Promise.all([ra('GET', `${st()}/tracks/${t.id}/tags`).catch(() => t.tags ?? []), ra('GET', `${st()}/tracks/tags`).catch(() => [])]);
    const before = /** @type {string[]} */ (Array.isArray(cur) ? cur : []);
    const v = await formDialog(`Tags: ${t.title ?? t.id}`, [
      { name: 'tags', label: 'Tags (mit Komma getrennt)', value: before.join(', '), hint: Array.isArray(all) && all.length ? `Vorhanden: ${all.slice(0, 40).join(', ')}` : 'z. B. recent, chill, hit, A-Rotation' },
    ]);
    if (!v) return;
    const after = [...new Set(String(v.tags).split(',').map((x) => x.trim()).filter(Boolean))];
    const add = after.filter((x) => !before.includes(x));
    const del = before.filter((x) => !after.includes(x));
    await run(async () => {
      if (add.length) await ra('POST', `${st()}/tracks/${t.id}/tags`, { tags: add });
      if (del.length) await ra('DELETE', `${st()}/tracks/${t.id}/tags`, { tags: del });
      t.tags = after;
      t._tagCell?.replaceChildren(...after.map((g) => h('span', { class: 'tag' }, g)));
      status(`Tags gespeichert (${add.length} neu, ${del.length} entfernt)`);
    });
  }

  /** Namen der bei laut.fm gespeicherten Algorithmen (aus Playlists und Vorlagen, per GET geprüft). */
  async function installedAlgos() {
    if (!playlists.length) await loadPlaylists().catch(() => {});
    const names = [...new Set([...playlists.map((p) => p.automation_algorithm_name).filter(Boolean), ...ALGO_TEMPLATES.map((t) => t.name)])];
    const found = await Promise.all(names.map((n) => ra('GET', `/automation_algorithms/${encodeURIComponent(n)}`).then(() => n).catch(() => null)));
    return /** @type {string[]} */ (found.filter(Boolean));
  }

  // ---------- Algorithmen ----------
  async function algos() {
    await loadPlaylists();
    const installed = new Set(await installedAlgos());
    const custom = [...installed].filter((n) => !ALGO_TEMPLATES.some((t) => t.name === n));
    const usedBy = (/** @type {string} */ n) => playlists.filter((p) => p.automation_algorithm_name === n).map((p) => p.title).join(', ');
    return [
      card('Automations-Algorithmen',
        h('p', { class: 'muted' }, 'laut.fm führt den Algorithmus aus, wenn eine Playlist gemischt wird (function(tracks) → tracks). Speichern legt ihn bei laut.fm an; zuweisen hier oder unter „Playlists → Bearbeiten“.'),
        h('div', { class: 'algo-grid' },
          ...ALGO_TEMPLATES.map((t) => h('div', { class: `algo${installed.has(t.name) ? ' on' : ''}` },
            h('div', { class: 'algo-head' }, h('span', {}, t.icon), h('strong', {}, t.label), installed.has(t.name) ? h('span', { class: 'pill live' }, 'gespeichert') : null),
            h('p', { class: 'muted' }, t.desc),
            installed.has(t.name) && usedBy(t.name) ? h('div', { class: 'small' }, `Genutzt von: ${usedBy(t.name)}`) : null,
            h('div', { class: 'row-btns' },
              h('button', { class: 'btn small primary', onclick: () => editAlgo(t.name, t.body.trim(), installed.has(t.name)) }, installed.has(t.name) ? 'Bearbeiten' : 'Ansehen & speichern'),
              installed.has(t.name) ? h('button', { class: 'btn small', onclick: () => assignAlgo(t.name) }, 'Zuweisen') : null,
              installed.has(t.name) ? h('button', { class: 'btn small danger', onclick: () => deleteAlgo(t.name) }, 'Löschen') : null))),
          ...custom.map((n) => h('div', { class: 'algo on' },
            h('div', { class: 'algo-head' }, h('strong', {}, n), h('span', { class: 'pill live' }, 'eigener')),
            usedBy(n) ? h('div', { class: 'small' }, `Genutzt von: ${usedBy(n)}`) : null,
            h('div', { class: 'row-btns' },
              h('button', { class: 'btn small primary', onclick: async () => { const a = await run(() => ra('GET', `/automation_algorithms/${encodeURIComponent(n)}`)); if (a) editAlgo(n, a.body ?? '', true); } }, 'Bearbeiten'),
              h('button', { class: 'btn small', onclick: () => assignAlgo(n) }, 'Zuweisen'),
              h('button', { class: 'btn small danger', onclick: () => deleteAlgo(n) }, 'Löschen'))))),
        h('button', { class: 'btn', onclick: () => editAlgo('', '(function(tracks) {\n  return tracks;\n})', false) }, '＋ Eigener Algorithmus')),
    ];
  }

  /** @param {string} name @param {string} body @param {boolean} exists */
  async function editAlgo(name, body, exists) {
    const v = await formDialog(exists ? `Algorithmus: ${name}` : 'Algorithmus speichern', [
      { name: 'name', label: 'Name (a–z, 0–9, _)', value: name, required: true },
      { name: 'body', label: 'Funktion', type: 'textarea', value: body, hint: 'Eine Funktion, die die Titelliste nimmt und sortiert zurückgibt' },
    ], 'Bei laut.fm speichern');
    if (!v) return;
    const n = String(v.name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    // Grobe Strukturprüfung (Code wird hier bewusst nicht ausgeführt – laut.fm prüft beim Speichern selbst)
    const code = String(v.body).trim();
    const depth = [...code.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '')].reduce((d, c) => (d < 0 ? d : d + (c === '{' || c === '(' ? 1 : c === '}' || c === ')' ? -1 : 0)), 0);
    if (!/^\(?\s*function\s*\(/.test(code) || depth !== 0) return status('Algorithmus muss eine Funktion sein: (function(tracks) { … return tracks; }) – Klammern prüfen', true);
    await run(async () => {
      await ra(exists && n === name ? 'PATCH' : 'PUT', `/automation_algorithms/${encodeURIComponent(n)}`, { body: v.body.trim() });
      status(`Algorithmus „${n}“ gespeichert`);
      renderTab();
    });
  }

  /** @param {string} name */
  async function assignAlgo(name) {
    const v = await formDialog(`„${name}“ zuweisen`, playlists.map((p) => ({ name: `p${p.id}`, label: p.title, type: 'checkbox', value: p.automation_algorithm_name === name })), 'Übernehmen');
    if (!v) return;
    await run(async () => {
      for (const p of playlists) {
        const want = !!v[`p${p.id}`];
        const has = p.automation_algorithm_name === name;
        if (want !== has) await ra('PATCH', `${st()}/playlists/${p.id}`, { automation_algorithm_name: want ? name : null });
      }
      status('Zuweisung gespeichert');
      renderTab();
    });
  }

  /** @param {string} name */
  async function deleteAlgo(name) {
    const used = playlists.filter((p) => p.automation_algorithm_name === name);
    if (!confirm(`Algorithmus „${name}“ bei laut.fm löschen?${used.length ? `\nWird genutzt von: ${used.map((p) => p.title).join(', ')} – dort wird er vorher entfernt.` : ''}`)) return;
    await run(async () => {
      for (const p of used) await ra('PATCH', `${st()}/playlists/${p.id}`, { automation_algorithm_name: null });
      await ra('DELETE', `/automation_algorithms/${encodeURIComponent(name)}`);
      status('Algorithmus gelöscht');
      renderTab();
    });
  }

  // ---------- Werbe-Log (Anregung von laut.fm: Werbe-Trigger aus den Track-Statistiken) ----------
  async function ads() {
    const day = /** @type {HTMLInputElement} */ (h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) }));
    const out = h('div', {});
    const load = () => run(async () => {
      const today = day.value === new Date().toISOString().slice(0, 10);
      const list = /** @type {any[]} */ (await ra('GET', `${st()}/tracks/stats/${today ? '24h' : day.value}`)) ?? [];
      const isAd = (/** @type {any} */ t) => /^(ad|ads|advert|advertisement|commercial|werbung)$/i.test(String(t.type ?? ''));
      const hits = list.filter(isAd);
      const types = [...new Set(list.map((t) => t.type).filter(Boolean))];
      // Element.replaceChildren() wandelt ein direkt übergebenes null (anders als der h()-Helfer)
      // in einen sichtbaren Textknoten "null" um - darum hier filtern (echter Fund: stand ohne
      // Werbe-Trigger am Tag als sichtbares "null" unter der Tabelle bzw. dem Leer-Hinweis).
      out.replaceChildren(...[
        kv('Werbe-Trigger', hits.length),
        kv('Hörer bei Werbung (Summe)', hits.reduce((a, t) => a + (t.listeners ?? 0), 0)),
        kv('Gefundene Typen', types.join(', ') || '– (laut.fm liefert keinen Typ)'),
        hits.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Start'), h('th', {}, 'Ende'), h('th', {}, 'Spot'), h('th', { class: 'num' }, 'Hörer'), h('th', {}, ''))),
          h('tbody', {}, ...hits.map((t) => h('tr', {},
            h('td', { class: 'num' }, t.started_at ? clockTime(new Date(t.started_at).getTime()) : ''),
            h('td', { class: 'num' }, t.ends_at ? clockTime(new Date(t.ends_at).getTime()) : ''),
            h('td', {}, `${t.artist?.name ?? t.artist ?? ''} – ${t.title ?? ''}`),
            h('td', { class: 'num' }, String(t.listeners ?? '')),
            h('td', {}, t.live ? h('span', { class: 'pill failed' }, 'live') : '')))))) : h('div', { class: 'empty' }, 'Keine Werbe-Trigger an diesem Tag.'),
        hits.length ? h('button', { class: 'btn small', onclick: () => {
          const csv = ['Start;Ende;Spot;Hörer;Live', ...hits.map((t) => [t.started_at, t.ends_at, `${t.artist?.name ?? ''} - ${t.title ?? ''}`.replace(/;/g, ','), t.listeners ?? '', t.live ? 'ja' : 'nein'].join(';'))].join('\n');
          h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `werbe-log-${day.value}.csv` }).click();
        } }, 'Als CSV') : null,
      ].filter((n) => n != null));
    });
    day.addEventListener('change', load);
    load();
    return [card('Werbe-Trigger-Log', h('p', { class: 'muted' }, 'Aus den laut.fm-Track-Statistiken (inkl. Live-Sendungen), gefiltert nach Typ „Werbung“ – Nachweis für Werbekunden.'), h('div', { class: 'row-btns' }, day), out)];
  }

  /** @param {any} t */
  async function prelisten(t) {
    pre?.pause();
    const blob = await run(() => ctx.api.blob(ctx.url(`/lautfm/ra${st()}/tracks/${t.id}/prelisten`)));
    if (!blob) return;
    pre = new Audio(URL.createObjectURL(blob));
    pre.play().catch(() => {});
  }

  // ---------- Titel ----------
  async function tracks() {
    await loadPlaylists();
    const results = h('div', {});
    const form = h('form', { class: 'lf-search', onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); search(); } },
      h('input', { name: 'artist', placeholder: 'Interpret' }), h('input', { name: 'title', placeholder: 'Titel' }), h('input', { name: 'genre', placeholder: 'Genre' }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', name: 'own' }), 'nur eigene'),
      h('button', { class: 'btn primary' }, 'Suchen'));
    const search = () => run(async () => {
      const fd = new FormData(/** @type {HTMLFormElement} */ (form));
      const q = new URLSearchParams();
      for (const k of ['artist', 'title', 'genre']) if (String(fd.get(k) ?? '').trim()) q.set(k, String(fd.get(k)).trim());
      if (fd.get('own')) q.set('own', 'true');
      const r = await ra('GET', `${st()}/tracks?${q}`);
      results.replaceChildren(trackTable(r?.tracks ?? [], (t) => h('select', {
        title: 'Zu Playlist hinzufügen',
        onchange: (/** @type {Event} */ e) => {
          const sel = /** @type {HTMLSelectElement} */ (e.target);
          if (!sel.value) return;
          run(async () => { await ra('POST', `${st()}/playlists/${sel.value}`, { track_id: t.id }); status('Zur Playlist hinzugefügt'); });
          sel.value = '';
        },
      }, h('option', { value: '' }, '＋ Playlist'), ...playlists.map((p) => h('option', { value: String(p.id) }, p.title))), search));
    });
    const upload = h('label', { class: 'btn' }, '⭱ MP3 zu laut.fm hochladen', h('input', { type: 'file', accept: '.mp3,audio/mpeg', multiple: true, hidden: true, onchange: uploadTracks }));
    const loadQueued = () => run(async () => {
      const [q, inc] = await Promise.all([ra('GET', `${st()}/tracks;queued`), ra('GET', `${st()}/tracks;incomplete`)]);
      results.replaceChildren(card('In Verarbeitung', trackTable([...(q?.tracks ?? []), ...(inc?.tracks ?? [])], undefined, loadQueued)));
    });
    const queued = h('button', { class: 'btn small', onclick: loadQueued }, 'Uploads in Verarbeitung');
    return [card('Titel suchen', form, h('div', { class: 'row-btns' }, upload, queued)), results];
  }

  /**
   * Hochladen mit Metadaten, Verarbeitungs-Poll und optionaler Playlist-Zuordnung (Referenz:
   * automation.html, Tracks-Tab Upload-Dialog + waitForNewTrack()). Je Datei ein kurzer Metadaten-Dialog
   * (Künstler/Titel/Genre/Jahr/Typ/Privat/Playlist) - „Abbrechen" überspringt nur diese eine Datei, die
   * übrigen werden trotzdem angeboten. @param {Event} e
   */
  async function uploadTracks(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const files = [...(input.files ?? [])];
    input.value = '';
    let ok = 0;
    for (const f of files) {
      const meta = await formDialog(`Hochladen: ${f.name}`, [
        { name: 'artist', label: 'Interpret' },
        { name: 'title', label: 'Titel' },
        { name: 'genre', label: 'Genre' },
        { name: 'release_year', label: 'Jahr', type: 'number' },
        { name: 'type', label: 'Typ', options: [['song', 'Song'], ['jingle', 'Jingle']], value: 'song' },
        { name: 'private', label: 'Privat (nicht in der öffentlichen laut.fm-Songdatenbank)', type: 'checkbox' },
        { name: 'playlist', label: 'Zu Playlist hinzufügen', options: [['', '– keine –'], ...playlists.map((p) => /** @type {[string,string]} */ ([String(p.id), p.title]))] },
      ], 'Hochladen');
      if (!meta) continue;
      if (await run(() => uploadOneTrack(f, meta))) ok++;
    }
    status(`${ok}/${files.length} Datei(en) an laut.fm übertragen`, ok < files.length);
  }

  /**
   * Einzelner Upload: Schnappschuss der aktuell neuesten eigenen Track-ID (Untergrenze), Upload (liefert
   * zunächst eine negative „in Bearbeitung"-ID), Warten auf Verarbeitung, Metadaten setzen, optional zu
   * einer Playlist hinzufügen. @param {File} f @param {Record<string, any>} meta
   */
  async function uploadOneTrack(f, meta) {
    status(`laut.fm-Upload: ${f.name} …`);
    const snap = await ra('GET', `${st()}/tracks?own=true&order=desc`).catch(() => null);
    const snapshotId = snap?.tracks?.[0]?.id ?? 0;
    const fd = new FormData();
    fd.append('track', f);
    fd.append('private', meta.private ? 'true' : 'false');
    const up = await ra('POST', `${st()}/tracks`, fd);
    const negId = up?.id;
    if (typeof negId !== 'number') throw new Error(`${f.name}: Upload fehlgeschlagen`);
    const trackId = await waitForNewTrack(snapshotId, negId);
    if (trackId == null) { status(`${f.name}: Zeitüberschreitung – hochgeladen, Metadaten bitte manuell setzen`, true); return true; }
    await ra('PATCH', `${st()}/tracks/${trackId}`, {
      artist: meta.artist || undefined, title: meta.title || undefined, genre: meta.genre || undefined,
      release_year: meta.release_year ? Number(meta.release_year) : undefined,
      type: meta.type, private: !!meta.private,
    }).catch(() => {});
    if (meta.playlist) await ra('POST', `${st()}/playlists/${meta.playlist}`, { track_id: trackId }).catch(() => {});
    return true;
  }

  /** Dünner Adapter um waitForNewTrackLogic() mit den echten Radioadmin-Aufrufen dieser Instanz. @param {number} snapshotId @param {number} negId */
  async function waitForNewTrack(snapshotId, negId) {
    return waitForNewTrackLogic(snapshotId, negId, {
      ownDesc: () => ra('GET', `${st()}/tracks?own=true&order=desc`).catch(() => null),
      queuedIncomplete: () => Promise.all([ra('GET', `${st()}/tracks;queued`).catch(() => null), ra('GET', `${st()}/tracks;incomplete`).catch(() => null)]),
      onWaiting: () => status('Warte auf laut.fm-Verarbeitung…'),
    });
  }

  // ---------- Sendeplan (Slots: Tag*24 + Stunde, Montag = 0) ----------
  async function schedule() {
    const [sched] = await Promise.all([ra('GET', `${st()}/schedule`), loadPlaylists()]);
    const s = Array.isArray(sched) ? sched[0] : sched;
    /** @type {Record<number, number>} */
    const grid = {};
    for (const e of s?.entries ?? []) for (let i = 0; i < e.duration; i++) grid[e.slot + i] = e.playlist_id;
    const plById = new Map(playlists.map((p) => [p.id, p]));
    const base = plById.get(s?.base_playlist_id);
    const table = h('table', { class: 'lf-grid' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), ...DAYS.map((d) => h('th', {}, d)))),
      h('tbody', {}, ...Array.from({ length: 24 }, (_, hour) => h('tr', {}, h('th', { class: 'num' }, `${String(hour).padStart(2, '0')}:00`),
        ...DAYS.map((_, day) => {
          const slot = day * 24 + hour;
          const pl = plById.get(grid[slot]);
          return h('td', { title: pl ? pl.title : base ? `Basis: ${base.title}` : '', style: pl && /^#[0-9a-f]{6}$/i.test(pl.color) ? `background:${pl.color}33;border-left:3px solid ${pl.color}` : '', onclick: () => editSlot(s, grid, slot) }, pl ? pl.title : '');
        })))));
    return [card('Sendeplan', h('p', { class: 'muted' }, `Basis-Playlist: ${base?.title ?? '–'} · Zelle anklicken, um eine Stunde zu belegen`), h('div', { class: 'table-wrap' }, table))];
  }

  /** @param {any} s @param {Record<number, number>} grid @param {number} slot */
  async function editSlot(s, grid, slot) {
    const v = await formDialog(`${DAYS[Math.floor(slot / 24)]} ${String(slot % 24).padStart(2, '0')}:00`, [
      { name: 'playlist', label: 'Playlist', value: String(grid[slot] ?? ''), options: [['', '– Basis-Playlist –'], ...playlists.filter((p) => p.id !== s?.base_playlist_id).map((p) => /** @type {[string,string]} */ ([String(p.id), p.title]))] },
      { name: 'hours', label: 'Für wie viele Stunden', type: 'number', value: 1 },
    ]);
    if (!v) return;
    const next = { ...grid };
    for (let i = 0; i < Math.max(1, Math.min(168 - slot, Number(v.hours) || 1)); i++) {
      if (v.playlist) next[slot + i] = Number(v.playlist);
      else delete next[slot + i];
    }
    if (!s?.base_playlist_id) return status('Sendeplan ohne Basis-Playlist – bitte erst bei laut.fm eine Basis-Playlist festlegen', true);
    const entries = scheduleEntries(next, s.base_playlist_id);
    await run(async () => {
      await ra('PATCH', `${st()}/schedule`, { base_playlist_id: s.base_playlist_id, entries });
      // Gegenkontrolle: laut.fm übernimmt ungültige Einträge teils stillschweigend nicht
      const back = await ra('GET', `${st()}/schedule`);
      const now = Array.isArray(back) ? back[0] : back;
      const key = (/** @type {any[]} */ list) => JSON.stringify((list ?? []).map((e) => [e.playlist_id, e.slot, e.duration]).sort((a, b) => a[1] - b[1]));
      if (key(now?.entries) !== key(entries)) status('laut.fm hat den Sendeplan nicht vollständig übernommen – bitte die Ansicht prüfen', true);
      else status('Sendeplan gespeichert');
      renderTab();
    });
  }

  // ---------- Statistik ----------
  async function stats() {
    const [s, day] = await Promise.all([ra('GET', `${st()}/stats`), ra('GET', `${st()}/tracks/stats/24h`).catch(() => [])]);
    const log = (/** @type {Record<string, number>} */ o) => Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const max = Math.max(1, ...log(s?.switchons_log).map(([, v]) => v));
    return [h('div', { class: 'view-grid' },
      card('Hörer', kv('Jetzt', s?.listeners_now), kv('Position', s?.position_now),
        h('div', { class: 'bars' }, ...log(s?.switchons_log).map(([d, v]) => h('div', { class: 'bar', title: `${d}: ${v} Einschaltungen` }, h('i', { style: `height:${(v / max) * 100}%` }), h('span', {}, d.slice(5)))))),
      card('Gespielte Titel (24 h)', h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Start'), h('th', {}, 'Titel'), h('th', { class: 'num' }, 'Hörer'), h('th', {}, ''))),
        h('tbody', {}, ...(Array.isArray(day) ? day : []).slice(0, 300).map((/** @type {any} */ t) => h('tr', {},
          h('td', { class: 'num' }, t.started_at ? clockTime(new Date(t.started_at).getTime()) : ''),
          h('td', {}, `${t.artist?.name ?? ''} – ${t.title ?? ''}`), h('td', { class: 'num' }, String(t.listeners ?? '')), h('td', {}, t.live ? h('span', { class: 'pill failed' }, 'live') : ''))))))))];
  }

  // ---------- Benutzer ----------
  async function users() {
    const r = await ra('GET', `${st()}/users`);
    const list = r?.users ?? [];
    return [card('Benutzer', h('button', { class: 'btn small primary', onclick: invite }, '＋ Einladen'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('tbody', {}, ...list.map((/** @type {any} */ u) => h('tr', {},
        h('td', {}, `${u.name ?? ''} ${u.surname ?? ''}`), h('td', {}, u.email ?? ''),
        h('td', {}, h('select', { onchange: (/** @type {Event} */ e) => run(async () => { await ra('PATCH', `${st()}/users/${u.id}`, { role: /** @type {HTMLSelectElement} */ (e.target).value }); status('Rolle geändert'); }) },
          ...ROLES.map(([v, l]) => h('option', { value: v, selected: u.role === v }, l)))),
        h('td', { class: 'act' }, h('button', { title: 'Entfernen', onclick: () => confirm('Benutzer entfernen?') && run(async () => { await ra('DELETE', `${st()}/users/${u.id}`); renderTab(); }) }, '✕'))))))))];
  }

  async function invite() {
    const v = await formDialog('Benutzer einladen', [{ name: 'email', label: 'E-Mail', type: 'email', required: true }, { name: 'role', label: 'Rolle', value: 'dj', options: ROLES }], 'Einladen');
    if (v) await run(async () => { await ra('POST', `${st()}/users`, v); status('Einladung versendet'); renderTab(); });
  }

  // ---------- Station ----------
  async function station() {
    const [s, state] = await Promise.all([ra('GET', st()), ra('GET', `${st()}/state`).catch(() => null)]);
    const fields = /** @type {const} */ ([['description', 'Beschreibung'], ['format', 'Format'], ['djs', 'DJs'], ['location', 'Ort'], ['website', 'Website'], ['twitter_name', 'X/Twitter'], ['facebook_page', 'Facebook'], ['instagram_name', 'Instagram']]);
    const form = h('form', { class: 'lf-form', onsubmit: (/** @type {Event} */ e) => {
      e.preventDefault();
      const fd = new FormData(/** @type {HTMLFormElement} */ (form));
      /** @type {Record<string, any>} */
      const body = {};
      for (const [k] of fields) if (String(fd.get(k) ?? '') !== String(s[k] ?? '')) body[k] = String(fd.get(k) ?? '');
      const genres = String(fd.get('genres') ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3);
      if (genres.join(',') !== (s.genres ?? []).join(',')) body.genres = genres;
      if (!Object.keys(body).length) return status('Keine Änderungen');
      run(async () => { await ra('PATCH', st(), body); status('Station gespeichert'); });
    } },
      ...fields.map(([k, l]) => h('div', { class: 'field' }, h('label', {}, l), h('input', { name: k, value: s[k] ?? '' }))),
      h('div', { class: 'field' }, h('label', {}, 'Genres (max. 3, kommagetrennt)'), h('input', { name: 'genres', value: (s.genres ?? []).join(', ') })),
      h('button', { class: 'btn primary' }, 'Speichern'));
    const logo = h('label', { class: 'btn small' }, 'Logo hochladen', h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif', hidden: true, onchange: (/** @type {Event} */ e) => {
      const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
      if (!f) return;
      const fd = new FormData();
      fd.append('image', f);
      run(async () => { await ra('PUT', `${st()}/images/logo`, fd); status('Logo hochgeladen'); renderTab(); });
    } }));
    // Quick Actions im Stil des laut.fm-Radioadmin-Vorbilds (farblich getönte Aktionsboxen), aber mit
    // AnMaCha Casts eigener Optik (--qa-card, dieselbe --c-Farblogik wie Schnellzugriff/Cardwall/Decks).
    const quickActions = card('Quick Actions',
      h('div', { class: 'qa-stack' },
        h('div', { class: `qa-card ${state?.active ? 'qa-success' : 'qa-warning'}` },
          h('div', { class: 'qa-card-head' }, icon('play', 14), 'Sender-Status'),
          h('p', { class: 'qa-card-desc' }, state?.active ? 'Streaming-Server aktiv' : 'Streaming-Server inaktiv'),
          !state?.active ? h('div', { class: 'qa-card-actions' },
            h('button', { class: 'btn small', onclick: () => run(async () => { await ra('POST', `${st()}/state`); status('Station aktiviert'); renderTab(); }) }, 'Aktivieren')) : null),
        h('div', { class: 'qa-card' },
          h('div', { class: 'qa-card-head' }, icon('grid', 14), 'Sender-Logo aktualisieren'),
          h('p', { class: 'qa-card-desc' }, 'JPG, PNG oder GIF'),
          s.logo_image_url ? h('img', { src: s.logo_image_url, alt: 'Logo', class: 'lf-logo' }) : null,
          h('div', { class: 'qa-card-actions' }, logo))));
    return [h('div', { class: 'view-grid' }, card(`Station ${s.name}`, form), quickActions)];
  }

  // ---------- Live ----------
  async function live() {
    const l = await ra('GET', `${st()}/live`);
    return [card('Live-Zugang (Encoder)',
      kv('Server', l.server), kv('Port', l.port), kv('Mountpoint', l.mountpoint), kv('Benutzer', l.user), kv('Format', `${l.format ?? ''} ${l.bitrate ?? ''} kbit/s ${l.samplerate ?? ''} Hz`),
      kv('Passwort', l.password ? '•••••••• (wird nicht angezeigt)' : '–'), kv('Status', l.active ? 'live verbunden' : 'nicht live'),
      h('p', { class: 'muted' }, 'AnMaCha Cast kann diesen Zugang als Ausgang übernehmen: Das Sendesignal (Automation, Live, Mikrofon) geht dann direkt zu laut.fm. Mit Priorität (?prio=) verdrängt AnMaCha Cast eine niedrigere Quelle bzw. lässt sich von einer höheren verdrängen.'),
      h('button', { class: 'btn primary', onclick: async () => {
        const v = await formDialog('Als AnMaCha Cast-Ausgang übernehmen', [{ name: 'priority', label: 'Priorität ?prio= (leer = ohne)', type: 'number', value: '' }], 'Übernehmen');
        if (v) await run(async () => { await ctx.api.post(ctx.url('/lautfm/live-output'), { priority: v.priority }); status('laut.fm-Ausgang angelegt – sendet, sobald eine Quelle auf Sendung ist'); });
      } }, 'Als Ausgang übernehmen'))];
  }

  return { show: () => run(show) };
}

// @ts-check
// KI-Programmchef Teil 4 – Hörer-Funktionen für laut.fm: Wunschstunde (mit Abstimmen und „jederzeit wünschen“),
// Grüße und Sprachnachrichten auf Sendung, Jingle-Rotation. Server: src/server/services/programmchef-hoerer.ts.
// Die Wünsche, Grüße und Sprachnachrichten kommen über den Hörerbereich (hoerer.html) und stehen im Posteingang.

import { h, run, status } from './ui.js';

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const AIR = /** @type {[string, string][]} */ ([['off', 'aus'], ['manual', 'auf Knopfdruck im Posteingang'], ['auto', 'automatisch']]);
const WSTATE = /** @type {Record<string, string>} */ ({ open: 'wartet', queued: 'eingeplant', played: 'gelaufen ✔', removed: 'entfernt' });

/** @param {[string, string][]} opts @param {string} val */
const select = (opts, val) => /** @type {HTMLSelectElement} */ (h('select', {}, ...opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l))));
const when = (/** @type {number} */ t) => new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * @param {{ api: any, url: (p: string) => string }} ctx
 * @param {(title: string, ...body: any[]) => HTMLElement} card
 */
export async function hoererSection(ctx, card) {
  /** @type {any} */ let v = await ctx.api.get(ctx.url('/programmchef/hoerer'));
  const w = v.wish;

  // ---------- Wunschstunde ----------
  const on = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: !!w.enabled }));
  const any = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: !!w.anytime }));
  const days = DAYS.map((d, i) => /** @type {[number, HTMLInputElement, string]} */ ([i + 1, /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: w.days.includes(i + 1) })), d]));
  const from = select(Array.from({ length: 24 }, (_, i) => /** @type {[string, string]} */ ([String(i), `ab ${i} Uhr`])), String(w.from));
  const hours = select([1, 2, 3, 4].map((n) => /** @type {[string, string]} */ ([String(n), n === 1 ? '1 Stunde' : `${n} Stunden`])), String(w.hours));
  const per = select([1, 2, 3, 5, 10].map((n) => /** @type {[string, string]} */ ([String(n), `${n} Wunsch/Wünsche je Hörer und Tag`])), String(w.perListener));
  const perA = select([0, 1, 2, 3, 5].map((n) => /** @type {[string, string]} */ ([String(n), n ? `höchstens ${n} offene je Interpret` : 'Interpreten nicht begrenzen'])), String(w.perArtist));
  const genre = /** @type {HTMLInputElement} */ (h('input', { value: w.fillGenre ?? '', placeholder: 'Füllmusik-Genre, z. B. Pop', style: 'max-width:220px' }));
  const jEvery = select([0, 3, 4, 5, 6, 8].map((n) => /** @type {[string, string]} */ ([String(n), n ? `Jingle alle ${n} Songs` : 'keine Jingles'])), String(w.jingleEvery));
  const info = h('div', {});
  const list = h('div', {});
  const renderInfo = () => info.replaceChildren(
    v.next ? h('p', {}, `Nächste Wunschstunde: ${when(v.next.start)}–${new Date(v.next.end).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr · ${v.next.filled ? 'Playlist ist aufgebaut' : `wird ab ${new Date(v.next.fillAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr aufgebaut`}`) : null,
    v.wish.lastStatus ? h('p', { class: 'muted small' }, `Zuletzt: ${v.wish.lastStatus}`) : null,
    v.wish.enabled || v.wish.anytime ? h('p', { class: 'muted small' }, 'Hörer wünschen sich Titel im Hörerbereich (Hörer & Interaktion → Hörerseite), sehen dort die Wunschliste und stimmen ab.') : null);
  const renderList = () => list.replaceChildren(...(v.wishes.length ? [h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Wunsch'), h('th', {}, 'von'), h('th', { class: 'num' }, 'Stimmen'), h('th', {}, 'Stand'), h('th', {}, ''))),
    h('tbody', {}, ...v.wishes.slice(0, 25).map((/** @type {any} */ x) => h('tr', {},
      h('td', {}, `${x.artist} – ${x.title}`), h('td', { class: 'muted' }, x.nick || '–'), h('td', { class: 'num' }, String(x.votes)), h('td', {}, WSTATE[x.status] ?? x.status),
      h('td', { class: 'row-btns' },
        x.status === 'open' ? h('button', { class: 'btn small', title: 'An die gerade laufende Playlist hängen', onclick: () => run(async () => { await ctx.api.post(ctx.url(`/programmchef/hoerer/wishes/${x.id}/queue`)); status(`„${x.title}“ läuft in Kürze`); await reload(); }) }, 'Jetzt spielen') : null,
        h('button', { class: 'btn small ghost', onclick: () => run(async () => { await ctx.api.del(ctx.url(`/programmchef/hoerer/wishes/${x.id}`)); await reload(); }) }, '✕')))))))] : [h('p', { class: 'muted' }, 'Noch keine Wünsche.')]));
  const reload = async () => { v = await ctx.api.get(ctx.url('/programmchef/hoerer')); renderInfo(); renderList(); };
  renderInfo();
  renderList();
  const saveWish = (/** @type {Record<string, boolean>} */ extra = {}) => run(async () => {
    const body = { enabled: on.checked, anytime: any.checked, days: days.filter(([, b]) => b.checked).map(([d]) => d), from: Number(from.value), hours: Number(hours.value), perListener: Number(per.value), perArtist: Number(perA.value), fillGenre: genre.value, jingleEvery: Number(jEvery.value), ...extra };
    try {
      v = await ctx.api.put(ctx.url('/programmchef/hoerer/wish'), body);
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err.code === 'adopt_needed' && confirm(`${err.message}\n\nVorhandene Playlist verwenden?`)) return saveWish({ ...extra, adopt: true });
      if (err.code === 'conflict' && confirm(`${err.message}\n\nDiese Stunden mit der Wunschstunde ersetzen?`)) return saveWish({ ...extra, replace: true });
      throw e;
    }
    renderInfo();
    status(on.checked ? 'Wunschstunde gespeichert und im laut.fm-Sendeplan eingetragen' : any.checked ? 'Wünsche laufen jetzt zwischendurch' : 'Wünsche aus');
  });

  // ---------- Grüße & Sprachnachrichten ----------
  const greet = select(AIR, v.air.greet);
  const vm = select(AIR, v.air.voicemail);
  // neue Grüße/Sprachnachrichten direkt hier senden (der volle Posteingang steht unter „Hörer & Interaktion“)
  const inboxBox = h('div', {});
  const loadInbox = async () => {
    const d = await ctx.api.get(ctx.url('/inbox')).catch(() => ({ items: [] }));
    const items = d.items.filter((/** @type {any} */ x) => x.status === 'new' && (x.kind === 'message' || x.kind === 'voice')).slice(0, 8);
    inboxBox.replaceChildren(h('h3', {}, `Neu eingegangen (${items.length})`), ...(items.length ? items.map((/** @type {any} */ it) => h('div', { class: 'kv' },
      h('span', {}, `${it.kind === 'voice' ? '🎙' : '💬'} ${it.name || 'Hörer'}`, h('span', { class: 'muted' }, it.text ? ` · „${it.text}“` : it.kind === 'voice' ? ' · Sprachnachricht' : '')),
      h('span', { class: 'row-btns' }, h('button', { class: 'btn small primary', onclick: () => run(async () => {
        const r = await ctx.api.post(ctx.url(`/inbox/${encodeURIComponent(it.id)}/air`));
        status(r.air?.skipped ?? `„${r.air?.title}“ wird erzeugt und bei laut.fm eingereiht`, !!r.air?.skipped);
        await loadInbox();
      }) }, 'Bei laut.fm senden')))) : [h('p', { class: 'muted' }, 'Keine neuen Grüße oder Sprachnachrichten.')]));
  };
  await loadInbox();

  // ---------- Jingle-Rotation ----------
  const jc = v.jingles;
  const jMode = select([['rotate', 'im Wechsel'], ['random', 'zufällig']], jc.mode);
  const jEvery2 = select([2, 3, 4, 5, 6, 8, 10].map((n) => /** @type {[string, string]} */ ([String(n), `alle ${n} Songs`])), String(jc.every));
  const jAuto = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: !!jc.auto }));
  const jHour = select(Array.from({ length: 24 }, (_, i) => /** @type {[string, string]} */ ([String(i), `täglich um ${i} Uhr`])), String(jc.hour));
  const jBox = h('div', {}, h('p', { class: 'muted small' }, `${jc.ids.length} Jingle(s) und ${jc.playlists.length} Playlist(en) gewählt.`));
  /** @type {Map<number, HTMLInputElement>} */ const jSel = new Map();
  /** @type {Map<number, HTMLInputElement>} */ const pSel = new Map();
  const loadJingles = () => run(async () => {
    const [cands, pf] = await Promise.all([ctx.api.get(ctx.url('/programmchef/hoerer/jingles/candidates')), ctx.api.get(ctx.url('/programmchef/pflege'))]);
    jSel.clear(); pSel.clear();
    jBox.replaceChildren(
      h('h3', {}, 'Jingles'),
      cands.length ? h('div', { class: 'row-btns' }, ...cands.map((/** @type {any} */ t) => { const b = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: jc.ids.includes(t.id) })); jSel.set(t.id, b); return h('label', { class: 'chk' }, b, t.title || `#${t.id}`); }))
        : h('p', { class: 'muted' }, 'Bei laut.fm sind keine eigenen Titel als Jingle gekennzeichnet (Art „Jingle“ oder Tag „Jingle“) – unter „laut.fm verwalten → Titel“ hochladen und als Jingle markieren.'),
      h('h3', {}, 'in diese Playlisten'),
      h('div', { class: 'row-btns' }, ...pf.playlists.map((/** @type {any} */ p) => { const b = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: jc.playlists.includes(p.id) })); pSel.set(p.id, b); return h('label', { class: 'chk' }, b, p.title); })));
  });
  const saveJingles = async () => {
    const body = { mode: jMode.value, every: Number(jEvery2.value), auto: jAuto.checked, hour: Number(jHour.value), ...(jSel.size || pSel.size ? { ids: [...jSel].filter(([, b]) => b.checked).map(([id]) => id), playlists: [...pSel].filter(([, b]) => b.checked).map(([id]) => id) } : {}) };
    Object.assign(jc, await ctx.api.put(ctx.url('/programmchef/hoerer/jingles'), body));
  };

  return [
    card('Wunschstunde',
      h('p', { class: 'muted' }, 'Hörer wünschen sich Titel aus dem laut.fm-Pool und stimmen für Wünsche ab. Die Playlist „Wunschstunde“ steht zu deinen Zeiten im laut.fm-Sendeplan und wird 45 Minuten vorher mit den Wünschen (meiste Stimmen zuerst), Füllmusik und Jingles aufgebaut. Mit „jederzeit“ laufen Wünsche zusätzlich gleich zwischendurch.'),
      !v.connected ? h('p', {}, '⚠ Zuerst mit laut.fm verbinden.') : null,
      h('div', { class: 'row-btns' }, h('label', { class: 'chk' }, on, 'Wunschstunde'), ...days.map(([, b, l]) => h('label', { class: 'chk' }, b, l)), from, hours),
      h('div', { class: 'row-btns' }, h('label', { class: 'chk' }, any, 'jederzeit wünschen (läuft gleich, danach wieder raus)'), per, perA),
      h('div', { class: 'row-btns' }, genre, jEvery,
        h('button', { class: 'btn primary', onclick: () => saveWish() }, 'Speichern'),
        h('button', { class: 'btn', title: 'Wunschstunde-Playlist sofort mit den aktuellen Wünschen aufbauen', onclick: () => run(async () => { const r = await ctx.api.post(ctx.url('/programmchef/hoerer/wish/fill')); status(r.status); await reload(); }) }, 'Jetzt aufbauen (Probelauf)')),
      info,
      h('h3', {}, 'Wünsche'), list),
    card('Grüße & Sprachnachrichten auf Sendung',
      h('p', { class: 'muted' }, 'Grüße aus dem Hörerbereich formuliert die KI zu einem kurzen Gruß (nur Vorname, ohne Links/Telefonnummern, Unpassendes wird übersprungen), die Stimme spricht ihn. Sprachnachrichten laufen im Original. Beides wird an die gerade laufende laut.fm-Playlist gehängt und nach dem Abspielen wieder gelöscht.'),
      !v.voice ? h('p', {}, '⚠ Für gesprochene Grüße unter „KI-Studio & Anbieter“ eine Stimme wählen.') : null,
      h('div', { class: 'row-btns' }, h('span', {}, 'Grüße:'), greet, h('span', {}, 'Sprachnachrichten:'), vm,
        h('button', { class: 'btn primary', onclick: () => run(async () => { v.air = await ctx.api.put(ctx.url('/programmchef/hoerer/air'), { greet: greet.value, voicemail: vm.value }); status('Gespeichert'); }) }, 'Speichern')),
      h('p', { class: 'muted small' }, '„Auf Knopfdruck“: unten oder im Posteingang (Hörer & Interaktion) „Bei laut.fm senden“. „Automatisch“: neue Einträge gehen nacheinander auf Sendung (höchstens zwei gleichzeitig offen).'),
      inboxBox),
    card('Jingle-Rotation',
      h('p', { class: 'muted' }, 'Deine Jingles werden im Wechsel oder zufällig alle N Songs in die gewählten Playlisten eingestreut (jeder Jingle je Playlist einmal – bei jedem Durchlauf rückt die Auswahl weiter). Smart-Mischen lässt sie an ihrer Stelle; bei „laut.fm mischt“ verteilt laut.fm sie zufällig.'),
      h('div', { class: 'row-btns' }, jMode, jEvery2, h('label', { class: 'chk' }, jAuto, 'automatisch'), jHour, h('button', { class: 'btn', onclick: loadJingles }, 'Jingles & Playlisten wählen …')),
      jBox,
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn primary', onclick: () => run(async () => { await saveJingles(); status('Jingle-Rotation gespeichert'); }) }, 'Speichern'),
        h('button', { class: 'btn', onclick: () => run(async () => { await saveJingles(); if (!confirm('Jingles jetzt in die gewählten Playlisten einstreuen? (rückgängig unter „Playlist-Pflege“)')) return; status((await ctx.api.post(ctx.url('/programmchef/hoerer/jingles/apply'))).summary); }) }, 'Jetzt einstreuen')),
      jc.lastStatus ? h('p', { class: 'muted small' }, `Zuletzt: ${jc.lastStatus}`) : null),
  ];
}

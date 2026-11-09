// @ts-check
// KI-Programmchef Teil 3 – Playlist-Pflege für laut.fm: Smart-Mischen (auch automatisch), Songliste → Playlist,
// Aufräumen (Doppelte, Interpreten-Limit, Flops), Sicherung/Wiederherstellung und „Letzte Pflege rückgängig“.
// Server: src/server/services/programmchef-pflege.ts.

import { h, run, status } from './ui.js';

const HOW = /** @type {Record<string, string>} */ ({ 'titel-interpret': 'Titel – Interpret', 'interpret-titel': 'Interpret – Titel', ki: 'KI-korrigiert' });
const MODE = /** @type {Record<string, string>} */ ({ off: 'aus', laut: 'laut.fm mischt', smart: 'Smart-Mischen' });
const CAD = /** @type {Record<string, string>} */ ({ h6: 'alle 6 Stunden', daily: 'täglich', weekly: 'wöchentlich' });
const KIND = /** @type {Record<string, string>} */ ({ dup_id: 'doppelt', dup_song: 'doppelt', overload: 'Interpret zu oft', flop: 'Flop' });

/** @param {HTMLSelectElement} sel @param {[string, string][]} opts @param {string} val */
function fill(sel, opts, val) {
  sel.replaceChildren(...opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
  return sel;
}

/**
 * @param {{ api: any, url: (p: string) => string }} ctx
 * @param {(title: string, ...body: any[]) => HTMLElement} card
 */
export async function pflegeSection(ctx, card) {
  /** @type {any} */ let v = await ctx.api.get(ctx.url('/programmchef/pflege'));
  const reload = async () => {
    v = await ctx.api.get(ctx.url('/programmchef/pflege'));
    // Playlisten (Name, „laut.fm mischt“, Misch-Einstellung) frisch übernehmen, Auswahl behalten
    pls.splice(0, pls.length, ...v.playlists);
    const keep = pl.value;
    fill(pl, plOpts(), pls.some((p) => String(p.id) === keep) ? keep : String(pls[0]?.id ?? ''));
    renderUndo();
    renderBackups();
  };
  const pls = /** @type {any[]} */ (v.playlists);
  const plOpts = () => /** @type {[string, string][]} */ (pls.map((p) => [String(p.id), `${p.title}${p.shuffled ? ' (laut.fm mischt)' : ''}`]));

  // ---------- Rückgängig ----------
  const undoBox = h('div', {});
  const renderUndo = () => undoBox.replaceChildren(...(v.undo ? [h('div', { class: 'row-btns' },
    h('span', { class: 'muted' }, `Letzte Pflege ${new Date(v.undo.at).toLocaleString('de-DE')}: ${v.undo.summary}`),
    h('button', { class: 'btn small danger', onclick: () => run(async () => {
      if (!confirm(`„${v.undo.summary}“ zurücknehmen? Reihenfolge und Titel der Playlist(en) werden wie vorher gesetzt.`)) return;
      status((await ctx.api.post(ctx.url('/programmchef/pflege/undo'))).summary);
      await reload();
    }) }, 'Letzte Pflege rückgängig'))] : []));
  renderUndo();

  // ---------- Mischen ----------
  const pl = fill(/** @type {HTMLSelectElement} */ (h('select', {})), plOpts(), String(pls[0]?.id ?? ''));
  const mode = /** @type {HTMLSelectElement} */ (h('select', {}));
  const cad = /** @type {HTMLSelectElement} */ (h('select', {}));
  const hour = fill(/** @type {HTMLSelectElement} */ (h('select', {})), Array.from({ length: 24 }, (_, i) => /** @type {[string, string]} */ ([String(i), `um ${i} Uhr`])), '4');
  const mixState = h('p', { class: 'muted small' });
  const previewBox = h('div', {});
  /** @type {number | undefined} */ let seed;
  const cur = () => pls.find((p) => String(p.id) === pl.value);
  const syncMix = () => {
    const s = cur()?.shuffle ?? { mode: 'off', cadence: 'daily', hour: 4 };
    fill(mode, Object.entries(MODE), s.mode);
    fill(cad, Object.entries(CAD), s.cadence);
    hour.value = String(s.hour);
    cad.disabled = hour.disabled = s.mode !== 'smart';
    mixState.textContent = s.lastStatus ? `Zuletzt: ${s.lastStatus}` : s.mode === 'off' ? 'Kein automatisches Mischen.' : '';
    previewBox.replaceChildren();
    seed = undefined;
  };
  mode.onchange = () => { cad.disabled = hour.disabled = mode.value !== 'smart'; };
  pl.onchange = syncMix;
  syncMix();
  const preview = () => run(async () => {
    const r = await ctx.api.get(ctx.url(`/programmchef/pflege/playlists/${pl.value}/shuffle`));
    seed = r.seed;
    previewBox.replaceChildren(
      h('p', {}, `${r.count} Titel, ${r.fixed} Jingles/Beiträge bleiben an ihrer Stelle. Kleinster Abstand gleicher Interpreten: ${r.gapBefore ?? '–'} → ${r.gapAfter ?? '–'} Songs.`),
      h('ol', { class: 'pc-list' }, ...r.preview.map((/** @type {any} */ t) => h('li', {}, `${t.artist} – ${t.title}`, t.fixed ? h('span', { class: 'tag' }, 'fest') : null))),
      h('p', { class: 'muted small' }, '„Jetzt smart mischen“ übernimmt genau diese Reihenfolge.'));
  });
  const mixNow = () => run(async () => {
    const p = cur();
    if (!p || !confirm(`„${p.title}“ jetzt neu mischen? Die Reihenfolge wird bei laut.fm neu geschrieben${p.shuffled ? ' und das laut.fm-Mischen ausgeschaltet' : ''} (rückgängig machbar).`)) return;
    status('Mische … (laut.fm braucht je Titel einen Moment)');
    const r = await ctx.api.post(ctx.url(`/programmchef/pflege/playlists/${pl.value}/shuffle`), { mode: 'smart', seed });
    await reload();
    syncMix();
    status(r.message, !r.ok);
  });
  const saveMix = () => run(async () => {
    const r = await ctx.api.put(ctx.url(`/programmchef/pflege/playlists/${pl.value}/shuffle`), { mode: mode.value, cadence: cad.value, hour: Number(hour.value) });
    const p = cur();
    if (p) { p.shuffle = { ...p.shuffle, ...r }; if (r.mode === 'laut') p.shuffled = true; }
    status(r.mode === 'off' ? 'Automatisches Mischen aus' : r.mode === 'laut' ? 'laut.fm mischt diese Playlist jetzt selbst' : `Smart-Mischen ${CAD[r.cadence]}${r.cadence === 'h6' ? '' : ` um ${r.hour} Uhr`}`);
    syncMix();
  });

  // ---------- Aufräumen ----------
  const perArtist = fill(/** @type {HTMLSelectElement} */ (h('select', {})), [3, 4, 5, 8, 10, 0].map((n) => /** @type {[string, string]} */ ([String(n), n ? `höchstens ${n} je Interpret` : 'Interpreten nicht begrenzen'])), '5');
  const days = fill(/** @type {HTMLSelectElement} */ (h('select', {})), [1, 3, 7].map((n) => /** @type {[string, string]} */ ([String(n), `Hörerzahlen ${n === 1 ? 'der letzten 24 Stunden' : `der letzten ${n} Tage`}`])), '3');
  const cleanBox = h('div', {});
  const scan = () => run(async () => {
    const r = await ctx.api.get(ctx.url(`/programmchef/pflege/playlists/${pl.value}/cleanup?perArtist=${perArtist.value}&days=${days.value}`));
    const all = [...r.duplicates, ...r.overload, ...r.flops];
    if (!all.length) return cleanBox.replaceChildren(h('p', {}, `✔ „${r.playlist.title}“ (${r.count} Titel) ist aufgeräumt – nichts gefunden.${r.statsPlays ? '' : ' Für Flops fehlen noch Hörerzahlen.'}`));
    // Doppelte sind sicher; Interpreten-Limit und Flops nur auf Wunsch
    const rows = all.map((f) => ({ f, box: /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: f.kind.startsWith('dup') })) }));
    cleanBox.replaceChildren(
      h('p', {}, `${r.count} Titel geprüft · ${r.duplicates.length} doppelt · ${r.overload.length} über dem Interpreten-Limit · ${r.flops.length} Flops${r.statsPlays ? ` (Ø ${r.avgListeners} Hörer)` : ' (noch keine Hörerzahlen)'}`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Titel'), h('th', {}, 'Befund'), h('th', {}, 'Warum'))),
        h('tbody', {}, ...rows.map(({ f, box }) => h('tr', {}, h('td', {}, box), h('td', {}, `${f.artist} – ${f.title}`), h('td', {}, h('span', { class: 'tag' }, KIND[f.kind] ?? f.kind)), h('td', { class: 'muted' }, f.reason)))))),
      h('div', { class: 'row-btns' }, h('button', { class: 'btn danger', onclick: () => run(async () => {
        const remove = rows.filter((x) => x.box.checked).map((x) => x.f.id);
        if (!remove.length) return status('Nichts ausgewählt', true);
        if (!confirm(`${remove.length} Titel aus „${r.playlist.title}“ entfernen? Doppelt eingetragene bleiben einmal drin (rückgängig machbar).`)) return;
        const a = await ctx.api.post(ctx.url(`/programmchef/pflege/playlists/${pl.value}/cleanup`), { remove });
        status(a.summary);
        cleanBox.replaceChildren();
        await reload();
      }) }, 'Ausgewählte entfernen')));
  });

  // ---------- Songliste → Playlist ----------
  const listText = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: 6, placeholder: 'Eine Songliste einfügen – je Zeile ein Song, egal ob „Titel - Interpret“ oder „Interpret - Titel“, auch mit Nummern oder Kommas:\nBohemian Rhapsody - Queen\nNena - 99 Luftballons\nmänner sind schweine - die ärzte' }));
  const useAi = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: !!v.ai, disabled: !v.ai }));
  const listBox = h('div', {});
  const searchList = () => run(async () => {
    if (!listText.value.trim()) return status('Bitte eine Songliste einfügen', true);
    let job = await ctx.api.post(ctx.url('/programmchef/pflege/songlist'), { text: listText.value, ai: useAi.checked });
    const prog = h('div', { class: 'empty' }, `Suche ${job.items.length} Songs bei laut.fm …`);
    listBox.replaceChildren(prog);
    while (job.state === 'running') {
      await new Promise((r) => setTimeout(r, 1500));
      if (!listBox.isConnected) return;
      job = await ctx.api.get(ctx.url(`/programmchef/pflege/songlist/${job.id}`)).catch(() => job);
      prog.textContent = `Suche … ${job.progress} % · ${job.step}`;
    }
    if (job.state === 'failed') return listBox.replaceChildren(h('p', { class: 'err' }, job.error ?? 'Suche fehlgeschlagen'));
    showList(job);
  });
  /** @param {any} job */
  const showList = (job) => {
    const found = job.items.filter((/** @type {any} */ x) => x.match);
    const missing = job.items.filter((/** @type {any} */ x) => !x.match);
    const rows = found.map((/** @type {any} */ x) => ({ x, box: /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: true })) }));
    const target = fill(/** @type {HTMLSelectElement} */ (h('select', {})), [['0', '➕ neue Playlist'], ...plOpts()], '0');
    const name = /** @type {HTMLInputElement} */ (h('input', { value: job.name || 'Songliste', placeholder: 'Name der neuen Playlist' }));
    const replace = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' }));
    const replaceLbl = h('label', { class: 'chk', hidden: true }, replace, 'Playlist genau auf diese Liste setzen (andere Songs raus)');
    target.onchange = () => { name.hidden = target.value !== '0'; replaceLbl.hidden = target.value === '0'; };
    listBox.replaceChildren(
      h('p', {}, `${found.length} von ${job.items.length} Songs bei laut.fm gefunden${job.ai === 'used' ? ' (Schreibweisen per KI korrigiert)' : job.ai === 'failed' ? ' – die KI-Korrektur hat gerade nicht geantwortet' : ''}.`),
      found.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Eingabe'), h('th', {}, 'Gefunden bei laut.fm'), h('th', {}, 'erkannt als'))),
        h('tbody', {}, ...rows.map(({ x, box }) => h('tr', {}, h('td', {}, box), h('td', { class: 'muted' }, x.raw), h('td', {}, `${x.match.artist} – ${x.match.title}`), h('td', { class: 'muted' }, HOW[x.how] ?? '')))))) : null,
      missing.length ? h('p', { class: 'muted small' }, `Nicht bei laut.fm: ${missing.slice(0, 40).map((/** @type {any} */ x) => x.raw).join('; ')}`) : null,
      found.length ? h('div', { class: 'row-btns' }, target, name, replaceLbl, h('button', { class: 'btn primary', onclick: () => run(async () => {
        const ids = rows.filter((/** @type {any} */ r) => r.box.checked).map((/** @type {any} */ r) => r.x.match.id);
        const r = await ctx.api.post(ctx.url('/programmchef/pflege/songlist/apply'), { ids, playlistId: Number(target.value) || undefined, name: name.value, replace: replace.checked });
        status(r.summary, r.failed > 0);
        listBox.replaceChildren(h('p', {}, `✔ ${r.summary}`));
        await reload();
      }) }, 'Bei laut.fm übernehmen')) : null);
  };

  // ---------- Sicherung ----------
  const label = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Name der Sicherung, z. B. „vor dem Umbau“' }));
  const auto = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: !!v.autoBackup, onchange: () => run(async () => {
    await ctx.api.put(ctx.url('/programmchef/pflege/backups/auto'), { enabled: auto.checked });
    status(auto.checked ? 'Wöchentliche Auto-Sicherung an' : 'Auto-Sicherung aus');
  }) }));
  const exact = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: true }));
  const withSched = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: true }));
  const fileIn = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => run(async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    const data = JSON.parse(await f.text());
    status((await ctx.api.post(ctx.url('/programmchef/pflege/backups'), { data })).summary);
    fileIn.value = '';
    await reload();
  }) }));
  const backupList = h('div', {});
  const renderBackups = () => backupList.replaceChildren(...(v.backups.length ? v.backups.map((/** @type {any} */ b) => h('div', { class: 'kv' },
    h('span', {}, `${b.label}`, b.auto ? h('span', { class: 'tag' }, 'auto') : null, h('span', { class: 'muted small' }, ` · ${new Date(b.at).toLocaleString('de-DE')} · ${b.playlists} Playlisten, ${b.tracks} Titel${b.schedule ? ', Sendeplan' : ''}`)),
    h('span', { class: 'row-btns' },
      h('button', { class: 'btn small primary', onclick: () => run(async () => {
        if (!confirm(`Sicherung „${b.label}“ bei laut.fm wiederherstellen?${exact.checked ? ' Titel und Reihenfolge werden genau wie gesichert gesetzt.' : ' Fehlende Titel werden ergänzt.'}${withSched.checked && b.schedule ? ' Der Sendeplan wird zurückgesetzt.' : ''} (rückgängig machbar)`)) return;
        status('Stelle wieder her … (kann einige Minuten dauern)');
        status((await ctx.api.post(ctx.url(`/programmchef/pflege/backups/${b.id}/restore`), { exact: exact.checked, schedule: withSched.checked })).summary);
        await reload();
      }) }, 'Wiederherstellen'),
      h('button', { class: 'btn small', onclick: () => run(async () => {
        const d = await ctx.api.get(ctx.url(`/programmchef/pflege/backups/${b.id}`));
        const a = /** @type {HTMLAnchorElement} */ (h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' })), download: `laut.fm-sicherung-${new Date(b.at).toISOString().slice(0, 10)}.json` }));
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }) }, 'Herunterladen'),
      h('button', { class: 'btn small ghost', onclick: () => run(async () => {
        if (!confirm(`Sicherung „${b.label}“ löschen?`)) return;
        await ctx.api.del(ctx.url(`/programmchef/pflege/backups/${b.id}`));
        await reload();
      }) }, '✕')))) : [h('p', { class: 'muted' }, 'Noch keine Sicherung – vor größeren Umbauten am besten eine anlegen.')]));
  renderBackups();

  return [
    card('Playlist-Pflege',
      h('p', { class: 'muted' }, 'Mischen und Aufräumen deiner laut.fm-Playlisten. Jingles, Moderationen und Beiträge bleiben dabei immer an ihrer Stelle; jede Änderung lässt sich zurücknehmen.'),
      v.error ? h('p', { class: 'err' }, v.error) : null,
      undoBox,
      h('div', { class: 'row-btns' }, h('span', {}, 'Playlist'), pl),
      h('h3', {}, 'Mischen'),
      h('p', { class: 'muted small' }, 'Smart-Mischen verteilt die Songs neu und hält gleiche Interpreten möglichst weit auseinander. „laut.fm mischt“ überlässt die Reihenfolge laut.fm.'),
      h('div', { class: 'row-btns' }, h('span', {}, 'Automatisch:'), mode, cad, hour, h('button', { class: 'btn', onclick: saveMix }, 'Speichern')),
      mixState,
      h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: preview }, 'Vorschau'), h('button', { class: 'btn primary', onclick: mixNow }, 'Jetzt smart mischen')),
      previewBox,
      h('h3', {}, 'Aufräumen'),
      h('div', { class: 'row-btns' }, perArtist, days, h('button', { class: 'btn', onclick: scan }, 'Playlist prüfen')),
      cleanBox),
    card('Songliste → Playlist',
      h('p', { class: 'muted' }, 'Eine fertige Liste (z. B. aus einer Sendung, einem Hörerwunsch oder einer Website) einfügen. Jeder Song wird im eigenen Bestand und im laut.fm-Pool gesucht; danach als neue Playlist anlegen oder an eine bestehende anhängen – in Listen-Reihenfolge.'),
      listText,
      h('div', { class: 'row-btns' }, h('label', { class: 'chk', title: v.ai ? '' : 'Keine Text-KI eingerichtet' }, useAi, 'Schreibfehler per KI korrigieren'), h('button', { class: 'btn primary', onclick: searchList }, 'Songs suchen')),
      listBox),
    card('Sicherung',
      h('p', { class: 'muted' }, 'Sichert alle Playlisten (Titel und Reihenfolge) und den Sendeplan. Die letzten 5 Sicherungen bleiben erhalten; als Datei herunterladen, um sie aufzuheben oder auf einem anderen Sender einzuspielen.'),
      h('div', { class: 'row-btns' }, label, h('button', { class: 'btn primary', onclick: () => run(async () => {
        status('Sichere … (je Playlist ein Abruf bei laut.fm)');
        status((await ctx.api.post(ctx.url('/programmchef/pflege/backups'), { label: label.value })).summary);
        label.value = '';
        await reload();
      }) }, 'Jetzt sichern'), h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Sicherungsdatei einspielen'), fileIn),
      h('div', { class: 'row-btns' }, h('label', { class: 'chk' }, auto, 'jede Woche automatisch sichern'), h('label', { class: 'chk' }, exact, 'beim Wiederherstellen genau wie gesichert'), h('label', { class: 'chk' }, withSched, 'Sendeplan mit wiederherstellen')),
      backupList),
  ];
}

// @ts-check
// KI-Programmchef für laut.fm (Tab in „laut.fm verwalten“): Wunsch → Plan → Titelsuche im laut.fm-Pool → Vorschau →
// bei laut.fm einspielen (mit Rückgängig) und der Autopilot, der das Programm regelmäßig selbst auffrischt.
// Server: src/server/services/programmchef.ts.

import { h, run, status } from './ui.js';

const SOURCE = /** @type {Record<string, string>} */ ({
  chart_de: 'Deutsche Charts', chart_global: 'Weltweite Charts', ai: 'KI-Auswahl', pool_genre: 'laut.fm-Pool nach Genre', artists: 'Interpreten', existing: 'vorhandene Playlist',
});
const DAY = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Tage kompakt: [1,2,3,4,5] → „Mo–Fr“ @param {number[]} d */
export function dayLabel(d) {
  const s = [...d].sort((a, b) => a - b);
  if (s.length === 7) return 'täglich';
  const runs = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    runs.push(j - i >= 2 ? `${DAY[s[i]]}–${DAY[s[j]]}` : s.slice(i, j + 1).map((x) => DAY[x]).join(', '));
    i = j;
  }
  return runs.join(', ');
}

/**
 * @param {{ api: any, url: (p: string) => string }} ctx
 * @param {(title: string, ...body: any[]) => HTMLElement} card
 */
export async function programmchefTab(ctx, card) {
  const st = /** @type {any} */ (await ctx.api.get(ctx.url('/programmchef')));
  /** @type {any} */ let plan = null;
  /** @type {any} */ let job = null;
  const planBox = h('div', {});
  const undoBox = h('div', {});

  const wish = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: 3, placeholder: 'z. B. „Morgens 6–10 Uhr aktuelle Pop-Hits, abends 18–22 Uhr Rock-Klassiker, am Wochenende 90er – je 60 Songs“' }));
  const single = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' }));

  const renderUndo = (/** @type {any} */ u) => undoBox.replaceChildren(...(u ? [h('div', { class: 'row-btns' },
    h('span', { class: 'muted' }, `Zuletzt eingespielt ${new Date(u.at).toLocaleString('de-DE')}: ${u.summary}`),
    h('button', { class: 'btn small danger', onclick: () => run(async () => {
      if (!confirm('Letztes Einspielen zurücknehmen? Neue Playlisten werden gelöscht, hinzugefügte Titel entfernt, der alte Sendeplan wiederhergestellt.')) return;
      const r = await ctx.api.post(ctx.url('/programmchef/undo'));
      status(r.summary);
      renderUndo(null);
    }) }, 'Rückgängig'))] : []));
  renderUndo(st.undo);

  async function makePlan() {
    if (!wish.value.trim()) return status('Bitte einen Wunsch eingeben', true);
    planBox.replaceChildren(h('div', { class: 'empty' }, 'Der Programmchef plant …'));
    const r = await run(() => ctx.api.post(ctx.url('/programmchef/plan'), { wish: wish.value, single: single.checked }));
    if (!r) return planBox.replaceChildren();
    plan = r.plan;
    job = null;
    showPlan(r.model, r.note);
  }

  /** @param {string} model @param {string} note */
  function showPlan(model, note) {
    planBox.replaceChildren(card('Plan',
      h('p', {}, plan.summary || ''),
      note ? h('p', { class: 'muted' }, `⚠ ${note}`) : null,
      h('p', { class: 'muted small' }, `Geplant von: ${model}`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Playlist'), h('th', {}, 'Quelle'), h('th', { class: 'num' }, 'Titel'), h('th', {}, 'Details'), h('th', {}, 'Warum'))),
        h('tbody', {}, ...plan.playlists.map((/** @type {any} */ p) => h('tr', {},
          h('td', {}, h('span', { class: 'pl-dot', style: `background:${p.color}` }), ' ', p.name, plan.basePlaylist === p.name ? h('span', { class: 'tag' }, 'Basis') : null),
          h('td', {}, SOURCE[p.source] ?? p.source),
          h('td', { class: 'num' }, p.source === 'existing' ? '–' : String(p.count)),
          h('td', { class: 'muted' }, [p.genres.join(', '), p.artists.length ? `Interpreten: ${p.artists.slice(0, 6).join(', ')}` : '', p.mood, p.minYear || p.maxYear ? `${p.minYear ?? '…'}–${p.maxYear ?? 'heute'}` : '', p.wish].filter(Boolean).join(' · ')),
          h('td', { class: 'muted' }, p.why || '')))))),
      plan.schedule.length ? h('div', {}, h('h3', {}, 'Sendezeiten'), ...plan.schedule.map((/** @type {any} */ s) => h('div', { class: 'kv' }, h('span', {}, s.playlist), h('span', { class: 'muted' }, `${dayLabel(s.days)} · ${s.from}–${s.to} Uhr`)))) : h('p', { class: 'muted' }, 'Keine festen Sendezeiten – die Basis-Playlist läuft durchgehend.'),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn primary', onclick: collect }, 'Titel im laut.fm-Pool suchen'),
        h('button', { class: 'btn', onclick: makePlan }, 'Neu planen'))));
  }

  async function collect() {
    const j = await run(() => ctx.api.post(ctx.url('/programmchef/collect'), { plan }));
    if (!j) return;
    job = j;
    const prog = h('div', { class: 'empty' }, 'Suche Titel …');
    planBox.append(prog);
    while (job.state === 'running') {
      await new Promise((r) => setTimeout(r, 1500));
      job = await ctx.api.get(ctx.url(`/programmchef/jobs/${job.id}`)).catch(() => job);
      prog.textContent = `Suche Titel … ${job.progress} % · ${job.step}`;
    }
    prog.remove();
    if (job.state === 'failed') return status(job.error ?? 'Titelsuche fehlgeschlagen', true);
    showResults();
  }

  function showResults() {
    const total = job.results.reduce((/** @type {number} */ a, /** @type {any} */ r) => a + r.found.length, 0);
    planBox.append(card(`Vorschau: ${total} Titel gefunden`,
      ...job.results.map((/** @type {any} */ r) => h('details', { class: 'pc-res' },
        h('summary', {}, h('strong', {}, r.name), ` · ${r.found.length} gefunden`, r.missing.length ? ` · ${r.missing.length} nicht bei laut.fm` : '', r.error ? h('span', { class: 'pill failed' }, ' Fehler') : null),
        r.error ? h('p', { class: 'muted' }, r.error) : null,
        r.note ? h('p', { class: 'muted small' }, r.note) : null,
        h('ol', { class: 'pc-list' }, ...r.found.map((/** @type {any} */ f) => h('li', {}, `${f.artist} – ${f.title}`))),
        r.missing.length ? h('p', { class: 'muted small' }, `Nicht im laut.fm-Pool: ${r.missing.slice(0, 30).map((/** @type {any} */ m) => `${m.artist} – ${m.title}`).join('; ')}`) : null)),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn primary', onclick: () => run(async () => {
          if (!confirm('Plan jetzt bei laut.fm einspielen? Playlisten werden angelegt/ergänzt und die Sendezeiten eingetragen (rückgängig machbar).')) return;
          const r = await ctx.api.post(ctx.url('/programmchef/apply'), { jobId: job.id });
          status(r.summary + (r.schedule ? ' – Sendeplan bei laut.fm geprüft ✔' : ''));
          renderUndo({ at: Date.now(), summary: r.summary });
        }) }, 'Bei laut.fm einspielen'))));
  }

  // ---------- Autopilot ----------
  const ap = st.autopilot;
  const apOn = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: !!ap.enabled }));
  const apBrief = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: 3, placeholder: 'Vorgabe für das ganze Programm, z. B. „Tagsüber aktuelle Hits, abends Rock, nachts Chill, am Wochenende 80er und 90er“' }, ap.brief ?? ''));
  const apEvery = /** @type {HTMLSelectElement} */ (h('select', {}, ...[[6, 'alle 6 Stunden'], [12, 'alle 12 Stunden'], [24, 'täglich'], [48, 'alle 2 Tage'], [168, 'wöchentlich']].map(([v, l]) => h('option', { value: String(v), selected: Number(ap.everyHours) === v }, String(l)))));
  const apState = h('p', { class: 'muted' }, ap.lastRun ? `Letzter Lauf ${new Date(ap.lastRun).toLocaleString('de-DE')}: ${ap.lastOk === false ? '⚠ ' : ''}${ap.lastResult ?? ''}` : 'Noch nicht gelaufen.');
  const saveAp = () => run(async () => {
    const r = await ctx.api.put(ctx.url('/programmchef/autopilot'), { enabled: apOn.checked, brief: apBrief.value, everyHours: Number(apEvery.value) });
    status(r.autopilot.enabled ? 'Autopilot eingeschaltet – er frischt das Programm regelmäßig auf' : 'Autopilot gespeichert (aus)');
  });

  return [
    !st.ai ? card('Hinweis', h('p', {}, 'Es ist noch keine KI eingerichtet. Der Programmchef plant dann nach festen Regeln aus deinem Text (Uhrzeiten, Tage, Anzahl, Charts). Für Stimmungs-/Themen-Playlisten unter „KI-Programmchef → Anbieter & lokale KI“ einen Anbieter wählen.')) : null,
    card('KI-Programmchef: Wunsch → Programm',
      h('p', { class: 'muted' }, 'Beschreibe dein Programm in eigenen Worten. Der Programmchef plant Playlisten und Sendezeiten, sucht jeden Titel im laut.fm-Pool und zeigt dir alles, bevor etwas bei laut.fm geändert wird.'),
      wish,
      h('div', { class: 'row-btns' }, h('label', { class: 'chk' }, single, 'nur eine Playlist (ohne Sendezeiten)'), h('button', { class: 'btn primary', onclick: makePlan }, 'Plan erstellen')),
      undoBox),
    planBox,
    card('Autopilot',
      h('p', { class: 'muted' }, 'Der Autopilot baut das Programm nach deiner Vorgabe und frischt die Playlisten regelmäßig mit passenden Titeln auf (alte raus, neue rein). Jeder Lauf ist im Protokoll und lässt sich rückgängig machen.'),
      apBrief,
      h('div', { class: 'row-btns' }, h('label', { class: 'chk' }, apOn, 'Autopilot an'), apEvery,
        h('button', { class: 'btn primary', onclick: saveAp }, 'Speichern'),
        h('button', { class: 'btn', onclick: () => run(async () => {
          status('Autopilot läuft … (kann einige Minuten dauern)');
          const r = await ctx.api.post(ctx.url('/programmchef/autopilot/run'));
          status(r.result);
          apState.textContent = `Letzter Lauf jetzt: ${r.result}`;
        }) }, 'Jetzt ausführen')),
      apState),
    card('Protokoll', ...(st.log.length ? st.log.slice(0, 15).map((/** @type {any} */ l) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, new Date(l.at).toLocaleString('de-DE')), h('span', {}, `${l.ok ? '' : '⚠ '}${l.text}`))) : [h('p', { class: 'muted' }, 'Noch keine Einträge.')])),
  ].filter(Boolean);
}

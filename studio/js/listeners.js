// @ts-check
// Hörer-Interaktion im Studio: Posteingang (Wünsche, Grüße, Sprachnachrichten), Voting-Charts, Einstellungen.
import { download, formDialog, h, run, status } from './ui.js';

const KIND = /** @type {Record<string, string>} */ ({ request: '🎵 Wunsch', message: '💬 Gruß', voice: '🎙 Sprachnachricht' });

/** @typedef {{ api: import('./api.js').Api, url: (p: string) => string, stationId: () => string, onUnread: (n: number) => void }} Ctx */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountListeners(root, ctx) {
  /** @param {string} title @param {...(Node|string|null|false)} body */
  const card = (title, ...body) => h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, title)), ...body);
  const time = (/** @type {number} */ t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  /** @type {{ text: string, mode: string, count: number, label: string, unique: boolean }} */
  const drawState = { text: '', mode: 'normal', count: 3, label: '', unique: true };
  /** @type {any} */ let lastDraw = null;

  async function show() {
    const [d, polls, forms, draws] = await Promise.all([ctx.api.get(ctx.url('/inbox')), ctx.api.get(ctx.url('/polls')), ctx.api.get(ctx.url('/forms')), ctx.api.get(ctx.url('/draws'))]);
    d.polls = polls; d.forms = forms; d.draws = draws;
    ctx.onUnread(d.unread);
    const c = d.config;
    const any = c.requests || c.messages || c.voting || c.voice || c.polls || c.forms;
    const link = `${base()}`;
    const act = (/** @type {any} */ it, /** @type {string} */ a) => run(async () => { await ctx.api.post(ctx.url(`/inbox/${encodeURIComponent(it.id)}/${a}`)); show(); });
    root.replaceChildren(...[
      h('div', { class: 'listener-hero' },
        h('div', {}, h('span', { class: 'ov-kicker' }, 'COMMUNITY'), h('h1', {}, 'Hörer & Interaktion'), h('p', {}, 'Wünsche, Grüße, Voting und Sprachnachrichten aus einer Oberfläche moderieren.')),
        h('div', { class: 'listener-hero-actions' },
          h('span', { class: 'listener-count' }, `${d.unread} neu`),
          h('button', { class: 'btn small', onclick: () => settings(c) }, 'Einstellungen'))),
      !any ? card('Hörerbereich ist aus', h('p', {}, 'Hörer können Musik wünschen, grüßen, abstimmen und Sprachnachrichten schicken – sobald du es unter „Einstellungen“ einschaltest. Alles läuft über AnMaCha Cast, mit Schutz vor Missbrauch.')) : null,
      any ? card('Hörerseite', h('p', { class: 'muted' }, 'Link für Hörer (auch auf deiner Webseite einbettbar):'),
        h('div', { class: 'row' }, h('code', {}, link), h('button', { class: 'btn small', onclick: () => navigator.clipboard?.writeText(link).then(() => status('Link kopiert')) }, 'Kopieren'),
          h('button', { class: 'btn small', onclick: () => navigator.clipboard?.writeText(`<iframe src="${link}" style="width:100%;height:640px;border:0" allow="microphone" title="Hörerbereich"></iframe>`).then(() => status('Einbettungs-Code kopiert')) }, 'Einbetten'))) : null,
      card('Posteingang',
        ...(d.items.length ? d.items.map((/** @type {any} */ it) => h('div', { class: `inbox-item${it.status === 'new' ? ' new' : ''}` },
          h('div', { class: 'row' }, h('strong', {}, KIND[it.kind] ?? it.kind), h('span', { class: 'muted' }, ` · ${time(it.at)}${it.name ? ` · ${it.name}` : ''}${it.source === 'mail' ? ' · ✉ Studiomail' : ''}${it.email ? ` · ${it.email}` : ''}`)),
          it.title ? h('div', {}, it.title) : null,
          it.text ? h('div', { class: 'muted' }, `„${it.text}“`) : null,
          ...(it.replies ?? []).map((/** @type {any} */ r) => h('div', { class: 'muted small' }, `↩ Antwort ${time(r.at)}: „${r.text.length > 140 ? `${r.text.slice(0, 140)} …` : r.text}“`)),
          it.kind === 'voice' ? h('audio', { controls: true, preload: 'none', src: `${ctx.api.base}/api/v1${ctx.url(`/inbox/${encodeURIComponent(it.id)}/audio`)}?token=${encodeURIComponent(ctx.api.token)}`, style: 'width:100%' }) : null,
          h('div', { class: 'row' },
            it.wishId ? h('button', { class: 'btn small primary', title: 'Wunsch an die laut Sendeplan laufende laut.fm-Playlist hängen (wird nach dem Abspielen wieder entfernt)', onclick: () => act(it, 'queue') }, 'Jetzt bei laut.fm einreihen')
              : it.kind !== 'message' ? h('button', { class: 'btn small primary', onclick: () => act(it, 'queue') }, it.kind === 'voice' ? 'In Bibliothek + Queue' : 'In die Queue') : null,
            d.lautfm && (it.kind === 'message' || it.kind === 'voice') ? h('button', { class: 'btn small', title: 'Automation: in die laufende laut.fm-Playlist · Live über AnMaCha Cast: als Nächstes in die Warteschlange · Live mit anderer Software: in die Mediathek (Ordner „Hörer“) und Text zum Vorlesen', onclick: () => run(async () => {
              const r = await ctx.api.post(ctx.url(`/inbox/${encodeURIComponent(it.id)}/air`));
              status(r.air?.skipped ?? (r.air?.mode === 'automation' ? `„${r.air?.title}“ wird erzeugt und bei laut.fm eingereiht` : `${r.air?.note}${r.air?.text ? ` Zum Vorlesen: „${r.air.text}“` : ''}`), !!r.air?.skipped);
              show();
            }) }, it.kind === 'message' ? '🎙 Gruß senden' : '📻 Auf Sendung') : null,
            it.email ? h('button', { class: 'btn small', title: `Per Mail an ${it.email} antworten (Studiomail)`, onclick: () => reply(it) }, '✉ Antworten') : null,
            it.status === 'new' ? h('button', { class: 'btn small', onclick: () => act(it, 'done') }, 'Erledigt') : null,
            h('button', { class: 'btn small danger', onclick: () => act(it, 'delete') }, 'Löschen'))))
          : [h('div', { class: 'empty' }, 'Noch nichts eingegangen.')])),
      mailCard(),
      pollsCard(c, d.polls ?? []),
      formsCard(c, d.forms ?? []),
      drawCard(d.draws ?? [], d.forms ?? [], d.items ?? []),
      c.voting ? card('Hörer-Charts (Voting)', ...(d.charts.length ? [h('ol', {}, ...d.charts.map((/** @type {any} */ t) => h('li', {}, `${t.artist ? `${t.artist} – ` : ''}${t.title} · ${t.score > 0 ? '+' : ''}${t.score} (${t.up}👍 ${t.down}👎)`)))] : [h('div', { class: 'empty' }, 'Noch keine Stimmen.')])) : null,
    ].filter((n) => n !== null));
  }

  /** Hörerseite auf dem Server, der die API liefert (in der App/mit Fernserver ist das nicht die eigene Adresse) */
  const base = () => `${ctx.api.base || location.origin + location.pathname.replace(/[^/]*$/, '').replace(/\/$/, '')}/hoerer.html?s=${encodeURIComponent(ctx.stationId())}`;
  const csv = (/** @type {string} */ path, /** @type {string} */ name) => run(async () => { const b = await ctx.api.blob(ctx.url(path)); if (b) download(b, name); });

  /** Umfragen: eine aktiv, Ergebnisse als Balken, CSV, Widget-Link. @param {any} c @param {any[]} polls */
  function pollsCard(c, polls) {
    const bar = (/** @type {any} */ p) => {
      const total = p.results.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0);
      return h('div', { class: 'poll-res' }, ...p.options.map((/** @type {string} */ o, /** @type {number} */ i) => {
        const pct = total ? Math.round((p.results[i] / total) * 100) : 0;
        return h('div', { class: 'poll-row' }, h('span', { class: 'poll-lbl' }, o), h('span', { class: 'poll-bar' }, h('i', { style: `width:${pct}%` })), h('span', { class: 'num muted' }, `${p.results[i]} · ${pct} %`));
      }), h('div', { class: 'muted small' }, `${total} Stimme${total === 1 ? '' : 'n'} · ${p.active ? 'läuft' : `beendet ${p.closedAt ? time(p.closedAt) : ''}`}`));
    };
    return card('Umfragen',
      h('p', { class: 'muted small', style: 'margin:0 0 8px' }, c.polls ? `Aktive Umfrage auf der Hörerseite und als Widget: ${base()}&only=polls` : 'Unter „Einstellungen“ einschalten, damit Hörer abstimmen können. Anlegen geht schon jetzt.'),
      h('div', { class: 'row', style: 'margin-bottom:8px' }, h('button', { class: 'btn small primary', onclick: () => editPoll(null) }, '＋ Umfrage')),
      ...(polls.length ? polls.map((p) => h('div', { class: `poll-item${p.active ? ' active' : ''}` },
        h('div', { class: 'row' }, h('strong', {}, p.question), p.active ? h('span', { class: 'tag' }, 'AKTIV') : null),
        bar(p),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => run(async () => { await ctx.api.patch(ctx.url(`/polls/${p.id}`), { active: !p.active }); show(); }) }, p.active ? 'Beenden' : 'Aktivieren'),
          h('button', { class: 'btn small', onclick: () => editPoll(p) }, 'Bearbeiten'),
          h('button', { class: 'btn small', onclick: () => csv(`/polls/${p.id}/csv`, `umfrage-${p.id}.csv`) }, '⬇ CSV'),
          h('button', { class: 'btn small danger', onclick: () => confirm(`Umfrage „${p.question}“ samt Ergebnis löschen?`) && run(async () => { await ctx.api.del(ctx.url(`/polls/${p.id}`)); show(); }) }, 'Löschen'))))
        : [h('div', { class: 'empty' }, 'Noch keine Umfrage.')]));
  }

  /** @param {any} p */
  async function editPoll(p) {
    const v = await formDialog(p ? 'Umfrage bearbeiten' : 'Neue Umfrage', [
      { name: 'question', label: 'Frage', value: p?.question ?? '', required: true },
      { name: 'options', label: 'Antworten (eine je Zeile, 2–10)', type: 'textarea', value: (p?.options ?? []).join('\n'), required: true, hint: p?.votes ? 'Mit Stimmen lässt sich die Anzahl nicht mehr ändern' : '' },
      { name: 'active', label: 'Sofort aktiv (beendet eine laufende Umfrage)', type: 'checkbox', value: p ? p.active : true },
    ], 'Speichern');
    if (!v) return;
    const body = { question: v.question, options: String(v.options).split('\n').map((/** @type {string} */ s) => s.trim()).filter(Boolean), active: v.active };
    await run(() => (p ? ctx.api.patch(ctx.url(`/polls/${p.id}`), body) : ctx.api.post(ctx.url('/polls'), body)));
    show();
  }

  /** Formulare: Felder, Einträge, CSV. @param {any} c @param {any[]} forms */
  function formsCard(c, forms) {
    return card('Formulare',
      h('p', { class: 'muted small', style: 'margin:0 0 8px' }, c.forms ? `Gewinnspiel, Anmeldung, Feedback - auf der Hörerseite und als Widget: ${base()}&only=forms&form=<id>` : 'Unter „Einstellungen“ einschalten, damit Hörer Formulare sehen.'),
      h('div', { class: 'row', style: 'margin-bottom:8px' }, h('button', { class: 'btn small primary', onclick: () => editForm(null) }, '＋ Formular')),
      ...(forms.length ? forms.map((f) => h('div', { class: 'poll-item' },
        h('div', { class: 'row' }, h('strong', {}, f.title), f.active ? h('span', { class: 'tag' }, 'OFFEN') : h('span', { class: 'muted small' }, 'geschlossen'), h('span', { class: 'muted small' }, `· ${f.fields.length} Felder · ${f.entries} Einträge`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => showEntries(f) }, `Einträge (${f.entries})`),
          h('button', { class: 'btn small', onclick: () => run(async () => { await ctx.api.patch(ctx.url(`/forms/${f.id}`), { active: !f.active }); show(); }) }, f.active ? 'Schließen' : 'Öffnen'),
          h('button', { class: 'btn small', onclick: () => editForm(f) }, 'Bearbeiten'),
          h('button', { class: 'btn small', onclick: () => csv(`/forms/${f.id}/entries/csv`, `formular-${f.id}.csv`) }, '⬇ CSV'),
          h('button', { class: 'btn small danger', onclick: () => confirm(`Formular „${f.title}“ samt Einträgen löschen?`) && run(async () => { await ctx.api.del(ctx.url(`/forms/${f.id}`)); show(); }) }, 'Löschen'))))
        : [h('div', { class: 'empty' }, 'Noch kein Formular.')]));
  }

  /** Felder als Textzeilen: Label | text|textarea|select|email | pflicht | Option1;Option2 */
  const fieldsToText = (/** @type {any[]} */ fields) => fields.map((f) => {
    const cols = [f.label, f.type, f.required ? 'pflicht' : '', (f.options ?? []).join(';')];
    while (cols.length > 2 && !cols[cols.length - 1]) cols.pop(); // nur leere Spalten am Ende weglassen, Spaltenlage bleibt
    return cols.join(' | ');
  }).join('\n');
  const textToFields = (/** @type {string} */ text) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [label, type = 'text', req = '', opts = ''] = l.split('|').map((x) => x.trim());
    return { label, type, required: /^(pflicht|ja|x|\*|required)$/i.test(req), options: opts ? opts.split(';').map((o) => o.trim()).filter(Boolean) : undefined };
  });

  /** @param {any} f */
  async function editForm(f) {
    const v = await formDialog(f ? 'Formular bearbeiten' : 'Neues Formular', [
      { name: 'title', label: 'Titel', value: f?.title ?? '', required: true },
      { name: 'description', label: 'Beschreibung', value: f?.description ?? '' },
      { name: 'fields', label: 'Felder (eine je Zeile)', type: 'textarea', value: f ? fieldsToText(f.fields) : 'Name | text | pflicht\nE-Mail | email | pflicht\nWohnort | text\nLieblingsgenre | select | | Pop;Rock;Schlager\nNachricht | textarea', required: true, hint: 'Label | text/textarea/select/email | pflicht | Option1;Option2' },
      { name: 'thanks', label: 'Danke-Text nach dem Absenden', value: f?.thanks ?? 'Danke, dein Eintrag ist angekommen!' },
      { name: 'active', label: 'Offen (Hörer können einsenden)', type: 'checkbox', value: f ? f.active : true },
    ], 'Speichern', { wide: true });
    if (!v) return;
    const body = { title: v.title, description: v.description, fields: textToFields(String(v.fields)), thanks: v.thanks, active: v.active };
    await run(() => (f ? ctx.api.patch(ctx.url(`/forms/${f.id}`), body) : ctx.api.post(ctx.url('/forms'), body)));
    show();
  }

  /** @param {any} f */
  async function showEntries(f) {
    const rows = /** @type {any[]} */ (await run(() => ctx.api.get(ctx.url(`/forms/${f.id}/entries`)))) ?? [];
    const dlg = /** @type {HTMLDialogElement} */ (document.getElementById('dialog'));
    const form = /** @type {HTMLFormElement} */ (document.getElementById('dialog-form'));
    form.onsubmit = null;
    const tbody = h('tbody', {});
    const draw = (/** @type {any[]} */ list) => tbody.replaceChildren(...(list.length ? list.map((e) => h('tr', {}, h('td', { class: 'num muted' }, time(e.at)), ...f.fields.map((/** @type {any} */ fld) => h('td', {}, e.values[fld.key] ?? '')),
      h('td', { class: 'act' }, h('button', { class: 'btn small danger', type: 'button', onclick: () => run(async () => { await ctx.api.del(ctx.url(`/form-entries/${e.id}`)); const i = list.indexOf(e); list.splice(i, 1); draw(list); }) }, '✕'))))
      : [h('tr', {}, h('td', { colspan: f.fields.length + 2, class: 'muted' }, 'Noch keine Einträge.'))]));
    draw(rows);
    form.replaceChildren(h('div', { class: 'fd-head' }, h('h3', {}, `Einträge: ${f.title}`)),
      h('div', { class: 'table-wrap', style: 'max-height:60vh;overflow:auto' }, h('table', { class: 'list' }, h('thead', {}, h('tr', {}, h('th', {}, 'Zeit'), ...f.fields.map((/** @type {any} */ fld) => h('th', {}, fld.label)), h('th', {}))), tbody)),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => csv(`/forms/${f.id}/entries/csv`, `formular-${f.id}.csv`) }, '⬇ CSV'), h('button', { class: 'btn primary', value: 'ok' }, 'Schließen')));
    dlg.classList.add('wide');
    dlg.showModal();
    dlg.onclose = () => { dlg.classList.remove('wide'); show(); };
  }

  /** Auslosung: Teilnehmer je Zeile, Modus, Gewinner groß, Protokoll mit CSV. @param {any[]} draws @param {any[]} forms @param {any[]} inbox */
  function drawCard(draws, forms, inbox) {
    const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', { rows: 8, placeholder: 'Ein Teilnehmer je Zeile …', oninput: () => { drawState.text = ta.value; } }, drawState.text));
    const names = () => { const seen = new Set(); return ta.value.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && (!drawState.unique || !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))); };
    const count = h('span', { class: 'muted small' }, `${names().length} Teilnehmer`);
    ta.addEventListener('input', () => { count.textContent = `${names().length} Teilnehmer`; });
    const winner = h('div', { class: 'draw-winner' }, lastDraw ? h('b', {}, lastDraw.winners.join(' · ')) : h('span', { class: 'muted' }, 'Noch nicht gezogen'));
    const MODES = /** @type {[string,string][]} */ ([['normal', 'Normal (ein Gewinner)'], ['multi', 'Multi (mehrere Gewinner)'], ['elim', 'Elimination (der Letzte gewinnt)']]);
    const countIn = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: 1, max: 100, value: String(drawState.count), style: 'width:70px', oninput: () => { drawState.count = Number(countIn.value) || 3; } }));
    const modeSel = /** @type {HTMLSelectElement} */ (h('select', { onchange: () => { drawState.mode = modeSel.value; countIn.disabled = drawState.mode !== 'multi'; } }, ...MODES.map(([v, l]) => h('option', { value: v, selected: v === drawState.mode }, l))));
    countIn.disabled = drawState.mode !== 'multi';
    const labelIn = /** @type {HTMLInputElement} */ (h('input', { placeholder: 'Bezeichnung (z. B. Konzertkarten)', value: drawState.label, oninput: () => { drawState.label = labelIn.value; } }));
    const importFrom = async () => {
      const opts = /** @type {[string,string][]} */ ([['inbox', `Posteingang (Namen aus Wünschen & Grüßen: ${new Set(inbox.map((i) => i.name).filter(Boolean)).size})`], ...forms.map((f) => /** @type {[string,string]} */ ([`form:${f.id}`, `Formular „${f.title}“ (${f.entries} Einträge)`]))]);
      const v = await formDialog('Teilnehmer übernehmen', [{ name: 'src', label: 'Quelle', value: opts[0]?.[0] ?? '', options: opts }, { name: 'add', label: 'An vorhandene Liste anhängen', type: 'checkbox', value: false }], 'Übernehmen');
      if (!v) return;
      let list = [];
      if (v.src === 'inbox') list = inbox.map((i) => i.name).filter(Boolean);
      else { const f = forms.find((x) => `form:${x.id}` === v.src); const rows = /** @type {any[]} */ (await ctx.api.get(ctx.url(`/forms/${f.id}/entries`))); const key = (f.fields.find((/** @type {any} */ x) => /name/i.test(x.label)) ?? f.fields[0]).key; list = rows.map((r) => r.values[key]).filter(Boolean); }
      ta.value = (v.add && ta.value.trim() ? ta.value.trim() + '\n' : '') + list.join('\n');
      ta.dispatchEvent(new Event('input'));
    };
    const doDraw = () => run(async () => {
      const r = await ctx.api.post(ctx.url('/draw'), { names: names(), mode: drawState.mode, count: drawState.count, label: drawState.label });
      lastDraw = r;
      // kleine Trommel: Namen durchlaufen lassen, dann Gewinner
      const pool = names();
      for (let i = 0; i < 14; i++) { winner.replaceChildren(h('span', { class: 'muted' }, pool[Math.floor(Math.random() * pool.length)] ?? '')); await new Promise((res) => setTimeout(res, 60 + i * 20)); }
      winner.replaceChildren(h('b', {}, r.winners.join(' · ')), h('div', { class: 'muted small' }, r.mode === 'elim' ? `Last one standing - ${r.pool} Teilnehmer` : `${r.winners.length} von ${r.pool} gezogen`));
      if (r.mode === 'elim') { ta.value = r.winners.join('\n'); } else if (r.mode === 'multi' || confirm('Gewinner aus der Liste entfernen (für die nächste Runde)?')) { ta.value = r.remaining.join('\n'); }
      ta.dispatchEvent(new Event('input'));
      status(`Gezogen: ${r.winners.join(', ')}`);
      log.replaceChildren(...logRows(await ctx.api.get(ctx.url('/draws'))));
    });
    const logRows = (/** @type {any[]} */ list) => (list.length ? list.slice(0, 50).map((d, i) => h('div', { class: 'kv' }, h('span', {}, h('b', {}, d.winners.join(', ')), h('span', { class: 'muted small' }, ` · ${({ normal: 'Normal', multi: 'Multi', elim: 'Elimination' })[d.mode] ?? d.mode}${d.label ? ` · ${d.label}` : ''} · ${d.pool} Teilnehmer`)), h('span', { class: 'muted small' }, `#${list.length - i} · ${time(d.at)}`)))
      : [h('div', { class: 'empty' }, 'Noch keine Ziehung.')]);
    const log = h('div', {}, ...logRows(draws));
    return card('Auslosung',
      h('div', { class: 'draw-grid' },
        h('div', {}, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:4px' }, h('b', { class: 'small' }, 'Teilnehmer (eine je Zeile)'), count), ta,
          h('div', { class: 'row', style: 'margin-top:6px;flex-wrap:wrap' },
            h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: drawState.unique, onchange: (/** @type {Event} */ e) => { drawState.unique = /** @type {HTMLInputElement} */ (e.target).checked; ta.dispatchEvent(new Event('input')); } }), 'Dubletten entfernen'),
            h('button', { class: 'btn small', onclick: importFrom }, '⇩ Aus Formular / Posteingang'))),
        h('div', {}, h('div', { class: 'row', style: 'flex-wrap:wrap' }, modeSel, countIn, labelIn),
          h('button', { class: 'btn primary', style: 'margin:10px 0', onclick: doDraw }, '🎲 Ziehen'),
          winner,
          h('div', { class: 'row', style: 'margin-top:10px;justify-content:space-between' }, h('b', {}, 'Gewinner-Protokoll'), h('span', { class: 'row' },
            h('button', { class: 'btn small', onclick: () => csv('/draws/csv', `auslosung-${ctx.stationId()}.csv`) }, '⬇ CSV'),
            h('button', { class: 'btn small danger', onclick: () => confirm('Protokoll leeren?') && run(async () => { await ctx.api.del(ctx.url('/draws')); show(); }) }, 'Leeren'))),
          log)));
  }

  /** @param {any} c */
  /** Auf einen Eintrag per Mail antworten @param {any} it */
  async function reply(it) {
    const v = await formDialog(`Antwort an ${it.name || it.email}`, [
      { name: 'info', label: 'Nachricht', type: 'info', value: it.text ?? '' },
      { name: 'text', label: 'Deine Antwort', type: 'textarea', value: '' },
    ], 'Senden', { subtitle: `geht per Studiomail an ${it.email}` });
    if (!v) return;
    await run(async () => { await ctx.api.post(ctx.url(`/inbox/${encodeURIComponent(it.id)}/reply`), { text: v.text }); status(`Antwort an ${it.email} gesendet`); show(); });
  }

  /** Studiomail: eigenes Postfach als Quelle und zum Antworten */
  function mailCard() {
    const box = h('div', {}, h('p', { class: 'muted' }, 'Lädt …'));
    ctx.api.get(ctx.url('/studiomail')).then((/** @type {any} */ m) => {
      box.replaceChildren(
        h('p', { class: 'muted' }, 'Verbinde dein eigenes Postfach (IMAP/SMTP): Neue Mails an die Studio-Adresse landen hier im Posteingang – mit Audio-Anhang als Sprachnachricht – und lassen sich wie alle Hörerpost auf Sendung bringen. Auf Hörerpost mit Mail-Adresse antwortest du direkt von hier.'),
        h('div', { class: 'kv' }, h('span', {}, m.enabled ? `✉ ${m.address} – verbunden` : 'Nicht eingerichtet'),
          h('span', { class: 'muted small' }, m.lastCheck ? `zuletzt geprüft ${time(m.lastCheck)}${m.lastError ? ` · ⚠ ${m.lastError}` : ` · ${m.lastCount ?? 0} neu`}` : '')),
        h('div', { class: 'row' },
          h('button', { class: 'btn small primary', onclick: () => mailSettings(m) }, m.enabled ? 'Einstellungen' : 'Postfach verbinden'),
          m.enabled ? h('button', { class: 'btn small', onclick: () => run(async () => { const r = await ctx.api.post(ctx.url('/studiomail/check')); status(`${r.received} neue Mail(s) abgeholt`); show(); }) }, 'Jetzt abholen') : null));
    }).catch((e) => box.replaceChildren(h('p', { class: 'muted' }, String(e?.message ?? e))));
    return card('Studiomail (eigenes Postfach)', box);
  }

  /** @param {any} m */
  async function mailSettings(m) {
    const presets = /** @type {Record<string, any>} */ (m.presets);
    const pre = await formDialog('Mail-Anbieter', [
      { name: 'preset', label: 'Anbieter', type: 'select', value: '', options: [['', 'Eigener Server / Webspace (selbst eintragen)'], ...Object.entries(presets).map(([k, p]) => /** @type {[string, string]} */ ([k, p.name]))] },
    ], 'Weiter', { subtitle: 'Server und Ports werden ausgefüllt – anpassen kannst du sie danach.' });
    if (!pre) return;
    const p = presets[pre.preset];
    const v = await formDialog('Studiomail einrichten', [
      ...(p?.note ? [{ name: 'note', label: 'Hinweis', type: 'info', value: p.note }] : []),
      { name: 'enabled', label: 'Studiomail aktiv (alle 2 Minuten neue Post abholen)', type: 'checkbox', value: m.enabled || !!p },
      { name: 'address', label: 'Studio-Adresse (Absender der Antworten)', value: m.address, hint: 'z. B. studio@mein-radio.de' },
      { name: 'name', label: 'Angezeigter Name', value: m.name },
      { name: 'user', label: 'Benutzername (meist die Adresse)', value: m.user },
      { name: 'password', label: m.hasPassword ? 'Passwort (leer = unverändert)' : 'Passwort (ggf. App-Passwort)', type: 'password', value: '' },
      { name: 'imapHost', label: 'Posteingang (IMAP-Server)', value: p ? p.imap[0] : m.imapHost },
      { name: 'imapPort', label: 'IMAP-Port', type: 'number', value: p ? p.imap[1] : m.imapPort },
      { name: 'imapSecure', label: 'IMAP mit SSL/TLS (sonst STARTTLS)', type: 'checkbox', value: p ? p.imap[2] : m.imapSecure },
      { name: 'smtpHost', label: 'Postausgang (SMTP-Server)', value: p ? p.smtp[0] : m.smtpHost },
      { name: 'smtpPort', label: 'SMTP-Port', type: 'number', value: p ? p.smtp[1] : m.smtpPort },
      { name: 'smtpSecure', label: 'SMTP mit SSL/TLS (sonst STARTTLS)', type: 'checkbox', value: p ? p.smtp[2] : m.smtpSecure },
      { name: 'folder', label: 'Ordner', value: m.folder || 'INBOX' },
      { name: 'signature', label: 'Signatur unter Antworten', type: 'textarea', value: m.signature },
    ], 'Verbinden & speichern', { subtitle: 'Die Verbindung wird beim Speichern geprüft. Übernommen wird nur Post, die ab jetzt eingeht.' });
    if (!v) return;
    if (!v.password) delete v.password;
    await run(async () => { await ctx.api.put(ctx.url('/studiomail'), v); status(v.enabled ? 'Studiomail verbunden' : 'Studiomail gespeichert (aus)'); show(); });
  }

  async function settings(c) {
    const v = await formDialog('Hörerbereich', [
      { name: 'info', label: 'Schutz', type: 'info', value: 'Begrenzt je Absender (z. B. 3 Wünsche in 10 Minuten, 1 Stimme je Titel in 12 Stunden). IP-Adressen werden nicht gespeichert. Nur reiner Text.' },
      { name: 'requests', label: 'Musikwunsch (Suche in der Musikbibliothek)', type: 'checkbox', value: c.requests },
      { name: 'messages', label: 'Grüße & Nachrichten (Wunschbox)', type: 'checkbox', value: c.messages },
      { name: 'voting', label: 'Song-Voting mit Hörer-Charts', type: 'checkbox', value: c.voting },
      { name: 'voice', label: 'Sprachnachricht ans Studio (bis 2 Minuten)', type: 'checkbox', value: c.voice },
      { name: 'polls', label: 'Hörer-Umfragen (eine Stimme je Teilnehmer)', type: 'checkbox', value: !!c.polls },
      { name: 'forms', label: 'Formulare (Gewinnspiel, Anmeldung, Feedback)', type: 'checkbox', value: !!c.forms },
      { name: 'welcome', label: 'Begrüßung auf der Hörerseite', value: c.welcome ?? '' },
    ]);
    if (!v) return;
    await run(() => ctx.api.put(ctx.url('/listener'), v));
    show();
  }

  /** Nur den Zähler für die Navigation aktualisieren (ohne Ansicht aufzubauen). */
  const unread = () => ctx.api.get(ctx.url('/inbox')).then((d) => ctx.onUnread(d.unread)).catch(() => {});
  unread();

  return {
    show,
    /** @param {string} type @param {any} data */
    onEvent(type, data) {
      if (type === 'community.changed' && !root.hidden) { show(); return; }
      if (type === 'inbox.new') {
        status(`Hörer: ${KIND[data.kind] ?? data.kind}${data.name ? ` von ${data.name}` : ''}`);
        if (!root.hidden) show();
        else unread();
      }
    },
  };
}

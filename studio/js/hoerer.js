// @ts-check
// Öffentlicher Hörerbereich: Musikwunsch, Grüße, Song-Voting, Sprachnachricht ans Studio.
// Aufruf: hoerer.html?s=<sender> – auch auf der Senderseite einbettbar (iframe).
(() => {
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  /** @param {string} tag @param {Record<string, any>} [attrs] @param {...(Node|string|null|undefined|false)} kids */
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') /** @type {any} */ (el).value = v;
      else el.setAttribute(k, String(v));
    }
    for (const c of kids) if (c != null && c !== false) el.append(c);
    return el;
  };
  // Einstellungen aus der Adresse (?s=…&only=…&theme=light&accent=ff4081&api=https://…) oder – bei der Datei für den
  // eigenen Webspace – aus window.ANMACHA_CAST (api = Adresse des AnMaCha-Cast-Servers, dessen öffentliche API genutzt wird)
  const cfg = /** @type {any} */ (window).ANMACHA_CAST ?? {};
  const qs = new URLSearchParams(location.search);
  const opt = (/** @type {string} */ k) => cfg[k] ?? qs.get(k);
  const sid = opt('s') ?? opt('station') ?? 'main';
  const api = String(opt('api') ?? '').replace(/\/+$/, '');
  const abs = (/** @type {string} */ p) => (api && !/^https?:/.test(p) ? `${api}/${p.replace(/^\/+/, '')}` : p);
  const base = abs(`api/v1/public/stations/${encodeURIComponent(sid)}/listener`);
  if (opt('theme') === 'light') document.documentElement.classList.add('light');
  const accent = String(opt('accent') ?? '').replace(/[^0-9a-f]/gi, '');
  if (accent.length === 6 || accent.length === 3) document.documentElement.style.setProperty('--accent', `#${accent}`);
  if (api) /** @type {HTMLImageElement} */ (document.getElementById('logo')).src = abs('icons/icon-192.png');
  /** @type {any} */ let info = null;

  /** @param {string} path @param {any} [body] */
  async function call(path, body) {
    const r = await fetch(`${base}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message ?? `Fehler ${r.status}`);
    return d;
  }

  /** @param {HTMLElement} box @param {string} text @param {boolean} ok */
  const say = (box, text, ok) => box.replaceChildren(h('div', { class: `msg ${ok ? 'ok' : 'bad'}`, role: 'status' }, text));

  /** Suchfeld mit Ergebnisliste; onPick(Titel) bzw. eigene Zeilen-Aktionen */
  function searchBox(/** @type {(t: any, li: HTMLElement) => (Node|null)[]} */ row) {
    const list = h('ul', { class: 'list' });
    let timer = 0;
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'search', placeholder: 'Interpret oder Titel suchen …', autocomplete: 'off', oninput: () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) return list.replaceChildren();
        try {
          const res = await call(`/search?q=${encodeURIComponent(q)}`);
          list.replaceChildren(...(res.length ? res.map((/** @type {any} */ t) => { const li = h('li'); li.append(h('span', {}, t.artist ? `${t.artist} – ${t.title}` : t.title), ...row(t, li).filter(Boolean)); return li; }) : [h('li', { class: 'muted' }, 'Nichts gefunden')]));
        } catch (e) {
          list.replaceChildren(h('li', { class: 'muted' }, /** @type {Error} */ (e).message));
        }
      }, 250);
    } }));
    return { input, list };
  }

  function requestView() {
    /** @type {any} */ let picked = null;
    const out = h('div');
    const name = h('input', { maxlength: 40, placeholder: 'optional' });
    const text = h('textarea', { maxlength: 300, placeholder: 'Gruß oder Anlass (optional)' });
    const s = searchBox((t, li) => [h('button', { class: 'btn ghost', style: 'margin:0', onclick: () => {
      picked = t;
      for (const x of s.list.children) x.classList.remove('sel');
      li.classList.add('sel');
      send.disabled = false;
    } }, 'Wählen')]);
    const send = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn', disabled: true, onclick: async () => {
      try {
        const r = await call('/request', { mediaId: picked.id, name: /** @type {HTMLInputElement} */ (name).value, text: /** @type {HTMLTextAreaElement} */ (text).value });
        say(out, r.message ?? `Danke! Dein Wunsch „${picked.title}“ ist im Studio angekommen.`, true);
        send.disabled = true;
        if (info.lautfm) loadWishes();
      } catch (e) { say(out, /** @type {Error} */ (e).message, false); }
    } }, 'Wunsch senden'));
    const form = h('div', { class: 'card' }, h('strong', {}, 'Musikwunsch'), info.live ? h('div', { class: 'msg ok' }, '🔴 Gerade läuft eine Live-Sendung – Wünsche, Grüße und Sprachnachrichten gehen direkt ins Studio.') : null, h('div', { class: 'muted' }, info.lautfm ? 'Such dir einen Titel aus dem ganzen Musikpool aus.' : 'Such dir einen Titel aus dem Programm aus.'),
      h('label', {}, 'Titel'), s.input, s.list, h('label', {}, 'Dein Name'), name, h('label', {}, 'Nachricht'), text, send, out);
    if (!info.lautfm) return form;
    // laut.fm: Wunschliste – für Wünsche anderer Hörer abstimmen (mehr Stimmen = früher in der Wunschstunde)
    const when = h('div', { class: 'muted' });
    const list = h('ul', { class: 'list' });
    const vout = h('div');
    loadWishes = async () => {
      try {
        const d = await call('/wishes');
        when.textContent = d.next ? `Nächste Wunschstunde: ${new Date(d.next.start).toLocaleString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr${d.anytime ? ' · Wünsche laufen auch zwischendurch' : ''}` : d.anytime ? 'Wünsche laufen in Kürze im Programm.' : '';
        list.replaceChildren(...(d.wishes.length ? d.wishes.map((/** @type {any} */ w) => h('li', {}, h('span', {}, `${w.artist ? `${w.artist} – ` : ''}${w.title}${w.nick ? ` · ${w.nick}` : ''}`),
          h('span', { class: 'pill', style: 'flex:none' }, w.status === 'queued' ? 'eingeplant' : `${w.votes} 👍`),
          w.status === 'open' ? h('button', { class: 'btn ghost', style: 'margin:0', title: 'Diesen Wunsch unterstützen', onclick: async () => {
            try { await call('/wish/vote', { id: w.id }); say(vout, `Danke für deine Stimme für „${w.title}“!`, true); loadWishes(); } catch (e) { say(vout, /** @type {Error} */ (e).message, false); }
          } }, '👍') : null)) : [h('li', { class: 'muted' }, 'Noch keine Wünsche – sei die oder der Erste!')]));
      } catch { /* Wunschliste optional */ }
    };
    loadWishes();
    return h('div', {}, form, h('div', { class: 'card' }, h('strong', {}, 'Wunschliste'), when, list, vout));
  }
  /** Wunschliste neu laden (nur bei laut.fm-Wünschen) */
  let loadWishes = async () => {};

  function messageView() {
    const out = h('div');
    const name = h('input', { maxlength: 40, placeholder: 'optional' });
    const text = h('textarea', { maxlength: 500, placeholder: 'Was möchtest du loswerden?' });
    const email = h('input', { type: 'email', maxlength: 200, placeholder: 'optional – nur, wenn das Studio dir antworten soll' });
    return h('div', { class: 'card' }, h('strong', {}, 'Grüße & Nachrichten'), h('label', {}, 'Dein Name'), name, h('label', {}, 'Nachricht'), text, h('label', {}, 'Deine E-Mail (für eine Antwort)'), email,
      h('button', { class: 'btn', onclick: async () => {
        try {
          await call('/message', { name: /** @type {HTMLInputElement} */ (name).value, text: /** @type {HTMLTextAreaElement} */ (text).value, email: /** @type {HTMLInputElement} */ (email).value });
          say(out, 'Danke, deine Nachricht ist im Studio angekommen!', true);
          /** @type {HTMLTextAreaElement} */ (text).value = '';
        } catch (e) { say(out, /** @type {Error} */ (e).message, false); }
      } }, 'Senden'), out);
  }

  function votingView() {
    const out = h('div');
    const charts = h('ol');
    const load = async () => {
      try {
        const c = await call('/charts');
        charts.replaceChildren(...(c.length ? c.map((/** @type {any} */ t) => h('li', {}, `${t.artist ? `${t.artist} – ` : ''}${t.title} `, h('span', { class: 'pill' }, `${t.score > 0 ? '+' : ''}${t.score}`))) : [h('li', { class: 'muted' }, 'Noch keine Stimmen')]));
      } catch { /* Charts optional */ }
    };
    const vote = async (/** @type {any} */ t, /** @type {boolean} */ up) => {
      try {
        await call('/vote', { mediaId: t.id, up });
        say(out, `Danke für deine Stimme für „${t.title}“!`, true);
        load();
      } catch (e) { say(out, /** @type {Error} */ (e).message, false); }
    };
    const s = searchBox((t) => [h('button', { class: 'btn ghost', style: 'margin:0', title: 'Gefällt mir', onclick: () => vote(t, true) }, '👍'), h('button', { class: 'btn ghost', style: 'margin:0', title: 'Gefällt mir nicht', onclick: () => vote(t, false) }, '👎')]);
    load();
    return h('div', {}, h('div', { class: 'card' }, h('strong', {}, 'Song-Voting'), h('label', {}, 'Titel suchen und abstimmen'), s.input, s.list, out),
      h('div', { class: 'card' }, h('strong', {}, 'Hörer-Charts'), charts));
  }

  function voiceView() {
    const out = h('div');
    const name = h('input', { maxlength: 40, placeholder: 'optional' });
    const text = h('input', { maxlength: 300, placeholder: 'z. B. Musikwunsch dazu (optional)' });
    const email = h('input', { type: 'email', maxlength: 200, placeholder: 'optional – nur, wenn das Studio dir antworten soll' });
    const state = h('span', { class: 'muted' }, 'Bis zu 2 Minuten');
    const player = /** @type {HTMLAudioElement} */ (h('audio', { controls: true, hidden: true, style: 'width:100%;margin-top:10px' }));
    /** @type {MediaRecorder|null} */ let rec = null;
    /** @type {Blob|null} */ let blob = null;
    /** @type {number} */ let stopTimer = 0;
    const recBtn = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn', onclick: async () => {
      if (rec) return rec.stop();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
        rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64000 } : undefined);
        /** @type {Blob[]} */ const parts = [];
        rec.ondataavailable = (e) => parts.push(e.data);
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          clearTimeout(stopTimer);
          blob = new Blob(parts, { type: rec?.mimeType || 'audio/webm' });
          rec = null;
          player.src = URL.createObjectURL(blob);
          player.hidden = false;
          state.replaceChildren('Aufnahme fertig – anhören und senden');
          recBtn.textContent = 'Neu aufnehmen';
          send.disabled = false;
        };
        rec.start();
        stopTimer = window.setTimeout(() => rec?.stop(), 120_000);
        state.replaceChildren(h('span', { class: 'dot' }), ' Aufnahme läuft …');
        recBtn.textContent = 'Stopp';
        send.disabled = true;
      } catch {
        say(out, 'Kein Zugriff auf das Mikrofon – bitte im Browser erlauben.', false);
      }
    } }, 'Aufnahme starten'));
    const send = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn', disabled: true, onclick: async () => {
      if (!blob) return;
      send.disabled = true;
      try {
        const q = new URLSearchParams({ name: /** @type {HTMLInputElement} */ (name).value, text: /** @type {HTMLInputElement} */ (text).value, email: /** @type {HTMLInputElement} */ (email).value });
        const r = await fetch(`${base}/voice?${q}`, { method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0] }, body: blob });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.message ?? `Fehler ${r.status}`);
        say(out, 'Danke! Deine Sprachnachricht ist im Studio angekommen.', true);
        blob = null;
      } catch (e) {
        say(out, /** @type {Error} */ (e).message, false);
        send.disabled = false;
      }
    } }, 'Senden'));
    return h('div', { class: 'card' }, h('strong', {}, 'Sprachnachricht ans Studio'), h('div', { class: 'rec' }, recBtn, state), player,
      h('label', {}, 'Dein Name'), name, h('label', {}, 'Nachricht dazu'), text, h('label', {}, 'Deine E-Mail (für eine Antwort)'), email, send, out);
  }

  /** Zufälliger Schlüssel je Browser - macht aus „eine Stimme je Teilnehmer“ keine Adress-Speicherung */
  const voterKey = () => { let k = localStorage.getItem('ac_voter'); if (!k) { k = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('ac_voter', k); } return k; };

  function pollView() {
    const box = h('div', { class: 'card' }, h('strong', {}, '🗳 Hörer-Umfrage'), h('div', { class: 'muted' }, 'Wird geladen …'));
    const draw = (/** @type {any} */ p, /** @type {number|null} */ voted) => {
      const total = p.total || 0;
      box.replaceChildren(h('strong', {}, '🗳 Hörer-Umfrage'), h('div', { class: 'poll-q' }, p.question),
        ...p.options.map((/** @type {string} */ o, /** @type {number} */ i) => {
          const pct = total ? Math.round(((p.results[i] ?? 0) / total) * 100) : 0;
          return h('button', { class: `poll-opt${voted !== null ? ' voted' : ''}${voted === i ? ' mine' : ''}`, disabled: voted !== null, onclick: async () => {
            try { const r = await call('/poll/vote', { pollId: p.id, option: i, voter: voterKey() }); localStorage.setItem(`ac_poll_${p.id}`, String(i)); draw({ ...p, results: r.results, total: r.total }, i); }
            catch (e) { if (/schon abgestimmt/.test(/** @type {Error} */ (e).message)) { localStorage.setItem(`ac_poll_${p.id}`, '-1'); draw(p, -1); } else say(box, /** @type {Error} */ (e).message, false); }
          } }, voted !== null ? h('i', { class: 'poll-fill', style: `width:${pct}%` }) : null, h('span', { class: 'poll-txt' }, h('span', {}, `${o}${voted === i ? ' ✓' : ''}`), voted !== null ? h('b', {}, `${pct} %`) : null));
        }),
        h('div', { class: 'muted small', style: 'text-align:right' }, voted !== null ? `${total} Stimme${total === 1 ? '' : 'n'}` : 'Tippe auf eine Antwort - eine Stimme je Teilnehmer.'));
    };
    call('/poll').then((d) => {
      if (!d.poll) { box.replaceChildren(h('strong', {}, '🗳 Hörer-Umfrage'), h('div', { class: 'muted' }, 'Gerade läuft keine Umfrage - schau später noch einmal vorbei.')); return; }
      const v = localStorage.getItem(`ac_poll_${d.poll.id}`);
      draw(d.poll, v === null ? null : Number(v));
    }).catch((e) => say(box, e.message, false));
    return box;
  }

  function formView() {
    const wrap = h('div', {});
    const only = new URLSearchParams(location.search).get('form');
    call(`/form${only ? `?id=${encodeURIComponent(only)}` : ''}`).then((d) => {
      if (!d.forms.length) { wrap.replaceChildren(h('div', { class: 'card muted' }, 'Gerade ist kein Formular offen.')); return; }
      wrap.replaceChildren(...d.forms.map((/** @type {any} */ f) => {
        /** @type {Record<string, HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>} */ const els = {};
        const out = h('div', {});
        const btn = /** @type {HTMLButtonElement} */ (h('button', { class: 'primary', onclick: async () => {
          const values = Object.fromEntries(Object.entries(els).map(([k, el]) => [k, el.value]));
          for (const fld of f.fields) if (fld.required && !values[fld.key]) { els[fld.key]?.focus(); return say(out, `„${fld.label}“ fehlt`, false); }
          btn.disabled = true;
          try { const r = await call('/form/submit', { formId: f.id, values }); card.replaceChildren(h('strong', {}, f.title), h('div', { class: 'msg ok', role: 'status' }, r.thanks)); }
          catch (e) { btn.disabled = false; say(out, /** @type {Error} */ (e).message, false); }
        } }, '➤ Absenden'));
        const card = h('div', { class: 'card' }, h('strong', {}, `📝 ${f.title}`), f.description ? h('div', { class: 'muted' }, f.description) : null,
          ...f.fields.map((/** @type {any} */ fld) => {
            const el = fld.type === 'textarea' ? h('textarea', { rows: 3, maxlength: 2000 })
              : fld.type === 'select' ? h('select', {}, h('option', { value: '' }, '– bitte wählen –'), ...fld.options.map((/** @type {string} */ o) => h('option', { value: o }, o)))
              : h('input', { type: fld.type === 'email' ? 'email' : 'text', maxlength: 200 });
            els[fld.key] = /** @type {any} */ (el);
            return h('div', {}, h('label', {}, fld.label, fld.required ? h('span', { class: 'req' }, ' *') : null), el);
          }), btn, out);
        return card;
      }));
    }).catch((e) => wrap.replaceChildren(h('div', { class: 'card' }, e.message)));
    return wrap;
  }

  const VIEWS = /** @type {[string, string, () => HTMLElement][]} */ ([
    ['requests', '🎵 Musikwunsch', requestView], ['messages', '💬 Grüße', messageView], ['voting', '👍 Voting', votingView], ['voice', '🎙 Sprachnachricht', voiceView],
    ['polls', '🗳 Umfrage', pollView], ['forms', '📝 Formular', formView],
  ]);

  function show(/** @type {string} */ key) {
    for (const b of $('tabs').children) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.k === key));
    const v = VIEWS.find(([k]) => k === key);
    if (v) $('main').replaceChildren(v[2]());
  }

  async function init() {
    try {
      info = await call('');
    } catch (e) {
      $('main').replaceChildren(h('div', { class: 'card' }, /** @type {Error} */ (e).message));
      return;
    }
    document.title = `${info.station.name} · Hörerbereich`;
    $('name').textContent = info.station.name;
    $('welcome').textContent = info.welcome || info.station.slogan || '';
    if (info.station.logo) /** @type {HTMLImageElement} */ ($('logo')).src = abs(info.station.logo);
    // ?only=polls|forms: nur dieses Element, ohne Kopf - zum Einbetten als Widget
    const only = opt('only');
    const on = VIEWS.filter(([k]) => info[k] && (!only || k === only));
    if (!on.length) { $('main').replaceChildren(h('div', { class: 'card' }, 'Dieser Bereich ist für den Sender nicht freigeschaltet.')); return; }
    $('tabs').replaceChildren(...on.map(([k, label]) => h('button', { 'data-k': k, 'aria-pressed': 'false', onclick: () => show(k) }, label)));
    if (on.length === 1) $('tabs').hidden = true;
    if (only) document.querySelector('header')?.setAttribute('hidden', '');
    show(on[0][0]);
  }

  init();
})();

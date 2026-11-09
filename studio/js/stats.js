// @ts-check
// Hörerstatistik - nach dem Statistik-Tab des AnMaCha Control Centers: Zeitraum-Chips, Kennzahl-Kacheln und
// Untertabs Gespielt / Top-Songs / Hörer-Verlauf / Genre-Mix / Live-Plays. Daten: GET /stats?period=…
// Diagramme als leichtes Inline-SVG (keine Bibliothek).

import { download, fmt, formDialog, h, mediaTitle, run, status } from './ui.js';

const PERIODS = /** @type {[string,string][]} */ ([['today', 'Heute'], ['24h', '24 h'], ['7d', '7 Tage'], ['30d', '30 Tage'], ['3m', '3 Monate']]);
const TABS = /** @type {[string,string][]} */ ([['played', '▶ Gespielt'], ['top', '🏆 Top-Songs'], ['series', '📈 Hörer-Verlauf'], ['genres', '🏷 Genre-Mix'], ['live', '🔴 Live-Plays'], ['heat', '🟦 Heatmap'], ['flop', '⚖ Top / Flop'], ['artists', '🎤 Interpreten'], ['trend', '📉 Song-Verlauf']]);
const DEEP_TABS = new Set(['heat', 'flop', 'artists', 'trend']);
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const TREND_COLORS = ['#38bdf8', '#f59e0b', '#22c55e', '#ec4899', '#a78bfa'];

/** Heatmap Wochentag × Uhrzeit als CSS-Raster. @param {(number|null)[][]} map @param {number} peak */
export function heatmap(map, peak) {
  if (!map.some((r) => r.some((v) => v != null))) return h('div', { class: 'empty' }, 'Noch keine Hörerdaten im Zeitraum – die Heatmap füllt sich, sobald ein Ausgang verbunden ist.');
  return h('div', { class: 'st-heat' },
    h('div', { class: 'st-heat-row st-heat-head' }, h('span'), ...Array.from({ length: 24 }, (_, i) => h('span', {}, i % 3 === 0 ? String(i) : ''))),
    ...map.map((row, d) => h('div', { class: 'st-heat-row' }, h('span', { class: 'st-heat-day' }, WEEKDAYS[d]),
      ...row.map((v, hr) => h('span', { class: 'st-heat-cell', title: `${WEEKDAYS[d]} ${hr}:00 – Ø ${v ?? '–'} Hörer`, style: v == null ? 'opacity:.18' : `background:rgba(56,189,248,${(0.12 + 0.88 * (peak ? v / peak : 0)).toFixed(2)})` })))),
    h('div', { class: 'muted small' }, `Ø Hörer je Wochentag und Stunde · dunkel = wenig, hell = viel (Spitze ${peak})`));
}

/** Song-Verlauf (Einsätze je Tag) als Mehrlinien-SVG. @param {{ days: string[], songs: { title: string, artist: string, plays: number[] }[] }} t */
export function trendChart(t) {
  if (!t.songs.length || t.days.length < 2) return h('div', { class: 'empty' }, 'Noch zu wenig Daten für einen Verlauf (mindestens zwei Tage mit Musik).');
  const W = 760, H = 200, L = 30, B = 24, T = 10;
  const max = Math.max(1, ...t.songs.flatMap((s) => s.plays));
  const x = (/** @type {number} */ i) => L + (i / (t.days.length - 1)) * (W - L - 8);
  const y = (/** @type {number} */ v) => T + (1 - v / max) * (H - T - B);
  const n = Math.min(7, t.days.length);
  const labels = Array.from({ length: n }, (_, k) => Math.round((k / (n - 1)) * (t.days.length - 1)));
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="st-chart" preserveAspectRatio="none" role="img" aria-label="Song-Verlauf">
    ${[0, Math.round(max / 2), max].map((v) => `<line x1="${L}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(56,189,248,.14)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="st-tick">${v}</text>`).join('')}
    ${t.songs.map((s, i) => `<polyline points="${s.plays.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${TREND_COLORS[i % TREND_COLORS.length]}" stroke-width="2"/>`).join('')}
    ${labels.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="st-tick">${t.days[i].slice(5).split('-').reverse().join('.')}</text>`).join('')}
  </svg>`;
  const wrap = h('div', { class: 'st-chart-wrap' });
  wrap.innerHTML = svg;
  wrap.append(h('div', { class: 'st-legend' }, ...t.songs.map((s, i) => h('span', {}, h('i', { style: `background:${TREND_COLORS[i % TREND_COLORS.length]}` }), ` ${mediaTitle(s)}`))));
  return wrap;
}
const CAT_LABEL = /** @type {Record<string,string>} */ ({ music: 'Musik', jingle: 'Jingle', sweeper: 'Sweeper', station_id: 'Sender-ID', ad: 'Werbung', news: 'Nachrichten', voice_track: 'Voice Track', tts: 'KI-Ansage', drop: 'Drop', bed: 'Bett', stream: 'Stream' });

/** @param {number} t @param {'minutes'|'hours'|'days'} step */
function tickLabel(t, step) {
  const d = new Date(t);
  if (step === 'days') return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  if (step === 'hours') return `${d.toLocaleDateString('de-DE', { weekday: 'short' })} ${String(d.getHours()).padStart(2, '0')}h`;
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Linien-/Flächendiagramm als SVG. @param {{ at: number, avg: number, peak: number }[]} pts
 * @param {'minutes'|'hours'|'days'} step
 */
export function lineChart(pts, step) {
  const W = 760, H = 200, L = 36, B = 24, T = 10;
  if (pts.length < 2) return h('div', { class: 'empty' }, 'Noch keine Hörerdaten im Zeitraum – sobald ein Ausgang verbunden ist, sammelt AnMaCha Cast alle 30 s die Hörerzahl.');
  const max = Math.max(1, ...pts.map((p) => p.peak));
  const x = (/** @type {number} */ i) => L + (i / (pts.length - 1)) * (W - L - 8);
  const y = (/** @type {number} */ v) => T + (1 - v / max) * (H - T - B);
  const avg = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
  const peak = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.peak).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${y(0)} L${avg.replace(/ /g, ' L')} L${x(pts.length - 1).toFixed(1)},${y(0)} Z`;
  const ticks = [0, Math.round(max / 2), max];
  const n = Math.min(6, pts.length);
  const labels = Array.from({ length: n }, (_, k) => Math.round((k / (n - 1)) * (pts.length - 1)));
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="st-chart" preserveAspectRatio="none" role="img" aria-label="Hörer-Verlauf">
    <defs><linearGradient id="stg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8" stop-opacity=".45"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map((v) => `<line x1="${L}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(56,189,248,.14)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="st-tick">${v}</text>`).join('')}
    <path d="${area}" fill="url(#stg)"/>
    <polyline points="${peak}" fill="none" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3 3" opacity=".8"/>
    <polyline points="${avg}" fill="none" stroke="#38bdf8" stroke-width="2"/>
    ${labels.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="st-tick">${tickLabel(pts[i].at, step)}</text>`).join('')}
  </svg>`;
  const wrap = h('div', { class: 'st-chart-wrap' });
  wrap.innerHTML = svg;
  wrap.append(h('div', { class: 'muted small' }, h('span', { class: 'st-leg st-leg-avg' }), ' Ø Hörer  ', h('span', { class: 'st-leg st-leg-peak' }), ' Spitze'));
  return wrap;
}

/** Balken „Ø Hörer nach Tageszeit“. @param {(number|null)[]} byHour */
export function hourBars(byHour) {
  const max = Math.max(1, ...byHour.map((v) => v ?? 0));
  if (!byHour.some((v) => v != null)) return null;
  return h('div', { class: 'st-hours' }, ...byHour.map((v, i) => h('div', { class: 'st-hour', title: `${i}:00 – Ø ${v ?? '–'}` },
    h('div', { class: 'st-bar', style: `height:${v == null ? 2 : Math.max(2, Math.round((v / max) * 60))}px${v == null ? ';opacity:.25' : ''}` }),
    h('span', {}, i % 3 === 0 ? String(i) : ''))));
}

/** @typedef {{ api: import('./api.js').Api, url: (p: string) => string, mediaUrl?: (id: string) => string }} Ctx */

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountStats(root, ctx) {
  let period = 'today';
  let tab = 'played';
  /** @type {any} */ let S = null;
  /** @type {any} */ let D = null;

  async function load() {
    S = await ctx.api.get(ctx.url(`/stats?period=${period}`));
    D = DEEP_TABS.has(tab) ? await ctx.api.get(ctx.url(`/stats/deep?period=${period}`)) : null;
    render();
  }
  async function selectTab(/** @type {string} */ id) {
    tab = id;
    if (DEEP_TABS.has(id) && (!D || D.period !== period)) { await run(async () => { D = await ctx.api.get(ctx.url(`/stats/deep?period=${period}`)); }); }
    render();
  }

  async function emailDeep() {
    const v = await formDialog('Deep Stats per E-Mail', [{ name: 'recipient', label: 'Empfänger (leer = Standard-Adresse unter Benachrichtigungen)', value: '' }], 'Senden');
    if (!v) return;
    const r = await run(() => ctx.api.post(ctx.url('/stats/deep/email'), { period, recipient: v.recipient || undefined }));
    if (r) status(r.ok ? 'Deep Stats verschickt' : 'E-Mail konnte nicht gesendet werden', !r.ok);
  }

  function deepBody() {
    if (!D) return h('div', { class: 'muted' }, 'Lade …');
    const song = (/** @type {any} */ t, /** @type {number} */ i, /** @type {boolean} */ flop) => h('li', {}, h('span', { class: 'st-title' }, mediaTitle(t)), h('span', { class: 'muted num' }, flop ? `Ø ${t.avgListeners} · ${t.plays}×` : `${t.plays}×${t.avgListeners == null ? '' : ` · Ø ${t.avgListeners}`}`));
    if (tab === 'heat') return h('div', {}, h('h4', {}, 'Hörer-Heatmap – Wochentag × Uhrzeit'), heatmap(D.heatmap, D.heatmapPeak));
    if (tab === 'flop') {
      return h('div', {},
        h('div', { class: 'st-compare' }, ...D.compare.map((/** @type {any} */ c) => h('div', { class: 'ov-stat' }, h('span', {}, c.label), h('strong', {}, c.now == null ? '–' : String(c.now)),
          h('small', { class: c.delta == null ? 'muted' : c.delta >= 0 ? 'st-up' : 'st-down' }, c.delta == null ? `Vorperiode: ${c.prev ?? '–'}` : `${c.delta > 0 ? '▲ +' : c.delta < 0 ? '▼ ' : '± '}${c.delta} % · vorher ${c.prev}`)))),
        h('div', { class: 'st-cols' },
          h('div', {}, h('h4', {}, '🏆 Top-Songs'), D.top.length ? h('ol', { class: 'st-ol' }, ...D.top.map((/** @type {any} */ t, /** @type {number} */ i) => song(t, i, false))) : h('div', { class: 'empty' }, 'Keine Musik im Zeitraum.')),
          h('div', {}, h('h4', {}, '📉 Flop-Songs (wenigste Hörer)'), D.flop.length ? h('ol', { class: 'st-ol' }, ...D.flop.map((/** @type {any} */ t, /** @type {number} */ i) => song(t, i, true))) : h('div', { class: 'empty' }, 'Keine Hörerzahlen je Titel im Zeitraum.'))));
    }
    if (tab === 'artists') {
      if (!D.artists.length) return h('div', { class: 'empty' }, 'Keine Musik im Zeitraum.');
      let acc = 0;
      const stops = D.artists.map((/** @type {any} */ a, /** @type {number} */ i) => { const from = acc; acc += a.share; return `${TREND_COLORS[i % TREND_COLORS.length]} ${from}% ${Math.min(100, acc)}%`; }).join(', ');
      return h('div', { class: 'st-cols' },
        h('div', { class: 'st-donut-wrap' }, h('div', { class: 'st-donut', style: `background: conic-gradient(${stops}, rgba(255,255,255,.06) ${Math.min(100, acc)}% 100%)` }, h('span', {}, `${D.artists.length}`, h('small', {}, 'Interpreten')))),
        h('div', {}, h('h4', {}, 'Interpreten-Anteile'), h('div', { class: 'st-hbars' }, ...D.artists.map((/** @type {any} */ a, /** @type {number} */ i) => h('div', { class: 'st-hbar' }, h('span', { class: 'st-title' }, h('i', { class: 'st-dot', style: `background:${TREND_COLORS[i % TREND_COLORS.length]}` }), ` ${a.artist}`), h('div', { class: 'st-hfill', style: `width:${Math.round(a.share)}%;background:${TREND_COLORS[i % TREND_COLORS.length]}` }), h('span', { class: 'muted num' }, `${a.share} % · ${a.plays}×`))))));
    }
    return h('div', {}, h('h4', {}, 'Song-Verlauf – Einsätze je Tag (Top 5)'), trendChart(D.trend));
  }

  const time = (/** @type {number} */ t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function tiles() {
    const k = S.kpis;
    /** @type {[string, string|number, string][]} */
    const list = [
      ['Gespielt', k.played, 'var(--primary)'], ['Hörer jetzt', k.listenersNow, 'var(--green)'], ['Ø Hörer/Song', k.avgPerSong ?? '–', 'var(--cyan)'],
      ['Peak Hörer', k.peak, 'var(--amber)'], ['Live-Plays', k.livePlays, 'var(--red)'], ['Einz. Songs', k.uniqueSongs, 'var(--accent)'],
      ['Std. mit Hörern', k.hoursOnAir, 'var(--primary)'], ['Top Song', k.topSong ? `${k.topSong.artist ? `${k.topSong.artist} – ` : ''}${k.topSong.title}` : '–', 'var(--accent-2)'],
    ];
    return h('div', { class: 'st-tiles' }, ...list.map(([l, v, c], i) => h('div', { class: `ov-stat${i === 7 ? ' st-small' : ''}`, style: `--c:${c}` }, h('span', {}, l), h('strong', {}, String(v)))));
  }

  function body() {
    if (DEEP_TABS.has(tab)) return deepBody();
    if (tab === 'played') {
      return S.played.length
        ? h('div', { class: 'st-table' }, ...S.played.map((/** @type {any} */ e) => h('div', { class: 'st-row' },
            h('span', { class: 'muted num' }, time(e.at)), h('span', { class: 'st-title' }, mediaTitle(e)),
            h('span', { class: 'pill' }, CAT_LABEL[e.category] ?? e.category), h('span', { class: 'muted num', title: 'Hörer beim Start' }, e.listeners == null ? '' : `👥 ${e.listeners}`), e.live ? h('span', { class: 'pill failed' }, 'LIVE') : h('span'))))
        : h('div', { class: 'empty' }, 'Im Zeitraum wurde nichts gespielt.');
    }
    if (tab === 'top') {
      return h('div', { class: 'st-cols' },
        h('div', {}, h('h4', {}, 'Top-Songs'), S.topSongs.length ? h('ol', { class: 'st-ol' }, ...S.topSongs.slice(0, 25).map((/** @type {any} */ t) => h('li', {}, h('span', { class: 'st-title' }, mediaTitle(t)), h('span', { class: 'muted num' }, `${t.plays}×${t.avgListeners == null ? '' : ` · Ø ${t.avgListeners}`}`)))) : h('div', { class: 'empty' }, 'Keine Musik im Zeitraum.')),
        h('div', {}, h('h4', {}, 'Top-Interpreten'), S.topArtists.length ? h('ol', { class: 'st-ol' }, ...S.topArtists.map((/** @type {any} */ a) => h('li', {}, h('span', { class: 'st-title' }, a.artist), h('span', { class: 'muted num' }, `${a.plays}×`)))) : h('div', { class: 'empty' }, '–')));
    }
    if (tab === 'series') {
      return h('div', {}, lineChart(S.series, S.seriesStep), hourBars(S.byHour) ? h('div', {}, h('h4', {}, 'Ø Hörer nach Tageszeit'), hourBars(S.byHour)) : null);
    }
    if (tab === 'genres') {
      const max = Math.max(1, ...S.genres.map((/** @type {any} */ g) => g.plays));
      return h('div', { class: 'st-cols' },
        h('div', {}, h('h4', {}, 'Genre-Mix'), S.genres.length ? h('div', { class: 'st-hbars' }, ...S.genres.map((/** @type {any} */ g) => h('div', { class: 'st-hbar' }, h('span', { class: 'st-title' }, g.genre), h('div', { class: 'st-hfill', style: `width:${Math.round((g.plays / max) * 100)}%` }), h('span', { class: 'muted num' }, `${g.plays}×`)))) : h('div', { class: 'empty' }, 'Keine Genres hinterlegt – Genre-Tag in den Tracks pflegen.')),
        h('div', {}, h('h4', {}, 'Kategorien'), h('div', { class: 'st-hbars' }, ...S.categories.map((/** @type {any} */ c) => h('div', { class: 'st-hbar' }, h('span', { class: 'st-title' }, CAT_LABEL[c.category] ?? c.category), h('div', { class: 'st-hfill st-hfill-2', style: `width:${Math.round((c.plays / Math.max(1, S.kpis.played)) * 100)}%` }), h('span', { class: 'muted num' }, `${c.plays}×`))))));
    }
    return S.livePlays.length
      ? h('div', { class: 'st-table' }, ...S.livePlays.map((/** @type {any} */ e) => h('div', { class: 'st-row' }, h('span', { class: 'muted num' }, time(e.at)), h('span', { class: 'st-title' }, mediaTitle(e)), h('span', { class: 'pill' }, CAT_LABEL[e.category] ?? e.category), h('span', { class: 'muted num' }, e.listeners == null ? '' : `👥 ${e.listeners}`), h('span', { class: 'pill failed' }, 'LIVE'))))
      : h('div', { class: 'empty' }, 'Keine Live-Plays im gewählten Zeitraum – Titel, die während einer Live-Sendung liefen, erscheinen hier.');
  }

  function render() {
    root.replaceChildren(
      h('div', { class: 'listener-hero' },
        h('div', {}, h('span', { class: 'ov-kicker' }, 'AUSWERTUNG'), h('h1', {}, 'Hörerstatistik'),
          h('p', {}, `Hörerzahlen über alle verbundenen Ausgänge, gespielte Titel und Live-Anteile${S ? ` · ${new Date(S.from).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} – jetzt` : ''}.`)),
        h('div', { class: 'listener-hero-actions st-periods' },
          ...PERIODS.map(([id, l]) => h('button', { class: `btn small${period === id ? ' primary' : ''}`, 'aria-pressed': String(period === id), onclick: () => { period = id; run(load); } }, l)),
          h('button', { class: 'btn small', onclick: () => run(load) }, '⟳'),
          h('button', { class: 'btn small', title: 'Deep Stats als Excel-taugliche CSV', onclick: async () => { const blob = await run(() => ctx.api.blob(ctx.url(`/stats/deep.csv?period=${period}`))); if (blob) download(blob, `deep-stats-${period}.csv`); } }, '⬇ Excel'),
          h('button', { class: 'btn small', title: 'Aktuelle Ansicht drucken / als PDF speichern', onclick: () => window.print() }, '🖨 PDF'),
          h('button', { class: 'btn small', title: 'Kurzfassung per E-Mail', onclick: emailDeep }, '✉ Mail'))),
      S ? tiles() : h('div', { class: 'muted' }, 'Lade …'),
      S ? h('section', { class: 'panel st-panel' },
        h('div', { class: 'tabs st-tabs' }, ...TABS.map(([id, l]) => h('button', { 'aria-pressed': String(tab === id), class: DEEP_TABS.has(id) ? 'st-deep' : '', onclick: () => selectTab(id) }, l))),
        body(),
        h('div', { class: 'muted small st-foot' }, 'Berichte und CSV-Export unter „Berichte“; Ausfall- und Stille-Alarme unter „System & Sicherung“.')) : null);
  }

  return { show: () => run(load), onEvent: (/** @type {string} */ t) => { if (t === 'now_playing' && !root.hidden && tab === 'played') run(load); } };
}

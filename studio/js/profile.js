// @ts-check
// Mein Profil (nach profile.html / api.html im Control Center): Konto, Social Links, eigene API-Schlüssel,
// Entwickler-API mit „Live ausprobieren“. Ohne Benutzersitzung (Windows-App, gekoppeltes Gerät, API-Schlüssel): dieses Gerät,
// seine Rechte, die API-Schlüssel des Servers (mit Verwaltungsrecht) und die Entwickler-API.
import { formDialog, h, run, status } from './ui.js';

/** @typedef {{ api: import('./api.js').Api, me: () => any, stations: () => any[], stationId: () => string, saveToken: (t: string) => void, onMeChanged: () => Promise<void> }} Ctx */

const LINKS = /** @type {[string, string, string][]} */ ([
  ['website', 'Webseite', 'https://…'], ['instagram', 'Instagram', '@name oder URL'], ['facebook', 'Facebook', 'Seite oder URL'], ['youtube', 'YouTube', 'Kanal oder URL'],
  ['tiktok', 'TikTok', '@name'], ['x', 'X (Twitter)', '@name'], ['mastodon', 'Mastodon', '@name@instanz'], ['threads', 'Threads', '@name'],
]);

/** Auswahl der wichtigsten Lese-Endpunkte für „Live ausprobieren“ (vollständige Liste in docs/BRIDGE.md). */
const ENDPOINTS = /** @type {{ path: string, scope: string, desc: string, station: boolean }[]} */ ([
  { path: '/me', scope: '–', desc: 'Wer bin ich: Rollen, Rechte, Sender', station: false },
  { path: '/stations', scope: 'branding:read', desc: 'Alle Sender, die der Schlüssel sehen darf', station: false },
  { path: '/stations/{id}/now-playing', scope: 'now_playing:read', desc: 'Jetzt läuft (Titel, Interpret, Start/Ende)', station: true },
  { path: '/stations/{id}/queue', scope: 'queue:read', desc: 'Warteschlange', station: true },
  { path: '/stations/{id}/history?limit=20', scope: 'now_playing:read', desc: 'Verlauf der letzten Titel', station: true },
  { path: '/stations/{id}/media', scope: 'media:read', desc: 'Bibliothek (Titel, Kategorie, Lautheit, Tonart)', station: true },
  { path: '/stations/{id}/playout', scope: 'automation:read', desc: 'Server-Playout: Zustand und Konfiguration', station: true },
  { path: '/stations/{id}/stats?period=7d', scope: 'automation:read', desc: 'Hörerstatistik (7 Tage)', station: true },
  { path: '/health', scope: '–', desc: 'Serverzustand (ffmpeg, Datenbank, Uptime)', station: false },
]);

/** @param {HTMLElement} root @param {Ctx} ctx */
export function mountProfile(root, ctx) {
  /** @param {string} title @param {...(Node|string|null|false)} body */
  const card = (title, ...body) => h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, title)), ...body);
  const kv = (/** @type {string} */ k, /** @type {any} */ v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v === null || v === undefined || v === '' ? '–' : v));

  async function show() {
    const me = ctx.me();
    if (!me?.user) return showDevice(me);
    const [p, tokens] = await Promise.all([ctx.api.get('/me/profile'), ctx.api.get('/me/tokens')]);
    const stationName = (/** @type {string} */ id) => (id === '*' ? 'alle Sender' : ctx.stations().find((s) => s.id === id)?.name ?? id);
    root.replaceChildren(
      h('div', { class: 'admin-hero' },
        h('div', {}, h('span', { class: 'ov-kicker' }, 'KONTO'), h('h1', {}, p.name), h('p', {}, `@${p.username} · ${(me.roles ?? []).join(', ')} · ${(p.stationIds ?? []).map(stationName).join(', ')}`)),
        h('div', { class: 'admin-hero-actions' },
          h('button', { class: 'btn small', onclick: () => editName(p) }, '✎ Name'),
          h('button', { class: 'btn small', onclick: () => changePassword() }, '🔑 Passwort ändern'))),
      h('div', { class: 'profile-grid' },
        card('Social Links',
          h('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Für Senderseite, Teamliste und Podcast-Feed. Handles („@name“) reichen, Adressen werden verlinkt.'),
          ...(Object.keys(p.links ?? {}).length ? LINKS.filter(([k]) => p.links?.[k]).map(([k, l]) => kv(l, linkEl(p.links[k]))) : [h('div', { class: 'empty' }, 'Keine Links hinterlegt.')]),
          h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small', onclick: () => editLinks(p) }, '✎ Links bearbeiten'))),
        card('Meine API-Keys',
          h('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Für Skripte, OBS-Overlays, Webseiten oder Automationen. Ein Schlüssel hat nie mehr Rechte als dein Konto und lässt sich jederzeit widerrufen.'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Rechte'), h('th', {}, 'Erstellt'), h('th', {}))),
            h('tbody', {}, ...(tokens.length ? tokens.map((/** @type {any} */ t) => h('tr', {},
              h('td', {}, h('b', {}, t.name), h('div', { class: 'muted small' }, t.id)),
              h('td', { class: 'muted small' }, t.scopes.includes('*') ? 'alle Rechte des Kontos' : t.scopes.every((/** @type {string} */ s) => s.endsWith(':read')) ? 'nur lesen' : `${t.scopes.length} Rechte`),
              h('td', { class: 'num muted', style: 'white-space:nowrap' }, new Date(t.createdAt).toLocaleDateString('de-DE')),
              h('td', { class: 'act' }, h('button', { class: 'btn small danger', onclick: () => confirm(`Schlüssel „${t.name}“ widerrufen? Verbundene Skripte verlieren sofort den Zugang.`) && run(async () => { await ctx.api.del(`/me/tokens/${encodeURIComponent(t.id)}`); status('Schlüssel widerrufen'); show(); }) }, 'Widerrufen'))))
              : [h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'Noch kein Schlüssel.'))])))),
          h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small primary', onclick: () => newKey(me) }, '＋ Schlüssel erzeugen')))),
      apiCard(),
    );
  }

  /** Angemeldet mit Geräte- oder API-Schlüssel (z. B. Windows-App): kein Konto, aber Gerät, Rechte, Schlüssel und API. @param {any} me */
  async function showDevice(me) {
    const scopes = /** @type {string[]} */ (me?.scopes ?? []);
    const admin = scopes.includes('*') || scopes.includes('tokens:write');
    const tokens = admin ? await ctx.api.get('/tokens').catch(() => null) : null;
    const self = tokens?.find((/** @type {any} */ t) => t.id === me?.id);
    const stationName = (/** @type {string} */ id) => (id === '*' ? 'alle Sender' : ctx.stations().find((s) => s.id === id)?.name ?? id);
    const rights = scopes.includes('*') ? 'alle Rechte' : scopes.every((x) => x.endsWith(':read')) ? 'nur lesen' : `${scopes.length} Rechte`;
    root.replaceChildren(
      h('div', { class: 'admin-hero' },
        h('div', {}, h('span', { class: 'ov-kicker' }, 'DIESES GERÄT'), h('h1', {}, self?.name === 'desktop' ? 'AnMaCha Cast auf diesem PC' : self?.name ?? 'Gerät / API-Schlüssel'),
          h('p', {}, `${(me?.roles ?? []).join(', ') || 'ohne Rolle'} · ${rights} · ${(me?.stationIds ?? []).map(stationName).join(', ')}`))),
      h('div', { class: 'profile-grid' },
        card('Anmeldung',
          h('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Dieses Gerät ist mit einem Schlüssel angemeldet, nicht mit einem Benutzerkonto. Name, Passwort und Social Links gehören zu Benutzerkonten – anlegen unter „Benutzer & Rollen“, dann im Browser mit Benutzername und Passwort anmelden.'),
          kv('Schlüssel', me?.id ?? '–'), kv('Rollen', (me?.roles ?? []).join(', ')), kv('Rechte', scopes.includes('*') ? 'alle' : scopes.join(', ')), kv('Sender', (me?.stationIds ?? []).map(stationName).join(', ')),
          self ? kv('Angelegt', new Date(self.createdAt).toLocaleDateString('de-DE')) : null),
        admin && tokens ? serverKeys(tokens, me) : card('API-Schlüssel', h('div', { class: 'empty' }, 'Schlüssel verwalten dürfen nur Administratoren.'))),
      apiCard(),
    );
  }

  /** API-Schlüssel des Servers (alle, nicht nur eigene) – nur mit Verwaltungsrecht. @param {any[]} tokens @param {any} me */
  function serverKeys(tokens, me) {
    return card('API-Schlüssel des Servers',
      h('p', { class: 'muted small', style: 'margin:0 0 8px' }, 'Für Skripte, OBS-Overlays, Webseiten oder Automationen. Gekoppelte Geräte erscheinen unter „Server & Geräte“. Ein Schlüssel lässt sich jederzeit widerrufen.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Rechte'), h('th', {}, 'Erstellt'), h('th', {}))),
        h('tbody', {}, ...tokens.map((/** @type {any} */ t) => h('tr', {},
          h('td', {}, h('b', {}, t.name), t.id === me?.id ? h('span', { class: 'muted small' }, ' · dieses Gerät') : null, h('div', { class: 'muted small' }, t.userId ? `${t.id} · Konto ${t.userId}` : t.id)),
          h('td', { class: 'muted small' }, t.scopes.includes('*') ? 'alle Rechte' : t.scopes.every((/** @type {string} */ x) => x.endsWith(':read')) ? 'nur lesen' : `${t.scopes.length} Rechte`),
          h('td', { class: 'num muted', style: 'white-space:nowrap' }, new Date(t.createdAt).toLocaleDateString('de-DE')),
          h('td', { class: 'act' }, t.id === me?.id ? null : h('button', { class: 'btn small danger', onclick: () => confirm(`Schlüssel „${t.name}“ widerrufen? Verbundene Skripte und Geräte verlieren sofort den Zugang.`) && run(async () => { await ctx.api.del(`/tokens/${encodeURIComponent(t.id)}`); status('Schlüssel widerrufen'); show(); }) }, 'Widerrufen'))))))),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn small primary', onclick: () => newServerKey() }, '＋ Schlüssel erzeugen')));
  }

  async function newServerKey() {
    const v = await formDialog('Neuer API-Schlüssel', [
      { name: 'name', label: 'Wofür (Name)', value: '', required: true, hint: 'z. B. „OBS-Overlay“ oder „Webseite Jetzt läuft“' },
      { name: 'preset', label: 'Rechte', value: 'read', options: [['read', 'Nur lesen (Jetzt läuft, Verlauf, Bibliothek, Statistik)'], ['full', 'Alles (auch steuern und ändern)']] },
      { name: 'station', label: 'Sender', value: ctx.stationId(), options: [['*', 'alle Sender'], ...ctx.stations().map((s) => /** @type {[string, string]} */ ([s.id, s.name]))] },
    ], 'Erzeugen');
    if (!v) return;
    const read = ['branding:read', 'now_playing:read', 'queue:read', 'media:read', 'automation:read', 'outputs:read'];
    const r = await run(() => ctx.api.post('/tokens', { name: v.name, scopes: v.preset === 'full' ? ['*'] : read, roles: [v.preset === 'full' ? 'admin' : 'viewer'], stationIds: [v.station] }));
    if (!r) return;
    await formDialog('Schlüssel erzeugt - jetzt kopieren', [
      { name: 'info', label: 'Nur einmal sichtbar', type: 'info', value: 'Der Schlüssel wird nicht noch einmal angezeigt. Bei Verlust einfach widerrufen und neu erzeugen.' },
      { name: 'token', label: 'API-Schlüssel', value: r.token, hint: 'Header: Authorization: Bearer <Schlüssel>' },
    ], 'Fertig');
    show();
  }

  /** @param {string} v */
  function linkEl(v) {
    const url = /^https?:\/\//i.test(v) ? v : '';
    return url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, v.replace(/^https?:\/\//, '').slice(0, 60)) : v;
  }

  /** @param {any} p */
  async function editName(p) {
    const v = await formDialog('Anzeigename', [{ name: 'name', label: 'Name', value: p.name, required: true }], 'Speichern');
    if (!v) return;
    await run(async () => { await ctx.api.patch('/me/profile', { name: v.name }); await ctx.onMeChanged(); status('Name gespeichert'); show(); });
  }

  /** @param {any} p */
  async function editLinks(p) {
    const v = await formDialog('Social Links', LINKS.map(([k, l, hint]) => ({ name: k, label: l, value: p.links?.[k] ?? '', hint })), 'Speichern', { wide: true });
    if (!v) return;
    await run(async () => { await ctx.api.patch('/me/profile', { links: v }); status('Links gespeichert'); show(); });
  }

  async function changePassword() {
    const v = await formDialog('Passwort ändern', [
      { name: 'current', label: 'Aktuelles Passwort', type: 'password', value: '', required: true },
      { name: 'next', label: 'Neues Passwort', type: 'password', value: '', required: true, hint: 'mindestens 10 Zeichen, Buchstaben und Ziffer oder Sonderzeichen' },
      { name: 'repeat', label: 'Neues Passwort wiederholen', type: 'password', value: '', required: true },
    ], 'Passwort speichern');
    if (!v) return;
    if (v.next !== v.repeat) return status('Die neuen Passwörter stimmen nicht überein', true);
    const r = await run(() => ctx.api.post('/auth/password', { current: v.current, next: v.next }));
    if (!r) return;
    if (r.token) ctx.saveToken(r.token); // andere Sitzungen sind damit abgemeldet, diese läuft mit neuem Token weiter
    status('Passwort geändert - Studio wird neu geladen');
    setTimeout(() => location.reload(), 800); // Live-Verbindung (SSE) hängt noch am alten Token
  }

  /** @param {any} me */
  async function newKey(me) {
    const mine = /** @type {string[]} */ (me.scopes ?? []);
    const v = await formDialog('Neuer API-Schlüssel', [
      { name: 'name', label: 'Wofür (Name)', value: '', required: true, hint: 'z. B. „OBS-Overlay“ oder „Webseite Jetzt läuft“' },
      { name: 'preset', label: 'Rechte', value: 'read', options: [['read', 'Nur lesen (Jetzt läuft, Verlauf, Bibliothek, Statistik)'], ['full', 'Wie mein Konto (auch steuern und ändern)']] },
    ], 'Erzeugen');
    if (!v) return;
    const all = mine.includes('*');
    const scopes = v.preset === 'full' ? (all ? ['*'] : mine) : (all ? ['branding:read', 'now_playing:read', 'queue:read', 'media:read', 'automation:read', 'outputs:read'] : mine.filter((s) => s.endsWith(':read')));
    const r = await run(() => ctx.api.post('/me/tokens', { name: v.name, scopes }));
    if (!r) return;
    // Der Schlüssel ist nur jetzt sichtbar: als Feld zum Kopieren anzeigen
    await formDialog('Schlüssel erzeugt - jetzt kopieren', [
      { name: 'info', label: 'Nur einmal sichtbar', type: 'info', value: 'Der Schlüssel wird nicht noch einmal angezeigt. Bei Verlust einfach widerrufen und neu erzeugen.' },
      { name: 'token', label: 'API-Schlüssel', value: r.token, hint: 'Header: Authorization: Bearer <Schlüssel>' },
    ], 'Fertig');
    show();
  }

  function apiCard() {
    const base = `${ctx.api.base || location.origin}/api/v1`;
    const out = h('pre', { class: 'wc-code api-out' }, 'Endpunkt wählen und „Abrufen“ drücken.');
    const sel = /** @type {HTMLSelectElement} */ (h('select', {}, ...ENDPOINTS.map((e, i) => h('option', { value: String(i) }, e.path))));
    const st = /** @type {HTMLSelectElement} */ (h('select', {}, ...ctx.stations().map((s) => h('option', { value: s.id, selected: s.id === ctx.stationId() }, s.name))));
    const curl = h('code', { class: 'api-curl' });
    const key = /** @type {HTMLInputElement} */ (h('input', { type: 'password', placeholder: 'API-Schlüssel (leer = meine Sitzung)', autocomplete: 'off', style: 'min-width:240px', title: 'So testest du, was ein frisch erzeugter Schlüssel wirklich sehen darf' }));
    const draw = () => {
      const e = ENDPOINTS[Number(sel.value)];
      const path = e.path.replace('{id}', st.value);
      curl.textContent = `curl -H "Authorization: Bearer <API-Key>" ${base}${path}`;
      st.disabled = !e.station;
    };
    sel.addEventListener('change', draw); st.addEventListener('change', draw); draw();
    return card('Entwickler-API',
      h('p', { class: 'muted small', style: 'margin:0 0 8px' }, `Alle Aufrufe gehen an ${base}/… mit dem Header „Authorization: Bearer <API-Key>“. Antworten sind JSON; 120 Anfragen pro Minute und Schlüssel. Schreibende Endpunkte (Queue, Playout, Cardwall, Sendeplan, Hörer) stehen in docs/API.md, Webhooks in docs/BRIDGE.md.`),
      h('p', { style: 'margin:0 0 8px' }, h('a', { href: `${ctx.api.base || location.origin}/api-docs.html`, target: '_blank', rel: 'noopener' }, '📖 Alle Endpunkte in der API-Dokumentation ansehen (mit OpenAPI-Spezifikation)')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list api-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'GET'), h('th', {}, 'Recht'), h('th', {}, 'Liefert'))),
        h('tbody', {}, ...ENDPOINTS.map((e) => h('tr', {}, h('td', {}, h('code', {}, e.path)), h('td', { class: 'muted small' }, e.scope), h('td', { class: 'muted small' }, e.desc)))))),
      h('h3', { style: 'margin:12px 0 6px;font-size:14px' }, '🧪 Live ausprobieren'),
      h('div', { class: 'row', style: 'flex-wrap:wrap' }, sel, st, key,
        h('button', { class: 'btn small primary', onclick: async () => {
          const e = ENDPOINTS[Number(sel.value)];
          const path = e.path.replace('{id}', st.value);
          out.textContent = '…';
          const t0 = performance.now();
          try {
            const k = key.value.trim();
            let r;
            if (k) {
              // mit fremdem Schlüssel: direkter Aufruf ohne die Sitzung, damit die Antwort die Rechte DES SCHLÜSSELS zeigt
              const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${k}` } });
              r = await res.json().catch(() => ({ status: res.status }));
              if (!res.ok) r = { status: res.status, ...r };
            } else r = await ctx.api.get(path);
            out.textContent = `// ${Math.round(performance.now() - t0)} ms${k ? ' · mit API-Schlüssel' : ''}\n${JSON.stringify(r, null, 2).slice(0, 20_000)}`;
          } catch (err) { out.textContent = `Fehler: ${err instanceof Error ? err.message : String(err)}`; }
        } }, '▶ Abrufen')),
      h('div', { class: 'muted small', style: 'margin:6px 0' }, curl),
      out);
  }

  return { show: () => run(show) };
}

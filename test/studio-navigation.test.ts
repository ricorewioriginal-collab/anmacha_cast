import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(import.meta.dirname, '../studio/index.html'), 'utf8');
const css = readFileSync(join(import.meta.dirname, '../studio/styles.css'), 'utf8');

test('Studio-Navigation: jeder sichtbare View-Link hat ein echtes Ziel', () => {
  const views = [...html.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(views.length > 0);
  for (const view of new Set(views)) {
    assert.match(html, new RegExp(`id="view-${view}"`), `data-view="${view}" braucht #view-${view}`);
  }
});

test('Studio-Navigation: jeder Sprung verweist auf ein vorhandenes Element', () => {
  const jumps = [...html.matchAll(/data-jump="([^"]+)"/g)].map((m) => m[1]!);
  for (const id of new Set(jumps)) {
    assert.match(html, new RegExp(`id="${id}"`), `data-jump="${id}" braucht #${id}`);
  }
});

test('Studio-HTML: IDs sind eindeutig und Nextcloud ist nur in Medien integriert', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(dup)], [], `doppelte IDs: ${[...new Set(dup)].join(', ')}`);
  assert.doesNotMatch(html, /data-view="nextcloud"/, 'kein separater Nextcloud-Menüpunkt');
  assert.match(html, /id="view-nextcloud"/, 'interne View bleibt für die integrierte Logik verfügbar');
});

test('Referenzlayout: zentrale Studio-Bereiche bleiben im DOM vorhanden', () => {
  for (const id of ['decks', 'carts-panel', 'carts', 'work-panel', 'queue-body', 'live-panel', 'outputs', 'studio-schedule', 'studio-schedule-track', 'top-cover', 'top-title', 'top-time']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} fehlt`);
  }
});


test('Sendeplan bleibt doppelt erreichbar: kompakt im Studio und vollständig über Navigation', () => {
  assert.match(html, /id="studio-schedule"/, 'kompakte Studio-Timeline fehlt');
  assert.match(html, /data-view="planning"/, 'Navigation zur vollständigen Planung fehlt');
  assert.match(html, /id="view-planning"/, 'vollständige Planungsansicht fehlt');
});


test('Referenz-Topbar besitzt echte Now-Playing-Ziele', () => {
  for (const id of ['top-cover', 'top-title', 'top-artist', 'top-time']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} fehlt in der Topbar`);
  }
});


test('Referenznavigation: Kernbereiche sind klar gruppiert und echte Funktionen bleiben erhalten', () => {
  // Roter LIVE-Knopf oben, danach Gruppen: Start, laut.fm, Musik, KI & Statistik, Programm planen,
  // Einstellungen, Geräte & Hilfe.
  assert.match(html, /class="nav-live" data-view="studio"/, 'LIVE-Knopf oben in der Seitenleiste fehlt');
  for (const section of ['overview', 'lautfm', 'media', 'ai', 'planning', 'broadcast', 'links']) {
    assert.match(html, new RegExp(`data-nav-section="${section}"`), `Navigationsgruppe ${section} fehlt`);
  }
  for (const id of ['btn-storage', 'btn-android', 'nav-status', 'btn-station', 'btn-audio', 'btn-update']) {
    assert.match(html, new RegExp(`id="${id}"`), `bestehende Funktion #${id} ging beim Umbau verloren`);
  }
});

test('Einfach-Modus: nur Alltagsbereiche sichtbar, Profi-Modus zeigt alles', () => {
  assert.match(html, /id="nav-mode-simple"/);
  assert.match(html, /id="nav-mode-pro"/);
  assert.match(css, /body:not\(\.pro\) \[data-pro\] \{ display: none !important; \}/);
  // Alltag (laut ausgewählten Kernbereichen) bleibt im Einfach-Modus sichtbar …
  for (const view of ['overview', 'lautfm', 'mediathek', 'playlists', 'ai', 'stats', 'planning', 'news']) {
    const btn = new RegExp(`<button data-view="${view}"[^>]*>`).exec(html)?.[0] ?? '';
    assert.ok(btn && !/data-pro/.test(btn), `${view} muss im Einfach-Modus sichtbar sein`);
  }
  // … Spezialbereiche nur im Profi-Modus
  // Abschnitte wie in der Windows-App: Sendeplan/Sendeuhr im Alltag, Ereignisse und Smart Blocks nur Profi, Server & Geräte nur Profi
  assert.doesNotMatch(html, /data-nav-section="planning" data-pro/);
  assert.match(html, /data-view="planning" data-sub="rotation"[^>]*data-pro/);
  assert.match(html, /data-nav-section="links" data-pro/);
  const sections = [...html.matchAll(/<summary><span>([^<]+)<\/span><\/summary>/g)].map((m) => m[1]);
  assert.deepEqual(sections, ['Start', 'laut.fm', 'Musik', 'KI &amp; Statistik', 'Senden', 'Programm planen', 'Einstellungen', 'Server &amp; Geräte']);
  for (const id of ['btn-storage', 'btn-update', 'btn-windows', 'nav-status']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-pro`), `#${id} gehört in den Profi-Modus`);
  }
});

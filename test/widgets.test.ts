// Widgets für die eigene Website: Optionen prüfen, Adressen/Einbett-Code bauen, Datei für den eigenen Webspace erzeugen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cleanWidgetOpts, widgetFile, widgetLinks } from '../src/server/widgets.ts';
import { cleanPublicUrl } from '../src/server/services/listeners.ts';

const studio = join(import.meta.dirname, '..', 'studio');

test('Widget-Optionen: nur bekannte Arten, saubere Farbe und Server-Adresse', () => {
  const o = cleanWidgetOpts({ kind: 'requests', theme: 'light', accent: '#ff4081', api: 'https://radio.example.de/cast/' }, 'main');
  assert.deepEqual(o, { kind: 'requests', station: 'main', theme: 'light', accent: 'ff4081', api: 'https://radio.example.de/cast', lautfm: undefined });
  assert.throws(() => cleanWidgetOpts({ kind: 'evil' }, 'main'), /Unbekanntes Widget/);
  assert.throws(() => cleanWidgetOpts({ api: 'javascript:alert(1)' }, 'main'), /http/);
  assert.throws(() => cleanWidgetOpts({ api: 'https://user:pw@x.de' }, 'main'), /http/);
  assert.equal(cleanWidgetOpts({ accent: 'zz"><' }, 'main').accent, '');
  assert.equal(cleanPublicUrl('  https://radio.example.de/  '), 'https://radio.example.de');
  assert.equal(cleanPublicUrl(''), undefined);
  assert.throws(() => cleanPublicUrl('ftp://x'), /http/);
});

test('Direkte Adresse und Einbett-Code', () => {
  const l = widgetLinks(cleanWidgetOpts({ kind: 'requests', accent: 'ff4081' }, 'main'), 'https://radio.example.de');
  assert.equal(l.url, 'https://radio.example.de/hoerer.html?s=main&only=requests&accent=ff4081');
  assert.match(l.iframe, /^<iframe src="https:\/\/radio\.example\.de\/hoerer\.html\?s=main&amp;only=requests&amp;accent=ff4081" style="width:100%;max-width:640px;height:640px;border:0"/);
  assert.equal(l.script, '<script src="https://radio.example.de/embed.js" data-station="main" data-widget="requests" data-accent="ff4081" async></script>');
  const voice = widgetLinks(cleanWidgetOpts({ kind: 'voice' }, 'main'), 'https://x.de');
  assert.match(voice.iframe, /allow="microphone"/, 'Mikrofon nur für Sprachnachrichten');
  assert.doesNotMatch(l.iframe, /microphone/);
  assert.equal(widgetLinks(cleanWidgetOpts({ kind: 'player', lautfm: 'mein-radio' }, 'main'), 'https://x.de').url, 'https://x.de/widget.html?lautfm=mein-radio');
});

test('Datei für den eigenen Webspace: Seite + Skript in einer Datei, Daten vom eigenen Server', () => {
  assert.throws(() => widgetFile(studio, cleanWidgetOpts({ kind: 'requests' }, 'main')), /öffentliche Adresse/);
  const f = widgetFile(studio, cleanWidgetOpts({ kind: 'requests', theme: 'light', api: 'https://radio.example.de' }, 'main'));
  assert.equal(f.name, 'anmacha-cast-requests.html');
  assert.ok(!f.html.includes('src="js/hoerer.js"'), 'kein relativer Skript-Verweis');
  assert.match(f.html, /window\.ANMACHA_CAST = \{"s":"main","only":"requests","theme":"light","api":"https:\/\/radio\.example\.de"\};/);
  assert.match(f.html, /src="https:\/\/radio\.example\.de\/icons\/icon-192\.png"/);
  assert.match(f.html, /api\/v1\/public\/stations/, 'Hörer-Skript eingebettet');
  const scripts = f.html.match(/<script>/g)?.length ?? 0;
  assert.equal(scripts, 2);
  assert.equal(f.html.match(/<\/script>/g)?.length, 2, 'eingebettetes Skript wird nicht vorzeitig beendet');
  const p = widgetFile(studio, cleanWidgetOpts({ kind: 'player', api: 'https://radio.example.de' }, 'main'));
  assert.match(p.html, /window\.ANMACHA_CAST = \{"station":"main","api":"https:\/\/radio\.example\.de"\}/);
});

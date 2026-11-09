import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.ANMACHA_CAST_SCREENSHOT_URL || 'http://127.0.0.1:8751';
const token = process.env.ANMACHA_CAST_SCREENSHOT_TOKEN;
if (!token) throw new Error('ANMACHA_CAST_SCREENSHOT_TOKEN fehlt');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
await page.addInitScript((t) => {
  localStorage.setItem('anmachacast.token', t);
  // Profi-Modus: alle Bereiche und Studio-Fenster sichtbar (der Einfach-Modus blendet Spezialfunktionen aus)
  localStorage.setItem('anmacha_cast.navMode', 'pro');
}, token);

try {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-view="studio"]').first().click();
  await page.waitForSelector('#view-studio:not([hidden])');

  // Referenzlayout darf nicht nur CSS sein: alle vier echten Decks und Kernbereiche muessen bedienbar sein.
  assert.equal(await page.locator('#decks .deck').count(), 4, 'vier Decks erwartet');
  await page.waitForSelector('#carts .cart:not(.empty)');
  await page.waitForSelector('#lib-body tr');

  // Cardwall-CUE ist lokales Browser-Audio und darf nicht den Sendetrigger benutzen.
  const cue = page.locator('#carts .cart:not(.empty) .cart-cue').first();
  await cue.click();
  await page.waitForTimeout(250);
  assert.equal(await cue.getAttribute('aria-pressed'), 'true', 'Cardwall-CUE muss lokal starten');
  await cue.click();
  assert.equal(await cue.getAttribute('aria-pressed'), 'false', 'Cardwall-CUE muss lokal stoppbar sein');

  // Echtes HTML5-Drag&Drop: Medium aus dem Archiv auf ein Deck.
  const media = page.locator('#lib-body tr').first();
  const deckD = page.locator('.deck[data-deck="D"]');
  await media.dragTo(deckD);
  await page.waitForFunction(() => {
    const t = document.querySelector('.deck[data-deck="D"] .deck-title')?.textContent?.trim();
    return !!t && t !== '–';
  }, undefined, { timeout: 10_000 });

  // Deck-CUE/PFL muss denselben geladenen Titel lokal vorhoeren, ohne ihn auf Sendung zu schalten.
  const deckCue = deckD.locator('.deck-btn.cue');
  await deckCue.click();
  await page.waitForTimeout(250);
  assert.equal(await deckCue.getAttribute('aria-pressed'), 'true', 'Deck-CUE muss lokal starten');
  await deckCue.click();
  assert.equal(await deckCue.getAttribute('aria-pressed'), 'false', 'Deck-CUE muss lokal stoppbar sein');

  // Queue muss per Drag&Drop wirklich umsortierbar sein.
  await page.waitForSelector('#queue-body .queue-row');
  const rowsBefore = page.locator('#queue-body .queue-row');
  assert.ok(await rowsBefore.count() >= 2, 'Demo braucht mindestens zwei Queue-Eintraege');
  const firstUid = await rowsBefore.nth(0).getAttribute('data-queue-uid');
  const secondUid = await rowsBefore.nth(1).getAttribute('data-queue-uid');
  await rowsBefore.nth(1).dragTo(rowsBefore.nth(0));
  await page.waitForFunction(
    ({ expected }) => document.querySelector('#queue-body .queue-row')?.getAttribute('data-queue-uid') === expected,
    { expected: secondUid },
    { timeout: 10_000 },
  );
  assert.notEqual(firstUid, secondUid, 'Queue-Test braucht verschiedene Eintraege');

  // Kompakter Sendeplan bleibt im Studio, Vollansicht bleibt ueber denselben Workflow erreichbar.
  assert.equal(await page.locator('#studio-schedule').count(), 1);
  await page.locator('#studio-schedule [data-view="planning"]').click();
  await page.waitForSelector('#view-planning:not([hidden])');
  await page.waitForSelector('#view-planning .planning-schedule');
  assert.equal(await page.locator('#view-planning .planning-schedule').count(), 1, 'vollstaendiger Sendeplan fehlt');

  // Responsive Regression: Referenzdesign muss auch auf Laptop, Tablet und Handy ohne Seiten-Overflow funktionieren.
  const noHorizontalOverflow = async (label) => {
    const dims = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    assert.ok(dims.scroll <= dims.inner + 2, `${label}: horizontaler Seiten-Overflow ${dims.scroll}px > ${dims.inner}px`);
  };

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('[data-view="studio"]').first().click();
  await page.waitForSelector('#view-studio:not([hidden])');
  assert.equal(await page.locator('#decks .deck').count(), 4, 'Laptop: vier echte Decks muessen erhalten bleiben');
  await noHorizontalOverflow('Laptop 1280');

  await page.setViewportSize({ width: 900, height: 1000 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.m-home').evaluate((el) => getComputedStyle(el).display !== 'none'), true, 'Tablet: mobile Studio-Uebersicht fehlt');
  await noHorizontalOverflow('Tablet 900');

  await page.setViewportSize({ width: 520, height: 900 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.bottom-nav').evaluate((el) => getComputedStyle(el).display !== 'none'), true, 'Handy: Bottom-Navigation fehlt');
  await noHorizontalOverflow('Handy 520');

  console.log('Browser-Smoke: Referenzlayout, CUE, DragDrop, Sendeplan und Responsive 1280/900/520 OK');
} finally {
  await browser.close();
}

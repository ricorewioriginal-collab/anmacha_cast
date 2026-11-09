import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.ANMACHA_CAST_SCREENSHOT_URL || 'http://127.0.0.1:8751';
const token = process.env.ANMACHA_CAST_SCREENSHOT_TOKEN;
if (!token) throw new Error('ANMACHA_CAST_SCREENSHOT_TOKEN fehlt');

const out = new URL('../docs/screenshots/', import.meta.url);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, deviceScaleFactor: 1 });
await page.addInitScript((t) => {
  localStorage.setItem('anmachacast.token', t);
  // Profi-Modus: alle Bereiche und Studio-Fenster sichtbar (der Einfach-Modus blendet Spezialfunktionen aus)
  localStorage.setItem('anmacha_cast.navMode', 'pro');
}, token);
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#view-overview:not([hidden])', { timeout: 20_000 });
await page.waitForTimeout(800);

async function view(name, file) {
  const button = page.locator(`[data-view="${name}"]`).first();
  const section = button.locator('xpath=ancestor::details[1]');
  if (await section.count() && await section.getAttribute('open') === null) {
    await section.locator('summary').first().click();
  }
  await button.click();
  await page.waitForSelector(`#view-${name}:not([hidden])`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: new URL(file, out).pathname, fullPage: false });
}
async function panel(win, file) {
  await page.locator('[data-view="studio"]').first().click();
  await page.waitForSelector('#view-studio:not([hidden])');
  const target = page.locator(`[data-win="${win}"]`).first();
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await target.screenshot({ path: new URL(file, out).pathname });
}

await page.screenshot({ path: new URL('view-dashboard.png', out).pathname, fullPage: false });
for (const [name, file] of [
  ['studio','view-studio.png'],
  ['planning','view-planning.png'],
  ['mediathek','view-mediathek.png'],
  ['playlists','view-playlists.png'],
  ['recorder','view-recorder.png'],
  ['ai','view-ai.png'],
  ['bridges','view-bridges.png'],
  ['listeners','view-listeners.png'],
  ['users','view-users.png'],
  ['handbuch','view-handbuch.png'],
]) await view(name, file);

for (const [win, file] of [
  ['decks','panel-decks.png'],
  ['carts','panel-carts.png'],
  ['np','panel-np.png'],
  ['lib','panel-lib.png'],
  ['queue','panel-queue.png'],
  ['quick','panel-quick.png'],
  ['live','panel-live.png'],
  ['stream','panel-stream.png'],
  ['playout','panel-playout.png'],
  ['processing','panel-processing.png'],
  ['meters','panel-meters.png'],
  ['sources','panel-sources.png'],
  ['system','panel-system.png'],
]) {
  if (await page.locator(`[data-win="${win}"]`).count()) await panel(win, file);
}

await browser.close();
console.log('AnMaCha-Cast-Screenshots aktualisiert.');

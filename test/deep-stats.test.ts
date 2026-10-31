/**
 * Deep Stats: Heatmap Wochentag × Uhrzeit, Kennzahlen mit Vorperiode, Top/Flop, Interpreten-Anteile,
 * Song-Verlauf je Tag, CSV- und Textfassung, E-Mail nur mit Kanal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnMaChaCastApp } from '../src/server/app.ts';

test('Deep Stats aus Play-Log, Stichproben und Stunden-Aggregat', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cast-deep-'));
  try {
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    const rt = app.rt('main');
    const h = 3_600_000;
    const now = new Date(2026, 9, 2, 14, 30).getTime(); // Freitag
    const e = (at: number, mediaId: string, title: string, artist: string, listeners: number, live = false) => ({ at, mediaId, title, artist, category: 'music', listeners, live });
    rt.data.playLog = [
      e(now - 1 * h, 'a', 'Alpha', 'Ann', 30), e(now - 2 * h, 'a', 'Alpha', 'Ann', 20), e(now - 26 * h, 'a', 'Alpha', 'Ann', 10),
      e(now - 3 * h, 'b', 'Beta', 'Bob', 4, true), e(now - 50 * h, 'c', 'Gamma', 'Ann', 8),
      { at: now - 4 * h, mediaId: 'j', title: 'Jingle', artist: '', category: 'jingle', listeners: 12 },
      // Vorperiode (7 Tage davor): 2 Einsätze
      e(now - 8 * 24 * h, 'a', 'Alpha', 'Ann', 5), e(now - 9 * 24 * h, 'b', 'Beta', 'Bob', 5),
    ];
    rt.data.listenerHours = [{ at: now - 1 * h, sum: 60, n: 2, peak: 40 }, { at: now - 25 * h, sum: 10, n: 1, peak: 10 }];
    rt.data.recapSamples = [{ at: now - 60_000, listeners: 7, bytesTotal: 0 }, { at: now - 120_000, listeners: 9, bytesTotal: 0 }];

    const d = app.svc.stats.deep('main', '7d', now);
    // Heatmap (7d → Stunden-Aggregat): Freitag 13 Uhr Ø 30, Donnerstag 13 Uhr Ø 10
    assert.equal(d.heatmap[4]![13], 30);
    assert.equal(d.heatmap[3]![13], 10);
    assert.equal(d.heatmapPeak, 30);
    assert.equal(d.heatmap[0]![0], null);
    // Vergleich zur Vorperiode
    const played = d.compare.find((c) => c.key === 'played')!;
    assert.equal(played.now, 6);
    assert.equal(played.prev, 2);
    assert.equal(played.delta, 200);
    assert.equal(d.compare.find((c) => c.key === 'unique')!.now, 3);
    assert.equal(d.compare.find((c) => c.key === 'live')!.now, 1);
    // Top/Flop
    assert.equal(d.top[0]!.title, 'Alpha');
    assert.equal(d.top[0]!.plays, 3);
    assert.equal(d.top[0]!.avgListeners, 20);
    assert.equal(d.flop[0]!.title, 'Beta', 'wenigste Hörer');
    // Interpreten-Anteile: Ann 4 von 5 Musik-Einsätzen
    assert.equal(d.artists[0]!.artist, 'Ann');
    assert.equal(d.artists[0]!.share, 80);
    assert.equal(d.artists.reduce((a, x) => a + x.plays, 0), 5);
    // Song-Verlauf: Tage über den Zeitraum, Alpha heute 2× und gestern 1×
    assert.ok(d.trend.days.length >= 8);
    const alpha = d.trend.songs.find((s) => s.title === 'Alpha')!;
    assert.equal(alpha.plays[alpha.plays.length - 1], 2);
    assert.equal(alpha.plays[alpha.plays.length - 2], 1);
    // Kurze Zeiträume nehmen die Stichproben
    const d24 = app.svc.stats.deep('main', '24h', now);
    assert.equal(d24.heatmap[4]![14], 8);
    assert.throws(() => app.svc.stats.deep('main', 'year'), /Zeitraum/);

    const csv = app.svc.stats.deepCsv('main', '7d', now);
    assert.match(csv, /"Kennzahl";"Jetzt";"Vorperiode"/);
    assert.match(csv, /"Top-Songs";"Interpret"/);
    assert.match(csv, /"Heatmap Ø Hörer";"0 Uhr"/);
    assert.match(app.svc.stats.deepText('main', '7d', now), /Top-Songs:\n1\. Ann – Alpha/);
    await assert.rejects(app.svc.stats.emailDeep('main', '7d'), /E-Mail-Kanal/);
    app.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

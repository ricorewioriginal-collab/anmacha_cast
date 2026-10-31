// „anmachacast --new-admin-token“: das ausgegebene Token muss nach dem Beenden gespeichert sein
// (vorher ging es verloren, weil der Prozess vor dem verzögerten Speichern endete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('--new-admin-token speichert das Token dauerhaft', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anmachacast-cli-token-'));
  try {
    const r = spawnSync(process.execPath, [join(import.meta.dirname, '../src/server/main.ts'), '--new-admin-token'], {
      env: { ...process.env, ANMACHA_CAST_DATA: dir, ANMACHA_CAST_PORT: '0' }, encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(r.status, 0, r.stderr);
    const token = /Admin-Token: (ad_\S+)/.exec(r.stdout)?.[1];
    assert.ok(token, 'Token ausgegeben');
    const { AnMaChaCastApp } = await import('../src/server/app.ts');
    const app = new AnMaChaCastApp(dir, { stableMs: 0, ffmpeg: null });
    try {
      const p = app.svc.auth.authenticate(token);
      assert.ok(p, 'Token nach Neustart gültig');
      assert.ok(p!.roles.includes('admin'));
    } finally {
      app.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Update über Admin › Update: npm ci installiert auch die devDependencies (TypeScript).
// Grund: start.cmd setzt NODE_ENV=production. Ohne --include=dev fehlt «tsc» beim Bauen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Updater, type Ausfuehren } from '../src/jobs/update.js';

function updater(aufrufe: string[][], bauenOk = true): Updater {
  const ordner = mkdtempSync(join(tmpdir(), 'ep-update-'));
  const run: Ausfuehren = async (befehl, args) => {
    aufrufe.push([befehl, ...args]);
    if (befehl === 'git' && args[0] === 'rev-parse') return { code: 0, ausgabe: args.includes('--short') ? 'abc1234' : 'abc1234def5678' };
    if (befehl === 'git' && args[0] === 'log') return { code: 0, ausgabe: 'def5678 Neuer Stand' };
    if (befehl === 'npm' && args[0] === 'run') return bauenOk ? { code: 0, ausgabe: '' } : { code: 1, ausgabe: 'Fehler' };
    return { code: 0, ausgabe: '' };
  };
  const u = new Updater({
    appDir: ordner, dataDir: join(ordner, 'data'), exportDir: join(ordner, 'export'), branch: 'main',
    sichern: async () => undefined, neustart: () => undefined, ausfuehren: run,
  });
  test.after(() => rmSync(ordner, { recursive: true, force: true }));
  return u;
}

async function warteBisFertig(u: Updater): Promise<void> {
  for (let i = 0; i < 200 && u.zustand.laeuft; i++) await new Promise((ok) => setTimeout(ok, 10));
}

test('Update: npm ci installiert die devDependencies, auch beim Rückweg zum alten Stand', async () => {
  const aufrufe: string[][] = [];
  const u = updater(aufrufe, false);
  await u.pruefe();
  assert.equal(u.zustand.phase, 'geprueft');
  assert.equal(u.starte(), true);
  await warteBisFertig(u);
  assert.equal(u.zustand.phase, 'fehler');
  const ci = aufrufe.filter((a) => a[0] === 'npm' && a[1] === 'ci');
  assert.equal(ci.length, 2);
  for (const a of ci) assert.ok(a.includes('--include=dev'), `npm ci ohne --include=dev: ${a.join(' ')}`);
  assert.ok(aufrufe.some((a) => a[0] === 'git' && a[1] === 'reset' && a.includes('abc1234def5678')));
});

test('Update: erfolgreicher Ablauf endet mit «fertig»', async () => {
  const aufrufe: string[][] = [];
  const u = updater(aufrufe, true);
  await u.pruefe();
  u.starte();
  await warteBisFertig(u);
  assert.equal(u.zustand.phase, 'fertig');
  assert.ok(aufrufe.some((a) => a[0] === 'npm' && a[1] === 'ci' && a.includes('--include=dev')));
});

// Update über Admin › Update: npm ci installiert auch die devDependencies (TypeScript).
// Grund: start.cmd setzt NODE_ENV=production. Ohne --include=dev fehlt «tsc» beim Bauen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Updater, type Ausfuehren } from '../src/jobs/update.js';

function updater(aufrufe: string[][], bauenOk = true, neueCommits = 'def5678 Neuer Stand', neustarts: number[] = []): Updater {
  const ordner = mkdtempSync(join(tmpdir(), 'ep-update-'));
  const envDatei = join(ordner, 'einsatzplaner.env');
  writeFileSync(envDatei, 'PORT=3010\n');
  const run: Ausfuehren = async (befehl, args) => {
    aufrufe.push([befehl, ...args]);
    if (befehl === 'git' && args[0] === 'rev-parse') return { code: 0, ausgabe: args.includes('--short') ? 'abc1234' : 'abc1234def5678' };
    if (befehl === 'git' && args[0] === 'log') return { code: 0, ausgabe: neueCommits };
    if (befehl === 'npm' && args[0] === 'run') return bauenOk ? { code: 0, ausgabe: '' } : { code: 1, ausgabe: 'Fehler' };
    return { code: 0, ausgabe: '' };
  };
  const u = new Updater({
    appDir: ordner, dataDir: join(ordner, 'data'), exportDir: join(ordner, 'export'), branch: 'main',
    sichern: async (datei) => writeFileSync(datei, '-- Sicherung'), envDatei, neustart: () => neustarts.push(1), ausfuehren: run,
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

test('Update installieren: ein Knopf sucht, sichert Datenbank und Konfiguration, installiert und startet neu', async () => {
  const aufrufe: string[][] = [];
  const neustarts: number[] = [];
  const u = updater(aufrufe, true, 'def5678 Neuer Stand', neustarts);
  assert.equal(u.installiere(), true);
  // Ein zweiter Klick während des Laufs ändert nichts.
  assert.equal(u.installiere(), false);
  await warteBisFertig(u);
  while (u.zustand.phase === 'geprueft' || u.zustand.laeuft) await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(u.zustand.phase, 'fertig');
  assert.ok(aufrufe.some((a) => a[0] === 'git' && a[1] === 'fetch'));
  assert.ok(aufrufe.some((a) => a[0] === 'git' && a[1] === 'merge'));
  const texte = u.zustand.schritte.map((s) => s.text);
  assert.ok(texte.some((t) => t.startsWith('Datenbank gesichert')));
  const envSchritt = texte.find((t) => t.startsWith('Konfiguration gesichert'));
  assert.ok(envSchritt, 'Die Konfiguration muss gesichert sein.');
  const ordner = envSchritt!.replace('Konfiguration gesichert: ', '').replace(/[\\/][^\\/]+$/, '');
  const env = readdirSync(ordner).filter((n) => n.endsWith('.env'));
  assert.equal(env.length, 1);
  assert.equal(readFileSync(join(ordner, env[0]), 'utf8'), 'PORT=3010\n');
  await new Promise((ok) => setTimeout(ok, 1600));
  assert.equal(neustarts.length, 1);
});

test('Update installieren ohne neuen Stand: keine Sicherung, kein Neustart', async () => {
  const aufrufe: string[][] = [];
  const neustarts: number[] = [];
  const u = updater(aufrufe, true, '', neustarts);
  assert.equal(u.installiere(), true);
  await warteBisFertig(u);
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(u.zustand.phase, 'geprueft');
  assert.equal(u.zustand.neueCommits.length, 0);
  assert.ok(!aufrufe.some((a) => a[0] === 'git' && a[1] === 'merge'));
  assert.ok(!u.zustand.schritte.some((s) => s.text.startsWith('Datenbank gesichert')));
  assert.equal(neustarts.length, 0);
});

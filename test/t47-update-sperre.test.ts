// T47: Sperre während eines Updates (Wunsch Yann, 23.11.2026).
// Während das Update läuft, sperrt jede Seite die Eingaben. Der Server speichert keine Änderungen.
// Die Live-Meldungen tragen Start-Kennung und Sperre. Nach dem Neustart lädt die Seite die neue Version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { beendeLive } from '../src/web/routes-live.js';
import { START_ID, setzeWartung, wartung } from '../src/web/wartung.js';
import { Updater, type Ausfuehren } from '../src/jobs/update.js';

async function leseBis(leser: ReadableStreamDefaultReader<Uint8Array>, pruefe: (e: string, d: any) => boolean): Promise<any> {
  const dekoder = new TextDecoder();
  let puffer = '';
  const ende = Date.now() + 3000;
  while (Date.now() < ende) {
    const { value, done } = await leser.read();
    if (done) break;
    puffer += dekoder.decode(value, { stream: true });
    let i;
    while ((i = puffer.indexOf('\n\n')) >= 0) {
      const block = puffer.slice(0, i);
      puffer = puffer.slice(i + 2);
      const e = /^event: (.*)$/m.exec(block)?.[1];
      const d = /^data: (.*)$/m.exec(block)?.[1];
      if (e && d && pruefe(e, JSON.parse(d))) return JSON.parse(d);
    }
  }
  throw new Error('Kein passendes Ereignis erhalten.');
}

test('T47 Während eines Updates speichert der Server nichts, die Seiten erhalten die Sperre live', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    await person(t.db, 1);
    const s = await einsatz(t.db, 'Sperre', inTagen(3, 8), inTagen(3, 12));
    const aid = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, null);
    const { cookie, csrf } = await anmelden(t.db, 'aufgebot');

    // Ohne Sperre: Start-Kennung auf der Seite und im Live-Stand, keine Sperre.
    const seite = await (await fetch(`${app.url}/einsaetze/${s.einsatzId}`, { headers: { cookie } })).text();
    assert.match(seite, new RegExp(`data-start="${START_ID}"`));
    assert.doesNotMatch(seite, /data-wartung=/);
    assert.match(seite, /\/static\/wartung\.js\?v=/);
    const j0 = await (await fetch(`${app.url}/live/stand`, { headers: { cookie } })).json();
    assert.equal(j0.start, START_ID);
    assert.equal(j0.wartung, null);

    const ab = new AbortController();
    const r = await fetch(`${app.url}/live`, { headers: { cookie }, signal: ab.signal });
    const leser = r.body!.getReader();
    const stand = await leseBis(leser, (e) => e === 'stand');
    assert.equal(stand.start, START_ID);
    assert.equal(stand.wartung, null);

    // Das Update beginnt: Alle offenen Seiten erhalten sofort die Sperre.
    setzeWartung('update');
    const w = await leseBis(leser, (e) => e === 'wartung');
    assert.equal(w.wartung, 'update');
    assert.equal(w.start, START_ID);

    // Eine Seite, die jetzt lädt, zeigt die Sperre gleich an.
    const gesperrt = await (await fetch(`${app.url}/einsaetze/${s.einsatzId}`, { headers: { cookie } })).text();
    assert.match(gesperrt, /data-wartung="update"/);
    assert.match(gesperrt, /wartung-hinweis/);

    // Eine Änderung während der Sperre: 503 mit Kennzeichen, die Datenbank bleibt unverändert.
    const post = await fetch(`${app.url}/anmeldungen/${aid}`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-live-formular': '1' },
      body: new URLSearchParams({ _csrf: csrf, status: 'bestaetigt' }),
    });
    assert.equal(post.status, 503);
    assert.equal(post.headers.get('x-wartung'), 'update');
    assert.match(await post.text(), /noch nicht gespeichert/);
    const z = await zeilen(t.db, 'SELECT status FROM anmeldung WHERE id = ?', [aid]);
    assert.equal(z[0].status, 'angemeldet');

    // Ohne gültiges Token bleibt es bei 403 (die CSRF-Prüfung kommt zuerst).
    const ohneToken = await fetch(`${app.url}/anmeldungen/${aid}`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'status=bestaetigt',
    });
    assert.equal(ohneToken.status, 403);

    // Lesen geht weiter. Abmelden geht weiter.
    assert.equal((await fetch(`${app.url}/einsaetze`, { headers: { cookie } })).status, 200);

    // Das Update bricht ab: Die Sperre endet, Speichern geht wieder.
    setzeWartung(null);
    const frei = await leseBis(leser, (e) => e === 'wartung');
    assert.equal(frei.wartung, null);
    const nachher = await fetch(`${app.url}/anmeldungen/${aid}`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, status: 'bestaetigt' }),
    });
    assert.equal(nachher.status, 303);
    ab.abort();
  } finally {
    setzeWartung(null);
    beendeLive();
    await app.stopp();
    await t.ende();
  }
});

test('T47 Das Update setzt die Sperre ab dem Sichern und hebt sie bei einem Fehler auf', async () => {
  const lauf = async (bauenOk: boolean) => {
    const ordner = mkdtempSync(join(tmpdir(), 'ep-sperre-'));
    const verlauf: (boolean | string)[] = [];
    const run: Ausfuehren = async (befehl, args) => {
      if (befehl === 'git' && args[0] === 'rev-parse') return { code: 0, ausgabe: args.includes('--short') ? 'abc1234' : 'abc1234def5678' };
      if (befehl === 'git' && args[0] === 'log') return { code: 0, ausgabe: 'def5678 Neu' };
      if (befehl === 'npm' && args[0] === 'run') {
        verlauf.push(`bauen, Sperre ${wartung() ? 'an' : 'aus'}`);
        return bauenOk ? { code: 0, ausgabe: '' } : { code: 1, ausgabe: 'Fehler' };
      }
      return { code: 0, ausgabe: '' };
    };
    const u = new Updater({
      appDir: ordner, dataDir: join(ordner, 'data'), exportDir: join(ordner, 'export'), branch: 'main',
      sichern: async (datei) => {
        verlauf.push(`sichern, Sperre ${wartung() ? 'an' : 'aus'}`);
        writeFileSync(datei, '-- Sicherung');
      },
      neustart: () => verlauf.push('neustart'),
      wartung: (an) => { verlauf.push(an); setzeWartung(an ? 'update' : null); },
      ausfuehren: run,
    });
    try {
      // Nur suchen sperrt nichts.
      await u.pruefe();
      assert.equal(wartung(), null);
      u.starte();
      for (let i = 0; i < 300 && (u.zustand.laeuft || (bauenOk && !verlauf.includes('neustart'))); i++) await new Promise((ok) => setTimeout(ok, 10));
      return { verlauf, phase: u.zustand.phase, sperre: wartung() };
    } finally {
      setzeWartung(null);
      rmSync(ordner, { recursive: true, force: true });
    }
  };

  const gut = await lauf(true);
  assert.equal(gut.phase, 'fertig');
  assert.deepEqual(gut.verlauf.slice(0, 2), [true, 'sichern, Sperre an']);
  assert.ok(gut.verlauf.includes('bauen, Sperre an'));
  // Bis zum Neustart bleibt die Sperre. Die neue Version hebt sie auf (neue Start-Kennung).
  assert.equal(gut.sperre?.grund, 'update');
  assert.ok(!gut.verlauf.includes(false));

  const schlecht = await lauf(false);
  assert.equal(schlecht.phase, 'fehler');
  assert.equal(schlecht.verlauf[0], true);
  assert.equal(schlecht.verlauf[schlecht.verlauf.length - 1], false);
  assert.equal(schlecht.sperre, null);
});

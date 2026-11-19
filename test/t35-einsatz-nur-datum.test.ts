// T35 (Wunsch Yann 19.11.2026): Ein neuer Einsatz braucht nur Name und Startdatum.
// Enddatum leer = gleicher Tag. Zeiten leer = «Zeit offen», später nachtragen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inTagen, neueDatenbank } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { erstelleEinsatz } from '../src/domain/einsatz.js';
import { ladeSchicht, schichtenVonEinsatz, speichereSchichtTabelle, zeilenAbdruck, anzeigeZeiten } from '../src/domain/schicht.js';
import { lokalesDatum, lokaleZeit } from '../src/domain/zeit.js';

test('T35 Neuer Einsatz nur mit Datum: Zeit offen, gleicher Tag, später nachtragen', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const tag = lokalesDatum(inTagen(20, 9));

    // Nur Name und Startdatum.
    const id = await erstelleEinsatz(t.db, { name: 'Herbstmesse', start_datum: tag, start_zeit: '', end_datum: '', end_zeit: '' }, null);
    const [s] = await schichtenVonEinsatz(t.db, id);
    assert.equal(Number(s.zeit_offen), 1);
    assert.equal(lokalesDatum(s.start_zeit), tag);
    assert.equal(lokalesDatum(s.end_zeit), tag);
    assert.deepEqual(anzeigeZeiten(s), { beginn: '', ende: '' });

    // Ohne Datum geht es nicht. Ohne Name auch nicht (Entscheid Yann).
    await assert.rejects(erstelleEinsatz(t.db, { name: 'X', start_datum: '', start_zeit: '', end_datum: '', end_zeit: '' }, null), /Datum/);
    await assert.rejects(erstelleEinsatz(t.db, { name: '', start_datum: tag, start_zeit: '', end_datum: '', end_zeit: '' }, null), /Name/);

    // Zeiten ohne Enddatum: gleicher Tag. Ende vor Beginn: Folgetag.
    const id2 = await erstelleEinsatz(t.db, { name: 'Lauf', start_datum: tag, start_zeit: '13:00', end_datum: '', end_zeit: '18:00' }, null);
    const [s2] = await schichtenVonEinsatz(t.db, id2);
    assert.equal(Number(s2.zeit_offen), 0);
    assert.equal(lokalesDatum(s2.end_zeit), tag);
    assert.equal(lokaleZeit(s2.end_zeit), '18:00');
    const id3 = await erstelleEinsatz(t.db, { name: 'Nacht', start_datum: tag, start_zeit: '22:00', end_datum: '', end_zeit: '02:00' }, null);
    const [s3] = await schichtenVonEinsatz(t.db, id3);
    assert.ok(lokalesDatum(s3.end_zeit) > tag);

    // Die Seite zeigt «Zeit offen» und den Punkt in «Zu tun».
    const { cookie } = await anmelden(t.db, 'aufgebot');
    const hole = async (pfad: string) => (await fetch(`${app.url}${pfad}`, { headers: { cookie } })).text();
    const seite = await hole(`/einsaetze/${id}`);
    assert.match(seite, /Zeit offen/);
    assert.match(seite, /Beginn oder Ende fehlt noch\./);

    // Formular «Neuer Einsatz»: nur Name und Startdatum mit «required».
    const neu = await hole('/einsaetze/neu');
    assert.match(neu, /name="start_datum" required/);
    assert.doesNotMatch(neu, /name="start_zeit" required/);
    assert.doesNotMatch(neu, /name="end_datum" required/);
    assert.doesNotMatch(neu, /name="end_zeit" required/);

    // Zeiten in der Tabelle nachtragen: Die Zeit ist danach nicht mehr offen.
    const z = { name: s.name, datum: tag, beginn: '', ende: '', soll_anzahl: '', ort: '', bemerkung_intern: '', rollen: {} };
    await speichereSchichtTabelle(t.db, id, [{ ...z, id: s.id, version: s.version, ursprung: zeilenAbdruck(z), beginn: '10:00', ende: '16:00' }], null);
    const s4 = await ladeSchicht(t.db, s.id);
    assert.equal(Number(s4.zeit_offen), 0);
    assert.equal(lokaleZeit(s4.start_zeit), '10:00');
  } finally {
    await app.stopp();
    await t.ende();
  }
});

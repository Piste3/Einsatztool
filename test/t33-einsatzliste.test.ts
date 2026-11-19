// T33: Einsatz-Liste nach Handbuch (Bild 6): Antreten, Status, Besetzung je Schicht, Neu, Bestätigt, Einsatzleitung, Filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, rang } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { einsatzListe } from '../src/domain/einsatz.js';

test('T33 Einsatz-Liste: Spalten, Einsatzleitung und Filter', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const r = await rang(t.db, 'Fw', 5);
    await person(t.db, 7, { vorname: 'Marco', nachname: 'Rüegg', rang_id: r });
    await person(t.db, 8, { vorname: 'Lea', nachname: 'Vogel', rang_id: r });
    const a = await einsatz(t.db, 'Herbstmesse', inTagen(5, 12), inTagen(5, 18), 'Claraplatz');
    const b = await einsatz(t.db, 'Neujahrsapéro', inTagen(40, 10), inTagen(40, 12), 'Rathaus');
    await t.db.query('UPDATE schicht SET publiziert = 0, soll_anzahl = 8 WHERE id = ?', [b.schichtId]);
    await t.db.query("INSERT IGNORE INTO rolle (name, reihenfolge, zaehlt_teilnehmer) VALUES ('Einsatzleitung', 1, 1)");
    const jetzt = new Date().toISOString();
    await t.db.query(
      `INSERT INTO anmeldung (schicht_id, person_id, name_text, status, rolle, kanal, erstellt_am, geaendert_am) VALUES
        (?, 7, 'Marco Rüegg', 'bestaetigt', 'Einsatzleitung', 'telefon', ?, ?),
        (?, 8, 'Lea Vogel', 'angemeldet', NULL, 'telefon', ?, ?)`,
      [a.schichtId, jetzt, jetzt, a.schichtId, jetzt, jetzt],
    );

    const alleE = await einsatzListe(t.db, 'kommend');
    const ea = alleE.find((e) => e.id === a.einsatzId)!;
    assert.equal(ea.publiziert, true);
    assert.equal(ea.bestaetigt, 1);
    assert.equal(ea.unbestaetigt, 1);
    assert.deepEqual(ea.einsatzleitung, ['Fw Marco Rüegg']);
    assert.equal(ea.antretenOrt, 'Claraplatz');
    assert.equal(ea.schichtListe.length, 1);
    const eb = alleE.find((e) => e.id === b.einsatzId)!;
    assert.equal(eb.publiziert, false);
    assert.equal(eb.schichtListe[0].soll, 8);

    // Filter: nur Entwürfe, nur im Formular, Zeitraum.
    assert.deepEqual((await einsatzListe(t.db, 'kommend', { status: 'entwurf' })).map((e) => e.id), [b.einsatzId]);
    assert.deepEqual((await einsatzListe(t.db, 'kommend', { status: 'publiziert' })).map((e) => e.id), [a.einsatzId]);
    const tag = (d: Date) => d.toISOString().slice(0, 10);
    assert.deepEqual((await einsatzListe(t.db, 'kommend', { von: tag(inTagen(20, 0)) })).map((e) => e.id), [b.einsatzId]);
    assert.deepEqual((await einsatzListe(t.db, 'kommend', { bis: tag(inTagen(20, 0)) })).map((e) => e.id), [a.einsatzId]);

    // Seite: Spalten und Werte. Ungültige Filterwerte gelten als leer.
    const { cookie } = await anmelden(t.db);
    const seite = await (await fetch(`${app.url}/einsaetze?status=xyz&von=boese`, { headers: { cookie } })).text();
    for (const spalte of ['Datum', 'Antreten', 'Status', 'Besetzung', 'Neu', 'Bestätigt', 'Einsatzleitung']) assert.match(seite, new RegExp(`<th[^>]*>${spalte}</th>`));
    assert.match(seite, /Im Formular/);
    assert.match(seite, /Entwurf/);
    assert.match(seite, /Fw Marco Rüegg/);
    assert.match(seite, /Ganzer Einsatz/);
    const entwuerfe = await (await fetch(`${app.url}/einsaetze?status=entwurf`, { headers: { cookie } })).text();
    assert.doesNotMatch(entwuerfe, /Herbstmesse/);
    assert.match(entwuerfe, /Neujahrsap/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

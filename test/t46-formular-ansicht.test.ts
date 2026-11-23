// T46: Ansicht eines Eingangs (Wunsch Yann 23.11.2026). Das Formular so, wie es beim Ausfüllen aussah,
// mit allen Angaben und der Original-Bemerkung. Ältere Eingänge rekonstruiert das Tool und kennzeichnet das.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { verarbeiteFormular } from '../src/domain/formular.js';
import { formularAnsicht } from '../src/domain/formular-ansicht.js';
import { aendereAnmeldung } from '../src/domain/anmeldung.js';
import { setzePubliziert } from '../src/domain/schicht.js';
import { loeschePersonendaten } from '../src/domain/import-clubdesk.js';
import { schreibe, transaktion } from '../src/db/db.js';

test('T46 Momentaufnahme: Formular beim Absenden, Original-Bemerkung, später bearbeitet', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const a = await einsatz(t.db, 'Herbstmesse', inTagen(10, 12), inTagen(10, 16));
    const b = await einsatz(t.db, 'Stadtlauf', inTagen(12, 8), inTagen(12, 12));
    await person(t.db, 1, { vorname: 'Ana', nachname: 'Muster' });
    const { anmeldungIds } = await verarbeiteFormular(t.db, {
      vorname: 'Ana', nachname: 'Muster',
      bemerkungen: { [a.einsatzId]: 'Komme <später>', [b.einsatzId]: 'Nur am Morgen' },
      schichten: [String(a.schichtId)],
    });
    const [eingang] = await zeilen<{ id: number }>(t.db, 'SELECT id FROM formular_eingang');

    // Später: Ein Benutzer ändert die Bemerkung. Der Stadtlauf heisst anders und ist nicht mehr publiziert.
    const { cookie, benutzerId } = await anmelden(t.db, 'aufgebot');
    await aendereAnmeldung(t.db, anmeldungIds[0], { bemerkung: 'Kommt um 13 Uhr' }, benutzerId);
    await schreibe(t.db, "UPDATE einsatz SET name = 'Stadtlauf neu' WHERE id = ?", [b.einsatzId]);
    await schreibe(t.db, "UPDATE schicht SET name = 'Stadtlauf neu' WHERE id = ?", [b.schichtId]);
    await setzePubliziert(t.db, b.schichtId, false);

    const x = await formularAnsicht(t.db, eingang.id);
    assert.equal(x.art, 'momentaufnahme');
    assert.deepEqual(x.schichten.map((s) => s.einsatz_name), ['Herbstmesse', 'Stadtlauf']);
    assert.deepEqual(x.gewaehlt, [a.schichtId]);
    assert.equal(x.vorname, 'Ana');
    assert.equal(x.nachname, 'Muster');
    assert.equal(x.bemerkungen[String(a.einsatzId)], 'Komme <später>');
    assert.equal(x.bemerkungen[String(b.einsatzId)], 'Nur am Morgen');
    assert.equal(x.spaeter.length, 1);
    assert.equal(x.spaeter[0].original, 'Komme <später>');
    assert.equal(x.spaeter[0].aktuell, 'Kommt um 13 Uhr');
    assert.equal(x.spaeter[0].benutzer, 'Test aufgebot');

    // Seite «Formular»: Knopf «Ansicht» öffnet das Fenster.
    const liste = await (await fetch(`${app.url}/formular`, { headers: { cookie } })).text();
    assert.match(liste, new RegExp(`href="/formular/eingang/${eingang.id}\\?zurueck=[^"]*" data-eintrag data-fenster="breit"`));

    // Fenster (nur Inhalt): gewählte Schicht angehakt und gesperrt, alter Name, Bemerkung maskiert, kein Knopf «Anmelden».
    const r = await fetch(`${app.url}/formular/eingang/${eingang.id}`, { headers: { cookie, 'X-Fragment': '1' } });
    assert.equal(r.status, 200);
    const teil = await r.text();
    assert.doesNotMatch(teil, /<html/);
    assert.match(teil, /Momentaufnahme/);
    assert.match(teil, new RegExp(`value="${a.schichtId}" checked disabled`));
    assert.match(teil, new RegExp(`value="${b.schichtId}" disabled`));
    assert.match(teil, /<h3>Stadtlauf<\/h3>/);
    assert.doesNotMatch(teil, /Stadtlauf neu/);
    assert.match(teil, /value="Ana" readonly/);
    assert.match(teil, /readonly>Komme &lt;später&gt;<\/textarea>/);
    assert.match(teil, /Bemerkung später bearbeitet/);
    assert.match(teil, /Kommt um 13 Uhr/);
    assert.doesNotMatch(teil, /<form/);
    assert.doesNotMatch(teil, /Komme <später>/);

    // Ohne Skript: ganze Seite. Unbekannte ID: 404.
    const ganz = await (await fetch(`${app.url}/formular/eingang/${eingang.id}`, { headers: { cookie } })).text();
    assert.match(ganz, /<html/);
    assert.match(ganz, /Formular von Ana Muster/);
    assert.equal((await fetch(`${app.url}/formular/eingang/999999`, { headers: { cookie } })).status, 404);
    // Nur angemeldete Benutzer.
    const ohne = await fetch(`${app.url}/formular/eingang/${eingang.id}`, { redirect: 'manual' });
    assert.notEqual(ohne.status, 200);

    // Personendaten löschen: Name und Bemerkungen verschwinden auch aus der Momentaufnahme.
    await transaktion(t.db, (c) => loeschePersonendaten(c, 1, null));
    const weg = await formularAnsicht(t.db, eingang.id);
    assert.equal(weg.geloescht, true);
    assert.equal(weg.vorname, '');
    assert.deepEqual(weg.bemerkungen, {});
    assert.equal(weg.spaeter.length, 0);
    const [roh] = await zeilen<{ eingabe: string | null; formular: string }>(t.db, 'SELECT eingabe, formular FROM formular_eingang WHERE id = ?', [eingang.id]);
    assert.equal(roh.eingabe, null);
    assert.doesNotMatch(roh.formular, /Muster|Komme/);
    const seite = await (await fetch(`${app.url}/formular/eingang/${eingang.id}`, { headers: { cookie, 'X-Fragment': '1' } })).text();
    assert.match(seite, /Gelöschte Person 1/);
    assert.doesNotMatch(seite, /Komme|Kommt um 13/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

test('T46 Rekonstruktion: Eingang ohne Momentaufnahme, Bemerkung aus dem Statusprotokoll', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const a = await einsatz(t.db, 'Herbstmesse', inTagen(10, 12), inTagen(10, 16));
    const b = await einsatz(t.db, 'Stadtlauf', inTagen(12, 8), inTagen(12, 12));
    const { anmeldungIds } = await verarbeiteFormular(t.db, {
      vorname: 'Lea', nachname: 'Neu Meier', bemerkungen: { [a.einsatzId]: 'Bringe Velo' }, schichten: [String(a.schichtId)],
    });
    // Eingang wie vor dem 20.11.2026: nachgetragen, ohne Momentaufnahme und ohne Bemerkung im Eingang.
    await schreibe(t.db, 'UPDATE formular_eingang SET formular = NULL, eingabe = NULL, nachgetragen = 1');
    await schreibe(t.db, 'UPDATE formular_eingang_schicht SET bemerkung = NULL');
    const [eingang] = await zeilen<{ id: number }>(t.db, 'SELECT id FROM formular_eingang');
    const { cookie, benutzerId } = await anmelden(t.db, 'aufgebot');
    await aendereAnmeldung(t.db, anmeldungIds[0], { bemerkung: 'Velo geklärt' }, benutzerId);
    // Ein Einsatz, der erst nach dem Eingang entsteht, gehört nicht ins rekonstruierte Formular.
    await schreibe(t.db, "UPDATE einsatz SET erstellt_am = '2999-01-01T00:00:00.000Z' WHERE id = ?", [b.einsatzId]);

    const x = await formularAnsicht(t.db, eingang.id);
    assert.equal(x.art, 'rekonstruiert');
    assert.deepEqual(x.schichten.map((s) => s.id), [a.schichtId]);
    assert.deepEqual(x.gewaehlt, [a.schichtId]);
    assert.equal(x.vorname, 'Lea');
    assert.equal(x.nachname, 'Neu Meier');
    assert.equal(x.bemerkungen[String(a.einsatzId)], 'Bringe Velo');
    assert.equal(x.bemerkungAusProtokoll, true);
    assert.equal(x.spaeter.length, 1);
    assert.equal(x.spaeter[0].aktuell, 'Velo geklärt');

    const teil = await (await fetch(`${app.url}/formular/eingang/${eingang.id}`, { headers: { cookie, 'X-Fragment': '1' } })).text();
    assert.match(teil, /Rekonstruiert\./);
    assert.match(teil, /Statusprotokoll/);
    assert.match(teil, /readonly>Bringe Velo<\/textarea>/);
    assert.doesNotMatch(teil, /<h3>Stadtlauf<\/h3>/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

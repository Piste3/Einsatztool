// T29: Rückmeldungen – Feld anklicken, Person eintragen und Status ändern (Bedienung nach Handbuch).
// Das Fenster nutzt die bestehenden Routen. Regeln, Konfliktschutz und Statusprotokoll bleiben gleich.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, rang, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';

test('T29 Rückmeldungen: Feld öffnet das Fenster, Eintragen und Ändern laufen über die bestehenden Routen', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const r = await rang(t.db, 'Sdt', 1);
    await person(t.db, 7, { vorname: 'Nina', nachname: 'Baumann', rang_id: r, telefon: '079 111 22 33' });
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(5, 12), inTagen(5, 18), 'Claraplatz');
    const { cookie, csrf } = await anmelden(t.db);
    const hole = (pfad: string, kopf: Record<string, string> = {}) => fetch(`${app.url}${pfad}`, { headers: { cookie, ...kopf }, redirect: 'manual' });

    // Die Tabelle verlinkt jedes Feld auf das Fenster.
    const tabelle = await (await hole('/rueckmeldungen')).text();
    assert.match(tabelle, new RegExp(`/rueckmeldungen/eintrag\\?schicht=${s.schichtId}&amp;person=7`));

    // Fenster ohne Eintrag: Formular zum Eintragen, nur der Inhalt.
    const leer = await (await hole(`/rueckmeldungen/eintrag?schicht=${s.schichtId}&person=7&zurueck=/rueckmeldungen`, { 'X-Fragment': '1' })).text();
    assert.doesNotMatch(leer, /<html/);
    assert.match(leer, new RegExp(`action="/schichten/${s.schichtId}/anmeldungen"`));
    assert.match(leer, /nicht gefragt/);
    // Bestätigen geht im Fenster noch nicht.
    assert.doesNotMatch(leer, /value="bestaetigt"/);
    assert.match(leer, /value="unsicher"/);

    const post = (pfad: string, felder: Record<string, string>) =>
      fetch(`${app.url}${pfad}`, {
        method: 'POST', redirect: 'manual',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: csrf, zurueck: '/rueckmeldungen?monate=3', ...felder }),
      });
    const a1 = await post(`/schichten/${s.schichtId}/anmeldungen`, { person: '7', status: 'nachricht_gesendet', kanal: 'whatsapp', rolle: '' });
    assert.equal(a1.status, 303);
    assert.equal(a1.headers.get('location'), '/rueckmeldungen?monate=3');

    // Fenster mit Eintrag: Formular zum Ändern mit Version (Konfliktschutz) und Verlauf.
    const [a] = await zeilen(t.db, 'SELECT id, version, status FROM anmeldung WHERE person_id = 7');
    assert.equal(a.status, 'nachricht_gesendet');
    const voll = await (await hole(`/rueckmeldungen/eintrag?schicht=${s.schichtId}&person=7&zurueck=/rueckmeldungen`, { 'X-Fragment': '1' })).text();
    assert.match(voll, new RegExp(`action="/anmeldungen/${a.id}"`));
    assert.match(voll, new RegExp(`name="version" value="${a.version}"`));
    assert.match(voll, /Verlauf \(1\)/);

    const a2 = await post(`/anmeldungen/${a.id}`, { status: 'angemeldet', kanal: 'telefon', rolle: '', bemerkung: 'Zusage am Telefon', version: String(a.version) });
    assert.equal(a2.status, 303);
    // Alte Version: Das Tool speichert nichts (Konflikt). Es führt zurück zur Ansicht und zeigt den Fehler als Meldung.
    const a3 = await post(`/anmeldungen/${a.id}`, { status: 'abgemeldet', kanal: 'telefon', rolle: '', bemerkung: '', version: String(a.version) });
    assert.equal(a3.headers.get('location'), '/rueckmeldungen?monate=3');
    const [nachher] = await zeilen(t.db, 'SELECT status, bemerkung FROM anmeldung WHERE id = ?', [a.id]);
    assert.deepEqual([nachher.status, nachher.bemerkung], ['angemeldet', 'Zusage am Telefon']);
    const log = await zeilen(t.db, 'SELECT aktion FROM status_log WHERE anmeldung_id = ?', [a.id]);
    assert.ok(log.length >= 2, 'Jede Änderung steht im Statusprotokoll.');

    // Ohne Skript: ganze Seite. Eine fremde Rücksprung-Adresse gilt nicht.
    const seite = await (await hole(`/rueckmeldungen/eintrag?schicht=${s.schichtId}&person=7&zurueck=//boese.example`)).text();
    assert.match(seite, /<html/);
    assert.doesNotMatch(seite, /boese\.example/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

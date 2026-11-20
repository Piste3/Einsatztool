// T30: Bemerkung bei der Anmeldung (Wunsch Yann 19.11.2026).
// Die Person gibt die Bemerkung im Formular ein. Die Aufgebotsstelle sieht und bearbeitet sie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, rang, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { verarbeiteFormular } from '../src/domain/formular.js';

test('T30 Bemerkung: Formular speichert sie, Aufgebot sieht und bearbeitet sie mit Statusprotokoll', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const r = await rang(t.db, 'Sdt', 1);
    await person(t.db, 7, { vorname: 'Nina', nachname: 'Baumann', rang_id: r });
    await person(t.db, 8, { vorname: 'Tim', nachname: 'Graf', rang_id: r });
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(5, 12), inTagen(5, 18), 'Claraplatz');
    const { cookie, csrf } = await anmelden(t.db, 'aufgebot');
    const hole = (pfad: string, kopf: Record<string, string> = {}) => fetch(`${app.url}${pfad}`, { headers: { cookie, ...kopf }, redirect: 'manual' });
    const post = (pfad: string, felder: Record<string, string>) =>
      fetch(`${app.url}${pfad}`, {
        method: 'POST', redirect: 'manual',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: csrf, zurueck: `/schichten/${s.schichtId}`, ...felder }),
      });

    // Das öffentliche Formular hat das Feld «Bemerkung».
    const formular = await (await fetch(`${app.url}/anmeldung`)).text();
    assert.match(formular, new RegExp(`name="bemerkung_${s.einsatzId}"`));

    // Die Person gibt die Bemerkung bei der Anmeldung ein.
    const f = await verarbeiteFormular(t.db, { vorname: 'Nina', nachname: 'Baumann', bemerkungen: { [String(s.einsatzId)]: 'Komme erst um 13 Uhr <b>' }, schichten: [String(s.schichtId)] });
    const [a] = await zeilen(t.db, 'SELECT id, version, bemerkung FROM anmeldung WHERE id = ?', [f.anmeldungIds[0]]);
    assert.equal(a.bemerkung, 'Komme erst um 13 Uhr <b>');

    // «Besetzen» zeigt die Bemerkung maskiert.
    const schicht = await (await hole(`/einsaetze/${s.einsatzId}/besetzen`)).text();
    assert.match(schicht, /Komme erst um 13 Uhr &lt;b&gt;/);
    assert.doesNotMatch(schicht, /13 Uhr <b>/);

    // Rückmeldungen: Das Feld zeigt eine Marke und die Bemerkung im Titel.
    const tabelle = await (await hole('/rueckmeldungen')).text();
    assert.match(tabelle, /bemerkung-marke/);
    assert.match(tabelle, /Bemerkung: Komme erst um 13 Uhr &lt;b&gt;/);

    // Das Fenster zeigt die Bemerkung zum Bearbeiten.
    const fenster = await (await hole(`/rueckmeldungen/eintrag?schicht=${s.schichtId}&person=7`, { 'X-Fragment': '1' })).text();
    assert.match(fenster, /<textarea name="bemerkung"[^>]*>Komme erst um 13 Uhr &lt;b&gt;<\/textarea>/);

    // Die Aufgebotsstelle bearbeitet die Bemerkung. Das Statusprotokoll hält alt und neu fest.
    const aendern = await post(`/anmeldungen/${a.id}`, { status: 'angemeldet', kanal: 'formular', rolle: '', bemerkung: 'Kommt um 13 Uhr, abgesprochen', version: String(a.version) });
    assert.equal(aendern.status, 303);
    const [neu] = await zeilen(t.db, 'SELECT bemerkung FROM anmeldung WHERE id = ?', [a.id]);
    assert.equal(neu.bemerkung, 'Kommt um 13 Uhr, abgesprochen');
    const log = await zeilen(t.db, "SELECT alt_wert, neu_wert FROM status_log WHERE anmeldung_id = ? AND aktion = 'bemerkung'", [a.id]);
    assert.deepEqual([log.at(-1).alt_wert, log.at(-1).neu_wert], ['Komme erst um 13 Uhr <b>', 'Kommt um 13 Uhr, abgesprochen']);

    // Eintragen ohne Bemerkung lässt eine vorhandene Bemerkung stehen.
    await post(`/schichten/${s.schichtId}/anmeldungen`, { person: '7', status: 'unsicher', kanal: 'telefon', rolle: '', bemerkung: '' });
    const [gleich] = await zeilen(t.db, 'SELECT status, bemerkung FROM anmeldung WHERE id = ?', [a.id]);
    assert.deepEqual([gleich.status, gleich.bemerkung], ['unsicher', 'Kommt um 13 Uhr, abgesprochen']);

    // Das Fenster ohne Eintrag hat schon ein Feld «Bemerkung». Eintragen speichert sie.
    const leer = await (await hole(`/rueckmeldungen/eintrag?schicht=${s.schichtId}&person=8`, { 'X-Fragment': '1' })).text();
    assert.match(leer, /name="bemerkung"/);
    const ein = await post(`/schichten/${s.schichtId}/anmeldungen`, { person: '8', status: 'angemeldet', kanal: 'telefon', rolle: '', bemerkung: 'Nur bis 16 Uhr' });
    assert.equal(ein.status, 303);
    const [tim] = await zeilen(t.db, 'SELECT id, bemerkung FROM anmeldung WHERE person_id = 8');
    assert.equal(tim.bemerkung, 'Nur bis 16 Uhr');
    const logTim = await zeilen(t.db, "SELECT neu_wert FROM status_log WHERE anmeldung_id = ? AND aktion = 'bemerkung'", [tim.id]);
    assert.equal(logTim[0].neu_wert, 'Nur bis 16 Uhr');
  } finally {
    await app.stopp();
    await t.ende();
  }
});

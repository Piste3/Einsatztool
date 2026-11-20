// T38: Personen zwischen Schichten verschieben, Fenster «Bestätigen?», Dokumente im neuen Tab (Wünsche Yann 20.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { setzeAnmeldung, verschiebeAnmeldung } from '../src/domain/anmeldung.js';
import { erstelleSchicht } from '../src/domain/schicht.js';
import { macheRueckgaengig, mitRueckgaengig } from '../src/domain/rueckgaengig.js';
import { Eingabefehler } from '../src/domain/eingabe.js';
import { lokalesDatum } from '../src/domain/zeit.js';
import { schreibe } from '../src/db/db.js';

test('T38 Verschieben: Status und Protokoll bleiben, Konflikte, neue Bestätigungsmail, Rückgängig', async () => {
  const t = await neueDatenbank();
  try {
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(20, 13), inTagen(20, 18), 'Claraplatz');
    const tag = lokalesDatum(inTagen(20, 13));
    const abend = await erstelleSchicht(t.db, s.einsatzId, { name: 'Abend', start_datum: tag, start_zeit: '18:00', end_datum: tag, end_zeit: '23:00' });
    const fremd = await einsatz(t.db, 'Anderer Einsatz', inTagen(30, 13), inTagen(30, 18));
    await person(t.db, 1, { vorname: 'Ana', nachname: 'Muster' });
    await person(t.db, 2, { vorname: 'Ben', nachname: 'Beispiel' });
    const ana = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon', rolle: undefined, bemerkung: 'nur bis 17 Uhr' }, null);
    await schreibe(t.db, "UPDATE anmeldung SET mail_gesendet_am = '2026-01-01T00:00:00.000Z' WHERE id = ?", [ana]);
    const benMorgen = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 2, status: 'angemeldet', kanal: 'formular' }, null);
    await setzeAnmeldung(t.db, { schichtId: abend, personId: 2, status: 'abgemeldet', kanal: 'telefon' }, null);

    // Ana nach «Abend»: Status, Bemerkung und Protokoll bleiben. Die Bestätigungsmail geht neu (Schicht geändert).
    const [vorher] = await zeilen(t.db, 'SELECT version FROM anmeldung WHERE id = ?', [ana]);
    const r = await verschiebeAnmeldung(t.db, ana, abend, vorher.version, null);
    assert.equal(r.geaendert, true);
    const [a] = await zeilen(t.db, 'SELECT * FROM anmeldung WHERE id = ?', [ana]);
    assert.equal(a.schicht_id, abend);
    assert.equal(a.status, 'bestaetigt');
    assert.equal(a.bemerkung, 'nur bis 17 Uhr');
    assert.equal(a.mail_gesendet_am, null);
    const log = await zeilen(t.db, "SELECT alt_wert, neu_wert FROM status_log WHERE anmeldung_id = ? AND aktion = 'verschoben'", [ana]);
    assert.deepEqual(log.map((l) => [l.alt_wert, l.neu_wert]), [['Herbstmesse', 'Abend']]);

    // Alte Version: Konflikt, nichts verschoben.
    await assert.rejects(verschiebeAnmeldung(t.db, ana, s.schichtId, vorher.version, null), /geändert/);

    // Ben hat in «Abend» schon einen Eintrag (abgemeldet): Das Tool verschiebt nichts.
    await assert.rejects(verschiebeAnmeldung(t.db, benMorgen, abend, undefined, null), (f: unknown) => f instanceof Eingabefehler && /schon einen Eintrag/.test((f as Error).message));
    const [ben] = await zeilen(t.db, 'SELECT schicht_id FROM anmeldung WHERE id = ?', [benMorgen]);
    assert.equal(ben.schicht_id, s.schichtId);

    // Nur innerhalb desselben Einsatzes.
    await assert.rejects(verschiebeAnmeldung(t.db, ana, fremd.schichtId, undefined, null), /desselben Einsatzes/);

    // Gleiche Schicht: keine Änderung.
    assert.equal((await verschiebeAnmeldung(t.db, ana, abend, undefined, null)).geaendert, false);

    // Rückgängig: zurück in die alte Schicht, mit Eintrag im Protokoll.
    const { schluessel } = await mitRueckgaengig(t.db, 1, () => verschiebeAnmeldung(t.db, ana, s.schichtId, undefined, null));
    assert.ok(schluessel);
    await schreibe(t.db, "INSERT INTO benutzer (id, name, email, entra_oid, rolle, aktiv) VALUES (1, 'B', 'b@kkb.ch', 'oid-b', 'aufgebot', 1)");
    assert.equal(await macheRueckgaengig(t.db, schluessel, 1), 1);
    const [zurueck] = await zeilen(t.db, 'SELECT schicht_id FROM anmeldung WHERE id = ?', [ana]);
    assert.equal(zurueck.schicht_id, abend);
    const n = await zeilen(t.db, "SELECT COUNT(*) AS n FROM status_log WHERE anmeldung_id = ? AND aktion = 'verschoben'", [ana]);
    assert.equal(Number(n[0].n), 3);
  } finally {
    await t.ende();
  }
});

test('T38 im Web: Bereich «Personen verschieben», Route, Fenster «Bestätigen?», Dokumente im neuen Tab', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Stadtlauf', inTagen(9, 12), inTagen(9, 16), 'Marktplatz');
    const tag = lokalesDatum(inTagen(9, 12));
    const abbau = await erstelleSchicht(t.db, s.einsatzId, { name: 'Abbau', start_datum: tag, start_zeit: '16:00', end_datum: tag, end_zeit: '18:00' });
    await person(t.db, 7, { vorname: 'Nina', nachname: 'Baumann <b>' });
    const aid = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 7, status: 'angemeldet', kanal: 'telefon' }, null);
    const { cookie, csrf } = await anmelden(t.db, 'aufgebot');
    const hole = async (pfad: string) => (await fetch(`${app.url}${pfad}`, { headers: { cookie }, redirect: 'manual' })).text();

    const seite = await hole(`/einsaetze/${s.einsatzId}/schichten`);
    assert.match(seite, /id="verschieben"/);
    assert.match(seite, new RegExp(`data-ziel-schicht="${abbau}"`));
    assert.match(seite, new RegExp(`action="/anmeldungen/${aid}/verschieben"`));
    assert.match(seite, /Baumann &lt;b&gt;/);
    assert.doesNotMatch(seite, /Baumann <b>/);
    // Kachel mit «angemeldet»: zuerst das Fenster «Bestätigen?».
    assert.match(seite, new RegExp(`data-bestaetigen="${aid}" data-version="\\d+" data-name="Nina Baumann &lt;b&gt;"`));
    // Dokumente, die sich im Browser öffnen, gehen in einem neuen Tab auf.
    assert.match(seite, /href="\/einsaetze\/\d+\/teilnehmerliste" target="_blank" rel="noopener"/);
    assert.match(seite, /href="\/schichten\/\d+\/aufgebot" target="_blank" rel="noopener"/);

    // Rückmeldungen und Besetzen haben dasselbe Fenster.
    assert.match(await hole('/rueckmeldungen'), new RegExp(`data-bestaetigen="${aid}"`));
    assert.match(await hole(`/einsaetze/${s.einsatzId}/besetzen?schicht=${s.schichtId}&filter=alle`), new RegExp(`data-bestaetigen="${aid}"`));

    // Verschieben über das Formular (so sendet auch das Ziehen).
    const r = await fetch(`${app.url}/anmeldungen/${aid}/verschieben`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, zurueck: `/einsaetze/${s.einsatzId}/schichten#verschieben`, schicht: String(abbau), version: '1' }),
    });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `/einsaetze/${s.einsatzId}/schichten#verschieben`);
    const [a] = await zeilen(t.db, 'SELECT schicht_id, status FROM anmeldung WHERE id = ?', [aid]);
    assert.equal(a.schicht_id, abbau);
    assert.equal(a.status, 'angemeldet');

    // Bestätigen aus dem Fenster: Status und Version, ohne Rolle, Kanal oder Bemerkung.
    const [v] = await zeilen(t.db, 'SELECT version FROM anmeldung WHERE id = ?', [aid]);
    const b = await fetch(`${app.url}/anmeldungen/${aid}`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, zurueck: '/rueckmeldungen', status: 'bestaetigt', version: String(v.version) }),
    });
    assert.equal(b.status, 303);
    const [nachher] = await zeilen(t.db, 'SELECT status, kanal FROM anmeldung WHERE id = ?', [aid]);
    assert.equal(nachher.status, 'bestaetigt');
    assert.equal(nachher.kanal, 'telefon');
  } finally {
    await app.stopp();
    await t.ende();
  }
});

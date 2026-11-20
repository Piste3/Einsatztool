// T36: Knopf «Rückgängig» im Toast (Wunsch Yann, 19.11.2026).
// Das Tool stellt die Einträge der letzten Aktion wieder her und schreibt dabei ins Statusprotokoll.
// Hat sich ein Eintrag seither geändert, ändert das Tool nichts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { aendereAnmeldung, bestaetigeAlle, loescheAnmeldung, ordneZu, setzeAnmeldung } from '../src/domain/anmeldung.js';
import { macheRueckgaengig, mitRueckgaengig, _paketeFuerTests } from '../src/domain/rueckgaengig.js';
import { schreibe } from '../src/db/db.js';

test('T36 Rückgängig: Status, Eintragen, Entfernen, Bestätigen, Zuordnen, Konflikt', async () => {
  const t = await neueDatenbank();
  try {
    const { benutzerId: ich } = await anmelden(t.db, 'admin');
    const { benutzerId: andere } = await anmelden(t.db, 'aufgebot');
    await person(t.db, 1, { vorname: 'Lea', nachname: 'Meier' });
    await person(t.db, 2, { vorname: 'Tim', nachname: 'Graf' });
    await person(t.db, 3, { vorname: 'Mia', nachname: 'Roth' });
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(5, 12), inTagen(5, 18));

    // 1. Eintragen: Rückgängig entfernt den neuen Eintrag.
    const neu = await mitRueckgaengig(t.db, ich, () => setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, ich));
    assert.ok(neu.schluessel);
    assert.equal(await macheRueckgaengig(t.db, neu.schluessel, ich), 1);
    assert.equal((await zeilen(t.db, 'SELECT id FROM anmeldung WHERE person_id = 1')).length, 0);
    // Ein Schlüssel gilt nur einmal.
    await assert.rejects(macheRueckgaengig(t.db, neu.schluessel, ich), /Rückgängig geht nicht mehr/);

    // 2. Status ändern: Rückgängig stellt Status, Bemerkung und Mail-Stand wieder her und protokolliert.
    const id = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon', bemerkung: 'alt' }, ich);
    await schreibe(t.db, "UPDATE anmeldung SET mail_gesendet_am = '2026-01-01T00:00:00.000Z' WHERE id = ?", [id]);
    const aenderung = await mitRueckgaengig(t.db, ich, () => aendereAnmeldung(t.db, id, { status: 'bestaetigt', bemerkung: 'neu' }, ich));
    const [mitten] = await zeilen(t.db, 'SELECT status, mail_gesendet_am FROM anmeldung WHERE id = ?', [id]);
    assert.deepEqual([mitten.status, mitten.mail_gesendet_am], ['bestaetigt', null]);
    // Ein anderer Benutzer kann die Aktion nicht rückgängig machen.
    await assert.rejects(macheRueckgaengig(t.db, aenderung.schluessel, andere), /Rückgängig geht nicht mehr/);
    await macheRueckgaengig(t.db, aenderung.schluessel, ich);
    const [zurueck] = await zeilen(t.db, 'SELECT status, bemerkung, mail_gesendet_am FROM anmeldung WHERE id = ?', [id]);
    assert.deepEqual([zurueck.status, zurueck.bemerkung, zurueck.mail_gesendet_am], ['angemeldet', 'alt', '2026-01-01T00:00:00.000Z']);
    const log = await zeilen(t.db, "SELECT aktion, alt_wert, neu_wert FROM status_log WHERE anmeldung_id = ? AND aktion = 'status' ORDER BY id", [id]);
    assert.deepEqual(log.map((l) => [l.alt_wert, l.neu_wert]), [['angemeldet', 'bestaetigt'], ['bestaetigt', 'angemeldet']]);

    // 3. Ohne Änderung gibt es keinen Knopf.
    const gleich = await mitRueckgaengig(t.db, ich, () => aendereAnmeldung(t.db, id, { status: 'angemeldet' }, ich));
    assert.equal(gleich.schluessel, null);

    // 4. Konflikt: Ändert jemand den Eintrag danach, ändert Rückgängig nichts.
    const k1 = await mitRueckgaengig(t.db, ich, () => aendereAnmeldung(t.db, id, { status: 'unsicher' }, ich));
    await aendereAnmeldung(t.db, id, { status: 'abgemeldet' }, andere);
    await assert.rejects(macheRueckgaengig(t.db, k1.schluessel, ich), /inzwischen geändert/);
    assert.equal((await zeilen(t.db, 'SELECT status FROM anmeldung WHERE id = ?', [id]))[0].status, 'abgemeldet');

    // 5. Entfernen: Rückgängig legt Eintrag und Statusprotokoll wieder an.
    const logVorher = await zeilen(t.db, 'SELECT id, aktion FROM status_log WHERE anmeldung_id = ? ORDER BY id', [id]);
    const weg = await mitRueckgaengig(t.db, ich, () => loescheAnmeldung(t.db, id));
    assert.equal((await zeilen(t.db, 'SELECT id FROM anmeldung WHERE id = ?', [id])).length, 0);
    await macheRueckgaengig(t.db, weg.schluessel, ich);
    const [wieder] = await zeilen(t.db, 'SELECT status, person_id FROM anmeldung WHERE id = ?', [id]);
    assert.deepEqual([wieder.status, wieder.person_id], ['abgemeldet', 1]);
    const logNachher = await zeilen(t.db, 'SELECT id, aktion FROM status_log WHERE anmeldung_id = ? ORDER BY id', [id]);
    assert.deepEqual(logNachher.slice(0, logVorher.length), logVorher);
    assert.equal(logNachher.at(-1).aktion, 'wiederhergestellt');

    // 6. Alle bestätigen: Rückgängig setzt alle Einträge zurück.
    const id2 = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 2, status: 'angemeldet', kanal: 'telefon' }, ich);
    const id3 = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 3, status: 'angemeldet', kanal: 'telefon' }, ich);
    const alle = await mitRueckgaengig(t.db, ich, () => bestaetigeAlle(t.db, [s.schichtId], ich));
    assert.equal(alle.ergebnis, 2);
    assert.equal(await macheRueckgaengig(t.db, alle.schluessel, ich), 2);
    const status = await zeilen(t.db, 'SELECT status FROM anmeldung WHERE id IN (?, ?)', [id2, id3]);
    assert.deepEqual(status.map((z) => z.status), ['angemeldet', 'angemeldet']);

    // 7. Zuordnen: Rückgängig macht den Eintrag wieder unbekannt.
    const z = await schreibe(t.db, `INSERT INTO anmeldung (schicht_id, person_id, name_text, email_text, status, kanal, erstellt_am, geaendert_am)
      VALUES (?, NULL, 'Lea Mayer', NULL, 'angemeldet', 'formular', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`, [s.schichtId]);
    await schreibe(t.db, 'DELETE FROM anmeldung WHERE id = ?', [id]);
    const zu = await mitRueckgaengig(t.db, ich, () => ordneZu(t.db, z.insertId, 1, ich));
    assert.deepEqual(zu.ergebnis, { ok: true });
    await macheRueckgaengig(t.db, zu.schluessel, ich);
    const [unbekannt] = await zeilen(t.db, 'SELECT person_id, name_text FROM anmeldung WHERE id = ?', [z.insertId]);
    assert.deepEqual([unbekannt.person_id, unbekannt.name_text], [null, 'Lea Mayer']);

    // 8. Nach 10 Minuten gilt ein Schlüssel nicht mehr.
    const alt = await mitRueckgaengig(t.db, ich, () => aendereAnmeldung(t.db, id2, { status: 'unsicher' }, ich));
    _paketeFuerTests().get(alt.schluessel!)!.ablauf = Date.now() - 1;
    await assert.rejects(macheRueckgaengig(t.db, alt.schluessel, ich), /zu alt/);
  } finally {
    await t.ende();
  }
});

test('T36 Rückgängig im Browser: Toast zeigt den Knopf, ein Klick setzt zurück', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    await person(t.db, 1, { vorname: 'Lea', nachname: 'Meier' });
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(5, 12), inTagen(5, 18));
    const { cookie, csrf } = await anmelden(t.db);
    const post = (pfad: string, felder: Record<string, string>) =>
      fetch(`${app.url}${pfad}`, {
        method: 'POST', redirect: 'manual',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: csrf, ...felder }),
      });
    const toastNach = async (r: Response) => {
      const meldung = (r.headers.get('set-cookie') ?? '').match(/meldung=[^;]+/)?.[0];
      assert.ok(meldung, 'Die Antwort setzt eine Meldung.');
      const seite = await fetch(`${app.url}${r.headers.get('location')}`, { headers: { cookie: `${cookie}; ${meldung}` } });
      return seite.text();
    };

    const ziel = `/einsaetze/${s.einsatzId}/besetzen?filter=alle`;
    const r1 = await post(`/schichten/${s.schichtId}/anmeldungen`, { person: '1', status: 'angemeldet', kanal: 'telefon', zurueck: ziel });
    assert.equal(r1.status, 303);
    const html1 = await toastNach(r1);
    assert.match(html1, /data-toast-aktion/);
    assert.match(html1, /action="\/rueckgaengig"/);
    const schluessel = html1.match(/name="schluessel" value="([A-Za-z0-9_-]+)"/)?.[1];
    assert.ok(schluessel);
    // Der Knopf führt auf dieselbe Seite zurück.
    assert.match(html1, new RegExp(`name="zurueck" value="${ziel.replace(/[?]/g, '\\?')}"`));

    const r2 = await post('/rueckgaengig', { schluessel, zurueck: ziel });
    assert.equal(r2.status, 303);
    assert.equal(r2.headers.get('location'), ziel);
    const html2 = await toastNach(r2);
    assert.match(html2, /Rückgängig gemacht\./);
    assert.doesNotMatch(html2, /data-toast-aktion/);
    assert.equal((await zeilen(t.db, 'SELECT id FROM anmeldung')).length, 0);

    // Ein zweiter Klick ändert nichts und zeigt einen Fehler.
    const r3 = await post('/rueckgaengig', { schluessel: schluessel!, zurueck: ziel });
    assert.match(await toastNach(r3), /Rückgängig geht nicht mehr/);
    // Ein ungültiger Schlüssel ebenso.
    const r4 = await post('/rueckgaengig', { schluessel: '<script>', zurueck: `/schichten/${s.schichtId}` });
    assert.match(await toastNach(r4), /Rückgängig geht nicht mehr/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

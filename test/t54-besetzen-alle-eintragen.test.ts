// T54: Besetzen › Alle Schichten: eine Person in gewählte Schichten eintragen (Wunsch Yann 26.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { erstelleSchicht } from '../src/domain/schicht.js';
import { lokalesDatum } from '../src/domain/zeit.js';
import { schreibe } from '../src/db/db.js';

test('T54 Besetzen: Person in mehrere Schichten eintragen', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Fasnacht', inTagen(30, 13), inTagen(30, 21), 'Marktplatz');
    const tag = lokalesDatum(inTagen(31, 13));
    const zwei = await erstelleSchicht(t.db, s.einsatzId, { name: 'Dienstag', start_datum: tag, start_zeit: '13:00', end_datum: tag, end_zeit: '21:00' });
    const drei = await erstelleSchicht(t.db, s.einsatzId, { name: 'Mittwoch', start_datum: lokalesDatum(inTagen(32, 13)), start_zeit: '13:00', end_datum: lokalesDatum(inTagen(32, 13)), end_zeit: '21:00' });
    const fremd = await einsatz(t.db, 'Anderer', inTagen(40, 13), inTagen(40, 21));
    await person(t.db, 8, { vorname: 'Lea', nachname: 'Meier <i>' });
    // Lea hat am Mittwoch schon einen Eintrag mit Rolle. Er ändert sich, die Rolle bleibt.
    await setzeAnmeldung(t.db, { schichtId: drei, personId: 8, status: 'unsicher', kanal: 'telefon', rolle: 'Einsatzleitung' }, null);
    const { cookie, csrf } = await anmelden(t.db, 'aufgebot');
    const pfad = `/einsaetze/${s.einsatzId}/besetzen`;

    // Die Ansicht «Alle Schichten» zeigt das Formular mit einem Häkchen je Schicht.
    const seite = await (await fetch(`${app.url}${pfad}?schicht=alle`, { headers: { cookie } })).text();
    assert.match(seite, new RegExp(`action="/einsaetze/${s.einsatzId}/anmeldungen"`));
    assert.match(seite, new RegExp(`name="schichten" value="${zwei}"`));
    assert.match(seite, new RegExp(`name="schichten" value="${drei}"`));
    assert.match(seite, /Meier &lt;i&gt;/);

    const sende = (felder: Record<string, string | string[]>) => {
      const body = new URLSearchParams({ _csrf: csrf, zurueck: `${pfad}?schicht=alle` });
      for (const [k, v] of Object.entries(felder)) for (const x of ([] as string[]).concat(v)) body.append(k, x);
      return fetch(`${app.url}/einsaetze/${s.einsatzId}/anmeldungen`, {
        method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body,
      });
    };

    // Ohne Schicht: Eingabefehler (Meldung), nichts gespeichert.
    await sende({ person: '8', status: 'angemeldet', kanal: 'telefon' });
    // Schicht eines anderen Einsatzes: Eingabefehler, nichts gespeichert.
    await sende({ person: '8', status: 'angemeldet', kanal: 'telefon', schichten: [String(s.schichtId), String(fremd.schichtId)] });
    assert.equal((await zeilen(t.db, 'SELECT id FROM anmeldung WHERE schicht_id = ?', [s.schichtId])).length, 0);

    const r = await sende({ person: '8', status: 'angemeldet', kanal: 'telefon', rolle: '', schichten: [String(s.schichtId), String(drei)] });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `${pfad}?schicht=alle`);
    const liste = await zeilen(t.db, 'SELECT schicht_id, status, rolle FROM anmeldung WHERE person_id = 8 ORDER BY schicht_id');
    assert.deepEqual(liste.map((a) => [a.schicht_id, a.status, a.rolle]), [
      [s.schichtId, 'angemeldet', null],
      [drei, 'angemeldet', 'Einsatzleitung'],
    ]);
    // Dienstag war nicht gewählt.
    assert.equal((await zeilen(t.db, 'SELECT id FROM anmeldung WHERE schicht_id = ?', [zwei])).length, 0);
    // Jede Änderung steht im Statusprotokoll.
    const [log] = await zeilen(t.db, `SELECT COUNT(*) AS n FROM status_log l JOIN anmeldung a ON a.id = l.anmeldung_id WHERE a.person_id = 8 AND l.aktion = 'status'`);
    assert.ok(Number(log.n) >= 1);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

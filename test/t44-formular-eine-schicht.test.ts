// T44: Einstellung je Einsatz «Im Formular mehrere Schichten wählbar» (Wunsch Yann 20.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { verarbeiteFormular } from '../src/domain/formular.js';
import { aendereEinsatz, kopiereEinsatz } from '../src/domain/einsatz.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { erstelleSchicht, setzePubliziert } from '../src/domain/schicht.js';
import { Eingabefehler } from '../src/domain/eingabe.js';
import { lokalesDatum } from '../src/domain/zeit.js';

test('T44 Nur eine Schicht im Formular: Auswahlknöpfe, Prüfung auf dem Server, Eintragen von Hand frei', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(10, 12), inTagen(10, 16));
    const tag = lokalesDatum(inTagen(10, 12));
    const abend = await erstelleSchicht(t.db, s.einsatzId, { name: 'Abend', start_datum: tag, start_zeit: '18:00', end_datum: tag, end_zeit: '22:00' });
    await setzePubliziert(t.db, abend, true);
    await person(t.db, 1, { vorname: 'Ana', nachname: 'Muster' });

    // Vorgabe: mehrere Schichten wählbar, Häkchen im Formular.
    let seite = await (await fetch(`${app.url}/anmeldung`)).text();
    assert.match(seite, /type="checkbox" name="schichten"/);
    assert.doesNotMatch(seite, /type="radio"/);

    // Ohne Feld `formular_mehrere_feld` bleibt der Wert. Mit Feld und ohne Haken: nur eine Schicht.
    await aendereEinsatz(t.db, s.einsatzId, { name: 'Herbstmesse' });
    assert.equal((await zeilen(t.db, 'SELECT formular_mehrere FROM einsatz'))[0].formular_mehrere, 1);
    await aendereEinsatz(t.db, s.einsatzId, { name: 'Herbstmesse', formular_mehrere_feld: '1' });
    assert.equal((await zeilen(t.db, 'SELECT formular_mehrere FROM einsatz'))[0].formular_mehrere, 0);

    seite = await (await fetch(`${app.url}/anmeldung`)).text();
    assert.match(seite, new RegExp(`type="radio" name="schicht_${s.einsatzId}" value="${abend}"`));
    assert.match(seite, /Keine Schicht in diesem Einsatz/);
    assert.match(seite, /Wähle höchstens eine Schicht/);

    // Server: zwei Schichten desselben Einsatzes gehen nicht.
    await assert.rejects(
      verarbeiteFormular(t.db, { vorname: 'Ana', nachname: 'Muster', schichten: [String(s.schichtId), String(abend)] }),
      (e: unknown) => e instanceof Eingabefehler && /nur eine Schicht/.test(e.message),
    );
    assert.equal((await zeilen(t.db, 'SELECT id FROM anmeldung')).length, 0);

    // Formular über HTTP mit Auswahlknopf: eine Schicht kommt an.
    const token = /name="token" value="([^"]+)"/.exec(seite)![1];
    await new Promise((r) => setTimeout(r, 2100));
    const antwort = await fetch(`${app.url}/anmeldung`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, vorname: 'Ana', nachname: 'Muster', [`schicht_${s.einsatzId}`]: String(abend) }).toString(),
    });
    assert.equal(antwort.status, 303);
    const an = await zeilen(t.db, 'SELECT schicht_id FROM anmeldung WHERE person_id = 1');
    assert.deepEqual(an.map((x) => x.schicht_id), [abend]);

    // Eintragen von Hand bleibt frei: zweite Schicht geht.
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, null);
    assert.equal((await zeilen(t.db, 'SELECT id FROM anmeldung WHERE person_id = 1')).length, 2);

    // Kopie übernimmt die Einstellung. Bearbeiten-Seite zeigt das Häkchen.
    const kopie = await kopiereEinsatz(t.db, s.einsatzId, { name: 'Herbstmesse 2', start_datum: lokalesDatum(inTagen(40, 12)) }, null);
    assert.equal((await zeilen(t.db, 'SELECT formular_mehrere FROM einsatz WHERE id = ?', [kopie]))[0].formular_mehrere, 0);
    const { cookie } = await anmelden(t.db, 'aufgebot');
    const bearbeiten = await (await fetch(`${app.url}/einsaetze/${s.einsatzId}/bearbeiten`, { headers: { cookie } })).text();
    assert.match(bearbeiten, /name="formular_mehrere" value="1">/);
    assert.match(bearbeiten, /name="formular_mehrere_feld"/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

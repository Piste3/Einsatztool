// T41: Seite «Formular» zeigt jedes Ausfüllen des Formulars einzeln (Wunsch Yann 20.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { verarbeiteFormular } from '../src/domain/formular.js';
import { formularEingaenge, passtZuFilter } from '../src/domain/formular-eingaenge.js';
import { erstelleSchicht, setzePubliziert } from '../src/domain/schicht.js';
import { loeschePersonendaten } from '../src/domain/import-clubdesk.js';
import { lokalesDatum } from '../src/domain/zeit.js';
import { transaktion } from '../src/db/db.js';

test('T41 Eingänge: ein Eingang je Ausfüllen, Schichten, Bemerkung, Filter, Löschen der Personendaten', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(10, 12), inTagen(10, 16));
    const tag = lokalesDatum(inTagen(10, 12));
    const abend = await erstelleSchicht(t.db, s.einsatzId, { name: 'Abend', start_datum: tag, start_zeit: '18:00', end_datum: tag, end_zeit: '22:00' });
    await setzePubliziert(t.db, abend, true);
    await person(t.db, 1, { vorname: 'Ana', nachname: 'Muster' });

    await verarbeiteFormular(t.db, { vorname: 'Ana', nachname: 'Muster', bemerkungen: { [s.einsatzId]: 'Komme <später>' }, schichten: [String(s.schichtId), String(abend)] });
    await verarbeiteFormular(t.db, { vorname: 'Lea', nachname: 'Neu', schichten: [String(abend)] });
    // Ana füllt nochmals aus: kein neuer Eintrag, aber ein neuer Eingang («war schon eingetragen»).
    await verarbeiteFormular(t.db, { vorname: 'Ana', nachname: 'Muster', schichten: [String(abend)] });

    const e = await formularEingaenge(t.db);
    assert.equal(e.length, 3);
    const [dritter, lea, erster] = e;
    assert.equal(erster.person_id, 1);
    assert.equal(erster.name, 'Ana Muster');
    assert.equal(erster.schichten.length, 2);
    assert.deepEqual(erster.schichten.map((x) => x.bemerkung), ['Komme <später>', 'Komme <später>']);
    assert.deepEqual(erster.schichten.map((x) => x.neu), [1, 1]);
    assert.equal(dritter.schichten[0].neu, 0);
    assert.equal(lea.person_id, null);
    assert.ok(passtZuFilter(lea, 'unbekannt'));
    assert.ok(!passtZuFilter(erster, 'unbekannt'));
    assert.ok(passtZuFilter(erster, 'bemerkung'));
    assert.ok(passtZuFilter(erster, 'neu'));

    // Seite: Name, Bemerkung maskiert, Link zum Formular, Fenster «Bestätigen?», Zuordnen für Unbekannte.
    const { cookie } = await anmelden(t.db, 'aufgebot');
    const seite = await (await fetch(`${app.url}/formular`, { headers: { cookie } })).text();
    assert.match(seite, /Ana Muster/);
    assert.match(seite, /Komme &lt;später&gt;/);
    assert.doesNotMatch(seite, /Komme <später>/);
    assert.match(seite, /href="\/anmeldung" target="_blank"/);
    assert.match(seite, /data-bestaetigen="\d+"/);
    assert.match(seite, /href="\/anmeldungen\/unbekannt#e\d+">Zuordnen/);
    assert.match(seite, /war schon eingetragen/);
    const gefiltert = await (await fetch(`${app.url}/formular?filter=unbekannt`, { headers: { cookie } })).text();
    assert.match(gefiltert, /Lea Neu/);
    assert.doesNotMatch(gefiltert, /<strong>Ana Muster<\/strong>/);

    // Personendaten löschen: Name und Bemerkung im Eingang verschwinden.
    await transaktion(t.db, (c) => loeschePersonendaten(c, 1, null));
    const rest = await zeilen(t.db, 'SELECT f.name, fs.bemerkung FROM formular_eingang f JOIN formular_eingang_schicht fs ON fs.eingang_id = f.id WHERE f.person_id = 1');
    assert.ok(rest.length >= 2);
    for (const r of rest) {
      assert.equal(r.name, 'Gelöschte Person 1');
      assert.equal(r.bemerkung, null);
    }
  } finally {
    await app.stopp();
    await t.ende();
  }
});

test('T41 Personenseite: «Nächste Einsätze» öffnet das normale Fenster statt direkt anzumelden', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Stadtlauf', inTagen(5, 12), inTagen(5, 16));
    const tag = lokalesDatum(inTagen(5, 12));
    const abend = await erstelleSchicht(t.db, s.einsatzId, { name: 'Abend', start_datum: tag, start_zeit: '18:00', end_datum: tag, end_zeit: '22:00' });
    await person(t.db, 4, { vorname: 'Ben', nachname: 'Test' });
    await verarbeiteFormular(t.db, { vorname: 'Ben', nachname: 'Test', schichten: [String(s.schichtId)] });
    const { cookie } = await anmelden(t.db, 'aufgebot');
    const html = await (await fetch(`${app.url}/personen/4`, { headers: { cookie } })).text();
    assert.doesNotMatch(html, /\/anmeldungen" class="zeilen-form"/);
    assert.match(html, new RegExp(`href="/rueckmeldungen/eintrag\\?schicht=${abend}&amp;person=4[^"]*" data-eintrag>Eintragen`));
    assert.match(html, new RegExp(`href="/rueckmeldungen/eintrag\\?schicht=${s.schichtId}&amp;person=4[^"]*" data-eintrag data-bestaetigen=`));
  } finally {
    await app.stopp();
    await t.ende();
  }
});

// T51: Aufgebot und ICS für den ganzen Einsatz (Wunsch Yann 26.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person } from './hilfe.js';
import { starteApp, anmelden } from './web-hilfe.js';
import { erstelleSchicht } from '../src/domain/schicht.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { lokaleZeit, lokalesDatum } from '../src/domain/zeit.js';

test('T51 Ganzer Einsatz: ein Brief je Person und Schicht, eine ICS-Datei mit einem Termin je Schicht', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    await person(t.db, 1, { vorname: 'Eva', nachname: 'Muster', strasse: 'Weg 1', plz: '4000', ort: 'Basel' });
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(10, 8), inTagen(10, 12), 'Kaserne');
    const zweite = await erstelleSchicht(t.db, s.einsatzId, {
      name: 'Dienstag', start_datum: lokalesDatum(inTagen(11, 8)), start_zeit: lokaleZeit(inTagen(11, 8)), end_datum: lokalesDatum(inTagen(11, 12)), end_zeit: lokaleZeit(inTagen(11, 12)),
    });
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon' }, null);
    await setzeAnmeldung(t.db, { schichtId: zweite, personId: 1, status: 'bestaetigt', kanal: 'telefon' }, null);
    const { cookie } = await anmelden(t.db);

    const brief = await (await fetch(`${app.url}/einsaetze/${s.einsatzId}/aufgebot`, { headers: { cookie } })).text();
    assert.equal((brief.match(/<article class="brief">/g) ?? []).length, 2);
    assert.ok(brief.includes('Einsatzaufgebot - Herbstmesse - Dienstag'));
    assert.ok(brief.includes('2 Briefe'));

    const erst = await fetch(`${app.url}/einsaetze/${s.einsatzId}/ics`, { headers: { cookie } });
    assert.ok((erst.headers.get('content-type') ?? '').startsWith('text/calendar'));
    const ics = await erst.text();
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
    assert.equal((ics.match(/BEGIN:VCALENDAR/g) ?? []).length, 1);

    // Zweiter Export: zuerst die Warnung (Regel 17.3), «Trotzdem laden» liefert die Datei.
    const zweit = await (await fetch(`${app.url}/einsaetze/${s.einsatzId}/ics`, { headers: { cookie } })).text();
    assert.ok(zweit.includes('W_ICS_DUPLIKAT'));
    const trotzdem = await fetch(`${app.url}/einsaetze/${s.einsatzId}/ics?trotzdem=1`, { headers: { cookie } });
    assert.ok((trotzdem.headers.get('content-type') ?? '').startsWith('text/calendar'));

    // Das Menü «Dokumente» zeigt beide Einträge unter «Ganzer Einsatz».
    const seite = await (await fetch(`${app.url}/einsaetze/${s.einsatzId}`, { headers: { cookie } })).text();
    assert.ok(seite.includes(`/einsaetze/${s.einsatzId}/aufgebot`));
    assert.ok(seite.includes(`/einsaetze/${s.einsatzId}/ics`));
  } finally {
    await app.stopp();
    await t.ende();
  }
});

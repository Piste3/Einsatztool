// T52: Eingang im Reiter «Formular» vollständig löschen (Wunsch Yann 26.11.2026).
// Das Tool löscht den Eingang und die Einträge, die er angelegt hat (mit Statusprotokoll). Ältere Einträge bleiben.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { verarbeiteFormular } from '../src/domain/formular.js';
import { formularEingaenge, loescheEingang } from '../src/domain/formular-eingaenge.js';
import { erstelleSchicht, setzePubliziert } from '../src/domain/schicht.js';
import { lokalesDatum } from '../src/domain/zeit.js';

test('T52 Eingang löschen: Eingang und daraus entstandene Anmeldungen verschwinden, ältere Einträge bleiben', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(10, 12), inTagen(10, 16));
    const tag = lokalesDatum(inTagen(10, 12));
    const abend = await erstelleSchicht(t.db, s.einsatzId, { name: 'Abend', start_datum: tag, start_zeit: '18:00', end_datum: tag, end_zeit: '22:00' });
    await setzePubliziert(t.db, abend, true);
    await person(t.db, 1, { vorname: 'Ana', nachname: 'Muster' });

    // Erster Eingang: Ana in der Standardschicht. Zweiter Eingang: Ana in beiden Schichten (eine war schon eingetragen).
    await verarbeiteFormular(t.db, { vorname: 'Ana', nachname: 'Muster', schichten: [String(s.schichtId)] });
    await verarbeiteFormular(t.db, { vorname: 'Ana', nachname: 'Muster', bemerkungen: { [s.einsatzId]: 'Abend auch' }, schichten: [String(s.schichtId), String(abend)] });
    await verarbeiteFormular(t.db, { vorname: 'Lea', nachname: 'Neu', schichten: [String(abend)] });
    const [lea, zweiter, erster] = await formularEingaenge(t.db);
    const abendAna = zweiter.schichten.find((x) => x.schicht_id === abend)!.anmeldung_id!;
    const fruehAna = erster.schichten[0].anmeldung_id!;

    // Seite: Knopf «Löschen» je Eingang. Rückfrage zeigt die Einträge und die bleibenden.
    const { cookie, csrf } = await anmelden(t.db, 'aufgebot');
    const seite = await (await fetch(`${app.url}/formular`, { headers: { cookie } })).text();
    assert.match(seite, new RegExp(`href="/formular/eingang/${zweiter.id}/loeschen\\?zurueck=[^"]*" data-eintrag`));
    const frage = await (await fetch(`${app.url}/formular/eingang/${zweiter.id}/loeschen`, { headers: { cookie, 'x-fragment': '1' } })).text();
    assert.match(frage, /Eingang löschen\?/);
    assert.match(frage, /Abend/);
    assert.match(frage, /Ein Eintrag bestand schon vor dem Eingang/);
    assert.match(frage, /name="bestaetigt" value="1" required/);

    const post = (pfad: string, felder: Record<string, string>) =>
      fetch(`${app.url}${pfad}`, {
        method: 'POST', redirect: 'manual',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: csrf, ...felder }),
      });

    // Ohne Häkchen ändert das Tool nichts.
    await post(`/formular/eingang/${zweiter.id}/loeschen`, {});
    assert.equal((await zeilen(t.db, 'SELECT id FROM formular_eingang')).length, 3);

    // Mit Häkchen: zweiter Eingang weg, Abend-Eintrag samt Protokoll weg, älterer Eintrag bleibt.
    const r = await post(`/formular/eingang/${zweiter.id}/loeschen`, { bestaetigt: '1', zurueck: '/formular' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/formular');
    assert.equal((await zeilen(t.db, 'SELECT id FROM formular_eingang WHERE id = ?', [zweiter.id])).length, 0);
    assert.equal((await zeilen(t.db, 'SELECT eingang_id FROM formular_eingang_schicht WHERE eingang_id = ?', [zweiter.id])).length, 0);
    assert.equal((await zeilen(t.db, 'SELECT id FROM anmeldung WHERE id = ?', [abendAna])).length, 0);
    assert.equal((await zeilen(t.db, 'SELECT id FROM status_log WHERE anmeldung_id = ?', [abendAna])).length, 0);
    assert.equal((await zeilen(t.db, 'SELECT id FROM anmeldung WHERE id = ?', [fruehAna])).length, 1);
    assert.equal((await zeilen(t.db, 'SELECT id FROM formular_eingang')).length, 2);

    // Erster Eingang: sein Eintrag verschwindet. Leas Eingang bleibt unberührt.
    const v = await loescheEingang(t.db, erster.id);
    assert.equal(v.loeschen.length, 1);
    assert.equal((await zeilen(t.db, 'SELECT id FROM anmeldung WHERE id = ?', [fruehAna])).length, 0);
    const rest = await formularEingaenge(t.db);
    assert.deepEqual(rest.map((x) => x.id), [lea.id]);
    assert.equal(rest[0].schichten[0].anmeldung_id !== null, true);

    // Ein schon gelöschter Eingang ergibt «nicht gefunden».
    await assert.rejects(loescheEingang(t.db, erster.id), /nicht gefunden/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

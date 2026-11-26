// T56 (Wunsch Yann 26.11.2026): Bestätigungsmails ein- und ausschalten, Warteschlange, einzelne Mail von Hand senden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import {
  bestaetigungslauf, bestaetigungsmailsAktiv, faelligeMails, markiereFehler, MAX_VERSUCHE, sendeMailErneut, setzeBestaetigungsmails,
  ungesendeteMails, wartendeMails,
} from '../src/domain/bestaetigung.js';

test('T56 Schalter aus: kein Lauf, kein Versand; Einschalten nachsenden oder verwerfen; einzelne Mail von Hand', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1, { vorname: 'Anna', email: 'anna@web.kkb.ch' });
    await person(t.db, 2, { vorname: 'Ben', email: 'ben@web.kkb.ch' });
    await person(t.db, 3, { vorname: 'Cleo', email: 'cleo@web.kkb.ch' });
    const s = await einsatz(t.db, 'Stadtlauf', inTagen(5, 8), inTagen(5, 12), 'Marktplatz');

    // Vorgabe: eingeschaltet.
    assert.equal(await bestaetigungsmailsAktiv(t.db), true);

    // Eine Mail liegt schon in der Warteschlange (vor dem Ausschalten angelegt).
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 3, status: 'bestaetigt', kanal: 'telefon' }, null);
    assert.equal((await bestaetigungslauf(t.db, 'aufgebot@kkb.ch')).mails, 1);

    await setzeBestaetigungsmails(t.db, false, null);
    assert.equal(await bestaetigungsmailsAktiv(t.db), false);
    // Aus: Der Versand sendet nichts aus der Warteschlange.
    assert.equal((await faelligeMails(t.db)).length, 0);

    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon' }, null);
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 2, status: 'bestaetigt', kanal: 'telefon' }, null);
    const r = await bestaetigungslauf(t.db, 'aufgebot@kkb.ch');
    assert.equal(r.aus, true);
    assert.equal(r.mails, 0);
    assert.equal((await zeilen(t.db, 'SELECT * FROM mail_queue')).length, 1);

    // Warteschlange zeigt beide Personen.
    const w = await wartendeMails(t.db);
    assert.deepEqual(w.map((x) => x.an).sort(), ['anna@web.kkb.ch', 'ben@web.kkb.ch']);

    // Von Hand: Mail für Anna geht auch bei «aus» weg.
    const anna = w.find((x) => x.an === 'anna@web.kkb.ch')!;
    assert.equal((await bestaetigungslauf(t.db, 'aufgebot@kkb.ch', anna.schluessel)).mails, 1);
    const faellig = await faelligeMails(t.db);
    assert.deepEqual(faellig.map((m) => m.an), ['anna@web.kkb.ch']);
    assert.deepEqual((await wartendeMails(t.db)).map((x) => x.an), ['ben@web.kkb.ch']);

    // Mail an Cleo von Hand freigeben: Sie geht auch bei «aus» weg.
    const cleo = (await ungesendeteMails(t.db)).find((m) => m.an === 'cleo@web.kkb.ch')!;
    assert.equal(await sendeMailErneut(t.db, cleo.id), true);
    assert.equal((await faelligeMails(t.db)).length, 2);

    // Einschalten ohne Nachsenden: Ben erhält nie eine Mail. Protokoll im Eintrag und in der Konfiguration.
    const v = await setzeBestaetigungsmails(t.db, true, null, false);
    assert.equal(v.verworfen, 1);
    assert.equal((await wartendeMails(t.db)).length, 0);
    assert.equal((await bestaetigungslauf(t.db, 'aufgebot@kkb.ch')).mails, 0);
    assert.equal((await zeilen(t.db, "SELECT * FROM status_log WHERE aktion = 'mail_verworfen'")).length, 1);
    assert.equal((await zeilen(t.db, "SELECT * FROM konfiguration_protokoll WHERE schluessel = 'Bestätigungsmails'")).length, 2);
    // Von Hand ausgelöste Mails bleiben in der Warteschlange.
    assert.equal((await faelligeMails(t.db)).length, 2);

    // Aus und wieder ein mit Nachsenden: Wartende Einträge gehen im nächsten Lauf weg.
    await setzeBestaetigungsmails(t.db, false, null);
    await setzeAnmeldung(t.db, { schichtId: (await einsatz(t.db, 'Messe', inTagen(8, 8), inTagen(8, 12))).schichtId, personId: 2, status: 'bestaetigt', kanal: 'telefon' }, null);
    await setzeBestaetigungsmails(t.db, true, null, true);
    assert.equal((await bestaetigungslauf(t.db, 'aufgebot@kkb.ch')).mails, 1);

    // «Erneut senden» setzt eine aufgegebene Mail zurück.
    const m = (await zeilen(t.db, "SELECT id FROM mail_queue WHERE an = 'ben@web.kkb.ch'"))[0];
    for (let i = 0; i < MAX_VERSUCHE; i++) await markiereFehler(t.db, m.id, 'SMTP weg');
    assert.ok(!(await faelligeMails(t.db)).some((x) => x.id === m.id));
    await sendeMailErneut(t.db, m.id);
    assert.ok((await faelligeMails(t.db)).some((x) => x.id === m.id));
  } finally {
    await t.ende();
  }
});

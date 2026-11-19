// T32: Neue Einsatzansicht (Konzept Yann 19.11.2026): Steckbrief, «Zu tun», Schichten-Tabelle, Personen.
// Die Liste «Zu tun» meldet ohne Soll nie «besetzt». Funktionen und Routen bleiben gleich.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, rang } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { einsatzLage } from '../src/domain/einsatz-lage.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { erstelleSchicht } from '../src/domain/schicht.js';
import { lokalesDatum } from '../src/domain/zeit.js';
import type { SchichtZahlen } from '../src/domain/zaehlung.js';

function zahlen(teil: Partial<SchichtZahlen>): SchichtZahlen {
  return { teilnehmende: 0, bestaetigt: 0, unbestaetigt: 0, unsicher: 0, nachricht: 0, abgemeldet: 0, fremd: 0, essen: 0, rollen: [], ...teil };
}

test('T32 Zu tun: ohne Soll nie «besetzt», fehlende Personen, Unbestätigte, Einsatzleitung', () => {
  const jetzt = '2026-11-19T12:00:00.000Z';
  const basis = { jetzt, warnZahl: new Map<number, number>(), schichtWarnungen: new Map() };

  // Eine Schicht ohne Soll mit einer Anmeldung: «Kein Soll» und «wartet auf Bestätigung», keine Meldung «besetzt».
  const ohneSoll = einsatzLage({
    ...basis,
    schichten: [{ id: 1, name: 'Stadtlauf', end_zeit: '2026-11-21T22:00:00.000Z', soll_anzahl: null }],
    zahlen: new Map([[1, zahlen({ unbestaetigt: 1 })]]),
    mitEinsatzleitung: null,
  });
  assert.deepEqual(ohneSoll.punkte.map((p) => p.art), ['kein_soll', 'unbestaetigt']);
  assert.equal(ohneSoll.punkte[0].text, 'Kein Soll festgelegt.');
  assert.equal(ohneSoll.punkte[1].text, '1 Anmeldung wartet auf Bestätigung.');
  assert.equal(ohneSoll.unbestaetigt, 1);

  // Zwei Schichten: Name vor dem Text, keine Nullen, Einsatzleitung fehlt in einer Schicht.
  const zwei = einsatzLage({
    ...basis,
    warnZahl: new Map([[2, 0], [3, 2]]),
    schichten: [
      { id: 2, name: 'Tagschicht', end_zeit: '2026-11-23T18:00:00.000Z', soll_anzahl: 10 },
      { id: 3, name: 'Abendschicht', end_zeit: '2026-11-23T22:00:00.000Z', soll_anzahl: 6 },
    ],
    zahlen: new Map([[2, zahlen({ teilnehmende: 4, unbestaetigt: 2, unsicher: 1 })], [3, zahlen({ teilnehmende: 6 })]]),
    mitEinsatzleitung: new Set([2]),
  });
  assert.deepEqual(zwei.punkte.map((p) => p.art), ['fehlt', 'unbestaetigt', 'offen', 'warnung', 'einsatzleitung']);
  assert.equal(zwei.punkte[0].text, 'Tagschicht: 6 Personen fehlen.');
  assert.equal(zwei.punkte[2].text, 'Tagschicht: 1 Person ist unsicher.');
  assert.equal(zwei.punkte[2].status, 'unsicher');
  assert.equal(zwei.punkte[3].text, 'Abendschicht: 2 Warnungen bei Einträgen.');
  assert.equal(zwei.punkte[4].text, 'Keine Einsatzleitung eingeteilt: Abendschicht.');
  assert.equal(zwei.punkte[4].schichtId, 3);

  // Alles besetzt und bestätigt: leere Liste. Vergangene Schichten zählen nicht.
  const fertig = einsatzLage({
    ...basis,
    schichten: [
      { id: 4, name: 'A', end_zeit: '2026-11-23T18:00:00.000Z', soll_anzahl: 2 },
      { id: 5, name: 'B', end_zeit: '2026-11-01T18:00:00.000Z', soll_anzahl: 9 },
    ],
    zahlen: new Map([[4, zahlen({ teilnehmende: 2 })], [5, zahlen({ unbestaetigt: 3 })]]),
    mitEinsatzleitung: null,
  });
  assert.deepEqual(fertig.punkte, []);
  assert.equal(fertig.vorbei, false);
  assert.equal(fertig.unbestaetigt, 0);

  const vorbei = einsatzLage({ ...basis, schichten: [{ id: 5, name: 'B', end_zeit: '2026-11-01T18:00:00.000Z', soll_anzahl: 9 }], zahlen: new Map([[5, zahlen({})]]), mitEinsatzleitung: null });
  assert.equal(vorbei.vorbei, true);
});

test('T32 Einsatzansicht: Steckbrief, Schichten-Tabelle, Kacheln bei mehreren Schichten, Liste bei einer Schicht', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const r = await rang(t.db, 'Kad', 1);
    await person(t.db, 7, { vorname: 'Nina', nachname: 'Baumann', rang_id: r });
    await person(t.db, 8, { vorname: 'Marco', nachname: 'Rüegg <b>', rang_id: r });
    const { cookie } = await anmelden(t.db, 'aufgebot');
    const hole = async (pfad: string) => (await fetch(`${app.url}${pfad}`, { headers: { cookie }, redirect: 'manual' })).text();

    // Eine Schicht ohne Soll, eine Anmeldung: kein «besetzt», Liste statt Matrix.
    const s = await einsatz(t.db, 'Stadtlauf', inTagen(5, 12), inTagen(5, 20), 'Marktplatz');
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 8, status: 'angemeldet', kanal: 'telefon', bemerkung: 'Komme später' }, null);
    const eine = await hole(`/einsaetze/${s.einsatzId}`);
    assert.doesNotMatch(eine, /Alle Schichten sind besetzt/);
    assert.match(eine, /Kein Soll festgelegt\./);
    assert.match(eine, /1 Anmeldung wartet auf Bestätigung\./);
    assert.match(eine, /Keine Einsatzleitung eingeteilt\./);
    assert.match(eine, /<dt>Antreten<\/dt><dd>Marktplatz<\/dd>/);
    assert.match(eine, /0 bestätigt<\/strong> <span class="unter">\+ 1 angemeldet/);
    assert.match(eine, /href="\/schichten\/\d+\/bearbeiten">Soll setzen/);
    assert.match(eine, /Rüegg &lt;b&gt;/);
    assert.doesNotMatch(eine, /Rüegg <b>/);
    assert.match(eine, /Komme später/);
    assert.doesNotMatch(eine, /class="tabelle rueck personen-tabelle"/);
    assert.match(eine, new RegExp(`/rueckmeldungen/eintrag\\?schicht=${s.schichtId}&amp;person=8`));

    // Zweite Schicht: Matrix mit Kacheln, Fenster-Link für leere Felder, Hinweis «zeitlich möglich».
    const tag = lokalesDatum(inTagen(5, 12));
    const s2 = await erstelleSchicht(t.db, s.einsatzId, { name: 'Abend', start_datum: tag, start_zeit: '21:00', end_datum: tag, end_zeit: '23:00', soll_anzahl: '2' });
    await setzeAnmeldung(t.db, { schichtId: s2, personId: 7, status: 'bestaetigt', kanal: 'telefon', rolle: 'Einsatzleitung' }, null);
    const zwei = await hole(`/einsaetze/${s.einsatzId}`);
    assert.match(zwei, /class="tabelle rueck personen-tabelle"/);
    assert.match(zwei, new RegExp(`/rueckmeldungen/eintrag\\?schicht=${s2}&amp;person=8`));
    assert.match(zwei, /kachel k-bestaetigt/);
    assert.match(zwei, /kachel k-moeglich/);
    assert.match(zwei, /<small class="rolle">Einsatzleitung<\/small>/);
    assert.match(zwei, /<dt>Einsatzleitung<\/dt><dd><span class="rang">Kad<\/span> Nina Baumann/);
    assert.match(zwei, /Abend: 1 Person fehlt\./);
    assert.match(zwei, /Keine Einsatzleitung eingeteilt: Stadtlauf\./);

    // Filter «Offen»: nur Personen mit offenem Eintrag.
    const offen = await hole(`/einsaetze/${s.einsatzId}?personen=offen`);
    assert.match(offen, /Rüegg/);
    assert.doesNotMatch(offen, /<span class="name">Nina Baumann<\/span>/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

// T25: Aufgebot einer Schicht mit Rolle Einsatzleitung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, rang } from './hilfe.js';
import { aufgebotDaten } from '../src/domain/aufgebot-vorlage.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { ladeSchicht } from '../src/domain/schicht.js';
import { lokaleZeit, datumLangVonIso, wochentag } from '../src/domain/zeit.js';
import { schreibe } from '../src/db/db.js';

test('T25 Brief: Antreten/Abtreten aus der Schicht, Einsatzleitung mit Rang, Name, Telefon; leere Felder entfallen', async () => {
  const t = await neueDatenbank();
  try {
    const r = await rang(t.db, 'Kpl', 3);
    await person(t.db, 1, { vorname: 'Eva', nachname: 'Leiterin', rang_id: r, telefon: '079 111 22 33', strasse: 'Weg 1', plz: '4000', ort: 'Basel' });
    await person(t.db, 2, { vorname: 'Tim', nachname: 'Helfer', strasse: 'Weg 2', plz: '4000', ort: 'Basel' });
    const s = await einsatz(t.db, 'Stadtlauf', inTagen(14, 7), inTagen(14, 15), 'Marktplatz');
    await schreibe(t.db, 'UPDATE schicht SET tenue = NULL, aufgebot_hinweis = NULL, abtreten_ort = NULL WHERE id = ?', [s.schichtId]);
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon', rolle: 'Einsatzleitung' }, null);
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 2, status: 'bestaetigt', kanal: 'telefon' }, null);

    const sch = await ladeSchicht(t.db, s.schichtId);
    const a = await aufgebotDaten(t.db, s.schichtId);
    assert.ok(a.antreten.startsWith(`${wochentag(sch.start_zeit)}, ${datumLangVonIso(sch.start_zeit)}, ${lokaleZeit(sch.start_zeit)} Uhr`));
    assert.ok(a.antreten.includes(lokaleZeit(sch.start_zeit)));
    assert.ok(a.antreten.endsWith('Marktplatz'));
    assert.ok(a.abtreten.includes(`${lokaleZeit(sch.end_zeit)} Uhr`));
    assert.ok(a.abtreten.endsWith('Marktplatz'));
    assert.deepEqual(a.einsatzleitung, ['Kpl Eva Leiterin (079 111 22 33)']);
    assert.equal(a.tenue, null);
    assert.equal(a.hinweis, null);
    assert.equal(a.briefe.length, 2);
    assert.ok(!a.luecken.some((l) => l.code === 'W_EINSATZLEITUNG'));
    assert.ok(a.luecken.some((l) => l.code === 'W_TENUE'));
  } finally {
    await t.ende();
  }
});

test('T25 Telefon im Brief ohne Bindestrich (Wunsch Yann 26.11.2026)', async () => {
  const t = await neueDatenbank();
  try {
    await person(t.db, 1, { vorname: 'Eva', nachname: 'Leiterin', telefon: '+41-77 411 07 51' });
    const s = await einsatz(t.db, 'Stadtlauf', inTagen(14, 7), inTagen(14, 15), 'Marktplatz');
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'bestaetigt', kanal: 'telefon', rolle: 'Einsatzleitung' }, null);
    const a = await aufgebotDaten(t.db, s.schichtId);
    assert.deepEqual(a.einsatzleitung, ['Eva Leiterin (+41 77 411 07 51)']);
  } finally {
    await t.ende();
  }
});

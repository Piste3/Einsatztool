// T37: Einsatz › Besetzen (Konzept «Bedienung im Einsatz», OK Yann 20.11.2026).
// Eine Liste ersetzt Matrix, Einträge der Schicht und Anrufliste. Filter, Antwort-Knöpfe, alte Adressen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { besetzenDaten, filtereBesetzen, vorgabeFilter, zaehleBesetzen } from '../src/domain/besetzen.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { erstelleSchicht } from '../src/domain/schicht.js';
import { lokalesDatum } from '../src/domain/zeit.js';
import { schreibe } from '../src/db/db.js';

function geburtstag(jahreAlt: number): string {
  return `${new Date().getUTCFullYear() - jahreAlt}-01-01`;
}

test('T37 Besetzen: Filter je Schicht und über alle Schichten, Mindestalter, Vorgabe', async () => {
  const t = await neueDatenbank();
  try {
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(20, 13), inTagen(20, 19), 'Claraplatz');
    const tag = lokalesDatum(inTagen(20, 13));
    const abend = await erstelleSchicht(t.db, s.einsatzId, { name: 'Abend', start_datum: tag, start_zeit: '19:00', end_datum: tag, end_zeit: '23:00' });
    await schreibe(t.db, 'UPDATE schicht SET min_alter = 16 WHERE id = ?', [abend]);
    await person(t.db, 1, { vorname: 'Ana', nachname: 'Neu', geburtsdatum: geburtstag(20) });
    await person(t.db, 2, { vorname: 'Ben', nachname: 'Bestätigt', geburtsdatum: geburtstag(20) });
    await person(t.db, 3, { vorname: 'Ugo', nachname: 'Unsicher', geburtsdatum: geburtstag(20) });
    await person(t.db, 4, { vorname: 'Jan', nachname: 'Jung', geburtsdatum: geburtstag(12) });
    await person(t.db, 5, { vorname: 'Fia', nachname: 'Frei', geburtsdatum: geburtstag(20) });
    await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'formular' }, null);
    await setzeAnmeldung(t.db, { schichtId: abend, personId: 2, status: 'bestaetigt', kanal: 'telefon' }, null);
    await setzeAnmeldung(t.db, { schichtId: abend, personId: 3, status: 'unsicher', kanal: 'telefon' }, null);

    const d = await besetzenDaten(t.db, s.einsatzId);
    const namen = (l: { name: string }[]) => l.map((z) => z.name).sort();

    // Schicht «Abend»: Ana hat dort keinen Eintrag. Jan ist zu jung und nur mit «Einblenden» sichtbar.
    assert.deepEqual(namen(filtereBesetzen(d.zeilen, [abend], 'nicht')), ['Ana Neu', 'Fia Frei']);
    assert.deepEqual(namen(filtereBesetzen(d.zeilen, [abend], 'nicht', true)), ['Ana Neu', 'Fia Frei', 'Jan Jung']);
    assert.deepEqual(namen(filtereBesetzen(d.zeilen, [abend], 'offen')), ['Ugo Unsicher']);
    assert.deepEqual(namen(filtereBesetzen(d.zeilen, [abend], 'neu')), []);
    const zahlAbend = zaehleBesetzen(d.zeilen, [abend]);
    assert.equal(zahlAbend.unpassend, 1);
    assert.equal(zahlAbend.alle, 2);

    // Alle Schichten: «Nicht gefragt» = kein Eintrag im ganzen Einsatz. Jan passt zur ersten Schicht (ohne Mindestalter).
    const ids = d.schichten.map((x) => x.id);
    assert.deepEqual(namen(filtereBesetzen(d.zeilen, ids, 'nicht')), ['Fia Frei', 'Jan Jung']);
    assert.deepEqual(namen(filtereBesetzen(d.zeilen, ids, 'neu')), ['Ana Neu']);
    assert.deepEqual(namen(filtereBesetzen(d.zeilen, ids, 'alle')), ['Ana Neu', 'Ben Bestätigt', 'Ugo Unsicher']);

    // Vorgabe (Wunsch Yann 20.11.2026): «Neu + Bestätigt», sonst alle Einträge, sonst «Nicht gefragt».
    assert.deepEqual(namen(filtereBesetzen(d.zeilen, ids, 'an')), ['Ana Neu', 'Ben Bestätigt']);
    assert.equal(vorgabeFilter(zaehleBesetzen(d.zeilen, ids)), 'an');
    assert.equal(vorgabeFilter({ ...zahlAbend, an: 0 }), 'alle');
    assert.equal(vorgabeFilter({ ...zahlAbend, an: 0, alle: 0 }), 'nicht');
  } finally {
    await t.ende();
  }
});

test('T37 Besetzen im Web: Antwort-Knopf legt Eintrag an, alte Adressen, Dokumente, Maskierung', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Stadtlauf', inTagen(9, 12), inTagen(9, 18), 'Marktplatz');
    await person(t.db, 7, { vorname: 'Nina', nachname: 'Baumann <b>', telefon: '079 123 45 67' });
    const { cookie, csrf } = await anmelden(t.db, 'aufgebot');
    const hole = async (pfad: string) => fetch(`${app.url}${pfad}`, { headers: { cookie }, redirect: 'manual' });
    const pfad = `/einsaetze/${s.einsatzId}/besetzen`;

    // Ohne Einträge zeigt die Seite «Nicht gefragt» mit Telefon und Antwort-Knöpfen. Der Name ist maskiert.
    const leer = await (await hole(pfad)).text();
    // Wunsch Yann 26.11.2026: Umschalter «Neu + Bestätigt» / «Nicht gefragt» mit Hinweis «Personen hinzufügen».
    assert.match(leer, /class="besetzen-wechsel"/);
    assert.match(leer, /aria-current="page"><span class="wechsel-titel">Nicht gefragt <strong>1<\/strong><\/span><span class="wechsel-unter">＋ Personen hinzufügen/);
    assert.match(leer, /Baumann &lt;b&gt;/);
    assert.doesNotMatch(leer, /Baumann <b>/);
    assert.match(leer, /href="tel:/);
    assert.match(leer, new RegExp(`action="/schichten/${s.schichtId}/sammelstatus"`));
    assert.match(leer, />Dokumente /);
    assert.match(leer, new RegExp(`href="/schichten/${s.schichtId}/aufgebot"`));

    // Knopf «An»: Der Eintrag entsteht mit Statusprotokoll. Zurück auf dieselbe Liste.
    const r = await fetch(`${app.url}/schichten/${s.schichtId}/sammelstatus`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, zurueck: `${pfad}?filter=nicht`, status: 'angemeldet', kanal: 'telefon', personen: '7' }),
    });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `${pfad}?filter=nicht`);
    const [a] = await zeilen(t.db, 'SELECT id, status FROM anmeldung WHERE schicht_id = ? AND person_id = 7', [s.schichtId]);
    assert.equal(a.status, 'angemeldet');
    const [log] = await zeilen(t.db, 'SELECT COUNT(*) AS n FROM status_log WHERE anmeldung_id = ?', [a.id]);
    assert.ok(Number(log.n) >= 1);

    // Danach: Vorgabe «Neu + Bestätigt» mit «Bestätigen» in der Zeile.
    const neu = await (await hole(pfad)).text();
    assert.match(neu, /aria-current="page"><span class="wechsel-titel">Neu \+ Bestätigt <strong>1<\/strong>/);
    assert.match(neu, new RegExp(`action="/anmeldungen/${a.id}"[\\s\\S]*?value="bestaetigt"`));

    // Alte Adressen führen auf «Besetzen».
    const schicht = await hole(`/schichten/${s.schichtId}?status=unsicher`);
    assert.equal(schicht.status, 303);
    assert.match(schicht.headers.get('location')!, /\/besetzen\?schicht=\d+&filter=offen$/);
    const anruf = await hole(`/schichten/${s.schichtId}/anrufliste?alle=1`);
    assert.match(anruf.headers.get('location')!, /filter=nicht&unpassend=1$/);
    assert.equal((await hole(`/einsaetze/${s.einsatzId}/anmeldungen`)).headers.get('location'), pfad);

    // «Zu tun» verlinkt auf «Besetzen».
    const uebersicht = await (await hole(`/einsaetze/${s.einsatzId}`)).text();
    assert.match(uebersicht, new RegExp(`href="/einsaetze/${s.einsatzId}/besetzen\\?filter=neu">Ansehen`));
  } finally {
    await app.stopp();
    await t.ende();
  }
});

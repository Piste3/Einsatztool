// T26: Mehrere Benutzer arbeiten gleichzeitig (bis rund 8).
// Schutz gegen gegenseitiges Überschreiben, Wiederholung bei Sperren, Jobs nur einmal. Live-Aktualisierung: T28.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { aendereAnmeldung, setzeAnmeldung } from '../src/domain/anmeldung.js';
import { aendereEinsatz, ladeEinsatz } from '../src/domain/einsatz.js';
import { aendereSchicht, ladeSchicht } from '../src/domain/schicht.js';
import { Konflikt } from '../src/domain/eingabe.js';
import { MAX_VERSUCHE, schreibe, transaktion, Wiederholen } from '../src/db/db.js';
import { fuehreAus, LAEUFT_SCHON } from '../src/jobs/taeglich.js';
import { lokalesDatum, lokaleZeit } from '../src/domain/zeit.js';

async function benutzer(db: any, name: string): Promise<number> {
  const r = await schreibe(db, 'INSERT INTO benutzer (name, email, entra_oid, rolle) VALUES (?, ?, ?, ?)', [
    name, `${name.toLowerCase()}@kkb.ch`, `oid-${name}`, 'aufgebot',
  ]);
  return r.insertId;
}

function schichtZeit(start: Date, ende: Date) {
  return { start_datum: lokalesDatum(start), start_zeit: lokaleZeit(start), end_datum: lokalesDatum(ende), end_zeit: lokaleZeit(ende) };
}

test('T26 Veraltetes Formular überschreibt die Änderung eines anderen Benutzers nicht', async () => {
  const t = await neueDatenbank();
  try {
    const anna = await benutzer(t.db, 'Anna');
    const ben = await benutzer(t.db, 'Ben');
    await person(t.db, 1, { vorname: 'Eva', nachname: 'Muster' });
    const s = await einsatz(t.db, 'Stadtlauf', inTagen(5, 8), inTagen(5, 12));
    const id = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, null);
    const [geladen] = await zeilen(t.db, 'SELECT version FROM anmeldung WHERE id = ?', [id]);
    assert.equal(geladen.version, 1);

    // Anna und Ben öffnen beide den Eintrag (Version 1). Anna speichert zuerst.
    await aendereAnmeldung(t.db, id, { status: 'unsicher', rolle: '', kanal: 'telefon', bemerkung: '', version: 1 }, anna);
    // Ben speichert mit dem alten Stand: Das Tool meldet einen Konflikt und speichert nichts.
    await assert.rejects(
      aendereAnmeldung(t.db, id, { status: 'angemeldet', rolle: '', kanal: 'telefon', bemerkung: 'Kommt später', version: 1 }, ben),
      (e: unknown) => e instanceof Konflikt && /Anna/.test(e.message) && /nicht gespeichert/.test(e.message),
    );
    const [nachher] = await zeilen(t.db, 'SELECT status, bemerkung, version FROM anmeldung WHERE id = ?', [id]);
    assert.equal(nachher.status, 'unsicher');
    assert.equal(nachher.bemerkung, null);
    assert.equal(nachher.version, 2);

    // Mit dem neuen Stand speichert Ben ohne Konflikt.
    await aendereAnmeldung(t.db, id, { status: 'unsicher', rolle: '', kanal: 'telefon', bemerkung: 'Kommt später', version: 2 }, ben);
    // Der Knopf «Bestätigen» schickt keine Version. Er wirkt immer.
    await aendereAnmeldung(t.db, id, { status: 'bestaetigt' }, anna);
    const [ende] = await zeilen(t.db, 'SELECT status, bemerkung, version FROM anmeldung WHERE id = ?', [id]);
    assert.deepEqual([ende.status, ende.bemerkung, ende.version], ['bestaetigt', 'Kommt später', 4]);
  } finally {
    await t.ende();
  }
});

test('T26 Konflikt bei Einsatz und Schicht, Vererbung macht ein offenes Schicht-Formular ungültig', async () => {
  const t = await neueDatenbank();
  try {
    const start = inTagen(7, 8);
    const ende = inTagen(7, 12);
    const s = await einsatz(t.db, 'Fasnacht', start, ende, 'Marktplatz');
    const e1 = await ladeEinsatz(t.db, s.einsatzId);
    const sch1 = await ladeSchicht(t.db, s.schichtId);
    assert.equal(e1.version, 1);
    assert.equal(sch1.version, 1);

    // Anna ändert den Ort des Einsatzes. Die Schicht erbt den Ort, ihre Version steigt.
    await aendereEinsatz(t.db, s.einsatzId, { name: 'Fasnacht', ort: 'Barfüsserplatz', version: 1 });
    assert.equal((await ladeSchicht(t.db, s.schichtId)).version, 2);

    // Ben hatte das Einsatz-Formular mit Version 1 offen.
    let konflikt: Konflikt | null = null;
    try {
      await aendereEinsatz(t.db, s.einsatzId, { name: 'Fasnacht 2027', ort: 'Marktplatz', version: 1 });
    } catch (e) {
      konflikt = e as Konflikt;
    }
    assert.ok(konflikt instanceof Konflikt);
    assert.equal(konflikt.aktuelleVersion, 2);
    assert.equal((await ladeEinsatz(t.db, s.einsatzId)).name, 'Fasnacht');
    // Ben speichert bewusst erneut (Formular trägt jetzt die aktuelle Version).
    await aendereEinsatz(t.db, s.einsatzId, { name: 'Fasnacht 2027', ort: 'Barfüsserplatz', version: konflikt.aktuelleVersion });
    assert.equal((await ladeEinsatz(t.db, s.einsatzId)).name, 'Fasnacht 2027');

    // Ein Schicht-Formular mit Version 1 ist veraltet.
    await assert.rejects(aendereSchicht(t.db, s.schichtId, { name: 'Früh', ...schichtZeit(start, ende), ort: 'Marktplatz', version: 1 }), Konflikt);
    assert.equal((await ladeSchicht(t.db, s.schichtId)).ort, 'Barfüsserplatz');
    await aendereSchicht(t.db, s.schichtId, { name: 'Früh', ...schichtZeit(start, ende), ort: 'Marktplatz', version: 2 });
    const sch = await ladeSchicht(t.db, s.schichtId);
    assert.deepEqual([sch.name, sch.ort, sch.version], ['Früh', 'Marktplatz', 3]);
  } finally {
    await t.ende();
  }
});

test('T26 Acht Benutzer tragen gleichzeitig ein: kein Fehler, kein doppelter Eintrag', async () => {
  const t = await neueDatenbank();
  try {
    const ids: number[] = [];
    for (let i = 1; i <= 8; i++) ids.push(await benutzer(t.db, `B${i}`));
    for (let p = 1; p <= 8; p++) await person(t.db, p);
    const s = await einsatz(t.db, 'Gross', inTagen(9, 8), inTagen(9, 12));

    // Alle acht tragen gleichzeitig dieselbe Person ein.
    await Promise.all(ids.map((b) => setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, b)));
    const gleich = await zeilen(t.db, 'SELECT id FROM anmeldung WHERE schicht_id = ? AND person_id = 1', [s.schichtId]);
    assert.equal(gleich.length, 1);
    const erstellt = await zeilen(t.db, "SELECT id FROM status_log WHERE anmeldung_id = ? AND aktion = 'erstellt'", [gleich[0].id]);
    assert.equal(erstellt.length, 1);

    // Alle acht tragen gleichzeitig je eine andere Person ein und ändern danach gleichzeitig den Status.
    const neu = await Promise.all(
      ids.map((b, i) => setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: i + 1, status: 'nachricht_gesendet', kanal: 'whatsapp' }, b)),
    );
    await Promise.all(neu.map((aid, i) => aendereAnmeldung(t.db, aid, { status: 'bestaetigt' }, ids[i])));
    const alle = await zeilen(t.db, 'SELECT status FROM anmeldung WHERE schicht_id = ?', [s.schichtId]);
    assert.equal(alle.length, 8);
    assert.ok(alle.every((a) => a.status === 'bestaetigt'));
  } finally {
    await t.ende();
  }
});

test('T26 Transaktion startet nach einem Deadlock neu, andere Fehler nicht', async () => {
  const t = await neueDatenbank();
  try {
    let versuche = 0;
    const ergebnis = await transaktion(t.db, async () => {
      versuche++;
      if (versuche === 1) throw Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' });
      if (versuche === 2) throw new Wiederholen('gleichzeitig');
      return 'ok';
    });
    assert.equal(ergebnis, 'ok');
    assert.equal(versuche, 3);

    // Ein Deadlock, der nicht aufhört: Nach MAX_VERSUCHE gibt das Tool auf.
    let immer = 0;
    await assert.rejects(
      transaktion(t.db, async () => {
        immer++;
        throw Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' });
      }),
      /Deadlock/,
    );
    assert.equal(immer, MAX_VERSUCHE);

    // Ein gewöhnlicher Fehler läuft nur einmal.
    let einmal = 0;
    await assert.rejects(transaktion(t.db, async () => {
      einmal++;
      throw new Error('kaputt');
    }), /kaputt/);
    assert.equal(einmal, 1);
  } finally {
    await t.ende();
  }
});

test('T26 Web: Konflikt führt zurück mit Meldung, Formular behält die Eingaben', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    await person(t.db, 1, { vorname: 'Eva', nachname: 'Muster' });
    const s = await einsatz(t.db, 'Web', inTagen(6, 8), inTagen(6, 12));
    const aid = await setzeAnmeldung(t.db, { schichtId: s.schichtId, personId: 1, status: 'angemeldet', kanal: 'telefon' }, null);
    const { cookie, csrf } = await anmelden(t.db);

    const seite = await (await fetch(`${app.url}/schichten/${s.schichtId}`, { headers: { cookie } })).text();
    assert.match(seite, /name="version" value="1"/);

    // Ein anderer Benutzer ändert den Eintrag.
    await aendereAnmeldung(t.db, aid, { status: 'unsicher' }, null);

    // Speichern mit dem alten Stand: Rücksprung mit Fehlermeldung, nichts gespeichert.
    const r3 = await fetch(`${app.url}/anmeldungen/${aid}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, zurueck: `/schichten/${s.schichtId}`, status: 'abgemeldet', rolle: '', kanal: 'telefon', bemerkung: '', version: '1' }),
      redirect: 'manual',
    });
    assert.equal(r3.status, 303);
    assert.equal(r3.headers.get('location'), `/schichten/${s.schichtId}`);
    assert.match(r3.headers.get('set-cookie') ?? '', /meldung=/);
    const [a] = await zeilen(t.db, 'SELECT status FROM anmeldung WHERE id = ?', [aid]);
    assert.equal(a.status, 'unsicher');

    // Einsatz-Formular mit altem Stand: 409, Eingaben bleiben, Formular trägt die neue Version.
    await aendereEinsatz(t.db, s.einsatzId, { name: 'Web neu' });
    const r4 = await fetch(`${app.url}/einsaetze/${s.einsatzId}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, name: 'Mein Name', ort: '', version: '1' }),
      redirect: 'manual',
    });
    assert.equal(r4.status, 409);
    const html4 = await r4.text();
    assert.match(html4, /anderer Benutzer/);
    assert.match(html4, /value="Mein Name"/);
    assert.match(html4, /name="version" value="2"/);
    assert.equal((await ladeEinsatz(t.db, s.einsatzId)).name, 'Web neu');
  } finally {
    await app.stopp();
    await t.ende();
  }
});

test('T26 Ein Job läuft nie zweimal gleichzeitig', async () => {
  const t = await neueDatenbank();
  try {
    let laeufe = 0;
    let freigeben: () => void = () => undefined;
    const job = {
      name: 'testjob',
      stunde: 3,
      lauf: async () => {
        laeufe++;
        await new Promise<void>((ok) => (freigeben = ok));
        return { ok: true, meldung: 'fertig' };
      },
    };
    const erster = fuehreAus(t.db, job, false);
    const zweiter = await fuehreAus(t.db, job, false);
    assert.deepEqual(zweiter, { ok: false, meldung: LAEUFT_SCHON });
    freigeben();
    assert.deepEqual(await erster, { ok: true, meldung: 'fertig' });
    assert.equal(laeufe, 1);
    // Danach läuft der Job wieder normal.
    const dritter = fuehreAus(t.db, job, false);
    await new Promise((ok) => setTimeout(ok, 10));
    freigeben();
    assert.equal((await dritter).ok, true);
    assert.equal(laeufe, 2);
  } finally {
    await t.ende();
  }
});

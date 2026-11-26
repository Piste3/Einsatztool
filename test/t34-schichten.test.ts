// T34: Einsatz › Schichten (Vorschlag Yann 20.11.2026): eine Zeile zum Aufklappen je Schicht mit allen Angaben.
// Ersetzt Karten, Tabelle «Schichten bearbeiten» und die Seite «Schicht bearbeiten». Neue Schicht, Kopie, Konflikt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { aendereSchicht, erstelleSchicht, kopiereSchicht, ladeSchicht } from '../src/domain/schicht.js';
import { lokalesDatum, lokaleZeit } from '../src/domain/zeit.js';

test('T34 Schicht: Enddatum leer = gleicher Tag oder Folgetag, Kopie ohne Einträge und nicht publiziert', async () => {
  const t = await neueDatenbank();
  try {
    const s = await einsatz(t.db, 'Kasernenfest', inTagen(10, 9), inTagen(10, 17), 'Kasernenhof');
    const tag = lokalesDatum(inTagen(10, 9));
    const nacht = await erstelleSchicht(t.db, s.einsatzId, { name: 'Nacht', start_datum: tag, start_zeit: '22:00', end_datum: '', end_zeit: '02:00', soll_anzahl: '3', rollen: { Einsatzleitung: '1' } });
    const n = await ladeSchicht(t.db, nacht);
    assert.ok(lokalesDatum(n.end_zeit) > tag);
    assert.equal(n.publiziert, 0);
    assert.equal(n.ort, 'Kasernenhof');

    const a = await ladeSchicht(t.db, s.schichtId);
    await aendereSchicht(t.db, a.id, { name: 'Tag', start_datum: tag, start_zeit: '08:00', end_datum: '', end_zeit: '12:00', tenue: 'Sommertenue', version: a.version });
    const a2 = await ladeSchicht(t.db, a.id);
    assert.equal(lokalesDatum(a2.end_zeit), tag);
    assert.equal(lokaleZeit(a2.end_zeit), '12:00');
    assert.equal(a2.tenue, 'Sommertenue');

    const k = await kopiereSchicht(t.db, nacht);
    const kopie = await ladeSchicht(t.db, k);
    assert.equal(kopie.name, 'Nacht (Kopie)');
    assert.equal(kopie.publiziert, 0);
    assert.equal(kopie.start_zeit, n.start_zeit);
    assert.equal(kopie.soll_anzahl, 3);
    const [rolle] = await zeilen(t.db, 'SELECT anzahl FROM schicht_rolle WHERE schicht_id = ? AND rolle = ?', [k, 'Einsatzleitung']);
    assert.equal(Number(rolle.anzahl), 1);
    const [anz] = await zeilen(t.db, 'SELECT COUNT(*) AS n FROM anmeldung WHERE schicht_id = ?', [k]);
    assert.equal(Number(anz.n), 0);
  } finally {
    await t.ende();
  }
});

test('T34 Reiter Schichten im Web: Zeilen, Speichern, Konflikt in der Zeile, neue Schicht, alte Adressen', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Kasernenfest', inTagen(10, 9), inTagen(10, 17), 'Kasernenhof');
    const tag = lokalesDatum(inTagen(10, 9));
    const b = await erstelleSchicht(t.db, s.einsatzId, { name: 'Abbau', start_datum: tag, start_zeit: '18:00', end_datum: '', end_zeit: '20:00' });
    const { cookie, csrf } = await anmelden(t.db, 'aufgebot');
    const hole = async (pfad: string) => fetch(`${app.url}${pfad}`, { headers: { cookie }, redirect: 'manual' });
    const post = (pfad: string, felder: Record<string, string>) => fetch(`${app.url}${pfad}`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, ...felder }),
    });

    const seite = await (await hole(`/einsaetze/${s.einsatzId}/schichten`)).text();
    for (const r of ['Übersicht', 'Besetzen', 'Schichten', 'Verlauf']) assert.match(seite, new RegExp(`>${r}<`));
    assert.match(seite, new RegExp(`id="schicht-${b}"`));
    assert.match(seite, new RegExp(`id="s${b}-tenue"`));
    assert.match(seite, /id="neue-schicht"/);
    assert.doesNotMatch(seite, /schichten\/tabelle/);
    // Mit mehreren Schichten ist nur die gewählte Zeile offen.
    const offen = await (await hole(`/einsaetze/${s.einsatzId}/schichten?offen=${b}`)).text();
    assert.equal((offen.match(/<details open>/g) ?? []).length, 1);

    // Speichern: alle Angaben in einem Formular, maskiert angezeigt.
    const alt = await ladeSchicht(t.db, b);
    const ok = await post(`/schichten/${b}`, { version: String(alt.version), name: 'Abbau <b>', start_datum: tag, start_zeit: '18:00', end_zeit: '21:00', tenue: 'Arbeitskleider', soll_anzahl: '4', 'rollen[Einsatzleitung]': '1' });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), `/einsaetze/${s.einsatzId}/schichten?offen=${b}#schicht-${b}`);
    const neu = await ladeSchicht(t.db, b);
    assert.deepEqual([neu.name, neu.tenue, neu.soll_anzahl, lokaleZeit(neu.end_zeit)], ['Abbau <b>', 'Arbeitskleider', 4, '21:00']);
    const nachher = await (await hole(`/einsaetze/${s.einsatzId}/schichten`)).text();
    assert.match(nachher, /Abbau &lt;b&gt;/);
    assert.doesNotMatch(nachher, /Abbau <b>/);

    // Konflikt: alte Version, die Zeile bleibt offen mit Meldung und Eingaben.
    const k = await post(`/schichten/${b}`, { version: String(alt.version), name: 'Meine Eingabe', start_datum: tag, start_zeit: '18:00', end_zeit: '20:00' });
    assert.equal(k.status, 409);
    const kText = await k.text();
    assert.match(kText, /Ein anderer Benutzer/);
    assert.match(kText, /value="Meine Eingabe"/);
    assert.match(kText, new RegExp(`name="version" value="${neu.version}"`));
    assert.equal((await ladeSchicht(t.db, b)).name, 'Abbau <b>');

    // Neue Schicht in der untersten Zeile: Ende vor Beginn = Folgetag.
    const n = await post(`/einsaetze/${s.einsatzId}/schichten`, { name: 'Nacht', start_datum: tag, start_zeit: '22:00', end_zeit: '02:00' });
    assert.equal(n.status, 303);
    const [nacht] = await zeilen(t.db, "SELECT id, end_zeit, publiziert FROM schicht WHERE einsatz_id = ? AND name = 'Nacht'", [s.einsatzId]);
    assert.equal(Number(nacht.publiziert), 0);
    assert.ok(lokalesDatum(nacht.end_zeit) > tag);
    const fehler = await post(`/einsaetze/${s.einsatzId}/schichten`, { name: 'Ohne Datum', start_datum: '' });
    assert.equal(fehler.status, 400);
    assert.match(await fehler.text(), /value="Ohne Datum"/);

    // Kopieren und alte Adressen.
    const kopie = await post(`/schichten/${b}/kopieren`, {});
    assert.equal(kopie.status, 303);
    assert.equal((await hole(`/schichten/${b}/bearbeiten`)).headers.get('location'), `/einsaetze/${s.einsatzId}/schichten?offen=${b}#schicht-${b}`);
    assert.equal((await hole(`/einsaetze/${s.einsatzId}/schichten/neu`)).headers.get('location'), `/einsaetze/${s.einsatzId}/schichten#neue-schicht`);

    // Verlauf: leer, aber die Seite lädt.
    // Seit 26.11.2026 zeigt der Verlauf auch Änderungen an Schichten (T53).
    assert.match(await (await hole(`/einsaetze/${s.einsatzId}/verlauf`)).text(), /Schicht erstellt/);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

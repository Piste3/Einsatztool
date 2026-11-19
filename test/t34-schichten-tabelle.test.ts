// T34: Einsatz › Schichten (Vorlage Yann, Handbuch): Karten je Schicht und Tabelle «Schichten bearbeiten».
// Mehrere Schichten auf einmal ändern, neue Schicht in der untersten Zeile, Konfliktschutz je Zeile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { erstelleSchicht, ladeSchicht, aendereSchicht, speichereSchichtTabelle, zeilenAbdruck, passtInTabelle } from '../src/domain/schicht.js';
import { Konflikt } from '../src/domain/eingabe.js';
import { lokalesDatum, lokaleZeit } from '../src/domain/zeit.js';

test('T34 Schichten-Tabelle: ändern, neue Schicht, Nachtschicht, unberührte Zeile, Konflikt', async () => {
  const t = await neueDatenbank();
  try {
    const s = await einsatz(t.db, 'Kasernenfest', inTagen(10, 9), inTagen(10, 17), 'Kasernenhof');
    const tag = lokalesDatum(inTagen(10, 9));
    const b = await erstelleSchicht(t.db, s.einsatzId, { name: 'Abbau', start_datum: tag, start_zeit: '18:00', end_datum: tag, end_zeit: '20:00' });
    const a1 = await ladeSchicht(t.db, s.schichtId);
    const b1 = await ladeSchicht(t.db, b);
    const zeile = (x: typeof a1, aenderung: Record<string, unknown> = {}) => {
      const z = { name: x.name, datum: lokalesDatum(x.start_zeit), beginn: lokaleZeit(x.start_zeit), ende: lokaleZeit(x.end_zeit), soll_anzahl: x.soll_anzahl ?? '', ort: x.ort ?? '', bemerkung_intern: x.bemerkung_intern ?? '', rollen: {} };
      return { ...z, id: x.id, version: x.version, ursprung: zeilenAbdruck(z), ...aenderung };
    };

    // Erste Zeile: Name, Soll und Bedarf Einsatzleitung. Zweite Zeile unverändert. Neue Nachtschicht 22:00–02:00.
    const r = await speichereSchichtTabelle(t.db, s.einsatzId, [
      zeile(a1, { name: 'Festbetrieb', soll_anzahl: '9', rollen: { Einsatzleitung: '1' } }),
      zeile(b1),
    ], { name: 'Nacht', datum: tag, beginn: '22:00', ende: '02:00', soll_anzahl: '3', rollen: {} });
    assert.equal(r.geaendert, 1);
    const a2 = await ladeSchicht(t.db, s.schichtId);
    assert.equal(a2.name, 'Festbetrieb');
    assert.equal(a2.soll_anzahl, 9);
    assert.equal(a2.version, a1.version + 1);
    assert.equal(a2.ort, 'Kasernenhof');
    assert.equal((await ladeSchicht(t.db, b)).version, b1.version);
    const [rolle] = await zeilen(t.db, 'SELECT anzahl FROM schicht_rolle WHERE schicht_id = ? AND rolle = ?', [s.schichtId, 'Einsatzleitung']);
    assert.equal(Number(rolle.anzahl), 1);
    const nacht = await ladeSchicht(t.db, r.neuId!);
    assert.equal(nacht.publiziert, 0);
    assert.equal(nacht.soll_anzahl, 3);
    assert.equal(lokalesDatum(nacht.end_zeit) > lokalesDatum(nacht.start_zeit), true);
    assert.equal(passtInTabelle(nacht), true);

    // Ein anderer Benutzer ändert «Abbau». Eine unberührte Zeile mit alter Version überschreibt nichts.
    await aendereSchicht(t.db, b, { name: 'Abbau spät', start_datum: tag, start_zeit: '19:00', end_datum: tag, end_zeit: '21:00' });
    const r2 = await speichereSchichtTabelle(t.db, s.einsatzId, [zeile(b1)], null);
    assert.equal(r2.geaendert, 0);
    assert.equal((await ladeSchicht(t.db, b)).name, 'Abbau spät');

    // Eine geänderte Zeile mit alter Version speichert nichts (Konflikt). Auch die anderen Zeilen bleiben gleich.
    const a3 = await ladeSchicht(t.db, s.schichtId);
    await assert.rejects(
      speichereSchichtTabelle(t.db, s.einsatzId, [zeile(a3, { name: 'Fest neu' }), zeile(b1, { name: 'Abbau alt' })], null),
      (f: unknown) => f instanceof Konflikt,
    );
    assert.equal((await ladeSchicht(t.db, s.schichtId)).name, 'Festbetrieb');

    // Ungültige Zeit: Eingabefehler, nichts gespeichert.
    await assert.rejects(speichereSchichtTabelle(t.db, s.einsatzId, [zeile(a3, { beginn: '25:00' })], null), /Beginn/);
  } finally {
    await t.ende();
  }
});

test('T34 Reiter: Übersicht, Anmeldungen, Schichten, Verlauf; Tabelle über das Web', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Kasernenfest', inTagen(10, 9), inTagen(10, 17), 'Kasernenhof');
    const { cookie, csrf } = await anmelden(t.db, 'aufgebot');
    const hole = async (pfad: string) => (await fetch(`${app.url}${pfad}`, { headers: { cookie }, redirect: 'manual' })).text();

    const seite = await hole(`/einsaetze/${s.einsatzId}/schichten`);
    for (const r of ['Übersicht', 'Anmeldungen', 'Schichten', 'Verlauf']) assert.match(seite, new RegExp(`>${r}<`));
    assert.match(seite, /Noch niemand zugeteilt\./);
    assert.match(seite, /Schichten bearbeiten/);
    assert.match(seite, new RegExp(`name="z\\[s${s.schichtId}\\]\\[name\\]"`));
    assert.match(seite, /name="z\[neu\]\[name\]"/);

    // Speichern über die Tabelle: Name ändern und neue Schicht anlegen.
    const a = await ladeSchicht(t.db, s.schichtId);
    const datum = lokalesDatum(a.start_zeit);
    const formular = new URLSearchParams({
      _csrf: csrf,
      [`z[s${a.id}][name]`]: 'Festbetrieb <b>', [`z[s${a.id}][datum]`]: datum, [`z[s${a.id}][beginn]`]: lokaleZeit(a.start_zeit),
      [`z[s${a.id}][ende]`]: lokaleZeit(a.end_zeit), [`z[s${a.id}][soll_anzahl]`]: '9', [`z[s${a.id}][ort]`]: 'Kasernenhof',
      [`z[s${a.id}][bemerkung_intern]`]: '', [`z[s${a.id}][version]`]: String(a.version), [`z[s${a.id}][ursprung]`]: 'alt',
      'z[neu][name]': 'Abbau', 'z[neu][datum]': datum, 'z[neu][beginn]': '18:00', 'z[neu][ende]': '20:00',
    });
    const r = await fetch(`${app.url}/einsaetze/${s.einsatzId}/schichten/tabelle`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: formular,
    });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `/einsaetze/${s.einsatzId}/schichten`);
    const liste = await zeilen(t.db, 'SELECT name, soll_anzahl FROM schicht WHERE einsatz_id = ? ORDER BY start_zeit', [s.einsatzId]);
    assert.deepEqual(liste.map((x) => x.name), ['Festbetrieb <b>', 'Abbau']);
    const nachher = await hole(`/einsaetze/${s.einsatzId}/schichten`);
    assert.match(nachher, /Festbetrieb &lt;b&gt;/);
    assert.doesNotMatch(nachher, /Festbetrieb <b>/);

    // Fehler: Die Seite zeigt die Meldung und behält die Eingaben.
    formular.set(`z[s${a.id}][beginn]`, 'xx');
    formular.set(`z[s${a.id}][name]`, 'Meine Eingabe');
    formular.set('z[neu][name]', '');
    const f = await fetch(`${app.url}/einsaetze/${s.einsatzId}/schichten/tabelle`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: formular,
    });
    assert.equal(f.status, 400);
    const fehler = await f.text();
    assert.match(fehler, /Beginn/);
    assert.match(fehler, /value="Meine Eingabe"/);

    // Verlauf: leer, aber die Seite lädt.
    assert.match(await hole(`/einsaetze/${s.einsatzId}/verlauf`), /Noch keine Einträge im Statusprotokoll\./);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

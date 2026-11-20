// T38: Text für den Clubdesk-Termin mit Bausteinen (Wunsch Yann 20.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, einsatz, inTagen, person, rang, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { schreibe } from '../src/db/db.js';
import { clubdeskText, fuelleClubdeskVorlage } from '../src/domain/clubdesk-text.js';
import { CLUBDESK_TERMIN, STANDARD_CLUBDESK, ladeVorlage, speichereVorlage } from '../src/domain/vorlagen.js';
import { erzeugeIcs } from '../src/domain/ics.js';
import { ladeSchicht } from '../src/domain/schicht.js';

test('T38a Eine Zeile mit nur leeren Bausteinen entfällt, Text ohne Baustein bleibt', () => {
  const v = 'Ort: {ort}\nTenue: {tenue}\n\n\n\nFest\n{ort} / {tenue}\n{unbekannt}';
  assert.equal(fuelleClubdeskVorlage(v, { ort: 'Marktplatz', tenue: '' }), 'Ort: Marktplatz\n\nFest\nMarktplatz / \n{unbekannt}');
  assert.equal(fuelleClubdeskVorlage(v, { ort: '', tenue: '' }), 'Fest\n{unbekannt}');
});

test('T38b Standardvorlage füllt die Angaben der Schicht aus, gespeicherte Vorlage gilt danach, auch im ICS', async () => {
  const t = await neueDatenbank();
  try {
    const s = await einsatz(t.db, 'Basler Stadtlauf', inTagen(5, 12), inTagen(5, 23), 'Marktplatz');
    await schreibe(t.db, 'UPDATE schicht SET tenue = ?, abtreten_ort = ?, bemerkung_extern = ? WHERE id = ?', ['Ausgang', 'Barfi', 'Pünktlich', s.schichtId]);
    // Standard: wie Regel 17.1, dazu Abtreten und Tenue. Leere Zeilen (Mindestalter) entfallen.
    const std = await clubdeskText(t.db, s.schichtId, 'https://einsatz.example.ch');
    assert.equal(std.titel, 'Basler Stadtlauf');
    assert.match(std.text, /^Einsatz: Basler Stadtlauf\nSchicht: .+\nZeit: \w\w \d\d\.\d\d\.\d{4}, \d\d:\d\d.+\nOrt: Marktplatz\nAbtreten: Barfi\nTenue: Ausgang\nBemerkung: Pünktlich$/);
    assert.doesNotMatch(std.text, /Mindestalter|\{/);

    // Einsatzleitung und eigene Vorlage.
    const wm = await rang(t.db, 'Wm', 5);
    await person(t.db, 4, { vorname: 'Yann', nachname: 'Wunderle', rang_id: wm });
    await schreibe(
      t.db,
      `INSERT INTO anmeldung (schicht_id, person_id, name_text, status, rolle, kanal, erstellt_am, geaendert_am)
       VALUES (?, 4, 'Yann Wunderle', 'bestaetigt', 'Einsatzleitung', 'telefon', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [s.schichtId],
    );
    await speichereVorlage(t.db, { betreff: '{einsatz}: {datum}', text: 'Antreten {beginn} {ort}\nLeitung: {einsatzleitung}\nAnmelden: {formular}\nRang: {mindestrang}', version: 0 }, null, CLUBDESK_TERMIN);
    const eigen = await clubdeskText(t.db, s.schichtId, 'https://einsatz.example.ch');
    assert.match(eigen.titel, /^Basler Stadtlauf: \d\d\.\d\d\.\d{4}$/);
    assert.match(eigen.text, /^Antreten \d\d:\d\d Marktplatz\nLeitung: Wm Yann Wunderle\nAnmelden: https:\/\/einsatz\.example\.ch\/anmeldung$/);

    // Das ICS übernimmt Titel und Text der Vorlage.
    const ics = erzeugeIcs(await ladeSchicht(t.db, s.schichtId), undefined, eigen).replace(/\r\n /g, '');
    assert.match(ics, /SUMMARY:Basler Stadtlauf: /);
    assert.match(ics, /DESCRIPTION:Antreten \d\d:\d\d Marktplatz\\nLeitung: Wm Yann Wunderle/);

    // Zeit offen: kein Beginn, «Zeit offen» im Zeittext.
    await schreibe(t.db, 'UPDATE schicht SET zeit_offen = 1 WHERE id = ?', [s.schichtId]);
    const offen = await clubdeskText(t.db, s.schichtId, 'https://x.ch');
    assert.match(offen.text, /^Antreten  Marktplatz\n/);
  } finally {
    await t.ende();
  }
});

test('T38c Admin bearbeitet die Vorlage in den Einstellungen, die Bausteine stehen daneben, Aufgebot kopiert den Text', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Herbstmesse', inTagen(3, 9), inTagen(3, 17), 'Petersplatz');
    const admin = await anmelden(t.db, 'admin');
    const aufgebot = await anmelden(t.db, 'aufgebot');
    const sende = (cookie: string, felder: Record<string, string>) => fetch(`${app.url}/admin/vorlage`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(felder),
    });
    assert.equal((await sende(aufgebot.cookie, { _csrf: aufgebot.csrf, schluessel: CLUBDESK_TERMIN, betreff: 'x', text: 'y', version: '0' })).status, 403);

    const einst = await (await fetch(`${app.url}/admin/einstellungen`, { headers: { cookie: admin.cookie } })).text();
    assert.match(einst, /Text für den Clubdesk-Termin/);
    assert.match(einst, /class="karte bausteine"/);
    assert.match(einst, /\{abtreten\}/);
    assert.match(einst, /mit der Schicht «Herbstmesse/);

    // Unbekannte Vorlage: Fehler. Speichern: neue Version, eigenes Protokoll, «Änderung melden» bleibt Standard.
    await sende(admin.cookie, { _csrf: admin.csrf, schluessel: 'gibt_es_nicht', betreff: 'x', text: 'y' });
    assert.equal((await zeilen(t.db, 'SELECT * FROM vorlage')).length, 0);
    const ok = await sende(admin.cookie, { _csrf: admin.csrf, schluessel: CLUBDESK_TERMIN, version: '0', betreff: '{titel}', text: 'Treffpunkt: {ort}\r\n<b>{tenue}</b>' });
    assert.equal(ok.status, 303);
    assert.match(ok.headers.get('location') ?? '', /#clubdesk$/);
    assert.equal((await ladeVorlage(t.db, CLUBDESK_TERMIN)).version, 1);
    assert.equal((await ladeVorlage(t.db)).version, 0);
    const prot = await zeilen(t.db, "SELECT * FROM konfiguration_protokoll WHERE schluessel = 'Vorlage clubdesk_termin'");
    assert.equal(prot.length, 1);

    // Konflikt: Eingabe bleibt im richtigen Formular stehen.
    const konflikt = await sende(admin.cookie, { _csrf: admin.csrf, schluessel: CLUBDESK_TERMIN, version: '0', betreff: '{titel}', text: 'Mein neuer Text' });
    assert.equal(konflikt.status, 409);
    assert.match(await konflikt.text(), /<textarea id="clubdesk_text"[^>]*>Mein neuer Text<\/textarea>/);

    // Die Aufgebotsstelle sieht den fertigen Text zum Kopieren. HTML ist maskiert.
    await schreibe(t.db, 'UPDATE schicht SET tenue = ? WHERE id = ?', ['<i>Ausgang</i>', s.schichtId]);
    const seite = await (await fetch(`${app.url}/schichten/${s.schichtId}/termintext`, { headers: { cookie: aufgebot.cookie } })).text();
    assert.match(seite, /Treffpunkt: Petersplatz/);
    assert.match(seite, /&lt;b&gt;&lt;i&gt;Ausgang&lt;\/i&gt;&lt;\/b&gt;/);
    assert.match(seite, /data-kopieren="#termintext"/);

    // Standard wiederherstellen.
    assert.equal((await sende(admin.cookie, { _csrf: admin.csrf, schluessel: CLUBDESK_TERMIN, standard: '1' })).status, 303);
    assert.equal((await ladeVorlage(t.db, CLUBDESK_TERMIN)).text, STANDARD_CLUBDESK.text);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

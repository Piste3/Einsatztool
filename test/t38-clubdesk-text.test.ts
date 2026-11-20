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
import { alsHtml, alsText } from '../src/domain/textformat.js';

const O = { baseUrl: 'https://einsatz.example.ch', aufgebotMail: 'aufgebot@kkb.ch' };

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
    // Standard: Vorlage von Yann (Tabelle mit Antreten, Abtreten, Einsatzleitung, Tenue). Leere Zeilen (Mindestalter, Einsatzleitung) entfallen.
    const std = await clubdeskText(t.db, s.schichtId, O);
    assert.equal(std.titel, 'Basler Stadtlauf');
    assert.match(std.text, /^Anmerkung: Das unten/);
    assert.match(std.text, /\nAntreten: \w+, \d\d\.\d\d\.\d{4} \d\d:\d\d, Marktplatz\nAbtreten: \w+, \d\d\.\d\d\.\d{4} \d\d:\d\d, Barfi\nTenue: Ausgang\n/);
    assert.match(std.text, /Deine Teilnahme ist definitiv\. .*aufgebot@kkb\.ch/);
    assert.doesNotMatch(std.text, /Mindestalter|Einsatzleitung:|\{|\*\*|\[rot\]/);
    assert.match(std.html, /<table class="cd-tabelle" border="1"[^>]*><tbody><tr><td><strong>Antreten<\/strong><\/td><td>/);
    assert.match(std.html, /<span class="text-rot" style="color:#e00000">definitiv<\/span>/);
    assert.match(std.html, /<h3>Basler Stadtlauf - Basler Stadtlauf<\/h3>/);

    // Einsatzleitung und eigene Vorlage.
    const wm = await rang(t.db, 'Wm', 5);
    await person(t.db, 4, { vorname: 'Yann', nachname: 'Wunderle', rang_id: wm, telefon: '079 645 66 76', email: 'yann@web.kkb.ch' });
    await schreibe(
      t.db,
      `INSERT INTO anmeldung (schicht_id, person_id, name_text, status, rolle, kanal, erstellt_am, geaendert_am)
       VALUES (?, 4, 'Yann Wunderle', 'bestaetigt', 'Einsatzleitung', 'telefon', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [s.schichtId],
    );
    const mitEl = await clubdeskText(t.db, s.schichtId, { ...O, benutzer: { name: 'Admin Test', email: 'YANN@web.kkb.ch' } });
    assert.match(mitEl.text, /\nEinsatzleitung: EL: Wm Yann Wunderle \(079 645 66 76\)\n/);
    assert.match(mitEl.text, /Liebe Grüsse\n\nWm Yann Wunderle\nAufgebotsstelle\naufgebot@kkb\.ch$/);
    // Ohne passende Person: Name aus dem Login.
    assert.match((await clubdeskText(t.db, s.schichtId, { ...O, benutzer: { name: 'Admin Test', email: 'x@y.ch' } })).text, /\n\nAdmin Test\nAufgebotsstelle/);

    await speichereVorlage(t.db, { betreff: '{einsatz}: {datum}', text: 'Antreten {beginn} {ort}\nLeitung: {einsatzleitung}\nAnmelden: {formular}\nRang: {mindestrang}', version: 0 }, null, CLUBDESK_TERMIN);
    const eigen = await clubdeskText(t.db, s.schichtId, O);
    assert.match(eigen.titel, /^Basler Stadtlauf: \d\d\.\d\d\.\d{4}$/);
    assert.match(eigen.text, /^Antreten \d\d:\d\d Marktplatz\nLeitung: Wm Yann Wunderle\nAnmelden: https:\/\/einsatz\.example\.ch\/anmeldung$/);

    // Das ICS übernimmt Titel und Text der Vorlage.
    const ics = erzeugeIcs(await ladeSchicht(t.db, s.schichtId), undefined, eigen).replace(/\r\n /g, '');
    assert.match(ics, /SUMMARY:Basler Stadtlauf: /);
    assert.match(ics, /DESCRIPTION:Antreten \d\d:\d\d Marktplatz\\nLeitung: Wm Yann Wunderle/);

    // Zeit offen: kein Beginn, «Zeit offen» im Zeittext.
    await schreibe(t.db, 'UPDATE schicht SET zeit_offen = 1 WHERE id = ?', [s.schichtId]);
    const offen = await clubdeskText(t.db, s.schichtId, O);
    assert.match(offen.text, /^Antreten  Marktplatz\n/);
  } finally {
    await t.ende();
  }
});

test('T38d Formatierung: fett, Farbe, Titel, Tabelle, neue Zeile in der Zelle. Text ist maskiert', () => {
  const v = '# Titel <x>\nDu bist **dabei** und [rot]definitiv[/rot] & [blau]froh[/blau].\nZweite Zeile\n\n| **A** | eins \\\\ zwei |\n| **B** | drei \\\\ |\n| nur |\n\nEnde [lila]x[/lila]';
  const h = alsHtml(v);
  assert.match(h, /^<h3>Titel &lt;x&gt;<\/h3>\n<p>Du bist <strong>dabei<\/strong> und <span class="text-rot" style="color:#e00000">definitiv<\/span> &amp; <span class="text-blau"[^>]*>froh<\/span>\.<br>Zweite Zeile<\/p>/);
  assert.match(h, /<tr><td><strong>A<\/strong><\/td><td>eins<br>zwei<\/td><\/tr><tr><td><strong>B<\/strong><\/td><td>drei<\/td><\/tr><tr><td colspan="2">nur<\/td><\/tr>/);
  assert.match(h, /<p>Ende \[lila\]x\[\/lila\]<\/p>$/);
  assert.equal(alsText(v), 'Titel <x>\n\nDu bist dabei und definitiv & froh.\nZweite Zeile\n\nA: eins, zwei\nB: drei\nnur\n\nEnde [lila]x[/lila]');
  // Ein Wert mit Zeilenumbruch bleibt in seiner Tabellenzelle.
  assert.equal(fuelleClubdeskVorlage('| S | {schichten} |', { schichten: 'Früh\nSpät' }), '| S | Früh \\\\ Spät |');
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

    const einst = await (await fetch(`${app.url}/admin/einstellungen/vorlagen`, { headers: { cookie: admin.cookie } })).text();
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
    assert.match(seite, /data-kopieren-html="#cd_html"/);
    assert.match(seite, /<div class="karte cd-vorschau" id="cd_vorschau"><p>Treffpunkt: Petersplatz<br>/);

    // Standard wiederherstellen.
    assert.equal((await sende(admin.cookie, { _csrf: admin.csrf, schluessel: CLUBDESK_TERMIN, standard: '1' })).status, 303);
    assert.equal((await ladeVorlage(t.db, CLUBDESK_TERMIN)).text, STANDARD_CLUBDESK.text);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

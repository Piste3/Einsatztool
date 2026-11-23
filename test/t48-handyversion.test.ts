// T48: Handyversion (Wunsch Yann 23.11.2026). Öffnet sich auf dem Smartphone, Wechsel zur vollen Version,
// Eintragen in einem Einsatz und Ansicht nach Person. Speichern läuft über die bestehenden Routen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, person, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { istHandy, personStatus, startInHandy, zaehlePersonStatus } from '../src/domain/handy.js';
import { setzeAnmeldung } from '../src/domain/anmeldung.js';
import { erstelleSchicht } from '../src/domain/schicht.js';
import { ladePerson } from '../src/domain/personen.js';
import { lokalesDatum } from '../src/domain/zeit.js';
import { schreibe } from '../src/db/db.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

test('T48 Handy erkennen: Smartphone ja, Tablet und PC nein, Wahl «voll» gilt', () => {
  assert.equal(istHandy(IPHONE), true);
  assert.equal(istHandy(ANDROID), true);
  assert.equal(istHandy(ANDROID_TABLET), false);
  assert.equal(istHandy(IPAD), false);
  assert.equal(istHandy(PC), false);
  assert.equal(istHandy(undefined), false);
  assert.equal(startInHandy(IPHONE, undefined), true);
  assert.equal(startInHandy(IPHONE, 'voll'), false);
  assert.equal(startInHandy(PC, 'handy'), true);
});

test('T48 Ansicht nach Person: alle kommenden Schichten mit Status, nicht gefragt und Mindestalter', async () => {
  const t = await neueDatenbank();
  try {
    const a = await einsatz(t.db, 'Herbstmesse', inTagen(10, 12), inTagen(10, 17));
    const tag = lokalesDatum(inTagen(10, 12));
    const abend = await erstelleSchicht(t.db, a.einsatzId, { name: 'Abend', start_datum: tag, start_zeit: '18:00', end_datum: tag, end_zeit: '23:00' });
    await schreibe(t.db, 'UPDATE schicht SET min_alter = 18 WHERE id = ?', [abend]);
    const b = await einsatz(t.db, 'Stadtlauf', inTagen(20, 8), inTagen(20, 14));
    const alt = await einsatz(t.db, 'Vorbei', inTagen(-5, 8), inTagen(-5, 14));
    await person(t.db, 5, { vorname: 'Lea', nachname: 'Meier', geburtsdatum: `${new Date().getUTCFullYear() - 16}-01-01` });
    await setzeAnmeldung(t.db, { schichtId: a.schichtId, personId: 5, status: 'bestaetigt', kanal: 'telefon' }, null);
    await setzeAnmeldung(t.db, { schichtId: alt.schichtId, personId: 5, status: 'bestaetigt', kanal: 'telefon' }, null);
    await setzeAnmeldung(t.db, { schichtId: b.schichtId, personId: 5, status: 'unsicher', kanal: 'telefon', bemerkung: 'evtl. später' }, null);

    const liste = await personStatus(t.db, await ladePerson(t.db, 5));
    // Vergangene Einsätze fehlen. Reihenfolge nach Zeit, Schichten nach Einsatz gruppiert.
    assert.deepEqual(liste.map((e) => e.einsatz), ['Herbstmesse', 'Stadtlauf']);
    const [herbst, lauf] = liste;
    assert.deepEqual(herbst.schichten.map((s) => [s.schicht, s.status, s.passt]), [['Herbstmesse', 'bestaetigt', true], ['Abend', null, false]]);
    assert.equal(lauf.schichten[0].bemerkung, 'evtl. später');
    const z = zaehlePersonStatus(liste);
    assert.equal(z.bestaetigt, 1);
    assert.equal(z.unsicher, 1);
    assert.equal(z.nicht, 1);
  } finally {
    await t.ende();
  }
});

test('T48 Handyversion im Web: Weiterleitung, Wechsel, Eintragen, Person, Maskierung', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const s = await einsatz(t.db, 'Stadtlauf <i>', inTagen(9, 12), inTagen(9, 18), 'Marktplatz');
    await schreibe(t.db, 'UPDATE schicht SET soll_anzahl = 4, publiziert = 1 WHERE id = ?', [s.schichtId]);
    await person(t.db, 7, { vorname: 'Nina', nachname: 'Baumann <b>', telefon: '079 123 45 67' });
    const { cookie, csrf } = await anmelden(t.db, 'aufgebot');
    const hole = (pfad: string, ua = IPHONE, extra = '') => fetch(`${app.url}${pfad}`, { headers: { cookie: cookie + extra, 'user-agent': ua }, redirect: 'manual' });

    // Startseite: Smartphone → Handyversion. PC und Wahl «volle Version» → Cockpit.
    const start = await hole('/');
    assert.equal(start.status, 302);
    assert.equal(start.headers.get('location'), '/m');
    assert.equal((await hole('/', PC)).status, 200);
    assert.equal((await hole('/', IPHONE, '; ansicht=voll')).status, 200);

    // Wechsel zur vollen Version setzt das Cookie für ein Jahr. Zurück zur Handyversion löscht es.
    const voll = await hole('/m/voll');
    assert.equal(voll.status, 303);
    assert.equal(voll.headers.get('location'), '/');
    assert.match(voll.headers.get('set-cookie') ?? '', /ansicht=voll;.*Max-Age=31536000/i);
    const zurueck = await hole('/m/handy');
    assert.equal(zurueck.headers.get('location'), '/m');
    assert.match(zurueck.headers.get('set-cookie') ?? '', /ansicht=;/);
    // Die volle Version hat auf dem Handy einen Link zur Handyversion.
    assert.match(await (await hole('/', PC)).text(), /href="\/m\/handy" data-normal/);

    // Einsätze: Karten mit Ist / Soll, Name maskiert. Seiten haben den Rahmen «handy».
    const liste = await (await hole('/m')).text();
    assert.match(liste, /data-layout="handy"/);
    assert.match(liste, new RegExp(`href="/m/einsaetze/${s.einsatzId}"`));
    assert.match(liste, /Stadtlauf &lt;i&gt;/);
    assert.doesNotMatch(liste, /Stadtlauf <i>/);
    assert.match(liste, /0 \/ 4/);

    // Einsatz ohne Einträge: «Nicht gefragt» mit Kachel, Anruf-Link und Antwort-Knöpfen.
    const pfad = `/m/einsaetze/${s.einsatzId}`;
    const leer = await (await hole(pfad)).text();
    assert.match(leer, /aria-current="page">Nicht gefragt <span class="zahl">1<\/span>/);
    assert.match(leer, /Baumann &lt;b&gt;/);
    assert.match(leer, /href="tel:0791234567"/);
    assert.match(leer, /class="handy-tel handy-wa" href="https:\/\/wa.me\/41791234567"/);
    assert.match(leer, new RegExp(`href="/rueckmeldungen/eintrag\\?schicht=${s.schichtId}&amp;person=7&amp;zurueck=`));
    assert.match(leer, new RegExp(`action="/schichten/${s.schichtId}/sammelstatus"`));
    assert.match(leer, /href="\/m\/personen\/7"/);

    // Knopf «An» über die bestehende Route: Eintrag mit Statusprotokoll, Rücksprung in die Handyversion.
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

    // Danach: Vorgabe «Neu + Bestätigt», Kachel mit «Bestätigen?», Knopf «Bestätigen» in der Zeile.
    const neu = await (await hole(pfad)).text();
    assert.match(neu, /aria-current="page">Neu \+ Bestätigt <span class="zahl">1<\/span>/);
    assert.match(neu, new RegExp(`data-bestaetigen="${a.id}"`));
    assert.match(neu, new RegExp(`action="/anmeldungen/${a.id}"[\\s\\S]*?value="bestaetigt"`));
    assert.match(neu, /1 Neue bestätigen/);

    // Ansicht nach Person: Status je Schicht, Kachel öffnet das Fenster, Anrufen und WhatsApp.
    const p = await (await hole('/m/personen/7')).text();
    assert.match(p, /Nina Baumann &lt;b&gt;/);
    assert.match(p, /<strong>1<\/strong> angemeldet/);
    assert.match(p, new RegExp(`/rueckmeldungen/eintrag\\?schicht=${s.schichtId}&amp;person=7`));
    assert.match(p, /href="https:\/\/wa.me\/41791234567"/);

    // Personenliste mit Suche.
    const pl = await (await hole('/m/personen')).text();
    assert.match(pl, /data-filter=".handy-personen > li"/);
    assert.match(pl, /href="\/m\/personen\/7"/);

    // Fenster aus der Handyversion: Links bleiben in der Handyversion. Ohne Skript eine Handy-Seite.
    const ziel = encodeURIComponent(pfad);
    const fenster = await (await fetch(`${app.url}/rueckmeldungen/eintrag?schicht=${s.schichtId}&person=7&zurueck=${ziel}`, { headers: { cookie, 'x-fragment': '1' } })).text();
    assert.match(fenster, /href="\/m\/personen\/7">Personenseite/);
    const seite = await (await hole(`/rueckmeldungen/eintrag?schicht=${s.schichtId}&person=7&zurueck=${ziel}`)).text();
    assert.match(seite, /data-layout="handy"/);
    // Aus der vollen Version bleibt alles wie bisher.
    const vollFenster = await (await fetch(`${app.url}/rueckmeldungen/eintrag?schicht=${s.schichtId}&person=7&zurueck=%2Frueckmeldungen`, { headers: { cookie, 'x-fragment': '1' } })).text();
    assert.match(vollFenster, /href="\/personen\/7">Personenseite/);

    // Kein Inline-Skript und kein style-Attribut (CSP).
    for (const html of [liste, leer, neu, p, pl]) {
      assert.doesNotMatch(html, /<script>|<script(?![^>]*src=)[^>]*>/);
      assert.doesNotMatch(html, /\sstyle="/);
    }

    // Ohne Login: Weiterleitung zum Login, keine Daten.
    const ohne = await fetch(`${app.url}/m/personen/7`, { redirect: 'manual' });
    assert.notEqual(ohne.status, 200);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

// T53: Der Reiter «Verlauf» zeigt auch Änderungen an Einsatz und Schichten (Wunsch Yann 26.11.2026).
// Erstellen, Ändern (je Feld alt → neu), Vererbung, Publizieren, Kopieren, Fremdabteilungen und Löschen kommen ins Protokoll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einsatz, inTagen, neueDatenbank, zeilen } from './hilfe.js';
import { anmelden, starteApp } from './web-hilfe.js';
import { aendereEinsatz, ladeEinsatz, loescheEinsatz } from '../src/domain/einsatz.js';
import { protokollEinsatz, protokollText } from '../src/domain/einsatz-protokoll.js';
import { ladeSchicht } from '../src/domain/schicht.js';
import { lokalesDatum } from '../src/domain/zeit.js';

test('T53 Verlauf: Einsatz und Schichten erstellen, ändern, publizieren, kopieren, löschen', async () => {
  const t = await neueDatenbank();
  const app = await starteApp(t.db);
  try {
    const { cookie, csrf, benutzerId } = await anmelden(t.db, 'aufgebot');
    const s = await einsatz(t.db, 'Stadtlauf', inTagen(10, 7), inTagen(10, 12), 'Marktplatz');
    const tag = lokalesDatum(inTagen(10, 7));
    // Erstellen schreibt einen Eintrag.
    let p = await protokollEinsatz(t.db, s.einsatzId);
    assert.deepEqual(p.map((x) => x.aktion), ['einsatz_erstellt']);

    // Einsatz ändern: je Feld ein Eintrag. Die Schicht mit gleichem Ort erhält «vom Einsatz übernommen».
    const e = await ladeEinsatz(t.db, s.einsatzId);
    await aendereEinsatz(t.db, s.einsatzId, { name: 'Stadtlauf 2026', ort: 'Barfüsserplatz', version: String(e.version) }, benutzerId);
    p = await protokollEinsatz(t.db, s.einsatzId);
    const texte = p.map(protokollText);
    assert.ok(texte.includes('Name: «Stadtlauf» → «Stadtlauf 2026»'), texte.join('\n'));
    assert.ok(texte.includes('Ort Antreten: «Marktplatz» → «Barfüsserplatz»'));
    assert.ok(texte.includes('Ort Antreten: «Marktplatz» → «Barfüsserplatz» (vom Einsatz übernommen)'));
    assert.ok(p.filter((x) => x.aktion !== 'einsatz_erstellt').every((x) => x.benutzer !== null));

    const post = (pfad: string, felder: Record<string, string>) =>
      fetch(`${app.url}${pfad}`, {
        method: 'POST', redirect: 'manual',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: csrf, ...felder }),
      });

    // Schicht über die Seite hinzufügen, ändern, publizieren, kopieren.
    assert.equal((await post(`/einsaetze/${s.einsatzId}/schichten`, { name: 'Abbau', start_datum: tag, start_zeit: '13:00', end_zeit: '15:00' })).status, 303);
    const [abbau] = await zeilen(t.db, 'SELECT id, version FROM schicht WHERE einsatz_id = ? AND name = ?', [s.einsatzId, 'Abbau']);
    const r = await post(`/schichten/${abbau.id}`, {
      version: String(abbau.version), name: 'Abbau', start_datum: tag, start_zeit: '13:30', end_zeit: '15:00', soll_anzahl: '4', 'rollen[Einsatzleitung]': '1',
    });
    assert.equal(r.status, 303);
    await post(`/schichten/${abbau.id}/publizieren`, { publiziert: '1' });
    await post(`/schichten/${abbau.id}/publizieren`, { publiziert: '1' }); // kein Wechsel, kein Eintrag
    await post(`/schichten/${abbau.id}/kopieren`, {});
    await post(`/schichten/${abbau.id}/fremdabteilungen`, { name: 'Pfadi', anzahl: '3' });
    const [fa] = await zeilen(t.db, 'SELECT id FROM fremdabteilung WHERE schicht_id = ?', [abbau.id]);
    await post(`/schichten/${abbau.id}/fremdabteilungen`, { id: String(fa.id), loeschen: '1' });

    // Schicht ändern ohne Änderung schreibt nichts.
    const vorher = (await protokollEinsatz(t.db, s.einsatzId)).length;
    const neu = await ladeSchicht(t.db, abbau.id);
    await post(`/schichten/${abbau.id}`, {
      version: String(neu.version), name: 'Abbau', start_datum: tag, start_zeit: '13:30', end_zeit: '15:00', soll_anzahl: '4', 'rollen[Einsatzleitung]': '1',
    });
    assert.equal((await protokollEinsatz(t.db, s.einsatzId)).length, vorher);

    // Schicht löschen: Der Eintrag bleibt mit dem Namen der Schicht.
    const [kopie] = await zeilen(t.db, 'SELECT id FROM schicht WHERE einsatz_id = ? AND name = ?', [s.einsatzId, 'Abbau (Kopie)']);
    assert.equal((await post(`/schichten/${kopie.id}/loeschen`, { bestaetigt: '1' })).status, 303);

    p = await protokollEinsatz(t.db, s.einsatzId);
    const alle = p.map((x) => `${x.schicht_name ?? 'Einsatz'} | ${protokollText(x)}`);
    const erwartet = [
      'Abbau | Schicht erstellt (nicht publiziert)',
      'Abbau | Beginn:',
      'Abbau | Soll (TN): (leer) → «4»',
      'Abbau | Bedarf Einsatzleitung: (leer) → «1»',
      'Abbau | Publiziert',
      'Abbau (Kopie) | Schicht erstellt als Kopie von «Abbau» (nicht publiziert)',
      'Abbau | Fremdabteilung erfasst: «Pfadi, 3»',
      'Abbau | Fremdabteilung gelöscht: «Pfadi, 3»',
      'Abbau (Kopie) | Schicht gelöscht',
    ];
    for (const x of erwartet) assert.ok(alle.some((a) => a.startsWith(x)), `fehlt: ${x}\n${alle.join('\n')}`);
    assert.equal(alle.filter((a) => a === 'Abbau | Publiziert').length, 1);
    assert.ok(alle.some((a) => /Abbau \| Beginn: «\w\w \d\d\.\d\d\.\d{4} 13:00» → «\w\w \d\d\.\d\d\.\d{4} 13:30»/.test(a)));

    // Seite «Verlauf»: Filter und Inhalt. Werte sind maskiert.
    await post(`/schichten/${abbau.id}`, {
      version: String((await ladeSchicht(t.db, abbau.id)).version), name: 'Abbau <b>', start_datum: tag, start_zeit: '13:30', end_zeit: '15:00', soll_anzahl: '4', 'rollen[Einsatzleitung]': '1',
    });
    const seite = await (await fetch(`${app.url}/einsaetze/${s.einsatzId}/verlauf`, { headers: { cookie } })).text();
    assert.match(seite, /Alle \d+/);
    assert.match(seite, /Einsatz und Schichten \d+/);
    assert.match(seite, /Name: «Stadtlauf» → «Stadtlauf 2026»/);
    assert.match(seite, /Publiziert/);
    assert.match(seite, /Abbau &lt;b&gt;/);
    assert.doesNotMatch(seite, /Abbau <b>/);
    const nurAnm = await (await fetch(`${app.url}/einsaetze/${s.einsatzId}/verlauf?art=anmeldungen`, { headers: { cookie } })).text();
    assert.doesNotMatch(nurAnm, /Stadtlauf 2026»/);
    assert.match(nurAnm, /Noch keine Einträge/);

    // Einsatz löschen entfernt sein Protokoll.
    await loescheEinsatz(t.db, s.einsatzId);
    assert.equal((await zeilen(t.db, 'SELECT id FROM einsatz_protokoll WHERE einsatz_id = ?', [s.einsatzId])).length, 0);
  } finally {
    await app.stopp();
    await t.ende();
  }
});

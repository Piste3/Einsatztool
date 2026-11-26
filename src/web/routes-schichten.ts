// Schichten: Detail, Bearbeiten, Publizieren, Löschen, Fremdabteilungen, Anrufliste, ICS, Aufgebot (14.1, 14.3, 17, 19.2, 20).
import type { Express, Request, Response } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot, zurueck } from './app.js';
import {
  aendereSchicht, anzahlAnmeldungenSchicht, erstelleSchicht, fremdabteilungen, ladeSchicht, loescheSchicht, rollenBedarf, setzePubliziert,
  speichereFremdabteilung, schichtenVonEinsatz, anzeigeZeiten, type SchichtMitEinsatz,
} from '../domain/schicht.js';
import { ladeEinsatz } from '../domain/einsatz.js';
import { bestaetigeAlle, sammelstatus, setzeAnmeldung, verlauf } from '../domain/anmeldung.js';
import { mitRueckgaengig } from '../domain/rueckgaengig.js';
import { warnungenFuerSchicht } from '../domain/warnungen.js';
import { zahlenFuerSchichten } from '../domain/zaehlung.js';
import { essenslisteCsv } from '../domain/export.js';
import { erzeugeIcs, icsDateiname, icsVermerk, terminTitel, vermerkeIcsExport } from '../domain/ics.js';
import { clubdeskText } from '../domain/clubdesk-text.js';
import { fuerVorschau, zeileAlsHtml } from '../domain/textformat.js';
import { aufgebotDaten } from '../domain/aufgebot-vorlage.js';
import { aufgebotSeite } from './views/aufgebot.js';
import { anrufliste, nachRangTiefZuerst } from '../domain/listen.js';
import { personenListe, personAuswahlText, idAusAuswahl } from '../domain/personen.js';
import { raenge as ladeRaenge, rollen as ladeRollen } from '../domain/stammdaten.js';
import { Eingabefehler, Konflikt, STATUS, STATUS_TEXT, KANAL_TEXT, id as leseId, liste, type Status, type Kanal } from '../domain/eingabe.js';
import { alle } from '../db/db.js';
import { feedStand } from '../domain/ical-abgleich.js';
import { alterAm, datumChVonIso, lokalesDatum, lokaleZeit } from '../domain/zeit.js';
import { html, mehrzeilig, Roh } from './html.js';
import { k, aktuellerPfad } from './kontext.js';
import { druckseite, formFelder, mehrMenue, seite, seitenKopf, type PfadTeil } from './views/layout.js';
import {
  abgleichPunkt, datumZeit, istSoll, kanalAuswahl, karte, knopfPost, rolleAuswahl, statusAuswahl, statusText, telefon, warnungen, zeitraum,
} from './views/teile.js';
import { dateiTeil, sendeCsv } from './routes-einsaetze.js';
import { besetzenPfad } from './views/besetzen.js';
import type { BesetzenFilter } from '../domain/besetzen.js';

/** Pfad oben: Einsätze › Einsatz › Schicht › … */
function schichtPfad(s: { id: number; name: string; einsatz_id: number; einsatz_name: string }, weiter?: string): PfadTeil[] {
  return [
    { text: 'Einsätze', href: '/einsaetze' },
    { text: s.einsatz_name, href: `/einsaetze/${s.einsatz_id}` },
    weiter ? { text: s.name, href: `/schichten/${s.id}` } : { text: s.name },
    ...(weiter ? [{ text: weiter }] : []),
  ];
}

const AKTION_TEXT: Record<string, string> = {
  erstellt: 'Eintrag erstellt',
  status: 'Status',
  rolle: 'Rolle',
  kanal: 'Kanal',
  bemerkung: 'Bemerkung',
  zugeordnet: 'Zugeordnet',
  zuordnung_aufgehoben: 'Zuordnung rückgängig',
  wiederhergestellt: 'Eintrag wiederhergestellt',
  bestaetigungsmail: 'Bestätigungsmail',
  mail_ohne_adresse: 'Keine Mail-Adresse',
  personendaten_geloescht: 'Personendaten gelöscht',
  verschoben: 'Verschoben',
};

function wertText(aktion: string, w: string | null): string {
  if (w === null) return '–';
  if ((aktion === 'status' || aktion === 'erstellt' || aktion === 'wiederhergestellt') && w in STATUS_TEXT) return STATUS_TEXT[w as Status];
  if (aktion === 'kanal' && w in KANAL_TEXT) return KANAL_TEXT[w as Kanal];
  return w;
}

export function verlaufListe(eintraege: { zeit: string; aktion: string; alt_wert: string | null; neu_wert: string | null; benutzer: string | null }[] | undefined): Roh {
  if (!eintraege?.length) return html`<p class="leer">Kein Verlauf.</p>`;
  return html`<ol class="verlauf">${eintraege.map((l) => html`<li><time>${datumZeit(l.zeit)}</time> ${logText(l)} <span class="unter">(${l.benutzer ?? 'Formular / System'})</span></li>`)}</ol>`;
}

/** Aktion und Werte eines Eintrags im Statusprotokoll, z. B. «Status angemeldet → bestätigt». */
export function logText(l: { aktion: string; alt_wert: string | null; neu_wert: string | null }): Roh {
  return html`<strong>${AKTION_TEXT[l.aktion] ?? l.aktion}</strong>${
    l.aktion === 'erstellt' || l.aktion === 'wiederhergestellt' || l.aktion === 'bestaetigungsmail' || l.aktion === 'mail_ohne_adresse' || l.aktion === 'personendaten_geloescht'
      ? html` ${wertText(l.aktion, l.neu_wert)}`
      : html` ${wertText(l.aktion, l.alt_wert)} → ${wertText(l.aktion, l.neu_wert)}`
  }`;
}

function v(e: Record<string, unknown>, n: string): string {
  return e[n] === null || e[n] === undefined ? '' : String(e[n]);
}

export function registriereSchichten(app: Express, deps: Abhaengigkeiten): void {
  const { db, konfig } = deps;

  // Konzept «Bedienung im Einsatz» (OK Yann 20.11.2026): Die Arbeit mit Personen liegt im Reiter «Besetzen».
  // Alte Adressen der Schicht führen dorthin. Der Filter «status» wird auf die Filter von «Besetzen» abgebildet.
  app.get('/schichten/:sid', nurAufgebot, async (req, res) => {
    const s = await ladeSchicht(db, leseId(req.params.sid));
    const status = String(req.query.status ?? '');
    const filter = ({ angemeldet: 'neu', unsicher: 'offen', nachricht_gesendet: 'offen', bestaetigt: 'bestaetigt', abgemeldet: 'ab' } as Record<string, BesetzenFilter>)[status] ?? 'alle';
    res.redirect(303, besetzenPfad(s.einsatz_id, s.id, filter));
  });

  app.post('/schichten/:sid/publizieren', nurAufgebot, async (req, res) => {
    const sid = leseId(req.params.sid);
    const an = req.body?.publiziert === '1';
    await setzePubliziert(db, sid, an);
    zurueck(req, res, `/schichten/${sid}`, an ? 'Schicht publiziert.' : 'Schicht nicht mehr publiziert.');
  });

  // Regel 13.2.4: Löschen mit Bestätigung und Zahl der Anmeldungen.
  app.get('/schichten/:sid/loeschen', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const s = await ladeSchicht(db, leseId(req.params.sid));
    const n = await anzahlAnmeldungenSchicht(db, s.id);
    res.send(seite(kx, 'Schicht löschen', 'einsaetze', html`
${seitenKopf({ pfad: schichtPfad(s, 'Löschen'), titel: `Schicht «${s.name}» löschen?` })}
${s.anzahl_schichten <= 1 ? html`<p class="meldung fehler">Das ist die einzige Schicht des Einsatzes. Lösche stattdessen den Einsatz.</p>` : html`
<p class="meldung fehler">${n > 0 ? `Die Schicht hat ${n} Anmeldungen. ` : ''}Das Tool löscht die Schicht mit allen Einträgen.</p>
<form method="post" action="/schichten/${s.id}/loeschen" class="stapel">
  ${formFelder(kx)}
  <label class="haken"><input type="checkbox" name="bestaetigt" value="1" required> Ja, Schicht löschen</label>
  <div class="knopfreihe"><button class="knopf gefahr" type="submit">Löschen</button> <a class="knopf" href="/schichten/${s.id}">Abbrechen</a></div>
</form>`}`));
  });

  app.post('/schichten/:sid/loeschen', nurAufgebot, async (req, res) => {
    if (req.body?.bestaetigt !== '1') throw new Eingabefehler('Bestätige das Löschen mit dem Häkchen.');
    const einsatzId = await loescheSchicht(db, leseId(req.params.sid));
    zurueck(req, res, `/einsaetze/${einsatzId}`, 'Schicht gelöscht.');
  });

  app.post('/schichten/:sid/fremdabteilungen', nurAufgebot, async (req, res) => {
    const sid = leseId(req.params.sid);
    await speichereFremdabteilung(db, sid, { ...req.body, loeschen: req.body?.loeschen === '1' });
    zurueck(req, res, `/schichten/${sid}`, req.body?.loeschen === '1' ? 'Fremdabteilung gelöscht.' : 'Gespeichert.');
  });

  app.get('/schichten/:sid/essensliste.csv', nurAufgebot, async (req, res) => {
    const s = await ladeSchicht(db, leseId(req.params.sid));
    sendeCsv(res, `essen-${dateiTeil(terminTitel(s))}.csv`, await essenslisteCsv(db, s.id));
  });

  // Leere Bemerkung beim Eintragen: Eine vorhandene Bemerkung bleibt stehen (Regel 13.5.4 ändert den Eintrag).
  const nichtLeer = (x: unknown) => (typeof x === 'string' && x.trim() !== '' ? x : undefined);

  // Person von Hand anmelden (Kanal wählen).
  app.post('/schichten/:sid/anmeldungen', nurAufgebot, async (req, res) => {
    const sid = leseId(req.params.sid);
    const personId = idAusAuswahl(req.body?.person);
    if (!personId) throw new Eingabefehler('Wähle eine Person aus der Liste.');
    const { schluessel } = await mitRueckgaengig(db, k(res).benutzer!.id, () =>
      setzeAnmeldung(db, { schichtId: sid, personId, status: req.body.status, kanal: req.body.kanal, rolle: req.body.rolle, bemerkung: nichtLeer(req.body.bemerkung) }, k(res).benutzer!.id));
    zurueck(req, res, `/schichten/${sid}`, 'Eingetragen.', 'ok', schluessel);
  });

  // Regel 14.3: Sammelstatus. «Nachricht gesendet» für alle gewählten Personen, Kanal whatsapp.
  app.post('/schichten/:sid/sammelstatus', nurAufgebot, async (req, res) => {
    const sid = leseId(req.params.sid);
    const ids = liste(req.body?.personen).map((x) => leseId(x, 'Person'));
    const status = req.body?.status ?? 'nachricht_gesendet';
    const kanal = req.body?.kanal ?? (status === 'nachricht_gesendet' ? 'whatsapp' : 'telefon');
    const { ergebnis: n, schluessel } = await mitRueckgaengig(db, k(res).benutzer!.id, () => sammelstatus(db, sid, ids, status, kanal, k(res).benutzer!.id));
    zurueck(req, res, `/schichten/${sid}/anrufliste`, `Status für ${n} Personen gesetzt.`, 'ok', schluessel);
  });

  app.post('/schichten/:sid/alle-bestaetigen', nurAufgebot, async (req, res) => {
    const sid = leseId(req.params.sid);
    const { ergebnis: n, schluessel } = await mitRueckgaengig(db, k(res).benutzer!.id, () => bestaetigeAlle(db, [sid], k(res).benutzer!.id));
    zurueck(req, res, `/schichten/${sid}`, `${n} Anmeldungen bestätigt.`, 'ok', schluessel);
  });

  // Die Anrufliste ist der Filter «Nicht gefragt» in «Besetzen».
  app.get('/schichten/:sid/anrufliste', nurAufgebot, async (req, res) => {
    const s = await ladeSchicht(db, leseId(req.params.sid));
    res.redirect(303, besetzenPfad(s.einsatz_id, s.id, 'nicht', req.query.alle === '1'));
  });

  // Regel 17.3: Erster Export liefert die Datei. Danach zuerst W_ICS_DUPLIKAT, «Trotzdem laden».
  app.get('/schichten/:sid/ics', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const s = await ladeSchicht(db, leseId(req.params.sid));
    const vermerk = await icsVermerk(db, s.id);
    if (vermerk && req.query.trotzdem !== '1') {
      res.send(seite(kx, 'ICS-Export', 'einsaetze', html`
${seitenKopf({ pfad: schichtPfad(s, 'ICS-Export'), titel: 'ICS-Export' })}
<p class="meldung hinweis" data-code="W_ICS_DUPLIKAT">⚠ Export fand am ${datumZeit(vermerk.exportiert_am)}${vermerk.benutzer ? ` durch ${vermerk.benutzer}` : ''} statt. Clubdesk erhält sonst einen doppelten Termin.</p>
<p class="knopfreihe"><a class="knopf" href="/schichten/${s.id}/ics?trotzdem=1">Trotzdem laden</a> <a class="knopf" href="/schichten/${s.id}">Abbrechen</a></p>`));
      return;
    }
    await vermerkeIcsExport(db, s.id, kx.benutzer!.id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${icsDateiname(s)}"`);
    res.send(erzeugeIcs(s, undefined, await clubdeskText(db, s.id, { baseUrl: konfig.baseUrl, aufgebotMail: konfig.mailFrom, benutzer: k(res).benutzer })));
  });

  app.get('/schichten/:sid/termintext', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const s = await ladeSchicht(db, leseId(req.params.sid));
    // Das Tool baut den Text aus der Vorlage. Formatierung (fett, Farbe, Tabelle) geht als HTML in die Zwischenablage.
    const t = await clubdeskText(db, s.id, { baseUrl: konfig.baseUrl, aufgebotMail: konfig.mailFrom, benutzer: kx.benutzer });
    const zeilen = Math.min(30, Math.max(8, t.text.split('\n').length + 1));
    res.send(seite(kx, 'Termintext', 'einsaetze', html`
${seitenKopf({ pfad: schichtPfad(s, 'Termintext'), titel: 'Text für den Clubdesk-Termin' })}
<p class="unter">Das Tool füllt die Vorlage mit den Angaben dieser Schicht. «Kopieren» übernimmt Fett, Farbe und Tabelle in den Editor von Clubdesk. ${kx.benutzer?.rolle === 'admin' ? html`Die Vorlage bearbeitest du in <a href="/admin/einstellungen/vorlagen#clubdesk">Admin › Einstellungen</a>.` : 'Die Vorlage bearbeitet ein Admin in den Einstellungen.'}</p>
<div class="feld"><label for="titel">Titel</label><input id="titel" readonly value="${t.titel}"></div>
<p><button type="button" class="knopf" data-kopieren="#titel">Titel kopieren</button></p>
<h2>Text</h2>
<div class="karte cd-vorschau" id="cd_vorschau">${new Roh(fuerVorschau(t.html))}</div>
<p class="knopfreihe">
  <button type="button" class="knopf haupt" data-kopieren-html="#cd_html" data-kopieren-text="#termintext" data-kopieren-auswahl="#cd_vorschau">Kopieren</button>
  <button type="button" class="knopf" data-kopieren="#cd_html">HTML kopieren</button>
  <button type="button" class="knopf" data-kopieren="#termintext">Nur Text kopieren</button>
</p>
<details class="gruppe"><summary>Nur Text</summary><div class="feld"><label for="termintext">Text ohne Formatierung</label><textarea id="termintext" readonly rows="${zeilen}">${t.text}</textarea></div></details>
<details class="gruppe"><summary>HTML-Quelltext</summary><div class="feld"><label for="cd_html">HTML für die Quelltext-Ansicht von Clubdesk</label><textarea id="cd_html" readonly rows="10">${t.html}</textarea></div></details>`));
  });

  // Regel 20: Druckansicht des Aufgebots. Ein Brief je bestätigter Person, je Brief eine A4-Seite.
  app.get('/schichten/:sid/aufgebot', nurAufgebot, async (req, res) => {
    const nur = typeof req.query.person === 'string' && /^\d+$/.test(req.query.person) ? Number(req.query.person) : null;
    const d = await aufgebotDaten(db, leseId(req.params.sid), nur);
    res.send(aufgebotSeite([d], d.titel, `/schichten/${d.schichtId}`));
  });
}

export type { Request, Response };

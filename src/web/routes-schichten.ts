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
import { warnungenFuerSchicht } from '../domain/warnungen.js';
import { zahlenFuerSchichten } from '../domain/zaehlung.js';
import { essenslisteCsv } from '../domain/export.js';
import { erzeugeIcs, icsDateiname, icsVermerk, terminText, terminTitel, vermerkeIcsExport } from '../domain/ics.js';
import { aufgebotDaten } from '../domain/aufgebot-vorlage.js';
import { FEST } from '../domain/aufgebot-vorlage.js';
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
import { dateiTeil, einsatzReiter, sendeCsv } from './routes-einsaetze.js';

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
  bestaetigungsmail: 'Bestätigungsmail',
  mail_ohne_adresse: 'Keine Mail-Adresse',
  personendaten_geloescht: 'Personendaten gelöscht',
};

function wertText(aktion: string, w: string | null): string {
  if (w === null) return '–';
  if ((aktion === 'status' || aktion === 'erstellt') && w in STATUS_TEXT) return STATUS_TEXT[w as Status];
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
    l.aktion === 'erstellt' || l.aktion === 'bestaetigungsmail' || l.aktion === 'mail_ohne_adresse' || l.aktion === 'personendaten_geloescht'
      ? html` ${wertText(l.aktion, l.neu_wert)}`
      : html` ${wertText(l.aktion, l.alt_wert)} → ${wertText(l.aktion, l.neu_wert)}`
  }`;
}

function v(e: Record<string, unknown>, n: string): string {
  return e[n] === null || e[n] === undefined ? '' : String(e[n]);
}

async function schichtFormular(deps: Abhaengigkeiten, kx: ReturnType<typeof k>, ziel: string, e: Record<string, unknown>, bedarf: Map<string, number>, fehler: string | null, neu: boolean): Promise<Roh> {
  const raenge = await ladeRaenge(deps.db);
  const rollen = await ladeRollen(deps.db);
  const rollenWerte = (e.rollen ?? {}) as Record<string, string>;
  return html`
${fehler ? html`<div class="meldung fehler" role="alert">${fehler}</div>` : ''}
<form method="post" action="${ziel}" class="formular-raster">
  ${formFelder(kx)}${neu ? '' : html`<input type="hidden" name="version" value="${v(e, 'version')}">`}
  <div class="feld breit"><label for="name">Name</label><input id="name" name="name" required maxlength="255" value="${v(e, 'name')}"></div>
  <div class="feld"><label for="start_datum">Start Datum</label><input id="start_datum" type="date" name="start_datum" required value="${v(e, 'start_datum')}"></div>
  <div class="feld"><label for="start_zeit">Start Zeit</label><input id="start_zeit" type="time" name="start_zeit" value="${v(e, 'start_zeit')}"></div>
  <div class="feld"><label for="end_datum">Ende Datum</label><input id="end_datum" type="date" name="end_datum" required value="${v(e, 'end_datum')}"></div>
  <div class="feld"><label for="end_zeit">Ende Zeit</label><input id="end_zeit" type="time" name="end_zeit" value="${v(e, 'end_zeit')}"></div>
  ${neu ? html`<p class="breit unter">Ort, Ort Abtreten, Tenue und Hinweis übernimmt die Schicht vom Einsatz. Eine neue Schicht ist nicht publiziert.</p>` : html`
  <div class="feld breit"><label for="ort">Ort Antreten</label><input id="ort" name="ort" maxlength="255" value="${v(e, 'ort')}"><small>Eine Änderung gilt nur für diese Schicht.</small></div>
  <div class="feld breit"><label for="abtreten_ort">Ort Abtreten</label><input id="abtreten_ort" name="abtreten_ort" maxlength="255" value="${v(e, 'abtreten_ort')}"><small>Leer = gleich wie Ort Antreten.</small></div>
  <div class="feld breit"><label for="tenue">Tenue</label><input id="tenue" name="tenue" maxlength="255" value="${v(e, 'tenue')}"></div>
  <div class="feld breit"><label for="aufgebot_hinweis">Hinweis Aufgebot</label><textarea id="aufgebot_hinweis" name="aufgebot_hinweis" rows="2" maxlength="2000">${v(e, 'aufgebot_hinweis')}</textarea></div>`}
  <div class="feld"><label for="min_alter">Mindestalter</label><input id="min_alter" type="number" min="0" max="120" name="min_alter" value="${v(e, 'min_alter')}"></div>
  <div class="feld"><label for="min_rang_id">Mindestrang</label><select id="min_rang_id" name="min_rang_id"><option value="">– keiner –</option>${raenge.map(
    (r) => html`<option value="${r.id}"${String(r.id) === v(e, 'min_rang_id') ? new Roh(' selected') : ''}>${r.name}</option>`,
  )}</select></div>
  <div class="feld"><label for="soll_anzahl">Soll-Anzahl TN</label><input id="soll_anzahl" type="number" min="0" name="soll_anzahl" value="${v(e, 'soll_anzahl')}"><small>Zielwert, keine Obergrenze.</small></div>
  <fieldset class="breit rollen-bedarf"><legend>Benötigte Rollen</legend>
    ${rollen.map((r) => html`<label>${r.name} <input type="number" min="0" max="10000" name="rollen[${r.name}]" value="${rollenWerte[r.name] ?? (bedarf.get(r.name) ? String(bedarf.get(r.name)) : '')}"></label>`)}
  </fieldset>
  <div class="feld breit"><label for="bemerkung_intern">Bemerkung intern</label><textarea id="bemerkung_intern" name="bemerkung_intern" rows="2" maxlength="5000">${v(e, 'bemerkung_intern')}</textarea></div>
  <div class="feld breit"><label for="bemerkung_extern">Bemerkung extern</label><textarea id="bemerkung_extern" name="bemerkung_extern" rows="2" maxlength="5000">${v(e, 'bemerkung_extern')}</textarea><small>Sichtbar im Formular.</small></div>
  <div class="aktionen breit"><button type="submit" class="knopf haupt">${neu ? 'Schicht hinzufügen' : 'Speichern'}</button></div>
</form>`;
}

function schichtWerte(s: SchichtMitEinsatz): Record<string, unknown> {
  return {
    ...s,
    start_datum: lokalesDatum(s.start_zeit), start_zeit: anzeigeZeiten(s).beginn,
    end_datum: lokalesDatum(s.end_zeit), end_zeit: anzeigeZeiten(s).ende,
  };
}

export function registriereSchichten(app: Express, deps: Abhaengigkeiten): void {
  const { db } = deps;

  app.get('/einsaetze/:id/schichten/neu', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const e = await ladeEinsatz(db, leseId(req.params.id));
    const erste = await alle<{ start_zeit: string; end_zeit: string }>(db, 'SELECT start_zeit, end_zeit FROM schicht WHERE einsatz_id = ? ORDER BY start_zeit LIMIT 1', [e.id]);
    const vorgabe = erste.length
      ? { start_datum: lokalesDatum(erste[0].start_zeit), start_zeit: lokaleZeit(erste[0].start_zeit), end_datum: lokalesDatum(erste[0].end_zeit), end_zeit: lokaleZeit(erste[0].end_zeit) }
      : {};
    res.send(seite(kx, 'Schicht hinzufügen', 'einsaetze', html`${seitenKopf({ pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: e.name, href: `/einsaetze/${e.id}` }, { text: 'Schicht hinzufügen' }], titel: 'Schicht hinzufügen' })}${await schichtFormular(deps, kx, `/einsaetze/${e.id}/schichten`, vorgabe, new Map(), null, true)}`));
  });

  app.post('/einsaetze/:id/schichten', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const einsatzId = leseId(req.params.id);
    try {
      const sid = await erstelleSchicht(db, einsatzId, req.body);
      zurueck(req, res, `/schichten/${sid}`, 'Schicht hinzugefügt. Sie ist nicht publiziert.');
    } catch (e) {
      if (!(e instanceof Eingabefehler)) throw e;
      res.status(400).send(seite(kx, 'Schicht hinzufügen', 'einsaetze', html`${seitenKopf({ pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: 'Schicht hinzufügen' }], titel: 'Schicht hinzufügen' })}${await schichtFormular(deps, kx, `/einsaetze/${einsatzId}/schichten`, req.body, new Map(), e.message, true)}`));
    }
  });

  app.get('/schichten/:sid', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const s = await ladeSchicht(db, leseId(req.params.sid));
    const z = (await zahlenFuerSchichten(db, [s.id])).get(s.id)!;
    const w = await warnungenFuerSchicht(db, s.id);
    const rollen = await ladeRollen(db);
    const fremd = await fremdabteilungen(db, s.id);
    const eintraege = await alle<any>(
      db,
      `SELECT a.*, p.vorname, p.nachname, p.geburtsdatum, p.essenseinschraenkung, p.telefon, p.telefon_privat, p.geloescht_am,
              r.name AS rang_name, r.reihenfolge AS rang_reihenfolge
         FROM anmeldung a LEFT JOIN person p ON p.clubdesk_id = a.person_id LEFT JOIN rang r ON r.id = p.rang_id
        WHERE a.schicht_id = ?`,
      [s.id],
    );
    for (const e of eintraege) {
      if (!e.vorname && !e.nachname) e.vorname = e.name_text;
    }
    eintraege.sort(nachRangTiefZuerst);
    const logs = await verlauf(db, eintraege.map((e) => e.id));
    const filter = typeof req.query.status === 'string' && (STATUS as readonly string[]).includes(req.query.status) ? (req.query.status as Status) : null;
    const sichtbar = filter ? eintraege.filter((e) => e.status === filter) : eintraege;
    const hier = aktuellerPfad(req);
    const stichtag = lokalesDatum(s.start_zeit);
    const personen = await personenListe(db);
    const vermerk = await icsVermerk(db, s.id);
    const feed = feedStand();
    const alleSchichten = await schichtenVonEinsatz(db, s.einsatz_id);

    const zaehlerStatus = new Map<Status, number>();
    for (const e of eintraege) zaehlerStatus.set(e.status, (zaehlerStatus.get(e.status) ?? 0) + 1);

    const zeile = (e: any) => {
      const wl = w.anmeldungen.get(e.id);
      return html`<tr class="${e.status === 'angemeldet' ? 'unbestaetigt' : ''}" data-suche="${`${e.name_text} ${e.rang_name ?? ''}`.toLowerCase()}">
  <td>${e.person_id !== null ? html`<a href="/personen/${e.person_id}">${e.name_text}</a>` : html`${e.name_text} <span class="pille orange">unbekannt</span>${e.email_text ? html`<br><small>${e.email_text}</small>` : ''}`}</td>
  <td>${e.rang_name ?? ''}</td>
  <td>${e.geburtsdatum ? alterAm(e.geburtsdatum, stichtag) : ''}</td>
  <td>${statusText(e.status)}</td>
  <td>${e.rolle ?? ''}</td>
  <td>${KANAL_TEXT[e.kanal as Kanal]}</td>
  <td class="bemerkung">${mehrzeilig(e.bemerkung)}</td>
  <td>${warnungen(wl)}</td>
  <td>${e.essenseinschraenkung ?? ''}</td>
  <td class="aktionen-zelle">
    ${e.status !== 'bestaetigt' ? knopfPost(kx, `/anmeldungen/${e.id}`, 'Bestätigen', { status: 'bestaetigt' }, 'knopf klein', hier) : ''}
    <details class="aufklapp"><summary>Ändern</summary>
      <form method="post" action="/anmeldungen/${e.id}" class="mini-form">
        ${formFelder(kx, hier)}<input type="hidden" name="version" value="${e.version}">
        <label>Status ${statusAuswahl('status', e.status)}</label>
        <label>Rolle ${rolleAuswahl('rolle', rollen, e.rolle)}</label>
        <label>Kanal ${kanalAuswahl('kanal', e.kanal)}</label>
        <label>Bemerkung <textarea name="bemerkung" rows="2" maxlength="5000">${e.bemerkung ?? ''}</textarea></label>
        <button type="submit" class="knopf haupt klein">Speichern</button>
        <a class="knopf gefahr klein" href="/anmeldungen/${e.id}/loeschen?zurueck=${encodeURIComponent(hier)}">Eintrag entfernen</a>
      </form>
    </details>
    <details class="aufklapp"><summary>Verlauf</summary>${verlaufListe(logs.get(e.id))}</details>
  </td>
</tr>`;
    };
    const tabelle = (liste: any[]) => html`<div class="rahmen"><table class="tabelle filterbar">
  <thead><tr><th>Name</th><th>Rang</th><th>Alter</th><th>Status</th><th>Rolle</th><th>Kanal</th><th>Bemerkung</th><th>Warnungen</th><th>Essen</th><th></th></tr></thead>
  <tbody>${liste.map(zeile)}</tbody></table></div>`;
    const zuBearbeiten = sichtbar.filter((e) => ['angemeldet', 'unsicher', 'nachricht_gesendet'].includes(e.status));
    const bestaetigt = sichtbar.filter((e) => e.status === 'bestaetigt');
    const abgemeldet = sichtbar.filter((e) => e.status === 'abgemeldet');

    const inhalt = html`
${seitenKopf({
  pfad: schichtPfad(s),
  titel: html`${abgleichPunkt(w.abgleich)} ${s.name}`,
  marke: html`<form method="post" action="/schichten/${s.id}/publizieren" class="inline">
      ${formFelder(kx, hier)}<input type="hidden" name="publiziert" value="${s.publiziert ? '0' : '1'}">
      <button type="submit" class="schalter${s.publiziert ? ' an' : ''}" aria-pressed="${s.publiziert ? 'true' : 'false'}" title="Nur die Schicht hat den Schalter «Publiziert».">${s.publiziert ? 'Publiziert' : 'Nicht publiziert'}</button>
    </form>`,
  angaben: [
    html`<strong>${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)}</strong>`,
    s.ort ? `Antreten ${s.ort}` : '',
    s.min_alter !== null ? `ab ${s.min_alter} Jahren` : '',
    s.min_rang_name ? `ab ${s.min_rang_name}` : '',
  ],
  aktionen: html`<a class="knopf haupt" href="/schichten/${s.id}/anrufliste">Anrufliste</a>
    <a class="knopf" href="/schichten/${s.id}/bearbeiten">Bearbeiten</a>
    ${mehrMenue([
      html`<a href="/schichten/${s.id}/aufgebot">Aufgebot (Briefe)</a>`,
      html`<a href="/schichten/${s.id}/ics">Kalendertermin (ICS)</a>`,
      html`<a href="/schichten/${s.id}/termintext">Text für Clubdesk-Termin</a>`,
      html`<a href="/schichten/${s.id}/essensliste.csv">Essensliste (CSV)</a>`,
      html`<div class="menue-trenner"></div>`,
      html`<a class="gefahr" href="/schichten/${s.id}/loeschen">Schicht löschen</a>`,
    ])}`,
  reiter: einsatzReiter(s.einsatz_id, 'schichten'),
})}
${alleSchichten.length > 1 ? html`<p class="filter-chips schicht-wahl" aria-label="Schichten dieses Einsatzes">${alleSchichten.map((x) => html`<a href="/schichten/${x.id}"${x.id === s.id ? new Roh(' aria-current="page"') : ''}>${x.name}</a>`)}</p>` : ''}
<div class="zahl-karten">
  <div class="zahl-karte"><span class="wert">${istSoll(z.teilnehmende, s.soll_anzahl)}</span><span class="titel">Teilnehmende</span></div>
  ${karte('Unbestätigt', z.unbestaetigt, z.unbestaetigt ? 'orange' : '')}
  ${karte('Unsicher', z.unsicher)}
  ${karte('Nachricht gesendet', z.nachricht)}
  ${karte('Essen', z.essen)}
  ${z.fremd ? karte('Fremdabteilungen', z.fremd) : ''}
  ${z.rollen.map((r) => karte(r.rolle, `${r.ist} / ${r.soll}`, r.ist >= r.soll ? 'gruen' : 'rot'))}
</div>
${warnungen(w.schicht)}
${feed.fehlerSeit ? html`<p class="hinweis">Abgleich nicht verfügbar seit ${datumZeit(feed.fehlerSeit)}.</p>` : ''}
${vermerk ? html`<p class="unter">ICS exportiert am ${datumZeit(vermerk.exportiert_am)}${vermerk.benutzer ? ` von ${vermerk.benutzer}` : ''}.</p>` : ''}
${s.bemerkung_intern ? html`<p class="bemerkung intern"><strong>Intern:</strong> ${mehrzeilig(s.bemerkung_intern)}</p>` : ''}

<section class="abschnitt">
  <h2>Person eintragen</h2>
  <form method="post" action="/schichten/${s.id}/anmeldungen" class="zeilen-form">
    ${formFelder(kx, hier)}
    <label class="wachsen">Person <input name="person" list="personen-liste" required placeholder="Name tippen …" autocomplete="off"></label>
    <datalist id="personen-liste">${personen.map((p) => html`<option value="${personAuswahlText(p)}"></option>`)}</datalist>
    <label>Kanal ${kanalAuswahl('kanal', 'telefon', true)}</label>
    <label>Status ${statusAuswahl('status', 'angemeldet')}</label>
    <label>Rolle ${rolleAuswahl('rolle', rollen, null)}</label>
    <label class="wachsen">Bemerkung <input name="bemerkung" maxlength="5000" autocomplete="off"></label>
    <button type="submit" class="knopf haupt">Eintragen</button>
  </form>
</section>

<section class="abschnitt">
  <div class="titelzeile">
    <h2>Einträge</h2>
    <input type="search" class="suche" data-filter=".filterbar tbody tr" placeholder="Suchen …" aria-label="Einträge suchen">
  </div>
  <p class="filter-chips">
    <a href="/schichten/${s.id}"${filter ? '' : new Roh(' aria-current="page"')}>alle ${eintraege.length}</a>
    ${STATUS.map((st) => html`<a class="s-${st}" href="/schichten/${s.id}?status=${st}"${filter === st ? new Roh(' aria-current="page"') : ''}>${STATUS_TEXT[st]} ${zaehlerStatus.get(st) ?? 0}</a>`)}
  </p>
  ${z.unbestaetigt ? html`<p>${knopfPost(kx, `/schichten/${s.id}/alle-bestaetigen`, `Alle angemeldeten bestätigen (${z.unbestaetigt})`, {}, 'knopf haupt', hier)}</p>` : ''}
  ${zuBearbeiten.length ? html`<h3>Zu bearbeiten (${zuBearbeiten.length})</h3>${tabelle(zuBearbeiten)}` : ''}
  ${bestaetigt.length ? html`<h3>Bestätigt (${bestaetigt.length})</h3>${tabelle(bestaetigt)}` : ''}
  ${abgemeldet.length ? html`<details class="gruppe"><summary><h3>Abgemeldet (${abgemeldet.length})</h3></summary>${tabelle(abgemeldet)}</details>` : ''}
  ${sichtbar.length === 0 ? html`<p class="leer">Keine Einträge.</p>` : ''}
</section>

<section class="abschnitt">
  <h2>Fremdabteilungen</h2>
  <p class="unter">Fremdabteilungen zählen als Teilnehmende und beim Essen.</p>
  ${fremd.length ? html`<div class="rahmen"><table class="tabelle"><thead><tr><th>Name</th><th>Anzahl</th><th>Bemerkung</th><th></th></tr></thead><tbody>
  ${fremd.map((f) => html`<tr><td colspan="4">
    <form method="post" action="/schichten/${s.id}/fremdabteilungen" class="zeilen-form">
      ${formFelder(kx, hier)}<input type="hidden" name="id" value="${f.id}">
      <input name="name" required maxlength="255" value="${f.name}" aria-label="Name">
      <input name="anzahl" type="number" min="1" required value="${f.anzahl}" aria-label="Anzahl">
      <input name="bemerkung" maxlength="2000" value="${f.bemerkung ?? ''}" aria-label="Bemerkung" class="wachsen">
      <button type="submit" class="knopf klein">Speichern</button>
      <label class="haken klein"><input type="checkbox" name="loeschen" value="1"> löschen</label>
    </form></td></tr>`)}
  </tbody></table></div>` : ''}
  <form method="post" action="/schichten/${s.id}/fremdabteilungen" class="zeilen-form">
    ${formFelder(kx, hier)}
    <input name="name" required maxlength="255" placeholder="Name" aria-label="Name">
    <input name="anzahl" type="number" min="1" required placeholder="Anzahl" aria-label="Anzahl">
    <input name="bemerkung" maxlength="2000" placeholder="Bemerkung, z. B. 2 vegetarisch" aria-label="Bemerkung" class="wachsen">
    <button type="submit" class="knopf">Hinzufügen</button>
  </form>
</section>`;
    res.send(seite(kx, s.name, 'einsaetze', inhalt, { breit: true}));
  });

  app.get('/schichten/:sid/bearbeiten', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const s = await ladeSchicht(db, leseId(req.params.sid));
    const bedarf = await rollenBedarf(db, s.id);
    res.send(seite(kx, 'Schicht bearbeiten', 'einsaetze', html`${seitenKopf({ pfad: schichtPfad(s, 'Bearbeiten'), titel: 'Schicht bearbeiten' })}${await schichtFormular(deps, kx, `/schichten/${s.id}`, schichtWerte(s), bedarf, null, false)}`));
  });

  app.post('/schichten/:sid', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const sid = leseId(req.params.sid);
    try {
      await aendereSchicht(db, sid, { ...req.body, rollen: req.body.rollen ?? {} });
      zurueck(req, res, `/schichten/${sid}`);
    } catch (e) {
      if (!(e instanceof Eingabefehler)) throw e;
      // Konflikt: Die Eingaben bleiben. Ein zweites Speichern überschreibt bewusst den neuen Stand.
      const konflikt = e instanceof Konflikt;
      const werte = konflikt ? { ...req.body, version: e.aktuelleVersion } : req.body;
      res.status(konflikt ? 409 : 400).send(seite(kx, 'Schicht bearbeiten', 'einsaetze', html`${seitenKopf({ pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: 'Schicht bearbeiten' }], titel: 'Schicht bearbeiten' })}${
        konflikt ? html`<p><a href="/schichten/${sid}" target="_blank" rel="noopener">Aktuellen Stand in neuem Tab öffnen</a></p>` : ''
      }${await schichtFormular(deps, kx, `/schichten/${sid}`, werte, new Map(), e.message, false)}`));
    }
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
    await setzeAnmeldung(db, { schichtId: sid, personId, status: req.body.status, kanal: req.body.kanal, rolle: req.body.rolle, bemerkung: nichtLeer(req.body.bemerkung) }, k(res).benutzer!.id);
    zurueck(req, res, `/schichten/${sid}`, 'Eingetragen.');
  });

  // Regel 14.3: Sammelstatus. «Nachricht gesendet» für alle gewählten Personen, Kanal whatsapp.
  app.post('/schichten/:sid/sammelstatus', nurAufgebot, async (req, res) => {
    const sid = leseId(req.params.sid);
    const ids = liste(req.body?.personen).map((x) => leseId(x, 'Person'));
    const status = req.body?.status ?? 'nachricht_gesendet';
    const kanal = req.body?.kanal ?? (status === 'nachricht_gesendet' ? 'whatsapp' : 'telefon');
    const n = await sammelstatus(db, sid, ids, status, kanal, k(res).benutzer!.id);
    zurueck(req, res, `/schichten/${sid}/anrufliste`, `Status für ${n} Personen gesetzt.`);
  });

  app.post('/schichten/:sid/alle-bestaetigen', nurAufgebot, async (req, res) => {
    const sid = leseId(req.params.sid);
    const n = await bestaetigeAlle(db, [sid], k(res).benutzer!.id);
    zurueck(req, res, `/schichten/${sid}`, `${n} Anmeldungen bestätigt.`);
  });

  app.get('/schichten/:sid/anrufliste', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const s = await ladeSchicht(db, leseId(req.params.sid));
    const alleZeigen = req.query.alle === '1';
    const { zeilen, ausgeblendet } = await anrufliste(db, s.id, alleZeigen);
    const hier = aktuellerPfad(req);
    const inhalt = html`
${seitenKopf({
  pfad: schichtPfad(s, 'Anrufliste'),
  titel: 'Anrufliste',
  angaben: [terminTitel(s), zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)],
  aktionen: html`<button type="submit" form="sammel" class="knopf haupt">Nachricht gesendet (gewählte)</button>`,
})}
<div class="titelzeile filterzeile">
  <input type="search" class="suche" data-filter=".filterbar tbody tr" placeholder="Person suchen …" aria-label="Personen suchen">
</div>
<p>${alleZeigen
    ? html`Alle Personen sichtbar. <a href="/schichten/${s.id}/anrufliste">Unpassende ausblenden</a>`
    : html`${ausgeblendet} Personen passen nicht zu Mindestalter oder Mindestrang. <a href="/schichten/${s.id}/anrufliste?alle=1">Einblenden</a>`}</p>
<form method="post" action="/schichten/${s.id}/sammelstatus" id="sammel">
  ${formFelder(kx, hier)}
  <input type="hidden" name="status" value="nachricht_gesendet">
  <input type="hidden" name="kanal" value="whatsapp">
</form>
<div class="rahmen"><table class="tabelle filterbar">
  <thead><tr><th><input type="checkbox" data-alle-waehlen="personen" aria-label="Alle wählen"></th><th>Rang</th><th>Name</th><th>Alter</th><th>Telefon</th><th>Status</th><th>Aktion</th></tr></thead>
  <tbody>${zeilen.map((p) => html`<tr class="${p.passt ? '' : 'passt-nicht'}" data-suche="${`${p.vorname ?? ''} ${p.nachname ?? ''} ${p.rang_name ?? ''}`.toLowerCase()}">
    <td><input type="checkbox" name="personen" value="${p.clubdesk_id}" form="sammel" aria-label="wählen"></td>
    <td>${p.rang_name ?? ''}</td>
    <td><a href="/personen/${p.clubdesk_id}">${`${p.vorname ?? ''} ${p.nachname ?? ''}`.trim()}</a>${p.bemerkung ? html`<br><small>${p.bemerkung}</small>` : ''}</td>
    <td>${p.alter ?? ''}</td>
    <td>${telefon(p)}</td>
    <td>${p.status ? statusText(p.status) : '–'}</td>
    <td class="knopfreihe">
      ${(['angemeldet', 'bestaetigt', 'unsicher', 'abgemeldet'] as const).map((st) =>
        knopfPost(kx, `/schichten/${s.id}/sammelstatus`, STATUS_TEXT[st].replace(/^./, (c) => c.toUpperCase()), { status: st, kanal: 'telefon', personen: String(p.clubdesk_id) }, 'knopf klein', hier))}
    </td>
  </tr>`)}</tbody>
</table></div>`;
    res.send(seite(kx, 'Anrufliste', 'einsaetze', inhalt, { breit: true}));
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
    res.send(erzeugeIcs(s));
  });

  app.get('/schichten/:sid/termintext', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const s = await ladeSchicht(db, leseId(req.params.sid));
    res.send(seite(kx, 'Termintext', 'einsaetze', html`
${seitenKopf({ pfad: schichtPfad(s, 'Termintext'), titel: 'Text für den Clubdesk-Termin' })}
<div class="feld"><label for="titel">Titel</label><input id="titel" readonly value="${terminTitel(s)}"></div>
<p><button type="button" class="knopf" data-kopieren="#titel">Titel kopieren</button></p>
<div class="feld"><label for="termintext">Text</label><textarea id="termintext" readonly rows="10">${terminText(s)}</textarea></div>
<p><button type="button" class="knopf haupt" data-kopieren="#termintext">Kopieren</button></p>`));
  });

  // Regel 20: Druckansicht des Aufgebots. Ein Brief je bestätigter Person, je Brief eine A4-Seite.
  app.get('/schichten/:sid/aufgebot', nurAufgebot, async (req, res) => {
    const nur = typeof req.query.person === 'string' && /^\d+$/.test(req.query.person) ? Number(req.query.person) : null;
    const d = await aufgebotDaten(db, leseId(req.params.sid), nur);
    const zeile = (titel: string, wert: string | null) => (wert ? html`<tr><th>${titel}</th><td>${wert}</td></tr>` : '');
    const briefe = d.briefe.map((b) => html`
<article class="brief">
  ${b.adresseFehlt ? html`<p class="brief-warnung nicht-drucken">Adresse fehlt</p>` : ''}
  <div class="brief-kopf">
    <div class="absender">${FEST.absender.map((z) => html`${z}<br>`)}</div>
  </div>
  <div class="brief-adresszeile">
    <div class="ansprechperson">${FEST.ansprechperson.map((z) => html`${z}<br>`)}</div>
    <div class="empfaenger">
      ${b.rang ? html`${b.rang}<br>` : ''}${b.name}<br>
      ${b.strasse ? html`${b.strasse}<br>` : ''}${b.adresszusatz ? html`${b.adresszusatz}<br>` : ''}${b.plzOrt ?? ''}
    </div>
  </div>
  <p class="brief-datum">${FEST.ortDatum} ${d.briefdatum}</p>
  <h2 class="brief-titel">${d.titel}</h2>
  ${FEST.einleitung.map((z) => html`<p>${z}</p>`)}
  <table class="brief-tabelle">
    ${zeile('Antreten', d.antreten)}
    ${zeile('Abtreten', d.abtreten)}
    ${d.hinweis ? html`<tr><th></th><td>${mehrzeilig(d.hinweis)}</td></tr>` : ''}
    ${d.einsatzleitung.length ? html`<tr><th>Einsatzleitung</th><td>${d.einsatzleitung.map((z, i) => html`${i ? html`<br>` : ''}${z}`)}</td></tr>` : ''}
    ${zeile('Tenue', d.tenue)}
  </table>
  ${FEST.schluss.map((z) => html`<p>${z}</p>`)}
  <p>${FEST.gruss}</p>
  <p class="unterschrift">${FEST.unterschrift.map((z) => html`${z}<br>`)}</p>
</article>`);
    res.send(druckseite(d.titel, html`
<div class="druck-steuerung nicht-drucken">
  <a href="/schichten/${d.schichtId}">← Zurück</a>
  <button type="button" class="knopf haupt" data-drucken>Drucken</button>
  <span>${d.briefe.length} Briefe</span>
</div>
${d.luecken.length ? html`<div class="luecken nicht-drucken"><h2>Lücken vor dem Druck</h2>${warnungen(d.luecken)}</div>` : ''}
${d.briefe.length ? briefe : html`<p class="nicht-drucken">Keine bestätigten Personen.</p>`}`, 'aufgebot'));
  });
}

export type { Request, Response };

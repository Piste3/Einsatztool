// Anmeldungen ändern, entfernen, unbekannte zuordnen (14.1, 14.6).
import type { Express } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot, refererPfad, zurueck } from './app.js';
import { macheRueckgaengig, mitRueckgaengig } from '../domain/rueckgaengig.js';
import { aendereAnmeldung, ladeAnmeldung, loescheAnmeldung, ordneZu, verlauf, verschiebeAnmeldung } from '../domain/anmeldung.js';
import { warnungenFuerSchichten } from '../domain/warnungen.js';
import { ladeSchicht } from '../domain/schicht.js';
import { unbekannteEintraege, zuordnungsVorschlaege } from '../domain/listen.js';
import { personAuswahlText, idAusAuswahl, personenListe } from '../domain/personen.js';
import { Eingabefehler, STATUS_TEXT, id as leseId } from '../domain/eingabe.js';
import { html, mehrzeilig } from './html.js';
import { k, sicheresZiel } from './kontext.js';
import { formFelder, seite, seitenKopf } from './views/layout.js';
import { datumZeit, statusText, zeitraum } from './views/teile.js';
import { verlaufListe } from './routes-schichten.js';
import { terminTitel } from '../domain/ics.js';

export function registriereAnmeldungen(app: Express, deps: Abhaengigkeiten): void {
  const { db } = deps;

  app.post('/anmeldungen/:id', nurAufgebot, async (req, res) => {
    const id = leseId(req.params.id);
    const { ergebnis: a, schluessel } = await mitRueckgaengig(db, k(res).benutzer!.id, () => aendereAnmeldung(
      db,
      id,
      {
        status: req.body.status,
        rolle: req.body.rolle,
        kanal: req.body.kanal,
        bemerkung: req.body.bemerkung,
        version: req.body.version,
      },
      k(res).benutzer!.id,
    ));
    const nurStatus = !['rolle', 'kanal', 'bemerkung'].some((f) => f in (req.body ?? {}));
    const text = req.body.status === 'bestaetigt' && nurStatus ? 'Bestätigt.' : 'Gespeichert.';
    zurueck(req, res, `/schichten/${a.schicht_id}`, text, 'ok', schluessel);
  });

  // Reiter «Schichten»: Eintrag in eine andere Schicht verschieben (Wunsch Yann 20.11.2026).
  app.post('/anmeldungen/:id/verschieben', nurAufgebot, async (req, res) => {
    const id = leseId(req.params.id);
    const ziel = leseId(req.body?.schicht);
    const benutzer = k(res).benutzer!.id;
    const { ergebnis: r, schluessel } = await mitRueckgaengig(db, benutzer, () => verschiebeAnmeldung(db, id, ziel, req.body?.version, benutzer));
    const s = await ladeSchicht(db, r.nach);
    if (!r.geaendert) {
      zurueck(req, res, `/einsaetze/${s.einsatz_id}/schichten`, '', 'ok');
      return;
    }
    const w = (await warnungenFuerSchichten(db, [r.nach])).get(r.nach)?.anmeldungen.get(id) ?? [];
    const text = `${r.name} nach «${s.name}» verschoben.${w.length ? ` Warnung: ${w.map((x) => x.text).join(' ')}` : ''}`;
    zurueck(req, res, `/einsaetze/${s.einsatz_id}/schichten`, text, w.length ? 'hinweis' : 'ok', schluessel);
  });

  app.get('/anmeldungen/:id/loeschen', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const a = await ladeAnmeldung(db, leseId(req.params.id));
    const s = await ladeSchicht(db, a.schicht_id);
    const ziel = sicheresZiel(req.query.zurueck, `/schichten/${s.id}`);
    res.send(seite(kx, 'Eintrag entfernen', 'einsaetze', html`
${seitenKopf({ titel: 'Eintrag entfernen?' })}
<p>${a.name_text} in «${terminTitel(s)}» (${STATUS_TEXT[a.status]}).</p>
<p class="meldung fehler">Das Tool entfernt den Eintrag mit seinem Verlauf. Die Person gilt dann als «nicht gefragt».</p>
<form method="post" action="/anmeldungen/${a.id}/loeschen" class="stapel">
  ${formFelder(kx, ziel)}
  <label class="haken"><input type="checkbox" name="bestaetigt" value="1" required> Ja, Eintrag entfernen</label>
  <div class="knopfreihe"><button class="knopf gefahr" type="submit">Entfernen</button> <a class="knopf" href="${ziel}">Abbrechen</a></div>
</form>`));
  });

  app.post('/anmeldungen/:id/loeschen', nurAufgebot, async (req, res) => {
    if (req.body?.bestaetigt !== '1') throw new Eingabefehler('Bestätige das Entfernen mit dem Häkchen.');
    const id = leseId(req.params.id);
    const { ergebnis: sid, schluessel } = await mitRueckgaengig(db, k(res).benutzer!.id, () => loescheAnmeldung(db, id));
    zurueck(req, res, `/schichten/${sid}`, 'Eintrag entfernt.', 'ok', schluessel);
  });

  // Knopf «Rückgängig» im Toast: stellt die Einträge der letzten Aktion wieder her.
  app.post('/rueckgaengig', nurAufgebot, async (req, res) => {
    const n = await macheRueckgaengig(db, req.body?.schluessel, k(res).benutzer!.id);
    zurueck(req, res, refererPfad(req), n === 1 ? 'Rückgängig gemacht.' : `Rückgängig gemacht (${n} Einträge).`);
  });

  // Regel 14.6.2 und 14.6.3: unzugeordnete Einträge mit Suche.
  app.get('/anmeldungen/unbekannt', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const liste = await unbekannteEintraege(db);
    const fuer = typeof req.query.fuer === 'string' && /^\d+$/.test(req.query.fuer) ? Number(req.query.fuer) : null;
    const suche = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    const logs = await verlauf(db, liste.map((e) => e.id));
    const personen = await personenListe(db);
    const bloecke = [];
    for (const e of liste) {
      const vorschlaege = await zuordnungsVorschlaege(db, e, fuer === e.id ? suche : '');
      bloecke.push(html`
<section class="karte unbekannt" id="e${e.id}">
  <header><h3>${e.name_text}</h3> ${statusText(e.status)}</header>
  <p>${e.email_text ? html`<a href="mailto:${e.email_text}">${e.email_text}</a> · ` : ''}<a href="/schichten/${e.schicht_id}">${e.einsatz} – ${e.schicht}</a> · ${zeitraum(e.start_zeit, e.start_zeit)}</p>
  ${e.bemerkung ? html`<p class="bemerkung">${mehrzeilig(e.bemerkung)}</p>` : ''}
  <p class="unter">Eingegangen ${datumZeit(e.erstellt_am)}</p>
  <form method="get" action="/anmeldungen/unbekannt#e${e.id}" class="zeilen-form">
    <input type="hidden" name="fuer" value="${e.id}">
    <input type="search" name="q" value="${fuer === e.id ? suche : ''}" placeholder="Person suchen …" aria-label="Person suchen" class="wachsen">
    <button type="submit" class="knopf">Suchen</button>
  </form>
  ${vorschlaege.length ? html`<ul class="vorschlaege">${vorschlaege.map((p) => html`<li>
    <form method="post" action="/anmeldungen/${e.id}/zuordnen" class="zeilen-form">
      ${formFelder(kx, '/anmeldungen/unbekannt')}
      <input type="hidden" name="person" value="${p.clubdesk_id}">
      <span class="wachsen">${p.rang_name ? `${p.rang_name} ` : ''}${p.vorname} ${p.nachname} <small>(ID ${p.clubdesk_id}${p.email ? `, ${p.email}` : ''})</small></span>
      <button type="submit" class="knopf klein haupt">Zuordnen</button>
    </form></li>`)}</ul>` : html`<p class="unter">Keine passende Person gefunden. Ist es ein neues Mitglied, ordne den Eintrag nach dem nächsten Import zu.</p>`}
  <details class="aufklapp"><summary>Andere Person wählen</summary>
    <form method="post" action="/anmeldungen/${e.id}/zuordnen" class="zeilen-form">
      ${formFelder(kx, '/anmeldungen/unbekannt')}
      <input name="person" list="personen-alle" required placeholder="Name tippen …" class="wachsen" aria-label="Person">
      <button type="submit" class="knopf klein">Zuordnen</button>
    </form>
  </details>
  <details class="aufklapp"><summary>Verlauf</summary>${verlaufListe(logs.get(e.id))}</details>
</section>`);
    }
    res.send(seite(kx, 'Unbekannte Anmeldungen', 'unbekannt', html`
${seitenKopf({ titel: 'Unbekannte Anmeldungen', angaben: [`${liste.length} offen`, 'Namen, die das Tool keiner Person sicher zuordnen konnte.'] })}
<p class="unter">Diese Anmeldungen aus dem Formular passen zu keiner Person aus Clubdesk. Ordne sie von Hand zu.</p>
<datalist id="personen-alle">${personen.map((p) => html`<option value="${personAuswahlText(p)}"></option>`)}</datalist>
${liste.length ? html`<div class="karten">${bloecke}</div>` : html`<p class="leer">Keine unbekannten Anmeldungen.</p>`}`));
  });

  // Regel 14.6.4 und 14.6.5.
  app.post('/anmeldungen/:id/zuordnen', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const id = leseId(req.params.id);
    const personId = idAusAuswahl(req.body?.person);
    if (!personId) throw new Eingabefehler('Wähle eine Person aus der Liste.');
    const { ergebnis: r, schluessel } = await mitRueckgaengig(db, kx.benutzer!.id, () => ordneZu(db, id, personId, kx.benutzer!.id));
    if (r.ok) {
      zurueck(req, res, '/anmeldungen/unbekannt', 'Zugeordnet.', 'ok', schluessel);
      return;
    }
    const a = await ladeAnmeldung(db, id);
    res.send(seite(kx, 'Person hat schon einen Eintrag', 'unbekannt', html`
${seitenKopf({ titel: 'Person hat schon einen Eintrag.' })}
<p>Die gewählte Person hat in dieser Schicht schon einen Eintrag. Das Tool führt Einträge nie automatisch zusammen.</p>
<p>Unbekannter Eintrag: ${a.name_text}${a.email_text ? ` (${a.email_text})` : ''}${a.bemerkung ? html`<br><small>${mehrzeilig(a.bemerkung)}</small>` : ''}</p>
<div class="knopfreihe">
  <a class="knopf gefahr" href="/anmeldungen/${a.id}/loeschen?zurueck=${encodeURIComponent('/anmeldungen/unbekannt')}">Unbekannten Eintrag löschen</a>
  <a class="knopf" href="/anmeldungen/unbekannt">Abbrechen</a>
</div>`));
  });
}

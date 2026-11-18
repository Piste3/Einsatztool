// Personen (14.4) und Rückmeldungen (Abschnitt 3 des Auftrags).
import type { Express } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot } from './app.js';
import { alterHeute, ladePerson, personenListe, telefonText } from '../domain/personen.js';
import { personUebersicht, rueckmeldungen, type RueckmeldungOptionen } from '../domain/listen.js';
import { verlauf } from '../domain/anmeldung.js';
import { STATUS_TEXT, KANAL_TEXT, id as leseId, type Kanal } from '../domain/eingabe.js';
import { html, Roh } from './html.js';
import { k, aktuellerPfad } from './kontext.js';
import { formFelder, seite } from './views/layout.js';
import { datumZeit, kanalAuswahl, legende, statusMarke, statusText, telefon, zeitraum } from './views/teile.js';
import { verlaufListe } from './routes-schichten.js';
import { datumCh, datumChVonIso, lokaleZeit } from '../domain/zeit.js';

export function registrierePersonen(app: Express, deps: Abhaengigkeiten): void {
  const { db, konfig } = deps;

  app.get('/personen', nurAufgebot, async (_req, res) => {
    const kx = k(res);
    const liste = await personenListe(db);
    res.send(seite(kx, 'Personen', 'personen', html`
<div class="titelzeile">
  <h1>Personen (${liste.length})</h1>
  <input type="search" class="suche" data-filter=".filterbar tbody tr" placeholder="Suchen …" aria-label="Personen suchen">
</div>
<p class="unter">Die Daten kommen aus Clubdesk. Das Tool ändert keine Personendaten.</p>
<div class="rahmen"><table class="tabelle filterbar">
  <thead><tr><th>Rang</th><th>Name</th><th>Alter</th><th>Telefon</th><th>E-Mail</th><th>Essen</th></tr></thead>
  <tbody>${liste.map((p) => html`<tr data-suche="${`${p.vorname ?? ''} ${p.nachname ?? ''} ${p.rang_name ?? ''} ${p.email ?? ''}`.toLowerCase()}">
    <td>${p.rang_name ?? ''}</td>
    <td><a href="/personen/${p.clubdesk_id}">${p.nachname ?? ''} ${p.vorname ?? ''}</a></td>
    <td>${alterHeute(p.geburtsdatum) ?? ''}</td>
    <td>${telefon(p)}</td>
    <td>${p.email ? html`<a href="mailto:${p.email}">${p.email}</a>` : ''}</td>
    <td>${p.essenseinschraenkung ?? ''}</td>
  </tr>`)}</tbody>
</table></div>`));
  });

  app.get('/personen/:id', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const p = await ladePerson(db, leseId(req.params.id));
    const u = await personUebersicht(db, p.clubdesk_id);
    const logs = await verlauf(db, [...u.kommend, ...u.vergangen].map((e) => e.id));
    const name = `${p.vorname ?? ''} ${p.nachname ?? ''}`.trim() || `Gelöschte Person ${p.clubdesk_id}`;
    const hier = aktuellerPfad(req);
    // Regel 14.4 (Annahme): mailto an MAIL_ROMAN mit Clubdesk-ID, Name und «Bitte ändern: …».
    const mailto = konfig.mailRoman
      ? `mailto:${konfig.mailRoman}?subject=${encodeURIComponent('Änderung Personendaten')}&body=${encodeURIComponent(`Clubdesk-ID: ${p.clubdesk_id}\nName: ${name}\nBitte ändern: …`)}`
      : null;
    const gruppe = (titel: string, liste: typeof u.kommend) => liste.length
      ? html`<h3>${titel} (${liste.length})</h3><ul class="liste">${liste.map((e) => html`<li>
          <a href="/schichten/${e.schicht_id}">${e.einsatz}${e.einsatz === e.schicht ? '' : ` – ${e.schicht}`}</a> · ${zeitraum(e.start_zeit, e.end_zeit)} · ${statusText(e.status)}${e.rolle ? ` · ${e.rolle}` : ''}
        </li>`)}</ul>`
      : '';
    const zeigen = (feld: string, wert: unknown) => (wert ? html`<tr><th>${feld}</th><td>${wert as string}</td></tr>` : '');
    res.send(seite(kx, name, 'personen', html`
<p><a href="/personen">← Personen</a></p>
<div class="titelzeile">
  <h1>${p.rang_name ? html`<span class="rang">${p.rang_name}</span> ` : ''}${name}</h1>
  ${mailto ? html`<a class="knopf" href="${mailto}">Änderung melden</a>` : html`<span class="unter">MAIL_ROMAN fehlt in der Konfiguration.</span>`}
</div>
${p.geloescht_am ? html`<p class="meldung hinweis">Die Personendaten sind gelöscht (${datumZeit(p.geloescht_am)}). Die ID bleibt.</p>` : ''}
<div class="zwei-spalten">
<section class="karte">
  <h2>Stammdaten</h2>
  <table class="tabelle schmal">
    ${zeigen('Clubdesk-ID', String(p.clubdesk_id))}
    ${zeigen('Geburtsdatum', p.geburtsdatum ? `${datumCh(p.geburtsdatum)} (${alterHeute(p.geburtsdatum)} Jahre)` : '')}
    ${p.telefon || p.telefon_privat ? html`<tr><th>Telefon</th><td>${telefon(p)}</td></tr>` : ''}
    ${p.email ? html`<tr><th>E-Mail</th><td><a href="mailto:${p.email}">${p.email}</a></td></tr>` : ''}
    ${zeigen('Adresse', [p.strasse, p.adresszusatz, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}
    ${zeigen('Essenseinschränkungen', p.essenseinschraenkung)}
    ${zeigen('Importiert', datumZeit(p.importiert_am))}
  </table>
</section>
<section class="karte">
  <h2>Nächste Einsätze</h2>
  ${gruppe('Bestätigt', u.kommend.filter((e) => e.status === 'bestaetigt'))}
  ${gruppe('Angemeldet', u.kommend.filter((e) => e.status === 'angemeldet'))}
  ${gruppe('Unsicher', u.kommend.filter((e) => e.status === 'unsicher'))}
  ${gruppe('Nachricht gesendet', u.kommend.filter((e) => e.status === 'nachricht_gesendet'))}
  ${gruppe('Abgemeldet', u.kommend.filter((e) => e.status === 'abgemeldet'))}
  ${!p.geloescht_am && u.offen.length ? html`<h3>Offen – nicht gefragt (${u.offen.length})</h3><ul class="liste">${u.offen.map((s) => html`<li class="zeilen-form">
    <span class="wachsen"><a href="/schichten/${s.id}">${s.einsatz}${s.einsatz === s.name ? '' : ` – ${s.name}`}</a> · ${zeitraum(s.start_zeit, s.end_zeit)}${s.publiziert ? '' : html` <span class="pille grau">intern</span>`}</span>
    <form method="post" action="/schichten/${s.id}/anmeldungen" class="zeilen-form">
      ${formFelder(kx, hier)}
      <input type="hidden" name="person" value="${p.clubdesk_id}">
      <input type="hidden" name="status" value="angemeldet">
      ${kanalAuswahl('kanal', 'telefon', true)}
      <button type="submit" class="knopf klein">Eintragen</button>
    </form></li>`)}</ul>` : ''}
</section>
</div>
<details class="gruppe"><summary><h2>Vergangene Einsätze (${u.vergangen.length})</h2></summary>
  <ul class="liste">${u.vergangen.map((e) => html`<li><a href="/schichten/${e.schicht_id}">${e.einsatz}${e.einsatz === e.schicht ? '' : ` – ${e.schicht}`}</a> · ${datumChVonIso(e.start_zeit)} · ${STATUS_TEXT[e.status]}${e.rolle ? ` · ${e.rolle}` : ''}</li>`)}</ul>
</details>
<details class="gruppe"><summary><h2>Verlauf</h2></summary>
  ${[...u.kommend, ...u.vergangen].map((e) => html`<h3>${e.einsatz}${e.einsatz === e.schicht ? '' : ` – ${e.schicht}`}</h3>${verlaufListe(logs.get(e.id))}`)}
</details>`));
  });

  app.get('/rueckmeldungen', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const q = req.query;
    const monate = ([1, 3, 6, 12] as const).find((m) => String(m) === q.monate) ?? 3;
    const o: RueckmeldungOptionen = {
      monate,
      nurOffen: q.offen === '1',
      unpublizierte: q.unpubliziert === '1',
      suche: typeof q.suche === 'string' ? q.suche.slice(0, 100) : '',
      sortierung: q.sort === 'name' ? 'name' : 'rang',
    };
    const r = await rueckmeldungen(db, o);
    const auswahl = (wert: string, aktuell: string) => (wert === aktuell ? new Roh(' selected') : '');
    res.send(seite(kx, 'Rückmeldungen', 'rueckmeldungen', html`
<h1>Rückmeldungen</h1>
<form method="get" action="/rueckmeldungen" class="filter-form zeilen-form">
  <label>Zeitraum <select name="monate">${[1, 3, 6, 12].map((m) => html`<option value="${m}"${auswahl(String(m), String(monate))}>${m} ${m === 1 ? 'Monat' : 'Monate'}</option>`)}</select></label>
  <label>Sortierung <select name="sort"><option value="rang"${auswahl('rang', o.sortierung)}>Rang</option><option value="name"${auswahl('name', o.sortierung)}>Name</option></select></label>
  <label class="haken"><input type="checkbox" name="offen" value="1"${o.nurOffen ? new Roh(' checked') : ''}> Nur mit offenen Schichten</label>
  <label class="haken"><input type="checkbox" name="unpubliziert" value="1"${o.unpublizierte ? new Roh(' checked') : ''}> Unpublizierte zeigen</label>
  <input type="search" name="suche" value="${o.suche}" placeholder="Name …" aria-label="Name suchen">
  <button type="submit" class="knopf">Anzeigen</button>
</form>
${legende()}
<p class="unter">Grau = passt nicht zu Mindestalter oder Mindestrang.</p>
${r.schichten.length === 0 ? html`<p class="leer">Keine kommenden Schichten im Zeitraum.</p>` : html`
<div class="rahmen rueck-rahmen"><table class="tabelle rueck">
  <thead><tr><th class="name-spalte">Person</th>${r.schichten.map((s) => html`<th><a href="/schichten/${s.id}"><span class="e">${s.einsatz_name}</span>${s.einsatz_name === s.name ? '' : html`<span class="s">${s.name}</span>`}<span class="d">${datumChVonIso(s.start_zeit)}</span></a>${s.publiziert ? '' : html`<span class="pille grau">intern</span>`}</th>`)}</tr></thead>
  <tbody>${r.personen.map((p) => html`<tr>
    <th class="name-spalte"><a href="/personen/${p.clubdesk_id}">${p.rang_name ? html`<span class="rang">${p.rang_name}</span> ` : ''}${p.nachname ?? ''} ${p.vorname ?? ''}</a></th>
    ${p.zellen.map((c) => html`<td class="${c.passt ? '' : 'passt-nicht'}" title="${c.status ? `${STATUS_TEXT[c.status]} · ${datumChVonIso(c.geaendert_am!)} ${lokaleZeit(c.geaendert_am!)} · ${KANAL_TEXT[c.kanal as Kanal]}` : c.passt ? 'nicht gefragt' : 'passt nicht'}">${statusMarke(c.status)}</td>`)}
  </tr>`)}</tbody>
  <tfoot>
    ${(['an', 'ab', 'unsicher', 'offen'] as const).map((n) => html`<tr><th class="name-spalte">${{ an: 'An', ab: 'Ab', unsicher: 'Unsicher', offen: 'Offen' }[n]}</th>${r.schichten.map((s) => html`<td>${s.summe[n]}</td>`)}</tr>`)}
  </tfoot>
</table></div>`}`, { breit: true }));
  });
}

export { telefonText };

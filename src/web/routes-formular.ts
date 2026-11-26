// Seite «Formular» (Wunsch Yann 20.11.2026): jedes Ausfüllen des Anmeldeformulars einzeln,
// dazu der Link zum Formular und die Schichten, die das Formular gerade zeigt.
import type { Express } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot, zurueck } from './app.js';
import { EINGANG_FILTER, EINGANG_FILTER_TEXT, eingangLoeschenVorschau, formularEingaenge, istUnbekannt, loescheEingang, passtZuFilter, type Eingang, type EingangFilter } from '../domain/formular-eingaenge.js';
import { sichtbareSchichten } from '../domain/formular.js';
import { Eingabefehler, STATUS_TEXT } from '../domain/eingabe.js';
import { html, mehrzeilig, Roh } from './html.js';
import { k, aktuellerPfad } from './kontext.js';
import { formFelder, seite, seitenKopf } from './views/layout.js';
import { bestaetigenFrage, datumZeit, kachel, punktMarke, zeitraum } from './views/teile.js';
import { besetzenPfad } from './views/besetzen.js';
import { formularAnsicht } from '../domain/formular-ansicht.js';
import { id as leseId } from '../domain/eingabe.js';
import { sicheresZiel } from './kontext.js';
import { anmeldeformularHtml } from './views/anmeldeformular.js';

const GRENZE = 300;

export function registriereFormular(app: Express, deps: Abhaengigkeiten): void {
  const { db, konfig } = deps;

  app.get('/formular', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const hier = aktuellerPfad(req);
    const filter: EingangFilter = (EINGANG_FILTER as readonly string[]).includes(String(req.query.filter)) ? (req.query.filter as EingangFilter) : 'alle';
    const alleEingaenge = await formularEingaenge(db, GRENZE);
    const liste = alleEingaenge.filter((e) => passtZuFilter(e, filter));
    const sichtbar = await sichtbareSchichten(db);
    const link = `${konfig.baseUrl}/anmeldung`;

    // Schichten im Formular, nach Einsatz gruppiert.
    const einsaetze = new Map<number, { name: string; schichten: typeof sichtbar }>();
    for (const s of sichtbar) {
      if (!einsaetze.has(s.einsatz_id)) einsaetze.set(s.einsatz_id, { name: s.einsatz_name, schichten: [] });
      einsaetze.get(s.einsatz_id)!.schichten.push(s);
    }

    const person = (e: Eingang) => {
      if (e.person_id !== null) {
        return html`<a href="/personen/${e.person_id}">${e.rang_name ? html`<span class="rang">${e.rang_name}</span> ` : ''}${`${e.person_vorname ?? ''} ${e.person_nachname ?? ''}`.trim() || e.name}</a>`;
      }
      if (e.zugeordnet_id !== null) return html`<a href="/personen/${e.zugeordnet_id}">zugeordnet (ID ${e.zugeordnet_id})</a>`;
      if (e.treffer) return html`<span class="orange-text">Mehrdeutig: IDs ${e.treffer}</span>`;
      if (istUnbekannt(e)) {
        const erste = e.schichten.find((s) => s.anmeldung_id !== null && s.anmeldung_person_id === null);
        return html`<span class="rot-text">Unbekannt</span> <a class="knopf klein" href="/anmeldungen/unbekannt#e${erste!.anmeldung_id}">Zuordnen</a>`;
      }
      return html`<span class="unter">keine Person</span>`;
    };

    const schichtZeile = (e: Eingang, s: Eingang['schichten'][number]) => {
      const pid = e.person_id ?? s.anmeldung_person_id;
      const status = s.status;
      const ziel = besetzenPfad(s.einsatz_id, s.schicht_id, 'alle');
      const kachelLink = s.anmeldung_id === null
        ? html`<span class="kachel-leer" title="Eintrag entfernt">${kachel(null)}</span>`
        : pid !== null
          ? html`<a href="/rueckmeldungen/eintrag?schicht=${s.schicht_id}&amp;person=${pid}&amp;zurueck=${encodeURIComponent(hier)}" data-eintrag${bestaetigenFrage({ id: s.anmeldung_id, version: s.version, status }, e.name ?? '')} title="${STATUS_TEXT[status!]} – Klick zum ${status === 'angemeldet' ? 'Bestätigen' : 'Eintragen'}">${kachel(status)}<span class="sr">${STATUS_TEXT[status!]}</span></a>`
          : html`<a href="${ziel}" title="${STATUS_TEXT[status!]} – in «Besetzen» bearbeiten">${kachel(status)}<span class="sr">${STATUS_TEXT[status!]}</span></a>`;
      return html`<li class="eingang-schicht">
  ${kachelLink}
  <span class="eingang-schicht-text"><a href="${ziel}">${s.einsatz_name}${s.schicht_name !== s.einsatz_name ? ` · ${s.schicht_name}` : ''}</a> <span class="unter">${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)}</span>
  ${s.anmeldung_id === null ? html` ${punktMarke('Eintrag entfernt', 'grau')}` : s.neu ? '' : html` ${punktMarke('war schon eingetragen', 'grau')}`}</span>
</li>`;
    };

    const bemerkungen = (e: Eingang) => {
      const texte = [...new Set(e.schichten.map((s) => s.bemerkung).filter((b): b is string => !!b))];
      return texte.length ? texte.map((t) => html`<p class="bemerkung">${mehrzeilig(t)}</p>`) : html`<span class="unter">–</span>`;
    };

    const zahl = Object.fromEntries(EINGANG_FILTER.map((f) => [f, alleEingaenge.filter((e) => passtZuFilter(e, f)).length])) as Record<EingangFilter, number>;

    res.send(seite(kx, 'Formular', 'formular', html`
${seitenKopf({
  titel: 'Formular',
  angaben: ['Jedes Ausfüllen des Anmeldeformulars einzeln, das neueste zuerst.'],
  aktionen: html`<a class="knopf haupt" href="/anmeldung" target="_blank" rel="noopener">Formular öffnen</a>`,
})}
<section class="formular-uebersicht" aria-labelledby="fk-titel">
  <h2 id="fk-titel" class="sr">Formular</h2>
  <div class="formular-link">
    <label for="formular-link">Link zum Formular</label>
    <div class="zeilen-form"><input id="formular-link" class="wachsen" readonly value="${link}"><button type="button" class="knopf" data-kopieren="#formular-link">Kopieren</button></div>
  </div>
  <div class="formular-sichtbar">
    <h3>Im Formular sichtbar</h3>
    ${einsaetze.size ? html`<ul>${[...einsaetze].map(([id, x]) => html`<li><a href="/einsaetze/${id}/schichten">${x.name}</a> <span class="unter">${x.schichten.length === 1 ? zeitraum(x.schichten[0].start_zeit, x.schichten[0].end_zeit) : `${x.schichten.length} Schichten: ${x.schichten.map((s) => s.name).join(', ')}`}</span></li>`)}</ul>`
      : html`<p class="leer">Keine Schicht ist im Formular sichtbar. Schalte «Publiziert» im Reiter «Schichten» eines Einsatzes ein.</p>`}
  </div>
</section>
<div class="titelzeile filterzeile">
  <p class="filter-chips">${EINGANG_FILTER.map((f) => html`<a href="/formular${f === 'alle' ? '' : `?filter=${f}`}"${filter === f ? new Roh(' aria-current="page"') : ''}>${EINGANG_FILTER_TEXT[f]} ${zahl[f]}</a>`)}</p>
  ${liste.length ? html`<input type="search" class="suche" data-filter=".eingang-tabelle tbody tr" placeholder="Name oder Einsatz suchen …" aria-label="Eingänge suchen">` : ''}
</div>
${!liste.length ? html`<p class="leer">${alleEingaenge.length ? 'Kein Eingang in diesem Filter.' : 'Noch niemand hat das Formular ausgefüllt.'}</p>` : html`<div class="rahmen"><table class="tabelle eingang-tabelle">
  <thead><tr><th>Eingang</th><th>Eingegeben</th><th>Person</th><th>Schichten</th><th>Bemerkung</th></tr></thead>
  <tbody>${liste.map((e) => html`<tr data-suche="${`${e.name ?? ''} ${e.person_vorname ?? ''} ${e.person_nachname ?? ''} ${e.schichten.map((s) => `${s.einsatz_name} ${s.schicht_name}`).join(' ')}`.toLowerCase()}">
    <td class="nowrap">${datumZeit(e.zeit)}${e.nachgetragen ? html`<br><span class="unter" title="Eingang vor dem 20.11.2026. Die Bemerkung ist nicht bekannt.">nachgetragen</span>` : ''}
      <br><a class="knopf klein eingang-ansicht" href="/formular/eingang/${e.id}?zurueck=${encodeURIComponent(hier)}" data-eintrag data-fenster="breit" title="Formular so zeigen, wie es ausgefüllt war">Ansicht</a>
      <a class="knopf klein gefahr eingang-loeschen" href="/formular/eingang/${e.id}/loeschen?zurueck=${encodeURIComponent(hier)}" data-eintrag title="Eingang mit seinen Einträgen vollständig löschen">Löschen</a></td>
    <td><strong>${e.name ?? ''}</strong></td>
    <td>${person(e)}</td>
    <td><ul class="eingang-schichten">${e.schichten.map((s) => schichtZeile(e, s))}</ul></td>
    <td class="eingang-bemerkung">${bemerkungen(e)}</td>
  </tr>`)}</tbody>
</table></div>${alleEingaenge.length >= GRENZE ? html`<p class="unter">Die Seite zeigt die ${GRENZE} neuesten Eingänge.</p>` : ''}`}`, { breit: true }));
  });

  // Eingang vollständig löschen (Wunsch Yann 26.11.2026). Rückfrage im Fenster, ohne Skript als eigene Seite.
  // Mit Header «X-Fragment: 1» nur der Inhalt (für das Fenster).
  app.get('/formular/eingang/:id/loeschen', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const ziel = sicheresZiel(req.query.zurueck, '/formular');
    const v = await eingangLoeschenVorschau(db, leseId(req.params.id, 'Eingang'));
    const name = v.name ?? '';
    const inhalt = html`<div class="eintrag-fenster eingang-loeschen-fenster">
  <header class="eintrag-kopf">
    <div>
      <h2>Eingang löschen?</h2>
      <p class="unter">${name} · ausgefüllt am ${datumZeit(v.zeit)}</p>
    </div>
    <button type="button" class="toast-zu" data-fenster-zu aria-label="Fenster schliessen">×</button>
  </header>
  <p class="meldung fehler">Das Tool löscht den Eingang vollständig. Das lässt sich nicht rückgängig machen.</p>
  ${v.loeschen.length ? html`<p>Diese Einträge löscht das Tool mit ihrem Verlauf. Die Person gilt dort danach als «nicht gefragt».</p>
  <ul class="eingang-schichten">${v.loeschen.map((x) => html`<li class="eingang-schicht">${kachel(x.status)}<span class="eingang-schicht-text">${x.einsatz_name}${x.schicht_name !== x.einsatz_name ? ` · ${x.schicht_name}` : ''} <span class="unter">${zeitraum(x.start_zeit, x.end_zeit, x.zeit_offen)} · ${STATUS_TEXT[x.status]}</span></span></li>`)}</ul>`
    : html`<p>Der Eingang hat keine Einträge mehr. Das Tool löscht nur den Eingang.</p>`}
  ${v.bleiben ? html`<p class="unter">${v.bleiben === 1 ? 'Ein Eintrag bestand schon vor dem Eingang. Er bleibt.' : `${v.bleiben} Einträge bestanden schon vor dem Eingang. Sie bleiben.`}</p>` : ''}
  <form method="post" action="/formular/eingang/${v.id}/loeschen" class="stapel">
    ${formFelder(kx, ziel)}
    <label class="haken"><input type="checkbox" name="bestaetigt" value="1" required> Ja, Eingang vollständig löschen</label>
    <div class="knopfreihe"><button class="knopf gefahr" type="submit">Löschen</button> <a class="knopf" href="${ziel}" data-fenster-zu>Abbrechen</a></div>
  </form>
</div>`;
    if (req.get('x-fragment') === '1') {
      res.type('html').send(inhalt.toString());
      return;
    }
    res.send(seite(kx, 'Eingang löschen', 'formular', html`${seitenKopf({ pfad: [{ text: 'Formular', href: ziel }, { text: name }], titel: 'Eingang löschen' })}<div class="karte eintrag-seite">${inhalt}</div>`));
  });

  app.post('/formular/eingang/:id/loeschen', nurAufgebot, async (req, res) => {
    if (req.body?.bestaetigt !== '1') throw new Eingabefehler('Bestätige das Löschen mit dem Häkchen.');
    const v = await loescheEingang(db, leseId(req.params.id, 'Eingang'));
    const n = v.loeschen.length;
    zurueck(req, res, '/formular', `Eingang gelöscht${n ? ` (${n === 1 ? '1 Eintrag' : `${n} Einträge`})` : ''}.`);
  });

  // Ansicht eines Eingangs (Wunsch Yann 23.11.2026): das Formular so, wie es beim Ausfüllen aussah. Nur lesen.
  // Mit Header «X-Fragment: 1» nur der Inhalt (für das Fenster), sonst eine ganze Seite (ohne Skript).
  app.get('/formular/eingang/:id', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const ziel = sicheresZiel(req.query.zurueck, '/formular');
    const a = await formularAnsicht(db, leseId(req.params.id, 'Eingang'));
    const name = a.geloescht ? (a.name ?? '') : `${a.vorname} ${a.nachname}`.trim() || (a.name ?? '');
    const hinweis = a.art === 'momentaufnahme'
      ? html`<p class="meldung ok">So sah das Formular beim Absenden aus (Momentaufnahme vom ${datumZeit(a.zeit)}).</p>`
      : html`<div class="meldung hinweis"><p><strong>Rekonstruiert.</strong> Dieser Eingang ist älter als die Momentaufnahme. Das Tool zeigt die Einsätze und Schichten mit ihren heutigen Angaben.</p>
  <p>Gezeigt sind die gewählten Schichten und die heute publizierten Schichten, die beim Eingang noch nicht vorbei waren. Welche Schichten damals wirklich publiziert waren, ist nicht bekannt. Gelöschte Schichten fehlen.</p>
  ${a.vorname || a.nachname ? html`<p>Vorname und Nachname sind beim ersten Leerzeichen getrennt.</p>` : ''}
  ${a.bemerkungAusProtokoll ? html`<p>Die Bemerkung stammt aus dem Statusprotokoll der Anmeldung (erster Wert).</p>` : a.nachgetragen ? html`<p>Die Bemerkung ist für Eingänge vor dem 20.11.2026 nicht immer bekannt.</p>` : ''}</div>`;
    const inhalt = html`<div class="eintrag-fenster formular-ansicht">
  <header class="eintrag-kopf">
    <div>
      <h2>Formular von ${name}</h2>
      <p class="unter">Ausgefüllt am ${datumZeit(a.zeit)}${a.person_id !== null ? html` · <a href="/personen/${a.person_id}">Personenseite</a>` : ''}</p>
    </div>
    <button type="button" class="toast-zu" data-fenster-zu aria-label="Fenster schliessen">×</button>
  </header>
  ${hinweis}
  ${a.geloescht ? html`<p class="meldung hinweis">Die Personendaten sind gelöscht. Name und Bemerkungen fehlen.</p>` : ''}
  ${a.spaeter.length ? html`<div class="meldung hinweis bemerkung-geaendert"><p><strong>Bemerkung später bearbeitet.</strong> Das Formular unten zeigt die Original-Bemerkung.</p>
    <ul>${a.spaeter.map((x) => html`<li><span class="unter">${x.einsatz_name}${x.schicht_name !== x.einsatz_name ? ` · ${x.schicht_name}` : ''} · ${datumZeit(x.zeit)}${x.benutzer ? ` · ${x.benutzer}` : ''}</span>
      <div class="bemerkung-vergleich"><div><span class="unter">Original</span><p>${x.original ? mehrzeilig(x.original) : '–'}</p></div><div><span class="unter">Heute</span><p>${x.aktuell ? mehrzeilig(x.aktuell) : '–'}</p></div></div></li>`)}</ul></div>` : ''}
  <div class="formular-vorschau">${anmeldeformularHtml(a.schichten, { vorname: a.vorname, nachname: a.nachname, bemerkungen: a.bemerkungen, schichten: a.gewaehlt.map(String) }, { art: 'ansicht' })}</div>
  <p class="knopfreihe"><a class="knopf" href="${ziel}" data-fenster-zu>Schliessen</a></p>
</div>`;
    if (req.get('x-fragment') === '1') {
      res.type('html').send(inhalt.toString());
      return;
    }
    res.send(seite(kx, `Formular von ${name}`, 'formular', html`${seitenKopf({ pfad: [{ text: 'Formular', href: ziel }, { text: name }], titel: 'Eingang' })}<div class="karte eintrag-seite">${inhalt}</div>`));
  });
}

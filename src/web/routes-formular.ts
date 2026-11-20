// Seite «Formular» (Wunsch Yann 20.11.2026): jedes Ausfüllen des Anmeldeformulars einzeln,
// dazu der Link zum Formular und die Schichten, die das Formular gerade zeigt.
import type { Express } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot } from './app.js';
import { EINGANG_FILTER, EINGANG_FILTER_TEXT, formularEingaenge, istUnbekannt, passtZuFilter, type Eingang, type EingangFilter } from '../domain/formular-eingaenge.js';
import { sichtbareSchichten } from '../domain/formular.js';
import { STATUS_TEXT } from '../domain/eingabe.js';
import { html, mehrzeilig, Roh } from './html.js';
import { k, aktuellerPfad } from './kontext.js';
import { seite, seitenKopf } from './views/layout.js';
import { bestaetigenFrage, datumZeit, kachel, punktMarke, zeitraum } from './views/teile.js';
import { besetzenPfad } from './views/besetzen.js';

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
<section class="formular-kopf" aria-labelledby="fk-titel">
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
    <td class="nowrap">${datumZeit(e.zeit)}${e.nachgetragen ? html`<br><span class="unter" title="Eingang vor dem 20.11.2026. Die Bemerkung ist nicht bekannt.">nachgetragen</span>` : ''}</td>
    <td><strong>${e.name ?? ''}</strong></td>
    <td>${person(e)}</td>
    <td><ul class="eingang-schichten">${e.schichten.map((s) => schichtZeile(e, s))}</ul></td>
    <td class="eingang-bemerkung">${bemerkungen(e)}</td>
  </tr>`)}</tbody>
</table></div>${alleEingaenge.length >= GRENZE ? html`<p class="unter">Die Seite zeigt die ${GRENZE} neuesten Eingänge.</p>` : ''}`}`, { breit: true }));
  });
}

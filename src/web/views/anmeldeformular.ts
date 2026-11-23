// Inhalt des öffentlichen Anmeldeformulars (15). Zwei Arten:
// «ausfuellen» = das echte Formular, «ansicht» = ein Eingang so, wie die Person ihn ausgefüllt hat (nur lesen).
import type { FormularSchicht } from '../../domain/formular.js';
import { html, mehrzeilig, angehakt, Roh } from '../html.js';
import { lokalesDatum, wochentagKurz, zeitraumText } from '../../domain/zeit.js';

const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export interface FormularWerte {
  vorname?: string;
  nachname?: string;
  /** Bemerkung je Einsatz, Schlüssel = Einsatz-ID. */
  bemerkungen?: Record<string, string>;
  schichten?: string[];
}

export type FormularArt = { art: 'ausfuellen'; token: string } | { art: 'ansicht' };

/** Einstellung des Einsatzes: Im Formular ist nur eine Schicht wählbar (Auswahlknöpfe statt Häkchen). */
function nurEine(liste: FormularSchicht[]): boolean {
  return Number(liste[0].einsatz_formular_mehrere) === 0;
}

function hinweisVorgaben(s: FormularSchicht): string {
  const teile: string[] = [];
  if (s.min_alter !== null && s.min_alter !== undefined) teile.push(`Nur ${s.min_alter}+`);
  if (s.min_rang_name) teile.push(`ab ${s.min_rang_name}`);
  return teile.join(' · ');
}

/** Kopf, Felder und Schichten des Formulars. Die Ansicht hat keine Eingabe und keinen Knopf «Anmelden». */
export function anmeldeformularHtml(schichten: FormularSchicht[], werte: FormularWerte, art: FormularArt, fehler: string | null = null): Roh {
  const ansicht = art.art === 'ansicht';
  // In der Ansicht liegt das Formular in einer Seite des Tools. Eigene IDs verhindern doppelte IDs.
  const vor = ansicht ? 'fa-' : '';
  const nurLesen = ansicht ? new Roh(' readonly') : new Roh('');
  const gesperrt = ansicht ? new Roh(' disabled') : new Roh('');
  const gewaehlt = new Set(werte.schichten ?? []);
  const gruppen = new Map<number, FormularSchicht[]>();
  for (const s of schichten) {
    if (!gruppen.has(s.einsatz_id)) gruppen.set(s.einsatz_id, []);
    gruppen.get(s.einsatz_id)!.push(s);
  }
  const felder = html`
  <section class="formular-karte">
    <h2 class="formular-schritt"><span>1</span> Deine Angaben</h2>
    <div class="formular-namen">
      <div class="feld"><label for="${vor}vorname">Vorname</label><input id="${vor}vorname" name="vorname" required maxlength="100" autocomplete="given-name" value="${werte.vorname ?? ''}"${nurLesen}></div>
      <div class="feld"><label for="${vor}nachname">Nachname</label><input id="${vor}nachname" name="nachname" required maxlength="100" autocomplete="family-name" value="${werte.nachname ?? ''}"${nurLesen}></div>
    </div>
  </section>
  <fieldset class="schichten">
    <legend class="formular-schritt"><span>2</span> Einsätze und Schichten</legend>
    ${[...gruppen.values()].map((liste) => html`
    <section class="formular-karte einsatz-gruppe">
      <h3>${liste[0].einsatz_name}</h3>
      ${liste[0].einsatz_bemerkung_extern ? html`<p class="einsatz-info">${mehrzeilig(liste[0].einsatz_bemerkung_extern)}</p>` : ''}
      ${nurEine(liste) ? html`<p class="nur-eine">Wähle höchstens eine Schicht.</p>` : ''}
      <div class="schicht-liste">
      ${liste.map((s) => html`
      <label class="schicht-wahl">
        ${nurEine(liste)
          ? html`<input type="radio" name="schicht_${s.einsatz_id}" value="${s.id}"${angehakt(gewaehlt.has(String(s.id)))}${gesperrt}>`
          : html`<input type="checkbox" name="schichten" value="${s.id}"${angehakt(gewaehlt.has(String(s.id)))}${gesperrt}>`}
        <span class="schicht-datum" aria-hidden="true"><small>${wochentagKurz(s.start_zeit)}</small><strong>${lokalesDatum(s.start_zeit).slice(8, 10)}</strong><small>${MONATE[Number(lokalesDatum(s.start_zeit).slice(5, 7)) - 1]}</small></span>
        <span class="schicht-text">
          <strong>${s.name}</strong>
          <span class="zeit">${zeitraumText(s.start_zeit, s.end_zeit)}</span>
          ${hinweisVorgaben(s) ? html`<span class="vorgabe">${hinweisVorgaben(s)}</span>` : ''}
          ${s.bemerkung_extern ? html`<span class="bemerkung">${mehrzeilig(s.bemerkung_extern)}</span>` : ''}
        </span>
        <span class="schicht-haken" aria-hidden="true"></span>
        ${ansicht && gewaehlt.has(String(s.id)) ? html`<span class="sr">gewählt</span>` : ''}
      </label>`)}
      ${nurEine(liste) ? html`
      <label class="schicht-wahl keine-schicht">
        <input type="radio" name="schicht_${liste[0].einsatz_id}" value=""${angehakt(!liste.some((s) => gewaehlt.has(String(s.id))))}${gesperrt}>
        <span class="schicht-text"><strong>Keine Schicht in diesem Einsatz</strong></span>
        <span class="schicht-haken" aria-hidden="true"></span>
      </label>` : ''}
      </div>
      <div class="feld einsatz-bemerkung"><label for="${vor}bemerkung_${liste[0].einsatz_id}">Bemerkungen</label><textarea id="${vor}bemerkung_${liste[0].einsatz_id}" name="bemerkung_${liste[0].einsatz_id}" maxlength="2000" rows="2"${nurLesen}>${werte.bemerkungen?.[String(liste[0].einsatz_id)] ?? ''}</textarea></div>
    </section>`)}
  </fieldset>`;

  return html`
<header class="formular-kopf">
  <h1>Anmeldung für Einsätze</h1>
  <p>Verkehrskadetten · Kadetten-Korps Basel</p>
</header>
${fehler ? html`<div class="meldung fehler" role="alert">${fehler}</div>` : ''}
${schichten.length === 0
    ? html`<div class="formular-karte formular-leer"><p>Zurzeit sind keine Einsätze offen.</p></div>`
    : art.art === 'ausfuellen'
      ? html`<form method="post" action="/anmeldung" class="formular-form">
  <input type="hidden" name="token" value="${art.token}">
  <div class="falle" aria-hidden="true">
    <label>Webseite <input type="text" name="webseite" tabindex="-1" autocomplete="off"></label>
  </div>
  ${felder}
  <div class="formular-senden"><button type="submit" class="knopf haupt">Anmelden</button></div>
</form>`
      : html`<div class="formular-form">${felder}</div>`}`;
}

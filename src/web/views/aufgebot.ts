// Aufgebot als Druckseite: ein Brief je bestätigter Person und Schicht, je Brief eine A4-Seite (20).
// Layout nach der Briefvorlage von Yann (26.11.2026).
import { FEST, type AufgebotDaten } from '../../domain/aufgebot-vorlage.js';
import { zeileAlsHtml } from '../../domain/textformat.js';
import { html, mehrzeilig, Roh } from '../html.js';
import { START_ID } from '../wartung.js';
import { druckseite } from './layout.js';
import { warnungen } from './teile.js';

// Wunsch Yann 26.11.2026: Die Tabelle ist immer vollständig. Ein fehlender Wert ergibt eine leere Zelle.
const zeile = (titel: string, wert: string | Roh | Roh[] | null) => html`<tr><th>${titel}</th><td>${wert ?? ''}</td></tr>`;

/** Die Aufgebotsadresse im Text erscheint als mailto-Link (wie in der Vorlage). */
function mitMail(text: string): Roh[] {
  return text.split(FEST.mail).map((t, i) => html`${i ? html`<a href="mailto:${FEST.mail}">${FEST.mail}</a>` : ''}${t}`);
}

/** Briefe einer Schicht. */
function briefeHtml(d: AufgebotDaten): Roh[] {
  const briefe = d.briefe.map((b) => html`
<article class="brief">
  ${b.adresseFehlt ? html`<p class="brief-warnung nicht-drucken">Adresse fehlt</p>` : ''}
  <div class="brief-kopf">
    <img class="brief-logo" src="/static/brief-logo.png?v=${START_ID}" alt="Logo Kadetten-Korps Basel" width="991" height="832">
    <div class="absender"><strong>${FEST.absender[0]}</strong><br>${FEST.absender.slice(1).map((z, i) => html`${i ? html`<br>` : ''}${z}`)}</div>
  </div>
  <div class="brief-adresszeile">
    <div class="ansprechperson"><strong class="ap-titel">${FEST.ansprechpersonTitel}</strong>${FEST.ansprechperson.map((z, i) => html`${i ? html`<br>` : ''}${z}`)}</div>
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
    ${d.hinweis ? html`<tr><th>Hinweis</th><td>${mehrzeilig(d.hinweis)}</td></tr>` : ''}
    ${zeile('Einsatzleitung', d.einsatzleitung.map((z, i) => html`${i ? html`<br>` : ''}${z}`))}
    ${zeile('Tenue', d.tenue ? new Roh(zeileAlsHtml(d.tenue)) : null)}
  </table>
  ${FEST.schluss.map((z) => html`<p>${mitMail(z)}</p>`)}
  <p class="gruss">${FEST.gruss}</p>
  <p class="unterschrift"><strong>${FEST.unterschrift[0]}</strong><br>${FEST.unterschrift.slice(1).map((z, i) => html`${i ? html`<br>` : ''}${z}`)}</p>
</article>`);
  return briefe;
}

/** Druckseite mit den Briefen einer oder mehrerer Schichten (ganzer Einsatz). */
export function aufgebotSeite(liste: AufgebotDaten[], titel: string, zurueckHref: string): string {
  const anzahl = liste.reduce((n, d) => n + d.briefe.length, 0);
  const mehrere = liste.length > 1;
  const luecken = liste.filter((d) => d.luecken.length).map((d) => html`${mehrere ? html`<h3>${d.titel}</h3>` : ''}${warnungen(d.luecken)}`);
  return druckseite(titel, html`
<div class="druck-steuerung nicht-drucken">
  <a href="${zurueckHref}">← Zurück</a>
  <button type="button" class="knopf haupt" data-drucken>Drucken</button>
  <span>${anzahl} ${anzahl === 1 ? 'Brief' : 'Briefe'}</span>
</div>
${luecken.length ? html`<div class="luecken nicht-drucken"><h2>Lücken vor dem Druck</h2>${luecken}</div>` : ''}
${anzahl ? liste.map(briefeHtml) : html`<p class="nicht-drucken">Keine bestätigten Personen.</p>`}`, 'aufgebot', 'brief-druck.css');
}

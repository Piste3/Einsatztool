// Wiederverwendbare Bausteine der Oberfläche.
import { html, Roh } from '../html.js';
import { STATUS_TEXT, KANAL_TEXT, STATUS, KANAELE, type Kanal, type Status } from '../../domain/eingabe.js';
import { hauptnummer, telLink, telefonText, whatsappNummer } from '../../domain/personen.js';
import { sollFarbe } from '../../domain/zaehlung.js';
import type { Warnung } from '../../domain/warnungen.js';
import type { AbgleichErgebnis } from '../../domain/ical-abgleich.js';
import { datumChVonIso, lokalesDatum, lokaleZeit, wochentagKurz, zeitraumText } from '../../domain/zeit.js';

/** Symbole je Status (Legende in Matrix und Rückmeldungen). */
export const STATUS_SYMBOL: Record<Status, string> = {
  bestaetigt: '✔',
  angemeldet: '●',
  unsicher: '?',
  nachricht_gesendet: '✉',
  abgemeldet: '✖',
};

export function statusMarke(status: Status | null): Roh {
  if (!status) return html`<span class="status leer" title="nicht gefragt">·</span>`;
  return html`<span class="status s-${status}" title="${STATUS_TEXT[status]}">${STATUS_SYMBOL[status]}</span>`;
}

export function statusText(status: Status): Roh {
  return html`<span class="pille s-${status}"><span class="punkt-marke" aria-hidden="true"></span>${STATUS_TEXT[status]}</span>`;
}

export function legende(): Roh {
  return html`<p class="legende">${STATUS.map((s) => html`<span>${statusMarke(s)} ${STATUS_TEXT[s]}</span>`)}<span>${statusMarke(null)} nicht gefragt</span></p>`;
}

export function statusAuswahl(name: string, aktuell: Status | null, mitLeer = false): Roh {
  return html`<select name="${name}">${mitLeer ? html`<option value="">–</option>` : ''}${STATUS.map(
    (s) => html`<option value="${s}"${s === aktuell ? new Roh(' selected') : ''}>${STATUS_TEXT[s]}</option>`,
  )}</select>`;
}

export function kanalAuswahl(name: string, aktuell: Kanal | null, ohneFormular = false): Roh {
  return html`<select name="${name}">${KANAELE.filter((k) => !ohneFormular || k !== 'formular' || aktuell === 'formular').map(
    (k) => html`<option value="${k}"${k === aktuell ? new Roh(' selected') : ''}>${KANAL_TEXT[k]}</option>`,
  )}</select>`;
}

export function rolleAuswahl(name: string, rollen: { name: string }[], aktuell: string | null): Roh {
  return html`<select name="${name}"><option value="">– keine –</option>${rollen.map(
    (r) => html`<option value="${r.name}"${r.name === aktuell ? new Roh(' selected') : ''}>${r.name}</option>`,
  )}</select>`;
}

/** Ist / Soll mit Farbe und kleinem Balken. */
export function istSoll(ist: number, soll: number | null): Roh {
  const farbe = sollFarbe(ist, soll);
  const prozent = soll && soll > 0 ? Math.min(100, Math.round((ist / soll) * 100)) : 0;
  return html`<span class="ist-soll f-${farbe}"><span class="zahl">${ist}${soll !== null ? html` / ${soll}` : ''}</span>${
    soll !== null ? html`<span class="balken"><span class="b${Math.round(prozent / 10) * 10}"></span></span>` : ''
  }</span>`;
}

export function warnungen(liste: Warnung[] | undefined): Roh {
  if (!liste || !liste.length) return html``;
  return html`<ul class="warnungen">${liste.map((w) => html`<li title="${w.code}">⚠ ${w.text}</li>`)}</ul>`;
}

/** Punkt für den Abgleich mit Clubdesk (17.4.6): grün, rot oder grau. */
export function abgleichPunkt(a: AbgleichErgebnis): Roh {
  const text: Record<string, string> = {
    ok: 'Clubdesk-Termin gefunden',
    zeit_abweicht: 'Zeiten in Clubdesk weichen ab',
    fehlt: 'Kein Clubdesk-Termin gefunden',
    unbekannt: 'Abgleich nicht verfügbar',
  };
  const farbe = a.status === 'ok' ? 'gruen' : a.status === 'unbekannt' ? 'grau' : 'rot';
  return html`<span class="punkt p-${farbe}" title="${text[a.status]}"></span><span class="sr">${text[a.status]}</span>`;
}

/** Telefon: jede Nummer ist ein Anruf-Link, daneben WhatsApp (wa.me). */
export function telefon(p: { telefon: string | null; telefon_privat: string | null }): Roh {
  const nummern = [p.telefon, p.telefon_privat].filter((n): n is string => !!n && !!n.trim());
  if (!nummern.length) return html``;
  return html`<span class="telefon">${nummern.map((n, i) => {
    const wa = whatsappNummer(n);
    return html`${i > 0 ? ' / ' : ''}<a href="tel:${telLink(n)}">${n}</a>${wa ? html` <a class="wa" href="https://wa.me/${wa}" title="WhatsApp-Chat" rel="noopener noreferrer" target="_blank">💬</a>` : ''}`;
  })}</span>`;
}

export { telefonText, hauptnummer };

/** Zeitraum für die Anzeige. Mit «offen» (Schicht ohne Zeiten): nur die Daten und «Zeit offen». */
export function zeitraum(start: string, ende: string, offen?: number | boolean): string {
  if (!offen || !Number(offen)) return zeitraumText(start, ende);
  const tag = (iso: string) => `${wochentagKurz(iso)} ${datumChVonIso(iso)}`;
  const b = lokaleZeit(start) === '00:00' ? '' : lokaleZeit(start);
  const e = lokaleZeit(ende) === '23:59' ? '' : lokaleZeit(ende);
  const zeiten = b || e ? `${b || '?'}–${e || '?'} (Zeit offen)` : 'Zeit offen';
  return lokalesDatum(start) === lokalesDatum(ende) ? `${tag(start)}, ${zeiten}` : `${tag(start)} – ${tag(ende)}, ${zeiten}`;
}

export function datumZeit(iso: string | null): string {
  return iso ? `${datumChVonIso(iso)} ${lokaleZeit(iso)}` : '';
}

/** Rang vor dem Namen. */
export function nameMitRang(p: { rang_name?: string | null; vorname: string | null; nachname: string | null }): Roh {
  return html`${p.rang_name ? html`<span class="rang">${p.rang_name}</span> ` : ''}${`${p.vorname ?? ''} ${p.nachname ?? ''}`.trim()}`;
}

/** Statistik-Karte. */
export function karte(titel: string, wert: unknown, klasse = ''): Roh {
  return html`<div class="zahl-karte ${klasse}"><span class="wert">${wert as string}</span><span class="titel">${titel}</span></div>`;
}

export function knopfPost(k: { csrf: string }, action: string, text: string, felder: Record<string, string> = {}, klasse = 'knopf', zurueck?: string): Roh {
  return html`<form method="post" action="${action}" class="inline">
    <input type="hidden" name="_csrf" value="${k.csrf}">
    ${zurueck ? html`<input type="hidden" name="zurueck" value="${zurueck}">` : ''}
    ${Object.entries(felder).map(([n, v]) => html`<input type="hidden" name="${n}" value="${v}">`)}
    <button type="submit" class="${klasse}">${text}</button>
  </form>`;
}

/** Kleine Marke mit farbigem Punkt, z. B. «Bestätigen» im Cockpit. */
export function punktMarke(text: string, farbe: 'orange' | 'blau' | 'rot' | 'gruen' | 'grau'): Roh {
  return html`<span class="pille punkt-${farbe}"><span class="punkt-marke" aria-hidden="true"></span>${text}</span>`;
}

/** Publiziert-Marke neben einem Titel. */
export function publiziertMarke(publiziert: boolean): Roh {
  return publiziert ? punktMarke('Publiziert', 'gruen') : punktMarke('Nicht publiziert', 'grau');
}

// ---------- Kacheln für die Seite «Rückmeldungen» ----------

const KACHEL_SVG: Record<Status | 'gleich' | 'moeglich', string> = {
  angemeldet: '<path d="M6 12.5l4 4 8-9"/>',
  bestaetigt: '<path d="M6 12.5l4 4 8-9"/>',
  abgemeldet: '<path d="M7 7l10 10M17 7L7 17"/>',
  nachricht_gesendet: '<path d="M5 18.5l1.2-3.6A7 7 0 1 1 9 18z"/>',
  unsicher: '<path d="M8.5 8.8a3.5 3.5 0 1 1 4.9 3.2c-.8.4-1.4 1.1-1.4 2v.6M12 18.5h.01"/>',
  gleich: '<path d="M8 12h8"/>',
  moeglich: '<circle cx="12" cy="12" r="3.6"/>',
};

export type KachelArt = Status | 'gleich' | 'moeglich' | null;

/** Text zu einer Kachel, für Legende und Tooltip. */
export const KACHEL_TEXT: Record<Status | 'gleich' | 'moeglich' | 'offen', string> = {
  angemeldet: 'An',
  bestaetigt: 'Bestätigt',
  abgemeldet: 'Ab',
  nachricht_gesendet: 'Nachricht gesendet',
  unsicher: 'Unsicher',
  offen: 'Offen',
  gleich: 'Andere Schicht, gleiche Zeit',
  moeglich: 'Andere Schicht, zeitlich möglich',
};

/** Quadratische Kachel mit Symbol. Ohne Art: leere, gestrichelte Kachel («Offen»). */
export function kachel(art: KachelArt): Roh {
  if (!art) return new Roh('<span class="kachel k-offen" aria-hidden="true"></span>');
  return new Roh(
    `<span class="kachel k-${art}" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${KACHEL_SVG[art]}</svg></span>`,
  );
}

/** Legende der Kacheln. Nur bestehende Status, dazu Offen und die zwei Hinweise zu anderen Schichten. */
export function kachelLegende(): Roh {
  const arten: (Status | 'gleich' | 'moeglich' | 'offen')[] = ['angemeldet', 'bestaetigt', 'abgemeldet', 'nachricht_gesendet', 'unsicher', 'offen', 'gleich', 'moeglich'];
  return html`<p class="legende kachel-legende"><strong>Legende</strong>${arten.map((a) => html`<span>${kachel(a === 'offen' ? null : a)} ${KACHEL_TEXT[a]}</span>`)}</p>`;
}

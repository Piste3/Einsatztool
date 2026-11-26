// Einsatz › Besetzen (Konzept «Bedienung im Einsatz», OK Yann 20.11.2026).
// Eine Liste für Neue, Offene und nicht Gefragte. Speichern läuft über die bestehenden Routen.
import type { Request } from 'express';
import type { Db } from '../../db/db.js';
import {
  BESETZEN_FILTER, BESETZEN_FILTER_TEXT, besetzenDaten, filtereBesetzen, vorgabeFilter, zaehleBesetzen,
  type BesetzenEintrag, type BesetzenFilter, type BesetzenSchicht, type BesetzenZeile,
} from '../../domain/besetzen.js';
import { sollFarbe, zahlenFuerSchichten } from '../../domain/zaehlung.js';
import { personAuswahlText, personenListe } from '../../domain/personen.js';
import { rollen as ladeRollen } from '../../domain/stammdaten.js';
import { STATUS_TEXT, type Status } from '../../domain/eingabe.js';
import { alterAm, datumChVonIso, lokalesDatum, lokaleZeit, wochentagKurz } from '../../domain/zeit.js';
import { html, Roh } from '../html.js';
import type { k } from '../kontext.js';
import { formFelder } from './layout.js';
import {
  bestaetigenFrage, kachel, kachelLegende, KACHEL_TEXT, kanalAuswahl, knopfPost, rolleAuswahl, statusAuswahl, statusText, telefon, warnungen, zeitraum, type KachelArt,
} from './teile.js';

type Kx = ReturnType<typeof k>;

export interface BesetzenErgebnis {
  inhalt: Roh;
  /** Zahl der Personen mit Eintrag (für den Reiter). */
  mitEintrag: number;
}

const an = (a: BesetzenEintrag | undefined) => !!a && (a.status === 'angemeldet' || a.status === 'bestaetigt');

/** Adresse der Liste mit Schicht und Filter. */
export function besetzenPfad(einsatzId: number, schicht: number | 'alle' | null, filter?: BesetzenFilter, unpassend = false): string {
  const teile = [schicht !== null ? `schicht=${schicht}` : '', filter ? `filter=${filter}` : '', unpassend ? 'unpassend=1' : ''].filter(Boolean);
  return `/einsaetze/${einsatzId}/besetzen${teile.length ? `?${teile.join('&')}` : ''}`;
}

export async function besetzenAnsicht(db: Db, kx: Kx, req: Request, einsatzId: number, hier: string): Promise<BesetzenErgebnis> {
  const d = await besetzenDaten(db, einsatzId);
  const { schichten, zeilen } = d;
  const ids = schichten.map((s) => s.id);
  const zahlen = await zahlenFuerSchichten(db, ids);

  // Schicht: Ein Einsatz mit einer Schicht zeigt immer diese Schicht.
  const q = req.query;
  const gewaehlt: BesetzenSchicht | null = schichten.length === 1
    ? schichten[0]
    : schichten.find((s) => String(s.id) === String(q.schicht)) ?? null;
  const sids = gewaehlt ? [gewaehlt.id] : ids;
  const zahl = zaehleBesetzen(zeilen, sids);
  const filter: BesetzenFilter = (BESETZEN_FILTER as readonly string[]).includes(String(q.filter)) ? (q.filter as BesetzenFilter) : vorgabeFilter(zahl);
  const unpassend = q.unpassend === '1';
  const liste = filtereBesetzen(zeilen, sids, filter, unpassend);
  const mitEintrag = zeilen.filter((z) => z.zellen.size > 0).length;
  const schichtWert = gewaehlt ? gewaehlt.id : 'alle';
  const pfad = (f: BesetzenFilter, s: number | 'alle' = schichtWert, u = false) => besetzenPfad(einsatzId, schichten.length > 1 ? s : null, f, u);
  const eintragLink = (sid: number, personId: number) => `/rueckmeldungen/eintrag?schicht=${sid}&person=${personId}&zurueck=${encodeURIComponent(hier)}`;

  if (!schichten.length) return { inhalt: html`<p class="leer">Der Einsatz hat keine Schicht.</p>`, mitEintrag };

  // ---------- Schicht wählen ----------
  const schichtChip = (s: BesetzenSchicht) => {
    const z = zahlen.get(s.id)!;
    const farbe = sollFarbe(z.teilnehmende, s.soll_anzahl);
    return html`<a class="schicht-chip" href="${pfad(filter, s.id)}"${gewaehlt?.id === s.id ? new Roh(' aria-current="page"') : ''}>
  <span class="schicht-chip-name">${s.name}</span>
  <span class="unter">${wochentagKurz(s.start_zeit)} ${datumChVonIso(s.start_zeit).slice(0, 6)}${s.zeit_offen ? '' : ` ${lokaleZeit(s.start_zeit)}`}</span>
  <strong class="f-${farbe}">${z.teilnehmende}${s.soll_anzahl ? ` / ${s.soll_anzahl}` : ''}</strong>
</a>`;
  };
  const schichtWahl = schichten.length > 1 ? html`<nav class="schicht-chips" aria-label="Schicht wählen">
  <a class="schicht-chip" href="${pfad(filter, 'alle')}"${gewaehlt ? '' : new Roh(' aria-current="page"')}><span class="schicht-chip-name">Alle Schichten</span></a>
  ${schichten.map(schichtChip)}
</nav>` : '';

  // ---------- Angaben zur gewählten Schicht ----------
  const sw = gewaehlt ? d.warnungen.get(gewaehlt.id) : undefined;
  const schichtInfo = gewaehlt ? html`<div class="schicht-info">
  <span><strong>${gewaehlt.name}</strong> · ${zeitraum(gewaehlt.start_zeit, gewaehlt.end_zeit, gewaehlt.zeit_offen)}${gewaehlt.ort ? ` · Antreten ${gewaehlt.ort}` : ''}${gewaehlt.min_alter !== null ? ` · ab ${gewaehlt.min_alter} Jahren` : ''}${gewaehlt.min_rang_name ? ` · ab ${gewaehlt.min_rang_name}` : ''}</span>
  <span class="knopfreihe">
    <form method="post" action="/schichten/${gewaehlt.id}/publizieren" class="inline">
      ${formFelder(kx, hier)}<input type="hidden" name="publiziert" value="${gewaehlt.publiziert ? '0' : '1'}">
      <button type="submit" class="schalter${gewaehlt.publiziert ? ' an' : ''}" aria-pressed="${gewaehlt.publiziert ? 'true' : 'false'}">${gewaehlt.publiziert ? 'Publiziert' : 'Nicht publiziert'}</button>
    </form>
    <a class="knopf klein" href="/schichten/${gewaehlt.id}/bearbeiten">Schicht bearbeiten</a>
  </span>
</div>
${sw ? warnungen(sw.schicht) : ''}
${gewaehlt.bemerkung_intern ? html`<p class="bemerkung intern"><strong>Intern:</strong> ${gewaehlt.bemerkung_intern}</p>` : ''}` : '';

  // ---------- Filter ----------
  // Wunsch Yann 26.11.2026: Der Wechsel zwischen «Neu + Bestätigt» (eingetragen) und «Nicht gefragt»
  // (Personen hinzufügen) steht als grosser Umschalter vorne. Die übrigen Filter folgen klein.
  const aktuell = (f: BesetzenFilter) => (filter === f ? new Roh(' aria-current="page"') : '');
  const wechsel = html`<span class="besetzen-wechsel" role="group" aria-label="Eingetragene Personen oder Personen hinzufügen">
  <a class="wechsel f-an" href="${pfad('an')}"${aktuell('an')}><span class="wechsel-titel">${BESETZEN_FILTER_TEXT.an} <strong>${zahl.an}</strong></span><span class="wechsel-unter">Eingetragene Personen</span></a>
  <a class="wechsel f-nicht" href="${pfad('nicht')}"${aktuell('nicht')}><span class="wechsel-titel">${BESETZEN_FILTER_TEXT.nicht} <strong>${zahl.nicht}</strong></span><span class="wechsel-unter">＋ Personen hinzufügen</span></a>
</span>`;
  const filterChips = html`<span class="besetzen-filtergruppe">${wechsel}<span class="filter-chips besetzen-filter">${BESETZEN_FILTER
    .filter((f) => f !== 'an' && f !== 'nicht')
    .filter((f) => f !== 'warnung' || zahl.warnung > 0 || filter === 'warnung')
    .map((f) => html`<a class="f-${f}" href="${pfad(f)}"${aktuell(f)}>${BESETZEN_FILTER_TEXT[f]} ${zahl[f]}</a>`)}</span></span>`;
  const hinweis: Record<BesetzenFilter, string> = {
    an: 'Angemeldet oder bestätigt.',
    neu: 'Angemeldet, noch nicht bestätigt.',
    offen: 'Unsicher oder Nachricht ohne Antwort.',
    nicht: gewaehlt ? 'Personen ohne Eintrag in dieser Schicht.' : 'Personen ohne Eintrag in diesem Einsatz.',
    bestaetigt: '', ab: '', warnung: 'Einträge mit einer Warnung. Warnungen sperren nichts.', alle: 'Alle Personen mit einem Eintrag.',
  };
  const unpassendHinweis = filter === 'nicht' && (zahl.unpassend > 0 || unpassend)
    ? unpassend
      ? html` Alle Personen sichtbar. <a href="${pfad('nicht')}">Unpassende ausblenden</a>`
      : html` ${zahl.unpassend} ${zahl.unpassend === 1 ? 'Person passt' : 'Personen passen'} nicht zu Mindestalter oder Mindestrang. <a href="${pfad('nicht', schichtWert, true)}">Einblenden</a>`
    : '';
  const alleBestaetigen = (filter === 'neu' || filter === 'an') && zahl.neu > 0
    ? knopfPost(kx, gewaehlt ? `/schichten/${gewaehlt.id}/alle-bestaetigen` : `/einsaetze/${einsatzId}/alle-bestaetigen`, zahl.neu === 1 ? 'Bestätigen' : `Alle ${zahl.neu} bestätigen`, {}, 'knopf haupt klein', hier)
    : '';

  // ---------- Person eintragen (eine Schicht) ----------
  const eintragen = async () => {
    if (!gewaehlt) return '';
    const personen = await personenListe(db);
    return html`<form method="post" action="/schichten/${gewaehlt.id}/anmeldungen" class="zeilen-form besetzen-eintragen">
  ${formFelder(kx, hier)}<input type="hidden" name="kanal" value="telefon">
  <label class="wachsen">Person eintragen <input name="person" list="personen-liste" required placeholder="Name tippen …" autocomplete="off"></label>
  <datalist id="personen-liste">${personen.map((p) => html`<option value="${personAuswahlText(p)}"></option>`)}</datalist>
  <label>Status ${statusAuswahl('status', 'angemeldet')}</label>
  <button type="submit" class="knopf">Eintragen</button>
</form>`;
  };

  // ---------- Zeilen ----------
  const stichtag = lokalesDatum((gewaehlt ?? schichten[0]).start_zeit);
  const personZelle = (z: BesetzenZeile, a?: BesetzenEintrag) => {
    const sid = gewaehlt?.id;
    const wl = sid !== undefined && a ? d.warnungen.get(sid)?.anmeldungen.get(a.id) : undefined;
    return html`<td class="person name-spalte">
  ${z.personId !== null && z.name
    ? html`<a href="/personen/${z.personId}"><span class="rang">${z.rang_name ?? ''}</span><span class="name">${z.name}</span></a>`
    : html`<span class="rang"></span><span class="name">${z.name}</span> <span class="pille orange">unbekannt</span>`}
  ${z.geburtsdatum ? html`<span class="unter">${alterAm(z.geburtsdatum, stichtag)} J.</span>` : ''}
  ${a?.bemerkung ? html`<small class="zeile-notiz">✎ ${a.bemerkung}</small>` : ''}
  ${z.essenseinschraenkung ? html`<small class="zeile-notiz">Essen: ${z.essenseinschraenkung}</small>` : ''}
  ${z.email_text ? html`<small class="zeile-notiz">${z.email_text}</small>` : ''}
  ${wl?.length ? warnungen(wl) : ''}
</td>`;
  };
  const kontakt = (z: BesetzenZeile) => html`<td class="kontakt">${z.telefon || z.telefon_privat ? telefon(z) : html`<span class="unter">–</span>`}</td>`;

  // Kachel wie in den Rückmeldungen. Ein Klick öffnet das Fenster zum Eintragen.
  const feld = (z: BesetzenZeile, s: BesetzenSchicht) => {
    const a = z.zellen.get(s.id);
    const nWarn = z.warnungen.get(s.id) ?? 0;
    let art: KachelArt = a ? a.status : null;
    if (!a && z.personId !== null) {
      const andere = schichten.filter((x) => x.id !== s.id && an(z.zellen.get(x.id)));
      if (andere.length) art = andere.some((x) => x.start_zeit < s.end_zeit && s.start_zeit < x.end_zeit) ? 'gleich' : 'moeglich';
    }
    const titel = a
      ? `${STATUS_TEXT[a.status]}${a.rolle ? ` · ${a.rolle}` : ''}${a.bemerkung ? ` · Bemerkung: ${a.bemerkung}` : ''}${nWarn ? ` · ${nWarn} Warnung` : ''}`
      : art ? KACHEL_TEXT[art as 'gleich' | 'moeglich'] : 'nicht gefragt';
    const innen = html`<span class="kachel-huelle">${kachel(art)}${nWarn ? html`<span class="warn-marke" aria-hidden="true">!</span>` : ''}${a?.bemerkung ? html`<span class="bemerkung-marke" aria-hidden="true">✎</span>` : ''}</span>${a?.rolle ? html`<small class="rolle">${a.rolle}</small>` : ''}<span class="sr">${titel}</span>`;
    if (z.personId !== null) return html`<td class="zelle-klick"><a href="${eintragLink(s.id, z.personId)}" data-eintrag${bestaetigenFrage(a, z.name)} title="${titel} – Klick zum Eintragen">${innen}</a></td>`;
    if (a) return html`<td class="zelle-klick"><a href="${pfad('alle', s.id)}" title="${titel} – in der Schicht bearbeiten">${innen}</a></td>`;
    return html`<td></td>`;
  };

  // Antwort-Knöpfe: ein Klick setzt den Status. Ohne Eintrag entsteht einer (wie in der Anrufliste).
  const antwort = (z: BesetzenZeile, s: BesetzenSchicht, a?: BesetzenEintrag) => {
    const knopf = (status: Status, text: string, klasse: string) => a
      ? knopfPost(kx, `/anmeldungen/${a.id}`, text, { status }, `knopf klein ${klasse}`, hier)
      : z.personId !== null
        ? knopfPost(kx, `/schichten/${s.id}/sammelstatus`, text, { status, kanal: status === 'nachricht_gesendet' ? 'whatsapp' : 'telefon', personen: String(z.personId) }, `knopf klein ${klasse}`, hier)
        : '';
    const st = a?.status ?? null;
    if (st === 'angemeldet') return html`${knopf('bestaetigt', 'Bestätigen', 'haupt')}${knopf('abgemeldet', 'Ab', 'a-ab')}`;
    if (st === 'bestaetigt') return '';
    if (st === 'abgemeldet') return knopf('angemeldet', 'An', 'a-an');
    return html`${knopf('angemeldet', 'An', 'a-an')}${st === 'unsicher' ? '' : knopf('unsicher', 'Unsicher', 'a-unsicher')}${knopf('abgemeldet', 'Ab', 'a-ab')}${st === 'nachricht_gesendet' ? '' : knopf('nachricht_gesendet', 'Nachricht', 'a-nachricht')}`;
  };

  // Unbekannte Einträge haben kein Fenster: Ändern direkt in der Zeile.
  const rollen = gewaehlt ? await ladeRollen(db) : [];
  const aendernUnbekannt = (a: BesetzenEintrag) => html`<details class="aufklapp"><summary>Ändern</summary>
  <form method="post" action="/anmeldungen/${a.id}" class="mini-form">
    ${formFelder(kx, hier)}<input type="hidden" name="version" value="${a.version}">
    <label>Status ${statusAuswahl('status', a.status)}</label>
    <label>Rolle ${rolleAuswahl('rolle', rollen, a.rolle)}</label>
    <label>Kanal ${kanalAuswahl('kanal', a.kanal as any)}</label>
    <label>Bemerkung <textarea name="bemerkung" rows="2" maxlength="5000">${a.bemerkung ?? ''}</textarea></label>
    <button type="submit" class="knopf haupt klein">Speichern</button>
    <a class="knopf gefahr klein" href="/anmeldungen/${a.id}/loeschen?zurueck=${encodeURIComponent(hier)}">Eintrag entfernen</a>
  </form>
</details>`;

  const suche = (z: BesetzenZeile) => `${z.name} ${z.rang_name ?? ''}`.toLowerCase();
  const tabelleEine = (s: BesetzenSchicht) => html`<div class="rahmen"><table class="tabelle besetzen-tabelle">
  <thead><tr><th class="waehlen"><input type="checkbox" data-alle-waehlen="personen" aria-label="Alle wählen"></th><th>Person</th><th>Telefon</th><th class="mitte">Status</th><th class="rechts">Antwort</th></tr></thead>
  <tbody>${liste.map((z) => {
    const a = z.zellen.get(s.id);
    return html`<tr data-suche="${suche(z)}" class="${a?.status === 'angemeldet' ? 'unbestaetigt' : ''}">
    <td class="waehlen">${z.personId !== null ? html`<input type="checkbox" name="personen" value="${z.personId}" form="sammel" aria-label="${z.name} wählen">` : ''}</td>
    ${personZelle(z, a)}
    ${kontakt(z)}
    ${z.personId !== null ? feld(z, s) : html`<td class="mitte">${a ? statusText(a.status) : ''}${a?.rolle ? html`<small class="rolle">${a.rolle}</small>` : ''}</td>`}
    <td class="antwort">${z.personId === null && a ? aendernUnbekannt(a) : html`<span class="knopfreihe">${antwort(z, s, a)}</span>`}</td>
  </tr>`;
  })}</tbody>
</table></div>
<form method="post" action="/schichten/${s.id}/sammelstatus" id="sammel" class="sammel-leiste">
  ${formFelder(kx, hier)}
  <span>Gewählte Personen:</span>
  <label class="sr" for="sammel-status">Status</label>
  <select id="sammel-status" name="status">${(['nachricht_gesendet', 'angemeldet', 'bestaetigt', 'unsicher', 'abgemeldet'] as const).map((st) => html`<option value="${st}">${STATUS_TEXT[st]}</option>`)}</select>
  <button type="submit" class="knopf klein">Setzen</button>
</form>`;

  const tabelleAlle = html`${kachelLegende()}
<div class="rahmen rueck-rahmen"><table class="tabelle rueck besetzen-tabelle besetzen-matrix">
  <thead><tr><th class="name-spalte">Person</th><th>Telefon</th>${schichten.map((s) => html`<th class="schicht-kopf"><a class="s" href="${pfad(filter, s.id)}">${s.name}</a><span class="d">${wochentagKurz(s.start_zeit)} ${datumChVonIso(s.start_zeit).slice(0, 6)}${s.zeit_offen ? '' : ` ${lokaleZeit(s.start_zeit)}`}</span></th>`)}</tr></thead>
  <tbody>${liste.map((z) => html`<tr data-suche="${suche(z)}">
    ${personZelle(z)}
    ${kontakt(z)}
    ${schichten.map((s) => feld(z, s))}
  </tr>`)}</tbody>
</table></div>`;

  const leer = filter === 'nicht' ? 'Alle passenden Personen sind schon gefragt.' : 'Keine Person in diesem Filter.';
  const inhalt = html`<section class="besetzen" aria-labelledby="besetzen-titel">
<h2 id="besetzen-titel" class="sr">Besetzen</h2>
${schichtWahl}
${schichtInfo}
<div class="titelzeile filterzeile">${filterChips}<span class="knopfreihe">${alleBestaetigen}<input type="search" class="suche" data-filter=".besetzen-tabelle tbody tr" placeholder="Name suchen …" aria-label="Personen suchen"></span></div>
${hinweis[filter] || unpassendHinweis ? html`<p class="unter">${hinweis[filter]}${unpassendHinweis}</p>` : ''}
${await eintragen()}
${!liste.length ? html`<p class="leer">${leer}</p>` : gewaehlt ? tabelleEine(gewaehlt) : tabelleAlle}
</section>`;
  return { inhalt, mitEintrag };
}

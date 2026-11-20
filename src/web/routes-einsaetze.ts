// Einsätze: Liste, Erstellen, Übersicht mit Matrix, Ändern, Kopieren, Löschen, Exporte (14.1, 14.2, 21).
import type { Express, Request, Response } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot, zurueck } from './app.js';
import {
  aendereEinsatz, anzahlAnmeldungenEinsatz, einsatzListe, type EinsatzZeile, erstelleEinsatz, kopiereEinsatz, ladeEinsatz, loescheEinsatz, vorgabeKopie,
  type Einsatz,
} from '../domain/einsatz.js';
import { aendereSchicht, anzeigeZeiten, erstelleSchicht, fremdabteilungen, kopiereSchicht, ladeSchicht, passtInTabelle, schichtenVonEinsatz } from '../domain/schicht.js';
import { bestaetigeAlle, verlaufEinsatz } from '../domain/anmeldung.js';
import { mitRueckgaengig } from '../domain/rueckgaengig.js';
import { logText } from './routes-schichten.js';
import { warnungenFuerSchichten } from '../domain/warnungen.js';
import { sollFarbe, zahlenFuerSchichten } from '../domain/zaehlung.js';
import { teilnehmerlisteCsv } from '../domain/export.js';
import { besetzenAnsicht, besetzenPfad } from './views/besetzen.js';
import { besetzenDaten, type BesetzenFilter, type BesetzenZeile } from '../domain/besetzen.js';
import { raenge as ladeRaenge, rollen as ladeRollen } from '../domain/stammdaten.js';
import { Eingabefehler, Konflikt, KANAL_TEXT, STATUS_TEXT, id as leseId, type Kanal, type Status } from '../domain/eingabe.js';
import { einsatzLage, type ZuTunPunkt } from '../domain/einsatz-lage.js';
import { filterFuerListe } from '../domain/filter.js';
import { alle } from '../db/db.js';
import { html, mehrzeilig, Roh } from './html.js';
import { k, aktuellerPfad } from './kontext.js';
import { druckseite, formFelder, mehrMenue, seite, seitenKopf, type Reiter } from './views/layout.js';
import {
  abgleichPunkt, datumZeit, istSoll, kachel, kachelLegende, KACHEL_TEXT, knopfPost, bestaetigenFrage, nameMitRang, publiziertMarke, punktMarke, statusText, warnungen, zeitraum, type KachelArt,
} from './views/teile.js';
import { datumChVonIso, jetztIso, lokalesDatum, lokaleZeit, wochentagKurz } from '../domain/zeit.js';

/** Name der Rolle für die Einsatzleitung (wie im Aufgebot, Regel 20.3). */
const EINSATZLEITUNG = 'Einsatzleitung';
import { telefonText, hauptnummer } from '../domain/personen.js';
import { nachRangTiefZuerst } from '../domain/listen.js';

/** Häkchen «mehrere Schichten»: Formular-Eingabe nach einem Fehler, sonst Wert aus der Datenbank (Vorgabe ja). */
function mehrereGewaehlt(e: Partial<Record<string, unknown>>): boolean {
  if (e.formular_mehrere_feld !== undefined) return e.formular_mehrere === '1';
  return Number(e.formular_mehrere ?? 1) !== 0;
}

function einsatzFormular(kx: ReturnType<typeof k>, ziel: string, e: Partial<Record<string, unknown>>, neu: boolean, fehler: string | null): Roh {
  const v = (n: string) => (e[n] === null || e[n] === undefined ? '' : String(e[n]));
  return html`
${fehler ? html`<div class="meldung fehler" role="alert">${fehler}</div>` : ''}
<form method="post" action="${ziel}" class="formular-raster">
  ${formFelder(kx)}${neu ? '' : html`<input type="hidden" name="version" value="${v('version')}">`}
  <div class="feld breit"><label for="name">Name</label><input id="name" name="name" required maxlength="255" value="${v('name')}"></div>
  ${neu ? html`
  <div class="breit zeit-raster">
    <div class="feld"><label for="start_datum">Startdatum</label><input id="start_datum" type="date" name="start_datum" required value="${v('start_datum')}"></div>
    <div class="feld"><label for="start_zeit">Beginn <span class="unter">(optional)</span></label><input id="start_zeit" type="time" name="start_zeit" value="${v('start_zeit')}"></div>
    <div class="feld"><label for="end_datum">Enddatum <span class="unter">(optional)</span></label><input id="end_datum" type="date" name="end_datum" value="${v('end_datum')}"><small>Leer = gleicher Tag.</small></div>
    <div class="feld"><label for="end_zeit">Ende <span class="unter">(optional)</span></label><input id="end_zeit" type="time" name="end_zeit" value="${v('end_zeit')}"><small>Leere Zeiten trägst du später in der Schicht nach.</small></div>
  </div>` : ''}
  <div class="feld breit"><label for="ort">Ort (Antreten)</label><input id="ort" name="ort" maxlength="255" value="${v('ort')}"><small>Gilt für alle Schichten mit dem gleichen Ort.</small></div>
  ${neu ? '' : html`
  <div class="feld breit"><label for="abtreten_ort">Ort Abtreten</label><input id="abtreten_ort" name="abtreten_ort" maxlength="255" value="${v('abtreten_ort')}"><small>Leer = gleich wie Ort.</small></div>
  <div class="feld breit"><label for="tenue">Tenue</label><input id="tenue" name="tenue" maxlength="255" value="${v('tenue')}"></div>
  <div class="feld breit"><label for="aufgebot_hinweis">Hinweis Aufgebot</label><textarea id="aufgebot_hinweis" name="aufgebot_hinweis" rows="2" maxlength="2000">${v('aufgebot_hinweis')}</textarea></div>
  <div class="feld breit"><label for="bemerkung_intern">Bemerkung intern</label><textarea id="bemerkung_intern" name="bemerkung_intern" rows="3" maxlength="5000">${v('bemerkung_intern')}</textarea><small>Nur für die Aufgebotsstelle.</small></div>
  <div class="feld breit"><label for="bemerkung_extern">Bemerkung extern</label><textarea id="bemerkung_extern" name="bemerkung_extern" rows="3" maxlength="5000">${v('bemerkung_extern')}</textarea><small>Sichtbar im Formular.</small></div>
  <div class="feld breit"><input type="hidden" name="formular_mehrere_feld" value="1"><label class="haken"><input type="checkbox" name="formular_mehrere" value="1"${mehrereGewaehlt(e) ? new Roh(' checked') : ''}> Im Formular mehrere Schichten wählbar</label><small>Ohne Haken wählt eine Person im Formular höchstens eine Schicht dieses Einsatzes. Eintragen von Hand bleibt frei.</small></div>`}
  <div class="aktionen breit"><button type="submit" class="knopf haupt">${neu ? 'Einsatz erstellen' : 'Speichern'}</button></div>
</form>`;
}

export function registriereEinsaetze(app: Express, deps: Abhaengigkeiten): void {
  const { db } = deps;

  app.get('/einsaetze', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const archiv = req.query.ansicht === 'archiv';
    // Filter je Benutzer, getrennt für «Kommend» und «Archiv».
    const { werte: q, gespeichert } = await filterFuerListe(db, kx.benutzer!.id, archiv ? 'archiv' : 'einsaetze', req.query, ['status', 'von', 'bis'], req.get('x-live-abfrage') !== '1');
    const datum = (w: unknown) => (typeof w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : null);
    const status = q.status === 'publiziert' || q.status === 'entwurf' ? q.status : 'alle';
    const filter = { status, von: datum(q.von), bis: datum(q.bis) } as const;
    const liste = await einsatzListe(db, archiv ? 'archiv' : 'kommend', filter);
    const gewaehlt = (w: string) => (w === status ? new Roh(' selected') : '');
    const tag = (iso: string, mitJahr: boolean) => `${wochentagKurz(iso)} ${mitJahr ? datumChVonIso(iso) : datumChVonIso(iso).slice(0, 6)}`;
    const datumText = (e: EinsatzZeile) =>
      datumChVonIso(e.start) === datumChVonIso(e.ende) || e.schichtListe.length === 1
        ? tag(e.start, true)
        : `${tag(e.start, false)} – ${tag(e.ende, true)}`;
    const besetzung = (e: EinsatzZeile) => html`<div class="besetzung">${e.schichtListe.map((s) => {
      const farbe = sollFarbe(s.teilnehmende, s.soll);
      const prozent = s.soll && s.soll > 0 ? Math.min(100, Math.round((s.teilnehmende / s.soll) * 100)) : 0;
      return html`<div class="besetzung-zeile f-${farbe}"><span class="besetzung-name">${e.schichtListe.length === 1 ? 'Ganzer Einsatz' : s.name}</span><span class="besetzung-zahl">${s.teilnehmende}${s.soll !== null ? ` / ${s.soll}` : ''}</span><span class="balken"><span class="b${Math.round(prozent / 10) * 10}"></span></span></div>`;
    })}</div>`;
    const inhalt = html`
${seitenKopf({
  titel: archiv ? 'Archiv' : 'Einsätze',
  angaben: [`${liste.length} ${liste.length === 1 ? 'Einsatz' : 'Einsätze'}`],
  aktionen: html`<input type="search" class="suche kopf-suche" data-filter=".filterbar tbody tr" placeholder="Suchen …" aria-label="Einsätze suchen">${archiv ? '' : html`<a class="knopf haupt" href="/einsaetze/neu">+ Neuer Einsatz</a>`}`,
  reiter: [
    { text: 'Kommend', href: '/einsaetze', aktiv: !archiv },
    { text: 'Archiv', href: '/einsaetze?ansicht=archiv', aktiv: archiv },
  ],
})}
<form method="get" action="/einsaetze" class="filter-form zeilen-form einsatz-filter">
  ${archiv ? html`<input type="hidden" name="ansicht" value="archiv">` : ''}
  <label>Status <select name="status"><option value="alle"${gewaehlt('alle')}>Entwürfe und veröffentlichte</option><option value="publiziert"${gewaehlt('publiziert')}>Nur im Formular</option><option value="entwurf"${gewaehlt('entwurf')}>Nur Entwürfe</option></select></label>
  <label>von <input type="date" name="von" value="${filter.von ?? ''}"></label>
  <label>bis <input type="date" name="bis" value="${filter.bis ?? ''}"></label>
  <button type="submit" class="knopf">Anzeigen</button>
  ${gespeichert && (filter.von || filter.bis || status !== 'alle') ? html`<a class="link-knopf" href="/einsaetze?${archiv ? 'ansicht=archiv&amp;' : ''}zuruecksetzen=1">Filter löschen</a>` : ''}
</form>
${liste.length === 0 ? html`<p class="leer">Keine Einsätze.</p>` : html`
<div class="rahmen"><table class="tabelle filterbar einsatz-liste">
  <thead><tr><th>Datum</th><th>Einsatz</th><th>Antreten</th><th>Status</th><th>Besetzung</th><th class="zahl">Neu</th><th class="zahl">Bestätigt</th><th>Einsatzleitung</th></tr></thead>
  <tbody>${liste.map((e) => html`<tr data-suche="${`${e.name} ${e.ort ?? ''} ${e.antretenOrt ?? ''} ${e.einsatzleitung.join(' ')}`.toLowerCase()}">
    <td class="nowrap">${datumText(e)}</td>
    <td><a class="einsatz-name" href="/einsaetze/${e.id}">${e.name}</a></td>
    <td class="antreten">${lokaleZeit(e.start)}${e.antretenOrt ? html` · ${e.antretenOrt}` : ''}</td>
    <td>${e.publiziert ? punktMarke('Im Formular', 'gruen') : punktMarke('Entwurf', 'grau')}</td>
    <td>${besetzung(e)}</td>
    <td class="zahl">${e.unbestaetigt ? html`<a href="${besetzenPfad(e.id, null, 'neu')}" class="orange-text">${e.unbestaetigt}</a>` : '–'}</td>
    <td class="zahl">${e.bestaetigt || '–'}</td>
    <td class="einsatzleitung">${e.einsatzleitung.length ? e.einsatzleitung.map((n, i) => html`${i ? html`<br>` : ''}${n}`) : '–'}</td>
  </tr>`)}</tbody>
</table></div>`}`;
    res.send(seite(kx, archiv ? 'Archiv' : 'Einsätze', archiv ? 'archiv' : 'einsaetze', inhalt, { breit: true }));
  });

  app.get('/einsaetze/neu', nurAufgebot, (_req, res) => {
    const kx = k(res);
    res.send(seite(kx, 'Neuer Einsatz', 'einsaetze', html`${seitenKopf({ pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: 'Neuer Einsatz' }], titel: 'Neuer Einsatz', angaben: ['Eine Standardschicht entsteht automatisch. Sie ist publiziert.'] })}${einsatzFormular(kx, '/einsaetze', {}, true, null)}`));
  });

  app.post('/einsaetze', nurAufgebot, async (req, res) => {
    const kx = k(res);
    try {
      const id = await erstelleEinsatz(db, req.body, kx.benutzer!.id);
      zurueck(req, res, `/einsaetze/${id}`, 'Einsatz erstellt.');
    } catch (e) {
      if (!(e instanceof Eingabefehler)) throw e;
      res.status(400).send(seite(kx, 'Neuer Einsatz', 'einsaetze', html`${seitenKopf({ pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: 'Neuer Einsatz' }], titel: 'Neuer Einsatz' })}${einsatzFormular(kx, '/einsaetze', req.body, true, e.message)}`));
    }
  });

  // Einsatz-Seite mit Reitern (Vorlage Yann, Handbuch): Übersicht, Anmeldungen, Schichten, Verlauf.
  const einsatzSeite = async (req: Request, res: Response, ansicht: Ansicht, fehler?: { sid: number | 'neu'; werte: Record<string, any>; fehler: string; version?: unknown; status: number }) => {
    const kx = k(res);
    const e = await ladeEinsatz(db, leseId(req.params.id));
    const schichten = await schichtenVonEinsatz(db, e.id);
    const ids = schichten.map((s) => s.id);
    const zahlen = await zahlenFuerSchichten(db, ids);
    const w = await warnungenFuerSchichten(db, ids);
    const rollen = await ladeRollen(db);
    const eintraege = ids.length
      ? await alle<any>(
          db,
          `SELECT a.*, p.vorname, p.nachname, r.name AS rang_name, r.reihenfolge AS rang_reihenfolge
             FROM anmeldung a LEFT JOIN person p ON p.clubdesk_id = a.person_id LEFT JOIN rang r ON r.id = p.rang_id
            WHERE a.schicht_id IN (?)`,
          [ids],
        )
      : [];
    const hier = aktuellerPfad(req);
    const jetzt = jetztIso();
    const warnZahl = new Map(ids.map((sid) => [sid, [...w.get(sid)!.anmeldungen.values()].reduce((n, l) => n + l.length, 0)]));
    const an = (a: any) => a.status === 'angemeldet' || a.status === 'bestaetigt';
    // Bekannte Personen: Name aus den Stammdaten. Unbekannte: Name aus dem Formular.
    for (const a of eintraege) {
      a.name = a.person_id !== null && (a.vorname || a.nachname) ? `${a.vorname ?? ''} ${a.nachname ?? ''}`.trim() : (a.name_text ?? '');
    }

    // Einsatzleitung: Einträge mit der Rolle «Einsatzleitung» (wie im Aufgebot, Regel 20.3).
    const elRolle = rollen.some((r) => r.name === EINSATZLEITUNG);
    const elEintraege = eintraege.filter((a) => a.rolle === EINSATZLEITUNG && an(a)).sort(nachRangTiefZuerst);
    const lage = einsatzLage({
      jetzt,
      schichten,
      zahlen,
      warnZahl,
      schichtWarnungen: new Map(ids.map((sid) => [sid, w.get(sid)!.schicht])),
      mitEinsatzleitung: elRolle ? new Set(elEintraege.map((a) => a.schicht_id)) : null,
    });

    // Zahl der Personen mit Eintrag (für den Reiter «Besetzen»).
    const mitEintrag = new Set(eintraege.map((a) => (a.person_id !== null ? `p${a.person_id}` : `u${a.id}`))).size;

    const ende = schichten.reduce((m, sc) => (sc.end_zeit > m ? sc.end_zeit : m), schichten[0]?.end_zeit ?? '');
    const name = (z: { rang_name: string | null; name: string }) => html`${z.rang_name ? html`<span class="rang">${z.rang_name}</span> ` : ''}${z.name}`;

    // ---------- Steckbrief ----------
    const leer = html`<span class="unter">–</span>`;
    const steckbrief = html`<dl class="steckbrief">
  <div><dt>Antreten</dt><dd>${e.ort ?? leer}</dd></div>
  <div><dt>Abtreten</dt><dd>${e.abtreten_ort ?? (e.ort ? html`<span class="unter">wie Antreten</span>` : leer)}</dd></div>
  <div><dt>Tenue</dt><dd>${e.tenue ?? leer}</dd></div>
  ${elRolle ? html`<div><dt>Einsatzleitung</dt><dd>${elEintraege.length
    ? [...new Map(elEintraege.map((a) => [a.person_id ?? `u${a.id}`, a])).values()].map((a, i) => html`${i ? ', ' : ''}${name(a)}${a.status === 'angemeldet' ? html` <span class="unter">(unbestätigt)</span>` : ''}`)
    : html`<span class="rot-text">fehlt</span>`}</dd></div>` : ''}
  <div><dt>Hinweis Aufgebot</dt><dd>${e.aufgebot_hinweis ? mehrzeilig(e.aufgebot_hinweis) : leer}</dd></div>
</dl>
${e.bemerkung_intern ? html`<p class="bemerkung intern"><strong>Intern:</strong> ${mehrzeilig(e.bemerkung_intern)}</p>` : ''}
${e.bemerkung_extern ? html`<p class="bemerkung"><strong>Extern:</strong> ${mehrzeilig(e.bemerkung_extern)}</p>` : ''}`;

    // ---------- Zu tun ----------
    const symbol = (p: ZuTunPunkt) => {
      const farbe = p.art === 'fehlt' || p.art === 'einsatzleitung' ? 'rot' : 'orange';
      const text = p.anzahl > 0 ? String(p.anzahl) : p.art === 'offen' ? '?' : '!';
      return html`<span class="zutun-symbol z-${farbe}" aria-hidden="true">${text}</span>`;
    };
    const knopf = (p: ZuTunPunkt) => {
      const besetzen = (filter: BesetzenFilter) => besetzenPfad(e.id, schichten.length > 1 ? p.schichtId : null, filter);
      switch (p.art) {
        case 'fehlt': return html`<a class="knopf klein" href="${besetzen('nicht')}">Anfragen ›</a>`;
        case 'kein_soll': return html`<a class="knopf klein" href="/einsaetze/${e.id}/schichten">Soll setzen</a>`;
        case 'unbestaetigt': return html`<span class="knopfreihe"><a class="knopf klein" href="${besetzenPfad(e.id, schichten.length > 1 ? 'alle' : null, 'neu')}">Ansehen ›</a>${knopfPost(kx, `/einsaetze/${e.id}/alle-bestaetigen`, lage.unbestaetigt === 1 ? 'Bestätigen' : `Alle ${lage.unbestaetigt} bestätigen`, {}, 'knopf klein', hier)}</span>`;
        case 'offen': return html`<a class="knopf klein" href="${besetzen('offen')}">Nachfassen ›</a>`;
        case 'einsatzleitung': return html`<a class="knopf klein" href="${besetzen('alle')}">Eintragen ›</a>`;
        case 'warnung': return html`<a class="knopf klein" href="${besetzen('warnung')}">Zeigen ›</a>`;
        case 'zeit_offen': return html`<a class="knopf klein" href="/einsaetze/${e.id}/schichten">Zeiten eintragen</a>`;
        default: return html`<a class="knopf klein" href="${besetzen('alle')}">Zeigen ›</a>`;
      }
    };
    const zuTun = html`<section class="zutun-block" aria-labelledby="zutun-titel">
  <h2 id="zutun-titel">Zu tun</h2>
  <ul class="zutun">${!schichten.length
    ? html`<li class="zutun-zeile">Der Einsatz hat keine Schicht.</li>`
    : lage.vorbei
      ? html`<li class="zutun-zeile z-vorbei"><span class="zutun-symbol z-grau" aria-hidden="true">✓</span><span class="zutun-text">Alle Schichten sind vorbei.</span></li>`
      : !lage.punkte.length
        ? html`<li class="zutun-zeile z-ok"><span class="zutun-symbol z-gruen" aria-hidden="true">✓</span><span class="zutun-text"><strong>Nichts zu tun.</strong> Alle kommenden Schichten sind besetzt und bestätigt.</span></li>`
        : lage.punkte.map((p) => html`<li class="zutun-zeile">${symbol(p)}<span class="zutun-text"><strong>${p.text}</strong>${p.unter ? html` <span class="unter">${p.unter}</span>` : ''}</span>${knopf(p)}</li>`)}</ul>
</section>`;

    // ---------- Schichten ----------
    const belegung = (z: NonNullable<ReturnType<typeof zahlen.get>>, soll: number | null, mitText = true) => {
      const farbe = sollFarbe(z.teilnehmende, soll);
      const basis = soll && soll > 0 ? Math.max(soll, z.teilnehmende) : 0;
      const b = basis ? Math.round((Math.min(z.teilnehmende, basis) / basis) * 100) : 0;
      const a = basis ? Math.min(100 - b, Math.round((z.unbestaetigt / basis) * 100)) : 0;
      return html`<div class="belegung f-${farbe}">
  ${basis ? html`<svg class="belegung-balken" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="spur" width="100" height="6"/><rect class="b" width="${b}" height="6"/><rect class="a" x="${b}" width="${a}" height="6"/></svg>` : ''}
  ${mitText ? html`<span class="belegung-text">${soll && soll > 0
    ? html`<strong>${z.teilnehmende} / ${soll}</strong>`
    : html`<strong>${z.teilnehmende} bestätigt</strong>`}${z.unbestaetigt ? html` <span class="unter">+ ${z.unbestaetigt} angemeldet</span>` : ''}${soll && soll > 0 ? '' : html` <span class="unter">· kein Soll</span>`}</span>` : ''}
</div>`;
    };
    const schichtTabelle = html`<section aria-labelledby="schichten-titel">
<div class="titelzeile"><h2 id="schichten-titel">Schichten</h2><a class="knopf klein" href="/einsaetze/${e.id}/schichten/neu">+ Schicht hinzufügen</a></div>
${!schichten.length ? html`<p class="leer">Keine Schichten.</p>` : html`<div class="rahmen"><table class="tabelle schicht-tabelle">
  <thead><tr><th>Schicht</th><th>Besetzung</th><th>Offen</th><th>Rollen</th><th class="zahl">Essen</th><th>Publiziert</th><th><span class="sr">Aktionen</span></th></tr></thead>
  <tbody>${schichten.map((s) => {
    const z = zahlen.get(s.id)!;
    const ws = w.get(s.id)!;
    const pillen = [
      z.unbestaetigt ? html`<span class="pille orange">${z.unbestaetigt} unbestätigt</span>` : '',
      z.unsicher ? html`<span class="pille orange">${z.unsicher} unsicher</span>` : '',
      z.nachricht ? html`<span class="pille blau">${z.nachricht} Nachricht</span>` : '',
      warnZahl.get(s.id) ? html`<span class="pille orange">⚠ ${warnZahl.get(s.id)}</span>` : '',
    ].filter((x) => x !== '');
    return html`<tr class="${s.end_zeit <= jetzt ? 'vergangen' : ''}">
    <td><div class="schicht-name">${abgleichPunkt(ws.abgleich)} <a href="${besetzenPfad(e.id, schichten.length > 1 ? s.id : null)}">${s.name}</a></div><div class="unter">${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)}${s.ort ? ` · ${s.ort}` : ''}</div></td>
    <td>${belegung(z, s.soll_anzahl)}</td>
    <td>${pillen.length ? html`<span class="pillen">${pillen}</span>` : html`<span class="unter">–</span>`}</td>
    <td>${z.rollen.length ? html`<span class="pillen">${z.rollen.map((r) => html`<span class="pille ${r.ist >= r.soll ? 'gruen' : 'rot'}">${r.rolle} ${r.ist}/${r.soll}</span>`)}</span>` : html`<span class="unter">–</span>`}</td>
    <td class="zahl">${z.essen}</td>
    <td>${s.publiziert ? punktMarke('Publiziert', 'gruen') : punktMarke('Nicht publiziert', 'grau')}</td>
    <td class="aktionen-zelle"><a class="knopf klein" href="${besetzenPfad(e.id, schichten.length > 1 ? s.id : null)}">Besetzen ›</a></td>
  </tr>`;
  })}</tbody>
</table></div>`}
</section>`;

    // ---------- Kopf: Leitung ----------
    const elPersonen = [...new Map(elEintraege.map((a) => [a.person_id ?? `u${a.id}`, a])).values()];
    const leitung = elPersonen.length ? elPersonen.map((a, i) => html`${i ? ', ' : ''}${name(a)}`) : '–';

    // ---------- Reiter «Schichten»: Karten je Schicht ----------
    const fremdJe = ansicht === 'schichten' ? new Map(await Promise.all(ids.map(async (sid) => [sid, await fremdabteilungen(db, sid)] as const))) : new Map();
    const fremdBlock = (sid: number) => {
      const fremd = fremdJe.get(sid) ?? [];
      return html`<details class="aufklapp fremd-block"><summary>Fremdabteilungen${fremd.length ? ` (${fremd.reduce((n: number, f: any) => n + Number(f.anzahl), 0)})` : ''}</summary>
  <p class="unter">Fremdabteilungen zählen als Teilnehmende und beim Essen.</p>
  ${fremd.map((f: any) => html`<form method="post" action="/schichten/${sid}/fremdabteilungen" class="zeilen-form">
    ${formFelder(kx, hier)}<input type="hidden" name="id" value="${f.id}">
    <input name="name" required maxlength="255" value="${f.name}" aria-label="Name" class="wachsen">
    <input name="anzahl" type="number" min="1" required value="${f.anzahl}" aria-label="Anzahl" class="zahl-feld">
    <input name="bemerkung" maxlength="2000" value="${f.bemerkung ?? ''}" aria-label="Bemerkung" class="wachsen">
    <button type="submit" class="knopf klein">Speichern</button>
    <label class="haken klein"><input type="checkbox" name="loeschen" value="1"> löschen</label>
  </form>`)}
  <form method="post" action="/schichten/${sid}/fremdabteilungen" class="zeilen-form">
    ${formFelder(kx, hier)}
    <input name="name" required maxlength="255" placeholder="Name" aria-label="Name" class="wachsen">
    <input name="anzahl" type="number" min="1" required placeholder="Anzahl" aria-label="Anzahl" class="zahl-feld">
    <input name="bemerkung" maxlength="2000" placeholder="Bemerkung, z. B. 2 vegetarisch" aria-label="Bemerkung" class="wachsen">
    <button type="submit" class="knopf klein">Hinzufügen</button>
  </form>
</details>`;
    };
    // ---------- Reiter «Schichten»: eine Zeile zum Aufklappen je Schicht (Vorschlag Yann 20.11.2026) ----------
    const raengeListe = ansicht === 'schichten' ? await ladeRaenge(db) : [];
    const bedarf = ansicht === 'schichten' && ids.length
      ? await alle<{ schicht_id: number; rolle: string; anzahl: number }>(db, 'SELECT schicht_id, rolle, anzahl FROM schicht_rolle WHERE schicht_id IN (?)', [ids])
      : [];
    const besetzung = ansicht === 'schichten' && schichten.length > 1 ? await besetzenDaten(db, e.id) : null;
    const offenId = String(req.query.offen ?? '');
    const schichtZeile = (s: (typeof schichten)[number]) => {
      const f = fehler && fehler.sid === s.id ? fehler : null;
      const werte: Record<string, unknown> = f ? f.werte : {
        ...s,
        start_datum: lokalesDatum(s.start_zeit), start_zeit: anzeigeZeiten(s).beginn,
        end_datum: passtInTabelle(s) ? '' : lokalesDatum(s.end_zeit), end_zeit: anzeigeZeiten(s).ende,
        rollen: Object.fromEntries(bedarf.filter((x) => x.schicht_id === s.id).map((x) => [x.rolle, String(x.anzahl)])),
      };
      const v = (n: string) => (werte[n] === null || werte[n] === undefined ? '' : String(werte[n]));
      const rolleWert = (r: string) => {
        const w = (werte.rollen as Record<string, unknown> | undefined)?.[r];
        return w === null || w === undefined ? '' : String(w);
      };
      const id = (n: string) => `s${s.id}-${n}`;
      const offen = !!f || offenId === String(s.id) || schichten.length === 1;
      const ziel = `/einsaetze/${e.id}/schichten?offen=${s.id}#schicht-${s.id}`;
      const z = zahlen.get(s.id)!;
      const feld = (n: string, text: string, eingabe: Roh, hinweis = '') => html`<div class="feld"><label for="${id(n)}">${text}</label>${eingabe}${hinweis ? html`<small>${hinweis}</small>` : ''}</div>`;
      const eingabe = (n: string, typ = 'text', extra = '') => html`<input id="${id(n)}" name="${n}" type="${typ}" value="${v(n)}"${new Roh(extra)}>`;
      const textfeld = (n: string, max: number) => html`<textarea id="${id(n)}" name="${n}" rows="2" maxlength="${max}">${v(n)}</textarea>`;
      return html`<article class="schicht-akk${s.end_zeit <= jetzt ? ' vergangen' : ''}" id="schicht-${s.id}">
  <div class="akk-aktionen">
    <form method="post" action="/schichten/${s.id}/publizieren" class="inline">
      ${formFelder(kx, hier)}<input type="hidden" name="publiziert" value="${s.publiziert ? '0' : '1'}">
      <button type="submit" class="schalter${s.publiziert ? ' an' : ''}" aria-pressed="${s.publiziert ? 'true' : 'false'}">${s.publiziert ? 'Publiziert' : 'Nicht publiziert'}</button>
    </form>
    <a class="knopf klein" href="${besetzenPfad(e.id, schichten.length > 1 ? s.id : null)}">Besetzen ›</a>
  </div>
  <details${offen ? new Roh(' open') : ''}>
    <summary>
      <span class="akk-name"><span class="akk-pfeil" aria-hidden="true">›</span> <strong>${s.name}</strong> <span class="unter">${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)}</span></span>
      ${belegung(z, s.soll_anzahl)}
    </summary>
    <div class="akk-inhalt">
      ${f ? html`<div class="meldung fehler" role="alert">${f.fehler}</div>` : ''}
      <form method="post" action="/schichten/${s.id}" class="akk-form">
        ${formFelder(kx, ziel)}<input type="hidden" name="version" value="${f?.version ?? s.version}">
        <div class="akk-gruppen">
          <fieldset class="akk-gruppe"><legend>Wann</legend>
            ${feld('name', 'Name', html`<input id="${id('name')}" name="name" required maxlength="255" value="${v('name')}">`)}
            <div class="akk-reihe">
              ${feld('start_datum', 'Datum', html`<input id="${id('start_datum')}" name="start_datum" type="date" required value="${v('start_datum')}">`)}
              ${feld('start_zeit', 'Beginn', eingabe('start_zeit', 'time'))}
              ${feld('end_zeit', 'Ende', eingabe('end_zeit', 'time'))}
            </div>
            ${v('end_datum') ? feld('end_datum', 'Enddatum', eingabe('end_datum', 'date'), 'Leer = gleicher Tag.') : ''}
            <small>Ende vor Beginn = Folgetag. Leer = «Zeit offen».</small>
          </fieldset>
          <fieldset class="akk-gruppe"><legend>Wer</legend>
            <div class="akk-reihe zwei">
              ${feld('soll_anzahl', 'Soll (Teilnehmende)', eingabe('soll_anzahl', 'number', ' min="0" max="100000"'))}
              ${feld('min_alter', 'Mindestalter', eingabe('min_alter', 'number', ' min="0" max="120"'))}
            </div>
            ${feld('min_rang_id', 'Mindestrang', html`<select id="${id('min_rang_id')}" name="min_rang_id"><option value="">– keiner –</option>${raengeListe.map((r) => html`<option value="${r.id}"${String(r.id) === v('min_rang_id') ? new Roh(' selected') : ''}>${r.name}</option>`)}</select>`)}
            ${rollen.length ? html`<div class="akk-reihe">${rollen.map((r, ri) => html`<div class="feld"><label for="${id(`rolle-${ri}`)}">${r.name}</label><input id="${id(`rolle-${ri}`)}" type="number" min="0" max="10000" name="rollen[${r.name}]" value="${rolleWert(r.name)}" placeholder="–"></div>`)}</div><small>Bedarf je Rolle.</small>` : ''}
          </fieldset>
          <fieldset class="akk-gruppe"><legend>Wo und was</legend>
            ${feld('ort', 'Antreten', html`<input id="${id('ort')}" name="ort" maxlength="255" value="${v('ort')}" placeholder="${e.ort ?? ''}">`)}
            ${feld('abtreten_ort', 'Abtreten', html`<input id="${id('abtreten_ort')}" name="abtreten_ort" maxlength="255" value="${v('abtreten_ort')}" placeholder="wie Antreten">`)}
            ${feld('tenue', 'Tenue', html`<input id="${id('tenue')}" name="tenue" maxlength="255" value="${v('tenue')}">`)}
          </fieldset>
          <fieldset class="akk-gruppe"><legend>Texte</legend>
            ${feld('aufgebot_hinweis', 'Hinweis Aufgebot', textfeld('aufgebot_hinweis', 2000))}
            ${feld('bemerkung_extern', 'Bemerkung im Formular', textfeld('bemerkung_extern', 5000))}
            ${feld('bemerkung_intern', 'Interne Bemerkung', textfeld('bemerkung_intern', 5000))}
          </fieldset>
        </div>
        <div class="akk-fuss"><span class="unter">Ändert der Einsatz Ort, Abtreten, Tenue oder Hinweis, gilt das für Schichten mit gleichem Wert.</span><button type="submit" class="knopf haupt">Speichern</button></div>
      </form>
      ${fremdBlock(s.id)}
      <div class="akk-fuss">
        <span class="knopfreihe">
          ${knopfPost(kx, `/schichten/${s.id}/kopieren`, 'Schicht kopieren', {}, 'knopf klein')}
          ${schichten.length > 1 ? html`<a class="knopf gefahr klein" href="/schichten/${s.id}/loeschen">Schicht löschen</a>` : ''}
        </span>
      </div>
    </div>
  </details>
</article>`;
    };
    const fn = fehler && fehler.sid === 'neu' ? fehler : null;
    const nv = (n: string) => (fn && fn.werte[n] !== undefined && fn.werte[n] !== null ? String(fn.werte[n]) : '');
    const tagVorgabe = schichten.length ? lokalesDatum(schichten[schichten.length - 1].start_zeit) : '';
    // Personen zwischen Schichten verschieben (Wunsch Yann 20.11.2026). Ziehen mit der Maus, sonst Menü ⇄ mit Auswahl der Schicht.
    // Nur Einträge mit «angemeldet» oder «bestätigt». Ohne Skript sendet das Menü ein normales Formular.
    const verschiebenBereich = () => {
      if (!besetzung) return '';
      const ziel = `/einsaetze/${e.id}/schichten#verschieben`;
      const karte = (zeile: BesetzenZeile, s: (typeof schichten)[number]) => {
        const a = zeile.zellen.get(s.id)!;
        const n = zeile.warnungen.get(s.id) ?? 0;
        const andere = schichten.filter((x) => x.id !== s.id);
        return html`<li class="zieh-karte" draggable="true" data-zieh="${a.id}" data-suche="${zeile.name.toLowerCase()}">
  <form method="post" action="/anmeldungen/${a.id}/verschieben" class="zieh-form" id="zieh-${a.id}">
    ${formFelder(kx, ziel)}<input type="hidden" name="version" value="${a.version}">
    <span class="zieh-griff" aria-hidden="true">⋮⋮</span>
    <span class="zieh-name">${zeile.personId !== null ? nameMitRang(zeile) : zeile.name}${n ? html` <span class="warn-marke" title="${n === 1 ? '1 Warnung' : `${n} Warnungen`}">⚠</span>` : ''}</span>
    ${zeile.personId !== null
      ? html`<a class="zieh-kachel" href="/rueckmeldungen/eintrag?schicht=${s.id}&amp;person=${zeile.personId}&amp;zurueck=${encodeURIComponent(ziel)}" data-eintrag${bestaetigenFrage(a, zeile.name)} title="${STATUS_TEXT[a.status]} – Klick zum ${a.status === 'angemeldet' ? 'Bestätigen' : 'Eintragen'}" draggable="false">${kachel(a.status)}<span class="sr">${STATUS_TEXT[a.status]}</span></a>`
      : statusText(a.status)}
    <details class="zieh-menue"><summary title="In andere Schicht verschieben" aria-label="${zeile.name} verschieben">⇄</summary>
      <div class="zieh-menue-inhalt">
        <label for="zs-${a.id}">Nach</label>
        <select id="zs-${a.id}" name="schicht">${andere.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select>
        <button type="submit" class="knopf klein">Verschieben</button>
      </div>
    </details>
  </form>
</li>`;
      };
      return html`<section class="verschieben" id="verschieben" aria-labelledby="verschieben-titel">
<div class="titelzeile filterzeile"><h2 id="verschieben-titel">Personen verschieben</h2><input type="search" class="suche" data-filter=".zieh-karte" placeholder="Name suchen …" aria-label="Personen suchen"></div>
<p class="unter">Zieh eine Person in eine andere Schicht. Auf dem Handy: ⇄ antippen und die Schicht wählen. Es zählen «angemeldet» und «bestätigt».</p>
<div class="zieh-spalten">${schichten.map((s) => {
  const liste = besetzung.zeilen.filter((z) => {
    const st = z.zellen.get(s.id)?.status;
    return st === 'angemeldet' || st === 'bestaetigt';
  });
  const z = zahlen.get(s.id)!;
  return html`<section class="zieh-spalte" data-ziel-schicht="${s.id}" aria-label="${s.name}">
  <header><strong>${s.name}</strong> <span class="unter">${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)}</span>${belegung(z, s.soll_anzahl)}</header>
  <ul class="zieh-liste">${liste.length ? liste.map((zeile) => karte(zeile, s)) : html`<li class="zieh-leer">Noch niemand. Zieh eine Person hierher.</li>`}</ul>
</section>`;
})}</div>
</section>`;
    };
    const schichtenAnsicht = () => html`<section aria-labelledby="akk-titel" class="schichten-akk">
<h2 id="akk-titel" class="sr">Schichten</h2>
${schichten.map(schichtZeile)}
<form method="post" action="/einsaetze/${e.id}/schichten" class="neue-schicht" id="neue-schicht">
  ${formFelder(kx)}
  ${fn ? html`<div class="meldung fehler breit" role="alert">${fn.fehler}</div>` : ''}
  <div class="feld"><label for="neu-name">Neue Schicht</label><input id="neu-name" name="name" required maxlength="255" placeholder="Name, z. B. Abbau" value="${nv('name')}"></div>
  <div class="feld"><label for="neu-datum">Datum</label><input id="neu-datum" name="start_datum" type="date" required value="${nv('start_datum') || tagVorgabe}"></div>
  <div class="feld"><label for="neu-beginn">Beginn</label><input id="neu-beginn" name="start_zeit" type="time" value="${nv('start_zeit')}"></div>
  <div class="feld"><label for="neu-ende">Ende</label><input id="neu-ende" name="end_zeit" type="time" value="${nv('end_zeit')}"></div>
  <button type="submit" class="knopf">Hinzufügen</button>
</form>
<p class="unter">Eine neue Schicht übernimmt Ort, Abtreten, Tenue und Hinweis vom Einsatz. Sie ist zuerst nicht publiziert. Leere Zeiten = «Zeit offen».</p>
</section>
${verschiebenBereich()}`;

    // ---------- Reiter «Verlauf» ----------
    const verlaufAnsicht = async () => {
      const log = await verlaufEinsatz(db, e.id, 300);
      return html`<section aria-labelledby="verlauf-titel">
<div class="titelzeile filterzeile"><h2 id="verlauf-titel">Verlauf</h2>${log.length ? html`<input type="search" class="suche" data-filter=".einsatz-verlauf tbody tr" placeholder="Suchen …" aria-label="Verlauf suchen">` : ''}</div>
${!log.length ? html`<p class="leer">Noch keine Einträge im Statusprotokoll.</p>` : html`<div class="rahmen"><table class="tabelle einsatz-verlauf">
  <thead><tr><th>Zeit</th><th>Person</th><th>Schicht</th><th>Änderung</th><th>Durch</th></tr></thead>
  <tbody>${log.map((l) => html`<tr data-suche="${`${l.person_name} ${l.schicht_name} ${l.benutzer ?? ''}`.toLowerCase()}">
    <td class="nowrap">${datumZeit(l.zeit)}</td>
    <td>${l.person_id !== null ? html`<a href="/personen/${l.person_id}">${name({ rang_name: l.rang_name, name: l.person_name })}</a>` : l.person_name}</td>
    <td>${l.schicht_name}</td>
    <td>${logText(l)}</td>
    <td class="unter">${l.benutzer ?? 'Formular / System'}</td>
  </tr>`)}</tbody>
</table></div>${log.length >= 300 ? html`<p class="unter">Das Tool zeigt die 300 neuesten Einträge.</p>` : ''}`}
</section>`;
    };

    const inhalt = html`
${seitenKopf({
  pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: e.name }],
  titel: e.name,
  marke: publiziertMarke(schichten.some((sc) => sc.publiziert)),
  angaben: [
    schichten.length ? html`<strong>${zeitraum(schichten[0].start_zeit, ende, schichten[0].zeit_offen && schichten[schichten.length - 1].zeit_offen)}</strong>` : '',
    `Antreten ${schichten.length ? anzeigeZeiten(schichten[0]).beginn || 'Zeit offen' : ''}${e.ort ? ` · ${e.ort}` : ''}`,
    elRolle ? html`Leitung ${leitung}` : '',
  ],
  aktionen: html`${dokumenteMenue(e.id, schichten)}
    <a class="knopf" href="/einsaetze/${e.id}/bearbeiten">Bearbeiten</a>
    ${mehrMenue([
      html`<a href="/einsaetze/${e.id}/schichten/neu">Schicht hinzufügen</a>`,
      html`<a href="/einsaetze/${e.id}/kopieren">Einsatz kopieren</a>`,
      html`<div class="menue-trenner"></div>`,
      html`<a class="gefahr" href="/einsaetze/${e.id}/loeschen">Einsatz löschen</a>`,
    ])}`,
  reiter: einsatzReiter(e.id, ansicht, { besetzen: mitEintrag, schichten: schichten.length }),
})}
<div class="einsatz-uebersicht">
${ansicht === 'uebersicht' ? html`${steckbrief}${zuTun}${schichtTabelle}`
  : ansicht === 'besetzen' ? (await besetzenAnsicht(db, kx, req, e.id, hier)).inhalt
  : ansicht === 'schichten' ? schichtenAnsicht()
  : await verlaufAnsicht()}
</div>`;
    res.status(fehler ? fehler.status : 200)
      .send(seite(kx, ansicht === 'uebersicht' ? e.name : `${e.name} · ${ANSICHT_TEXT[ansicht]}`, 'einsaetze', inhalt, { breit: true }));
  };

  app.get('/einsaetze/:id', nurAufgebot, async (req, res) => {
    // Alte Links mit Filter der Personen führen auf den Reiter «Anmeldungen».
    if (typeof req.query.personen === 'string') {
      res.redirect(303, besetzenPfad(leseId(req.params.id), null, req.query.personen === 'warnung' ? 'warnung' : undefined));
      return;
    }
    await einsatzSeite(req, res, 'uebersicht');
  });
  app.get('/einsaetze/:id/besetzen', nurAufgebot, (req, res) => einsatzSeite(req, res, 'besetzen'));
  // Alte Adresse des Reiters «Anmeldungen» (bis 20.11.2026).
  app.get('/einsaetze/:id/anmeldungen', nurAufgebot, (req, res) => {
    const f = req.query.personen === 'warnung' ? 'warnung' : undefined;
    res.redirect(303, besetzenPfad(leseId(req.params.id), null, f));
  });
  app.get('/einsaetze/:id/schichten', nurAufgebot, (req, res) => einsatzSeite(req, res, 'schichten'));
  app.get('/einsaetze/:id/verlauf', nurAufgebot, (req, res) => einsatzSeite(req, res, 'verlauf'));

  // Reiter «Schichten» (Vorschlag Yann 20.11.2026): Speichern einer Schicht. Fehler erscheinen in der aufgeklappten Zeile.
  app.post('/schichten/:sid', nurAufgebot, async (req, res) => {
    const sid = leseId(req.params.sid);
    const s = await ladeSchicht(db, sid);
    try {
      await aendereSchicht(db, sid, { ...req.body, rollen: req.body.rollen ?? {} });
      zurueck(req, res, `/einsaetze/${s.einsatz_id}/schichten?offen=${sid}#schicht-${sid}`, 'Schicht gespeichert.');
    } catch (f) {
      if (!(f instanceof Eingabefehler)) throw f;
      // Konflikt: Die Eingaben bleiben. Ein zweites Speichern überschreibt bewusst den neuen Stand.
      const konflikt = f instanceof Konflikt;
      req.params.id = String(s.einsatz_id);
      await einsatzSeite(req, res, 'schichten', { sid, werte: req.body, fehler: f.message, version: konflikt ? f.aktuelleVersion : req.body.version, status: konflikt ? 409 : 400 });
    }
  });

  app.post('/einsaetze/:id/schichten', nurAufgebot, async (req, res) => {
    const einsatzId = leseId(req.params.id);
    try {
      const sid = await erstelleSchicht(db, einsatzId, { ...req.body, end_datum: req.body?.end_datum ?? '' });
      zurueck(req, res, `/einsaetze/${einsatzId}/schichten?offen=${sid}#schicht-${sid}`, 'Schicht hinzugefügt. Sie ist nicht publiziert.');
    } catch (f) {
      if (!(f instanceof Eingabefehler)) throw f;
      await einsatzSeite(req, res, 'schichten', { sid: 'neu', werte: req.body, fehler: f.message, status: 400 });
    }
  });

  app.post('/schichten/:sid/kopieren', nurAufgebot, async (req, res) => {
    const s = await ladeSchicht(db, leseId(req.params.sid));
    const neu = await kopiereSchicht(db, s.id);
    zurueck(req, res, `/einsaetze/${s.einsatz_id}/schichten?offen=${neu}#schicht-${neu}`, 'Schicht kopiert. Die Kopie ist nicht publiziert.');
  });

  // Alte Seiten «Schicht bearbeiten» und «Schicht hinzufügen»: Der Reiter «Schichten» ersetzt sie.
  app.get('/schichten/:sid/bearbeiten', nurAufgebot, async (req, res) => {
    const s = await ladeSchicht(db, leseId(req.params.sid));
    res.redirect(303, `/einsaetze/${s.einsatz_id}/schichten?offen=${s.id}#schicht-${s.id}`);
  });
  app.get('/einsaetze/:id/schichten/neu', nurAufgebot, (req, res) => {
    res.redirect(303, `/einsaetze/${leseId(req.params.id)}/schichten#neue-schicht`);
  });

  app.get('/einsaetze/:id/bearbeiten', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const e = await ladeEinsatz(db, leseId(req.params.id));
    res.send(seite(kx, `${e.name} bearbeiten`, 'einsaetze', html`${seitenKopf({ pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: e.name, href: `/einsaetze/${e.id}` }, { text: 'Bearbeiten' }], titel: 'Einsatz bearbeiten' })}${einsatzFormular(kx, `/einsaetze/${e.id}`, e as unknown as Record<string, unknown>, false, null)}`));
  });

  app.post('/einsaetze/:id', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const id = leseId(req.params.id);
    try {
      await aendereEinsatz(db, id, req.body);
      zurueck(req, res, `/einsaetze/${id}`);
    } catch (e) {
      if (!(e instanceof Eingabefehler)) throw e;
      // Konflikt: Die Eingaben bleiben. Ein zweites Speichern überschreibt bewusst den neuen Stand.
      const konflikt = e instanceof Konflikt;
      const werte = konflikt ? { ...req.body, version: e.aktuelleVersion } : req.body;
      res.status(konflikt ? 409 : 400).send(seite(kx, 'Einsatz bearbeiten', 'einsaetze', html`${seitenKopf({ pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: 'Bearbeiten' }], titel: 'Einsatz bearbeiten' })}${
        konflikt ? html`<p><a href="/einsaetze/${id}" target="_blank" rel="noopener">Aktuellen Stand in neuem Tab öffnen</a></p>` : ''
      }${einsatzFormular(kx, `/einsaetze/${id}`, werte, false, e.message)}`));
    }
  });

  app.get('/einsaetze/:id/kopieren', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const e = await ladeEinsatz(db, leseId(req.params.id));
    const v = await vorgabeKopie(db, e.id);
    res.send(seite(kx, 'Einsatz kopieren', 'einsaetze', html`
${seitenKopf({ pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: e.name, href: `/einsaetze/${e.id}` }, { text: 'Kopieren' }], titel: 'Einsatz kopieren' })}
<p>Das Tool kopiert alle Schichten mit Ort, Vorgaben, Rollenbedarf und Bemerkungen. Es kopiert keine Anmeldungen und keine Fremdabteilungen. Alle Schichten sind danach nicht publiziert.</p>
<form method="post" action="/einsaetze/${e.id}/kopieren" class="formular-raster">
  ${formFelder(kx)}
  <div class="feld breit"><label for="name">Neuer Name</label><input id="name" name="name" required maxlength="255" value="${v.name}"></div>
  <div class="feld"><label for="start_datum">Neues Startdatum</label><input id="start_datum" type="date" name="start_datum" required value="${v.startDatum}"></div>
  <div class="aktionen breit"><button type="submit" class="knopf haupt">Kopie erstellen</button></div>
</form>`));
  });

  app.post('/einsaetze/:id/kopieren', nurAufgebot, async (req, res) => {
    const neu = await kopiereEinsatz(db, leseId(req.params.id), req.body, k(res).benutzer!.id);
    zurueck(req, res, `/einsaetze/${neu}`, 'Kopie erstellt. Alle Schichten sind nicht publiziert.');
  });

  // Regel 21.3: Löschen nur nach Bestätigung, mit Zahl der Anmeldungen.
  app.get('/einsaetze/:id/loeschen', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const e = await ladeEinsatz(db, leseId(req.params.id));
    const n = await anzahlAnmeldungenEinsatz(db, e.id);
    res.send(seite(kx, 'Einsatz löschen', 'einsaetze', html`
${seitenKopf({ pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: e.name, href: `/einsaetze/${e.id}` }, { text: 'Löschen' }], titel: `Einsatz «${e.name}» löschen?` })}
<p class="meldung fehler">${n > 0 ? `Der Einsatz hat ${n} Anmeldungen. ` : ''}Das Tool löscht den Einsatz mit allen Schichten und Anmeldungen. Es gibt keine Wiederherstellung. Nur das nächtliche Backup enthält die Daten noch.</p>
<form method="post" action="/einsaetze/${e.id}/loeschen" class="stapel">
  ${formFelder(kx)}
  <label class="haken"><input type="checkbox" name="bestaetigt" value="1" required> Ja, Einsatz endgültig löschen</label>
  <div class="knopfreihe"><button class="knopf gefahr" type="submit">Löschen</button> <a class="knopf" href="/einsaetze/${e.id}">Abbrechen</a></div>
</form>`));
  });

  app.post('/einsaetze/:id/loeschen', nurAufgebot, async (req, res) => {
    const id = leseId(req.params.id);
    if (req.body?.bestaetigt !== '1') throw new Eingabefehler('Bestätige das Löschen mit dem Häkchen.');
    await loescheEinsatz(db, id);
    zurueck(req, res, '/einsaetze', 'Einsatz gelöscht.');
  });

  app.post('/einsaetze/:id/alle-bestaetigen', nurAufgebot, async (req, res) => {
    const id = leseId(req.params.id);
    const ids = (await schichtenVonEinsatz(db, id)).filter((s) => s.end_zeit > jetztIso()).map((s) => s.id);
    const { ergebnis: n, schluessel } = await mitRueckgaengig(db, k(res).benutzer!.id, () => bestaetigeAlle(db, ids, k(res).benutzer!.id));
    zurueck(req, res, `/einsaetze/${id}`, `${n} Anmeldungen bestätigt.`, 'ok', schluessel);
  });

  app.get('/einsaetze/:id/export.csv', nurAufgebot, async (req, res) => {
    const e = await ladeEinsatz(db, leseId(req.params.id));
    sendeCsv(res, `teilnehmer-${dateiTeil(e.name)}.csv`, await teilnehmerlisteCsv(db, e.id));
  });

  app.get('/einsaetze/:id/teilnehmerliste', nurAufgebot, async (req, res) => {
    const e = await ladeEinsatz(db, leseId(req.params.id));
    res.send(await teilnehmerlisteDruck(deps, e, req.query.umfang === 'beide'));
  });
}

export type Ansicht = 'uebersicht' | 'besetzen' | 'schichten' | 'verlauf';

const ANSICHT_TEXT: Record<Ansicht, string> = { uebersicht: 'Übersicht', besetzen: 'Besetzen', schichten: 'Schichten', verlauf: 'Verlauf' };

/** Reiter eines Einsatzes (Vorlage Yann, Handbuch): Übersicht, Anmeldungen, Schichten, Verlauf. */
export function einsatzReiter(einsatzId: number, aktiv: Ansicht, zahlen: { besetzen?: number; schichten?: number } = {}): Reiter[] {
  return [
    { text: 'Übersicht', href: `/einsaetze/${einsatzId}`, aktiv: aktiv === 'uebersicht' },
    { text: 'Besetzen', href: `/einsaetze/${einsatzId}/besetzen`, aktiv: aktiv === 'besetzen', zahl: zahlen.besetzen },
    { text: 'Schichten', href: `/einsaetze/${einsatzId}/schichten`, aktiv: aktiv === 'schichten', zahl: zahlen.schichten },
    { text: 'Verlauf', href: `/einsaetze/${einsatzId}/verlauf`, aktiv: aktiv === 'verlauf' },
  ];
}

/** Menü «Dokumente»: alles zum Drucken und Exportieren, nach Schicht gegliedert. */
function dokumenteMenue(einsatzId: number, schichten: { id: number; name: string }[]): Roh {
  const jeSchicht = (s: { id: number; name: string }) => [
    html`<a href="/schichten/${s.id}/aufgebot" target="_blank" rel="noopener">Aufgebot (Briefe)</a>`,
    html`<a href="/schichten/${s.id}/essensliste.csv">Essensliste (CSV)</a>`,
    html`<a href="/schichten/${s.id}/ics">Kalendertermin (ICS)</a>`,
    html`<a href="/schichten/${s.id}/termintext" target="_blank" rel="noopener">Text für Clubdesk-Termin</a>`,
  ];
  return mehrMenue([
    html`<div class="menue-titel">Ganzer Einsatz</div>`,
    html`<a href="/einsaetze/${einsatzId}/teilnehmerliste" target="_blank" rel="noopener">Teilnehmerliste drucken</a>`,
    html`<a href="/einsaetze/${einsatzId}/export.csv">Teilnehmerliste als CSV</a>`,
    ...schichten.flatMap((s) => [html`<div class="menue-trenner"></div><div class="menue-titel">${schichten.length > 1 ? s.name : 'Schicht'}</div>`, ...jeSchicht(s)]),
  ], 'Dokumente');
}

export function dateiTeil(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}

export function sendeCsv(res: Response, dateiname: string, inhalt: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
  res.send(inhalt);
}

/** Teilnehmerliste zum Drucken: je Schicht ein Block, Fremdabteilungen, Verpflegung für die Küche. */
async function teilnehmerlisteDruck(deps: Abhaengigkeiten, e: Einsatz, auchAngemeldet: boolean): Promise<string> {
  const schichten = await schichtenVonEinsatz(deps.db, e.id);
  const status = auchAngemeldet ? ['bestaetigt', 'angemeldet'] : ['bestaetigt'];
  const bloecke: Roh[] = [];
  for (const s of schichten) {
    const personen = await alle<any>(
      deps.db,
      `SELECT a.name_text, a.rolle, a.status, p.vorname, p.nachname, p.telefon, p.telefon_privat, p.essenseinschraenkung,
              r.name AS rang_name, r.reihenfolge AS rang_reihenfolge
         FROM anmeldung a LEFT JOIN person p ON p.clubdesk_id = a.person_id LEFT JOIN rang r ON r.id = p.rang_id
        WHERE a.schicht_id = ? AND a.status IN (?)`,
      [s.id, status],
    );
    for (const p of personen) {
      if (!p.vorname && !p.nachname) p.vorname = p.name_text;
    }
    personen.sort(nachRangTiefZuerst);
    const fremd = await alle<any>(deps.db, 'SELECT name, anzahl, bemerkung FROM fremdabteilung WHERE schicht_id = ? ORDER BY id', [s.id]);
    const essen = new Map<string, number>();
    let ohne = 0;
    for (const p of personen) {
      const t = (p.essenseinschraenkung ?? '').trim();
      if (!t) ohne++;
      else essen.set(t.toLowerCase(), (essen.get(t.toLowerCase()) ?? 0) + 1);
    }
    const fremdTotal = fremd.reduce((n: number, f: any) => n + Number(f.anzahl), 0);
    const total = personen.length + fremdTotal;
    const teile = [...essen.entries()].map(([t, n]) => `${n} × ${t}`);
    teile.push(`${ohne} ohne Einschränkung`);
    if (fremdTotal) teile.push(`${fremdTotal} Fremdabteilungen`);
    teile.push(`Total Essen ${total}`);
    bloecke.push(html`<section class="druck-block">
  <h2>${e.name}${schichten.length > 1 ? ` – ${s.name}` : ''}</h2>
  <p class="unter">${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)}${s.ort ? ` · ${s.ort}` : ''}</p>
  <table class="tabelle druck-tabelle">
    <thead><tr><th>Rang</th><th>Name</th><th>Mobil</th><th>Rolle</th><th>Essen</th>${auchAngemeldet ? html`<th>Status</th>` : ''}</tr></thead>
    <tbody>${personen.map((p) => html`<tr>
      <td>${p.rang_name ?? ''}</td><td>${`${p.vorname ?? ''} ${p.nachname ?? ''}`.trim()}</td><td>${hauptnummer(p) ?? ''}</td>
      <td>${p.rolle ?? ''}</td><td>${p.essenseinschraenkung ?? ''}</td>${auchAngemeldet ? html`<td>${p.status === 'bestaetigt' ? 'bestätigt' : 'angemeldet'}</td>` : ''}
    </tr>`)}</tbody>
  </table>
  ${fremd.length ? html`<h3>Fremdabteilungen</h3><table class="tabelle druck-tabelle"><thead><tr><th>Name</th><th>Anzahl</th><th>Bemerkung</th></tr></thead>
    <tbody>${fremd.map((f: any) => html`<tr><td>${f.name}</td><td>${f.anzahl}</td><td>${f.bemerkung ?? ''}</td></tr>`)}</tbody></table>` : ''}
  <p class="verpflegung"><strong>Verpflegung:</strong> ${teile.join(' · ')}</p>
</section>`);
  }
  return druckseite(
    `Teilnehmerliste ${e.name}`,
    html`<div class="druck-steuerung nicht-drucken">
  <a href="/einsaetze/${e.id}">← Zurück</a>
  <a href="/einsaetze/${e.id}/teilnehmerliste"${auchAngemeldet ? '' : new Roh(' aria-current="page"')}>Nur bestätigte</a>
  <a href="/einsaetze/${e.id}/teilnehmerliste?umfang=beide"${auchAngemeldet ? new Roh(' aria-current="page"') : ''}>Bestätigte + angemeldete</a>
  <button type="button" class="knopf haupt" data-drucken>Drucken</button>
</div>
${bloecke}`,
  );
}

export { telefonText, knopfPost };
export type { Request };

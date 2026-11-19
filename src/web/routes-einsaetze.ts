// Einsätze: Liste, Erstellen, Übersicht mit Matrix, Ändern, Kopieren, Löschen, Exporte (14.1, 14.2, 21).
import type { Express, Request, Response } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot, zurueck } from './app.js';
import {
  aendereEinsatz, anzahlAnmeldungenEinsatz, einsatzListe, type EinsatzZeile, erstelleEinsatz, kopiereEinsatz, ladeEinsatz, loescheEinsatz, vorgabeKopie,
  type Einsatz,
} from '../domain/einsatz.js';
import { anzeigeZeiten, passtInTabelle, schichtenVonEinsatz, speichereSchichtTabelle, zeilenAbdruck, type SchichtZeile } from '../domain/schicht.js';
import { bestaetigeAlle, verlaufEinsatz } from '../domain/anmeldung.js';
import { logText } from './routes-schichten.js';
import { warnungenFuerSchichten } from '../domain/warnungen.js';
import { sollFarbe, zahlenFuerSchichten } from '../domain/zaehlung.js';
import { teilnehmerlisteCsv } from '../domain/export.js';
import { rollen as ladeRollen } from '../domain/stammdaten.js';
import { Eingabefehler, Konflikt, KANAL_TEXT, STATUS_TEXT, id as leseId, type Kanal, type Status } from '../domain/eingabe.js';
import { einsatzLage, type ZuTunPunkt } from '../domain/einsatz-lage.js';
import { alle } from '../db/db.js';
import { html, mehrzeilig, Roh } from './html.js';
import { k, aktuellerPfad } from './kontext.js';
import { druckseite, formFelder, mehrMenue, seite, seitenKopf, type Reiter } from './views/layout.js';
import {
  abgleichPunkt, datumZeit, istSoll, kachel, kachelLegende, KACHEL_TEXT, knopfPost, publiziertMarke, punktMarke, statusText, warnungen, zeitraum, type KachelArt,
} from './views/teile.js';
import { datumChVonIso, jetztIso, lokalesDatum, lokaleZeit, wochentagKurz } from '../domain/zeit.js';

/** Name der Rolle für die Einsatzleitung (wie im Aufgebot, Regel 20.3). */
const EINSATZLEITUNG = 'Einsatzleitung';
import { telefonText, hauptnummer } from '../domain/personen.js';
import { nachRangTiefZuerst } from '../domain/listen.js';

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
  <div class="feld breit"><label for="bemerkung_extern">Bemerkung extern</label><textarea id="bemerkung_extern" name="bemerkung_extern" rows="3" maxlength="5000">${v('bemerkung_extern')}</textarea><small>Sichtbar im Formular.</small></div>`}
  <div class="aktionen breit"><button type="submit" class="knopf haupt">${neu ? 'Einsatz erstellen' : 'Speichern'}</button></div>
</form>`;
}

export function registriereEinsaetze(app: Express, deps: Abhaengigkeiten): void {
  const { db } = deps;

  app.get('/einsaetze', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const archiv = req.query.ansicht === 'archiv';
    const q = req.query;
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
  ${filter.von || filter.bis || status !== 'alle' ? html`<a class="link-knopf" href="/einsaetze${archiv ? '?ansicht=archiv' : ''}">Filter löschen</a>` : ''}
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
    <td class="zahl">${e.unbestaetigt ? html`<a href="/einsaetze/${e.id}/anmeldungen?personen=offen" class="orange-text">${e.unbestaetigt}</a>` : '–'}</td>
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
  const einsatzSeite = async (req: Request, res: Response, ansicht: Ansicht, tabelle?: { werte: Record<string, any>; fehler: string }) => {
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

    // Zeilen der Personen: bekannte Personen oder unbekannte Einträge, je mit einem Feld pro Schicht.
    type Zeile = { schluessel: string; name: string; rang_name: string | null; rang_reihenfolge: number | null; vorname: string | null; nachname: string | null; personId: number | null; zellen: Map<number, any> };
    const zeilen = new Map<string, Zeile>();
    for (const a of eintraege) {
      const schluessel = a.person_id !== null ? `p${a.person_id}` : `u${a.id}`;
      if (!zeilen.has(schluessel)) {
        zeilen.set(schluessel, {
          schluessel, name: a.name, rang_name: a.rang_name, rang_reihenfolge: a.rang_reihenfolge,
          vorname: a.vorname ?? a.name, nachname: a.nachname ?? '', personId: a.person_id, zellen: new Map(),
        });
      }
      zeilen.get(schluessel)!.zellen.set(a.schicht_id, a);
    }
    const alleZeilen = [...zeilen.values()].sort(nachRangTiefZuerst);
    const mitWarnung = (z: Zeile) => [...z.zellen.values()].some((a) => (w.get(a.schicht_id)?.anmeldungen.get(a.id)?.length ?? 0) > 0);
    const offen = (z: Zeile) => [...z.zellen.values()].some((a) => a.status === 'angemeldet' || a.status === 'unsicher' || a.status === 'nachricht_gesendet');
    const filter = req.query.personen === 'offen' ? 'offen' : req.query.personen === 'warnung' ? 'warnung' : null;
    const sichtbar = filter === 'offen' ? alleZeilen.filter(offen) : filter === 'warnung' ? alleZeilen.filter(mitWarnung) : alleZeilen;

    const ende = schichten.reduce((m, sc) => (sc.end_zeit > m ? sc.end_zeit : m), schichten[0]?.end_zeit ?? '');
    const name = (z: { rang_name: string | null; name: string }) => html`${z.rang_name ? html`<span class="rang">${z.rang_name}</span> ` : ''}${z.name}`;
    const eintragLink = (sid: number, personId: number) => `/rueckmeldungen/eintrag?schicht=${sid}&person=${personId}&zurueck=${encodeURIComponent(hier)}`;

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
      switch (p.art) {
        case 'fehlt': return html`<a class="knopf klein" href="/schichten/${p.schichtId}/anrufliste">Anrufliste</a>`;
        case 'kein_soll': return html`<a class="knopf klein" href="/schichten/${p.schichtId}/bearbeiten">Soll setzen</a>`;
        case 'unbestaetigt': return knopfPost(kx, `/einsaetze/${e.id}/alle-bestaetigen`, lage.unbestaetigt === 1 ? 'Bestätigen' : `Alle ${lage.unbestaetigt} bestätigen`, {}, 'knopf klein', hier);
        case 'offen': return html`<a class="knopf klein" href="/schichten/${p.schichtId}?status=${p.status}">Zeigen</a>`;
        case 'einsatzleitung': return html`<a class="knopf klein" href="/schichten/${p.schichtId}">Eintragen</a>`;
        case 'zeit_offen': return html`<a class="knopf klein" href="/einsaetze/${e.id}/schichten">Zeiten eintragen</a>`;
        default: return html`<a class="knopf klein" href="/schichten/${p.schichtId}">Zeigen</a>`;
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
    <td><div class="schicht-name">${abgleichPunkt(ws.abgleich)} <a href="/schichten/${s.id}">${s.name}</a></div><div class="unter">${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)}${s.ort ? ` · ${s.ort}` : ''}</div></td>
    <td>${belegung(z, s.soll_anzahl)}</td>
    <td>${pillen.length ? html`<span class="pillen">${pillen}</span>` : html`<span class="unter">–</span>`}</td>
    <td>${z.rollen.length ? html`<span class="pillen">${z.rollen.map((r) => html`<span class="pille ${r.ist >= r.soll ? 'gruen' : 'rot'}">${r.rolle} ${r.ist}/${r.soll}</span>`)}</span>` : html`<span class="unter">–</span>`}</td>
    <td class="zahl">${z.essen}</td>
    <td><form method="post" action="/schichten/${s.id}/publizieren" class="inline">
        ${formFelder(kx, hier)}
        <input type="hidden" name="publiziert" value="${s.publiziert ? '0' : '1'}">
        <button type="submit" class="schalter${s.publiziert ? ' an' : ''}" aria-pressed="${s.publiziert ? 'true' : 'false'}">${s.publiziert ? 'Publiziert' : 'Nicht publiziert'}</button>
      </form></td>
    <td class="aktionen-zelle"><a class="knopf klein" href="/schichten/${s.id}">Öffnen ›</a></td>
  </tr>`;
  })}</tbody>
</table></div>`}
</section>`;

    // ---------- Personen ----------
    const filterChips = html`<p class="filter-chips">
  <a href="/einsaetze/${e.id}/anmeldungen"${filter ? '' : new Roh(' aria-current="page"')}>Alle ${alleZeilen.length}</a>
  <a href="/einsaetze/${e.id}/anmeldungen?personen=offen"${filter === 'offen' ? new Roh(' aria-current="page"') : ''}>Offen ${alleZeilen.filter(offen).length}</a>
  <a href="/einsaetze/${e.id}/anmeldungen?personen=warnung"${filter === 'warnung' ? new Roh(' aria-current="page"') : ''}>Mit Warnung ${alleZeilen.filter(mitWarnung).length}</a>
</p>`;
    const suche = html`<input type="search" class="suche" data-filter=".personen-tabelle tbody tr" placeholder="Name suchen …" aria-label="Personen suchen">`;
    const titelPersonen = html`<div class="titelzeile filterzeile"><h2 id="personen-titel">Anmeldungen</h2>${alleZeilen.length ? suche : ''}</div>${alleZeilen.length ? filterChips : ''}`;

    // Mehrere Schichten: Kacheln wie in den Rückmeldungen. Ein Klick öffnet das Fenster zum Eintragen.
    const feld = (z: Zeile, s: (typeof schichten)[number]) => {
      const a = z.zellen.get(s.id);
      const wl = a ? w.get(s.id)?.anmeldungen.get(a.id) : undefined;
      let art: KachelArt = a ? (a.status as Status) : null;
      if (!a && z.personId !== null) {
        // Hinweis wie in den Rückmeldungen: Die Person ist in einer anderen Schicht dieses Einsatzes an.
        const andere = schichten.filter((x) => x.id !== s.id && z.zellen.get(x.id) && an(z.zellen.get(x.id)));
        if (andere.length) art = andere.some((x) => x.start_zeit < s.end_zeit && s.start_zeit < x.end_zeit) ? 'gleich' : 'moeglich';
      }
      const titel = a
        ? `${STATUS_TEXT[a.status as Status]}${a.rolle ? ` · ${a.rolle}` : ''}${a.bemerkung ? ` · Bemerkung: ${a.bemerkung}` : ''}${wl?.length ? ` · ⚠ ${wl.map((x) => x.text).join(' ')}` : ''}`
        : art ? KACHEL_TEXT[art as 'gleich' | 'moeglich'] : 'nicht gefragt';
      const innen = html`<span class="kachel-huelle">${kachel(art)}${wl?.length ? html`<span class="warn-marke" aria-hidden="true">!</span>` : ''}${a?.bemerkung ? html`<span class="bemerkung-marke" aria-hidden="true">✎</span>` : ''}</span>${a?.rolle ? html`<small class="rolle">${a.rolle}</small>` : ''}<span class="sr">${titel}</span>`;
      if (z.personId !== null) return html`<td class="zelle-klick"><a href="${eintragLink(s.id, z.personId)}" data-eintrag title="${titel} – Klick zum Eintragen">${innen}</a></td>`;
      if (a) return html`<td class="zelle-klick"><a href="/schichten/${s.id}" title="${titel} – in der Schicht bearbeiten">${innen}</a></td>`;
      return html`<td></td>`;
    };
    const summe = (s: (typeof schichten)[number], n: 'an' | 'ab' | 'unsicher') => {
      const z = zahlen.get(s.id)!;
      return n === 'an' ? z.bestaetigt + z.unbestaetigt : n === 'ab' ? z.abgemeldet : z.unsicher;
    };
    const matrix = html`${kachelLegende()}
<div class="rahmen rueck-rahmen"><table class="tabelle rueck personen-tabelle">
  <thead><tr><th class="name-spalte">Person</th>${schichten.map((s) => html`<th class="schicht-kopf"><a class="s" href="/schichten/${s.id}">${s.name}</a><span class="d">${wochentagKurz(s.start_zeit)} ${datumChVonIso(s.start_zeit).slice(0, 6)} ${lokaleZeit(s.start_zeit)}</span></th>`)}</tr></thead>
  <tbody>${sichtbar.map((z) => html`<tr data-suche="${`${z.name} ${z.rang_name ?? ''}`.toLowerCase()}">
    <th class="name-spalte">${z.personId !== null
      ? html`<a href="/personen/${z.personId}"><span class="rang">${z.rang_name ?? ''}</span><span class="name">${z.name}</span></a>`
      : html`<a href="/anmeldungen/unbekannt"><span class="rang"></span><span class="name">${z.name}</span></a> <span class="pille orange">unbekannt</span>`}</th>
    ${schichten.map((s) => feld(z, s))}
  </tr>`)}</tbody>
  <tfoot>${(['an', 'ab', 'unsicher'] as const).map((n) => html`<tr><th class="name-spalte">${{ an: 'An', ab: 'Ab', unsicher: 'Unsicher' }[n]}</th>${schichten.map((s) => html`<td>${summe(s, n)}</td>`)}</tr>`)}</tfoot>
</table></div>`;

    // Eine Schicht: Eine Matrix mit einer Spalte hilft nicht. Die Seite zeigt eine Liste.
    const liste = () => {
      const s = schichten[0];
      return html`<div class="rahmen"><table class="tabelle personen-tabelle">
  <thead><tr><th>Person</th><th>Status</th><th>Rolle</th><th>Kanal</th><th>Bemerkung</th><th>Warnungen</th><th><span class="sr">Aktionen</span></th></tr></thead>
  <tbody>${sichtbar.map((z) => {
    const a = z.zellen.get(s.id)!;
    return html`<tr class="${a.status === 'angemeldet' ? 'unbestaetigt' : ''}" data-suche="${`${z.name} ${z.rang_name ?? ''}`.toLowerCase()}">
    <td>${z.personId !== null ? html`<a href="/personen/${z.personId}">${name(z)}</a>` : html`${z.name} <span class="pille orange">unbekannt</span>`}</td>
    <td>${statusText(a.status as Status)}</td>
    <td>${a.rolle ?? ''}</td>
    <td>${KANAL_TEXT[a.kanal as Kanal]}</td>
    <td class="bemerkung">${mehrzeilig(a.bemerkung)}</td>
    <td>${warnungen(w.get(s.id)?.anmeldungen.get(a.id))}</td>
    <td class="aktionen-zelle">${a.status !== 'bestaetigt' ? knopfPost(kx, `/anmeldungen/${a.id}`, 'Bestätigen', { status: 'bestaetigt' }, 'knopf klein', hier) : ''}
      ${z.personId !== null ? html`<a class="knopf klein" href="${eintragLink(s.id, z.personId)}" data-eintrag>Ändern</a>` : html`<a class="knopf klein" href="/schichten/${s.id}">Ändern</a>`}</td>
  </tr>`;
  })}</tbody>
</table></div>`;
    };

    const personen = html`<section aria-labelledby="personen-titel">${titelPersonen}
${!alleZeilen.length
  ? html`<p class="leer">Noch keine Einträge. Personen trägst du in der Schicht oder in den Rückmeldungen ein.</p>`
  : !sichtbar.length
    ? html`<p class="leer">Keine Person passt zum Filter.</p>`
    : schichten.length === 1 ? liste() : matrix}
</section>`;

    // ---------- Kopf: Leitung ----------
    const elPersonen = [...new Map(elEintraege.map((a) => [a.person_id ?? `u${a.id}`, a])).values()];
    const leitung = elPersonen.length ? elPersonen.map((a, i) => html`${i ? ', ' : ''}${name(a)}`) : '–';

    // ---------- Reiter «Schichten»: Karten je Schicht ----------
    const schichtKarten = () => html`<section aria-labelledby="karten-titel">
<h2 id="karten-titel" class="sr">Schichten</h2>
${!schichten.length ? html`<p class="leer">Keine Schichten.</p>` : html`<div class="schicht-karten">${schichten.map((s) => {
  const z = zahlen.get(s.id)!;
  const fehlt = s.soll_anzahl && s.soll_anzahl > z.teilnehmende ? s.soll_anzahl - z.teilnehmende : 0;
  const leute = eintraege.filter((a) => a.schicht_id === s.id && an(a)).sort((x, y) => (x.status === y.status ? nachRangTiefZuerst(x, y) : x.status === 'bestaetigt' ? -1 : 1));
  const zeigen = leute.slice(0, 12);
  return html`<article class="karte schicht-karte2${s.end_zeit <= jetzt ? ' vergangen' : ''}">
  <header>
    <div><h3><a href="/schichten/${s.id}">${s.name}</a></h3><p class="unter">${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)}</p></div>
    <div class="karte-besetzung">
      <span class="unter">Besetzung</span>
      <span class="karte-zahl f-${sollFarbe(z.teilnehmende, s.soll_anzahl)}"><strong>${z.teilnehmende}${s.soll_anzahl ? ` / ${s.soll_anzahl}` : ''}</strong>${fehlt ? ` · ${fehlt} fehlen` : ''}</span>
      ${belegung(z, s.soll_anzahl, false)}
    </div>
  </header>
  ${z.rollen.length ? html`<p class="pillen">${z.rollen.map((r) => html`<span class="pille ${r.ist >= r.soll ? 'gruen' : 'rot'}">${r.rolle} ${r.ist}/${r.soll}</span>`)}</p>` : ''}
  ${!leute.length ? html`<p class="leer karte-leer">Noch niemand zugeteilt.</p>` : html`<ul class="karte-personen">${zeigen.map((a) => html`<li><span>${name(a)}${a.rolle ? html` <span class="unter">· ${a.rolle}</span>` : ''}</span>${statusText(a.status as Status)}</li>`)}${leute.length > zeigen.length ? html`<li class="unter">+ ${leute.length - zeigen.length} weitere</li>` : ''}</ul>`}
  <footer>
    <a class="knopf klein" href="/schichten/${s.id}">Öffnen</a>
    <a class="knopf klein" href="/schichten/${s.id}/anrufliste">Anrufliste</a>
    <form method="post" action="/schichten/${s.id}/publizieren" class="inline">
      ${formFelder(kx, hier)}
      <input type="hidden" name="publiziert" value="${s.publiziert ? '0' : '1'}">
      <button type="submit" class="schalter${s.publiziert ? ' an' : ''}" aria-pressed="${s.publiziert ? 'true' : 'false'}">${s.publiziert ? 'Publiziert' : 'Nicht publiziert'}</button>
    </form>
  </footer>
</article>`;
})}</div>`}
</section>`;

    // ---------- Reiter «Schichten»: Tabelle «Schichten bearbeiten» ----------
    const bearbeitenTabelle = async () => {
      const bedarf = ids.length
        ? await alle<{ schicht_id: number; rolle: string; anzahl: number }>(db, 'SELECT schicht_id, rolle, anzahl FROM schicht_rolle WHERE schicht_id IN (?)', [ids])
        : [];
      const werte = tabelle?.werte ?? {};
      const zeileAusDb = (s: (typeof schichten)[number]): SchichtZeile => ({
        name: s.name, datum: lokalesDatum(s.start_zeit), beginn: anzeigeZeiten(s).beginn, ende: anzeigeZeiten(s).ende,
        soll_anzahl: s.soll_anzahl ?? '', ort: s.ort ?? '', bemerkung_intern: s.bemerkung_intern ?? '',
        rollen: Object.fromEntries(bedarf.filter((b) => b.schicht_id === s.id).map((b) => [b.rolle, String(b.anzahl)])),
      });
      const wert = (z: SchichtZeile, feld: keyof SchichtZeile) => (z[feld] === null || z[feld] === undefined ? '' : String(z[feld]));
      const rolleWert = (z: SchichtZeile, rolle: string) => {
        const w = z.rollen?.[rolle];
        return w === null || w === undefined ? '' : String(w);
      };
      const zellen = (schluessel: string, z: SchichtZeile, neu: boolean) => html`
    <td><input name="z[${schluessel}][name]" value="${wert(z, 'name')}" maxlength="255" aria-label="Name"${neu ? new Roh(' placeholder="+ Neue Schicht"') : new Roh(' required')}></td>
    <td><input type="date" name="z[${schluessel}][datum]" value="${wert(z, 'datum')}" aria-label="Datum"></td>
    <td><input type="time" name="z[${schluessel}][beginn]" value="${wert(z, 'beginn')}" aria-label="Beginn"></td>
    <td><input type="time" name="z[${schluessel}][ende]" value="${wert(z, 'ende')}" aria-label="Ende"></td>
    ${rollen.map((r) => html`<td class="zahl"><input class="zahl-feld" type="number" min="0" max="10000" name="z[${schluessel}][rollen][${r.name}]" value="${rolleWert(z, r.name)}" placeholder="–" aria-label="${r.name}"></td>`)}
    <td class="zahl"><input class="zahl-feld" type="number" min="0" max="100000" name="z[${schluessel}][soll_anzahl]" value="${wert(z, 'soll_anzahl')}" placeholder="–" aria-label="Soll"></td>
    <td><input name="z[${schluessel}][ort]" value="${wert(z, 'ort')}" maxlength="255" placeholder="${e.ort ?? 'Ort'}" aria-label="Antretensort"></td>
    <td><input name="z[${schluessel}][bemerkung_intern]" value="${wert(z, 'bemerkung_intern')}" maxlength="5000" aria-label="Interne Bemerkung"></td>`;
      const tagVorgabe = schichten.length ? lokalesDatum(schichten[schichten.length - 1].start_zeit) : '';
      return html`<section aria-labelledby="bearbeiten-titel" class="schichten-bearbeiten">
<div class="titelzeile"><h2 id="bearbeiten-titel">Schichten bearbeiten <span class="unter">Name, Tag, Zeit, Soll und Bedarf je Rolle</span></h2></div>
${tabelle ? html`<div class="meldung fehler" role="alert">${tabelle.fehler}</div>` : ''}
<form method="post" action="/einsaetze/${e.id}/schichten/tabelle" class="tabelle-formular">
  ${formFelder(kx)}
  <div class="rahmen"><table class="tabelle bearbeiten-tabelle">
    <thead><tr><th>Name</th><th>Datum</th><th>Beginn</th><th>Ende</th>${rollen.map((r) => html`<th class="zahl" title="Bedarf ${r.name}">${r.name}</th>`)}<th class="zahl">Soll</th><th>Antretensort</th><th>Interne Bemerkung</th><th><span class="sr">Aktionen</span></th></tr></thead>
    <tbody>
    ${schichten.map((s) => {
      const schluessel = `s${s.id}`;
      if (!passtInTabelle(s)) {
        return html`<tr class="nur-lesen"><td>${s.name}</td><td colspan="${3 + rollen.length + 3}">${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)} <span class="unter">· dauert über den Folgetag hinaus</span></td><td><a class="knopf klein" href="/schichten/${s.id}/bearbeiten">Bearbeiten</a></td></tr>`;
      }
      const ausDb = zeileAusDb(s);
      const gesendet = werte[schluessel] as SchichtZeile | undefined;
      const z = gesendet ?? ausDb;
      const ursprung = typeof gesendet?.ursprung === 'string' ? gesendet.ursprung : zeilenAbdruck(ausDb);
      return html`<tr>
    ${zellen(schluessel, z, false)}
    <td class="aktionen-zelle"><input type="hidden" name="z[${schluessel}][version]" value="${s.version}"><input type="hidden" name="z[${schluessel}][ursprung]" value="${ursprung}"><a class="knopf gefahr klein" href="/schichten/${s.id}/loeschen">Löschen</a></td>
  </tr>`;
    })}
    <tr class="neue-zeile">
      ${zellen('neu', (werte.neu as SchichtZeile | undefined) ?? { name: '', datum: tagVorgabe, beginn: '', ende: '', rollen: {} }, true)}
      <td class="unter">neu</td>
    </tr>
    </tbody>
  </table></div>
  <div class="tabelle-fuss">
    <p class="unter">Ende vor Beginn = Ende am Folgetag. Soll zählt die Teilnehmenden, die Rollen zeigen den Bedarf je Rolle. Tenue, Abtreten, Mindestalter und Hinweis ändert das Formular der Schicht. Neue Schicht: unterste Zeile ausfüllen. Sie ist danach nicht publiziert.</p>
    <button type="submit" class="knopf haupt">Speichern</button>
  </div>
</form>
</section>`;
    };

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
  aktionen: html`<a class="knopf haupt" href="/einsaetze/${e.id}/teilnehmerliste">Teilnehmerliste</a>
    <a class="knopf" href="/einsaetze/${e.id}/bearbeiten">Bearbeiten</a>
    ${mehrMenue([
      html`<a href="/einsaetze/${e.id}/schichten/neu">Schicht hinzufügen</a>`,
      html`<a href="/einsaetze/${e.id}/kopieren">Einsatz kopieren</a>`,
      html`<div class="menue-trenner"></div><div class="menue-titel">Export</div>`,
      html`<a href="/einsaetze/${e.id}/teilnehmerliste">Teilnehmerliste drucken</a>`,
      html`<a href="/einsaetze/${e.id}/export.csv">Teilnehmerliste als CSV</a>`,
      html`<div class="menue-trenner"></div>`,
      html`<a class="gefahr" href="/einsaetze/${e.id}/loeschen">Einsatz löschen</a>`,
    ])}`,
  reiter: einsatzReiter(e.id, ansicht, { anmeldungen: alleZeilen.length, schichten: schichten.length }),
})}
<div class="einsatz-uebersicht">
${ansicht === 'uebersicht' ? html`${steckbrief}${zuTun}${schichtTabelle}`
  : ansicht === 'anmeldungen' ? personen
  : ansicht === 'schichten' ? html`${schichtKarten()}${await bearbeitenTabelle()}`
  : await verlaufAnsicht()}
</div>`;
    res.status(tabelle ? (tabelle.fehler.startsWith('Ein anderer Benutzer') ? 409 : 400) : 200)
      .send(seite(kx, ansicht === 'uebersicht' ? e.name : `${e.name} · ${ANSICHT_TEXT[ansicht]}`, 'einsaetze', inhalt, { breit: true }));
  };

  app.get('/einsaetze/:id', nurAufgebot, async (req, res) => {
    // Alte Links mit Filter der Personen führen auf den Reiter «Anmeldungen».
    if (typeof req.query.personen === 'string') {
      res.redirect(303, `/einsaetze/${leseId(req.params.id)}/anmeldungen?personen=${encodeURIComponent(req.query.personen)}`);
      return;
    }
    await einsatzSeite(req, res, 'uebersicht');
  });
  app.get('/einsaetze/:id/anmeldungen', nurAufgebot, (req, res) => einsatzSeite(req, res, 'anmeldungen'));
  app.get('/einsaetze/:id/schichten', nurAufgebot, (req, res) => einsatzSeite(req, res, 'schichten'));
  app.get('/einsaetze/:id/verlauf', nurAufgebot, (req, res) => einsatzSeite(req, res, 'verlauf'));

  // Tabelle «Schichten bearbeiten»: alle Zeilen in einer Transaktion, dazu eine neue Schicht (unterste Zeile).
  app.post('/einsaetze/:id/schichten/tabelle', nurAufgebot, async (req, res) => {
    const id = leseId(req.params.id);
    const roh = (req.body?.z ?? {}) as Record<string, any>;
    if (typeof roh !== 'object' || Array.isArray(roh)) throw new Eingabefehler('Die Tabelle ist ungültig.');
    const zeilen: SchichtZeile[] = [];
    for (const [schluessel, wert] of Object.entries(roh)) {
      if (!/^s\d+$/.test(schluessel) || typeof wert !== 'object' || wert === null) continue;
      zeilen.push({ ...wert, id: Number(schluessel.slice(1)), rollen: typeof wert.rollen === 'object' && wert.rollen ? wert.rollen : {} });
    }
    const neu = typeof roh.neu === 'object' && roh.neu ? { ...roh.neu, rollen: typeof roh.neu.rollen === 'object' && roh.neu.rollen ? roh.neu.rollen : {} } : null;
    try {
      const r = await speichereSchichtTabelle(db, id, zeilen, neu);
      const teile = [r.geaendert ? `${r.geaendert} ${r.geaendert === 1 ? 'Schicht' : 'Schichten'} gespeichert.` : '', r.neuId ? 'Neue Schicht angelegt. Sie ist nicht publiziert.' : ''].filter(Boolean);
      zurueck(req, res, `/einsaetze/${id}/schichten`, teile.length ? teile.join(' ') : 'Keine Änderung.');
    } catch (fehler) {
      if (!(fehler instanceof Eingabefehler)) throw fehler;
      await einsatzSeite(req, res, 'schichten', { werte: roh, fehler: fehler.message });
    }
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
    const n = await bestaetigeAlle(db, ids, k(res).benutzer!.id);
    zurueck(req, res, `/einsaetze/${id}`, `${n} Anmeldungen bestätigt.`);
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

export type Ansicht = 'uebersicht' | 'anmeldungen' | 'schichten' | 'verlauf';

const ANSICHT_TEXT: Record<Ansicht, string> = { uebersicht: 'Übersicht', anmeldungen: 'Anmeldungen', schichten: 'Schichten', verlauf: 'Verlauf' };

/** Reiter eines Einsatzes (Vorlage Yann, Handbuch): Übersicht, Anmeldungen, Schichten, Verlauf. */
export function einsatzReiter(einsatzId: number, aktiv: Ansicht, zahlen: { anmeldungen?: number; schichten?: number } = {}): Reiter[] {
  return [
    { text: 'Übersicht', href: `/einsaetze/${einsatzId}`, aktiv: aktiv === 'uebersicht' },
    { text: 'Anmeldungen', href: `/einsaetze/${einsatzId}/anmeldungen`, aktiv: aktiv === 'anmeldungen', zahl: zahlen.anmeldungen },
    { text: 'Schichten', href: `/einsaetze/${einsatzId}/schichten`, aktiv: aktiv === 'schichten', zahl: zahlen.schichten },
    { text: 'Verlauf', href: `/einsaetze/${einsatzId}/verlauf`, aktiv: aktiv === 'verlauf' },
  ];
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

// Einsätze: Liste, Erstellen, Übersicht mit Matrix, Ändern, Kopieren, Löschen, Exporte (14.1, 14.2, 21).
import type { Express, Request, Response } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot, zurueck } from './app.js';
import {
  aendereEinsatz, anzahlAnmeldungenEinsatz, einsatzListe, type EinsatzZeile, erstelleEinsatz, kopiereEinsatz, ladeEinsatz, loescheEinsatz, vorgabeKopie,
  type Einsatz,
} from '../domain/einsatz.js';
import { schichtenVonEinsatz } from '../domain/schicht.js';
import { bestaetigeAlle } from '../domain/anmeldung.js';
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
  abgleichPunkt, istSoll, kachel, kachelLegende, KACHEL_TEXT, knopfPost, publiziertMarke, punktMarke, statusText, warnungen, zeitraum, type KachelArt,
} from './views/teile.js';
import { datumChVonIso, jetztIso, lokaleZeit, wochentagKurz } from '../domain/zeit.js';

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
  <div class="feld"><label for="start_datum">Start Datum</label><input id="start_datum" type="date" name="start_datum" required value="${v('start_datum')}"></div>
  <div class="feld"><label for="start_zeit">Start Zeit</label><input id="start_zeit" type="time" name="start_zeit" required value="${v('start_zeit')}"></div>
  <div class="feld"><label for="end_datum">Ende Datum</label><input id="end_datum" type="date" name="end_datum" required value="${v('end_datum')}"></div>
  <div class="feld"><label for="end_zeit">Ende Zeit</label><input id="end_zeit" type="time" name="end_zeit" required value="${v('end_zeit')}"></div>` : ''}
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
    <td class="zahl">${e.unbestaetigt ? html`<a href="/einsaetze/${e.id}?personen=offen" class="orange-text">${e.unbestaetigt}</a>` : '–'}</td>
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

  app.get('/einsaetze/:id', nurAufgebot, async (req, res) => {
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
    const besetzung = (z: NonNullable<ReturnType<typeof zahlen.get>>, soll: number | null) => {
      const farbe = sollFarbe(z.teilnehmende, soll);
      const basis = soll && soll > 0 ? Math.max(soll, z.teilnehmende) : 0;
      const b = basis ? Math.round((Math.min(z.teilnehmende, basis) / basis) * 100) : 0;
      const a = basis ? Math.min(100 - b, Math.round((z.unbestaetigt / basis) * 100)) : 0;
      return html`<div class="besetzung f-${farbe}">
  ${basis ? html`<svg class="besetzung-balken" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="spur" width="100" height="6"/><rect class="b" width="${b}" height="6"/><rect class="a" x="${b}" width="${a}" height="6"/></svg>` : ''}
  <span class="besetzung-text">${soll && soll > 0
    ? html`<strong>${z.teilnehmende} / ${soll}</strong>`
    : html`<strong>${z.teilnehmende} bestätigt</strong>`}${z.unbestaetigt ? html` <span class="unter">+ ${z.unbestaetigt} angemeldet</span>` : ''}${soll && soll > 0 ? '' : html` <span class="unter">· kein Soll</span>`}</span>
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
    <td><div class="schicht-name">${abgleichPunkt(ws.abgleich)} <a href="/schichten/${s.id}">${s.name}</a></div><div class="unter">${zeitraum(s.start_zeit, s.end_zeit)}${s.ort ? ` · ${s.ort}` : ''}</div></td>
    <td>${besetzung(z, s.soll_anzahl)}</td>
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
  <a href="/einsaetze/${e.id}"${filter ? '' : new Roh(' aria-current="page"')}>Alle ${alleZeilen.length}</a>
  <a href="/einsaetze/${e.id}?personen=offen"${filter === 'offen' ? new Roh(' aria-current="page"') : ''}>Offen ${alleZeilen.filter(offen).length}</a>
  <a href="/einsaetze/${e.id}?personen=warnung"${filter === 'warnung' ? new Roh(' aria-current="page"') : ''}>Mit Warnung ${alleZeilen.filter(mitWarnung).length}</a>
</p>`;
    const suche = html`<input type="search" class="suche" data-filter=".personen-tabelle tbody tr" placeholder="Name suchen …" aria-label="Personen suchen">`;
    const titelPersonen = html`<div class="titelzeile filterzeile"><h2 id="personen-titel">Personen</h2>${alleZeilen.length ? suche : ''}</div>${alleZeilen.length ? filterChips : ''}`;

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

    const inhalt = html`
${seitenKopf({
  pfad: [{ text: 'Einsätze', href: '/einsaetze' }, { text: e.name }],
  titel: e.name,
  marke: publiziertMarke(schichten.some((sc) => sc.publiziert)),
  angaben: [
    schichten.length ? html`<strong>${zeitraum(schichten[0].start_zeit, ende)}</strong>` : '',
    `${schichten.length} ${schichten.length === 1 ? 'Schicht' : 'Schichten'}`,
    `${alleZeilen.length} ${alleZeilen.length === 1 ? 'Person' : 'Personen'} eingetragen`,
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
  reiter: einsatzReiter(e.id, schichten, null),
})}
<div class="einsatz-uebersicht">
${steckbrief}
${zuTun}
${schichtTabelle}
${personen}
</div>`;
    res.send(seite(kx, e.name, 'einsaetze', inhalt, { breit: true }));
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

/** Reiter eines Einsatzes: Übersicht und eine Schicht pro Reiter. */
export function einsatzReiter(einsatzId: number, schichten: { id: number; name: string }[], aktiveSchicht: number | null): Reiter[] {
  return [
    { text: 'Übersicht', href: `/einsaetze/${einsatzId}`, aktiv: aktiveSchicht === null },
    ...schichten.map((sc) => ({ text: sc.name, href: `/schichten/${sc.id}`, aktiv: sc.id === aktiveSchicht })),
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
  <p class="unter">${zeitraum(s.start_zeit, s.end_zeit)}${s.ort ? ` · ${s.ort}` : ''}</p>
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

// Einsätze: Liste, Erstellen, Übersicht mit Matrix, Ändern, Kopieren, Löschen, Exporte (14.1, 14.2, 21).
import type { Express, Request, Response } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot, zurueck } from './app.js';
import {
  aendereEinsatz, anzahlAnmeldungenEinsatz, einsatzListe, erstelleEinsatz, kopiereEinsatz, ladeEinsatz, loescheEinsatz, vorgabeKopie,
  type Einsatz,
} from '../domain/einsatz.js';
import { schichtenVonEinsatz } from '../domain/schicht.js';
import { bestaetigeAlle } from '../domain/anmeldung.js';
import { warnungenFuerSchichten } from '../domain/warnungen.js';
import { zahlenFuerSchichten } from '../domain/zaehlung.js';
import { teilnehmerlisteCsv } from '../domain/export.js';
import { rollen as ladeRollen } from '../domain/stammdaten.js';
import { Eingabefehler, id as leseId, type Status } from '../domain/eingabe.js';
import { alle } from '../db/db.js';
import { html, mehrzeilig, Roh } from './html.js';
import { k, aktuellerPfad } from './kontext.js';
import { druckseite, formFelder, seite } from './views/layout.js';
import {
  abgleichPunkt, istSoll, kanalAuswahl, knopfPost, legende, rolleAuswahl, statusAuswahl, statusMarke, warnungen, zeitraum,
} from './views/teile.js';
import { jetztIso, lokalesDatum, lokaleZeit } from '../domain/zeit.js';
import { telefonText, hauptnummer } from '../domain/personen.js';
import { nachRangTiefZuerst } from '../domain/listen.js';

function einsatzFormular(kx: ReturnType<typeof k>, ziel: string, e: Partial<Record<string, unknown>>, neu: boolean, fehler: string | null): Roh {
  const v = (n: string) => (e[n] === null || e[n] === undefined ? '' : String(e[n]));
  return html`
${fehler ? html`<div class="meldung fehler" role="alert">${fehler}</div>` : ''}
<form method="post" action="${ziel}" class="formular-raster">
  ${formFelder(kx)}
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
    const liste = await einsatzListe(db, archiv ? 'archiv' : 'kommend');
    const inhalt = html`
<div class="titelzeile">
  <h1>${archiv ? 'Archiv' : 'Einsätze'}</h1>
  ${archiv ? '' : html`<a class="knopf haupt" href="/einsaetze/neu">Neuer Einsatz</a>`}
</div>
<p class="tabs"><a href="/einsaetze"${archiv ? '' : new Roh(' aria-current="page"')}>Kommend</a> <a href="/einsaetze?ansicht=archiv"${archiv ? new Roh(' aria-current="page"') : ''}>Archiv</a></p>
${liste.length === 0 ? html`<p class="leer">Keine Einsätze.</p>` : html`
<div class="rahmen"><table class="tabelle">
  <thead><tr><th>Einsatz</th><th>Zeitraum</th><th>Ort</th><th>Schichten</th><th>${archiv ? 'Teilnehmende' : 'Ist / Soll'}</th>${archiv ? '' : html`<th>Unbestätigt</th>`}</tr></thead>
  <tbody>${liste.map((e) => html`<tr>
    <td><a href="/einsaetze/${e.id}">${e.name}</a></td>
    <td>${zeitraum(e.start, e.ende)}</td>
    <td>${e.ort ?? ''}</td>
    <td>${e.schichten}</td>
    <td>${archiv ? e.teilnehmende : istSoll(e.teilnehmende, e.soll)}</td>
    ${archiv ? '' : html`<td>${e.unbestaetigt ? html`<span class="pille orange">${e.unbestaetigt}</span>` : '0'}</td>`}
  </tr>`)}</tbody>
</table></div>`}`;
    res.send(seite(kx, archiv ? 'Archiv' : 'Einsätze', archiv ? 'archiv' : 'einsaetze', inhalt));
  });

  app.get('/einsaetze/neu', nurAufgebot, (_req, res) => {
    const kx = k(res);
    res.send(seite(kx, 'Neuer Einsatz', 'einsaetze', html`<h1>Neuer Einsatz</h1>${einsatzFormular(kx, '/einsaetze', {}, true, null)}`));
  });

  app.post('/einsaetze', nurAufgebot, async (req, res) => {
    const kx = k(res);
    try {
      const id = await erstelleEinsatz(db, req.body, kx.benutzer!.id);
      zurueck(req, res, `/einsaetze/${id}`, 'Einsatz erstellt.');
    } catch (e) {
      if (!(e instanceof Eingabefehler)) throw e;
      res.status(400).send(seite(kx, 'Neuer Einsatz', 'einsaetze', html`<h1>Neuer Einsatz</h1>${einsatzFormular(kx, '/einsaetze', req.body, true, e.message)}`));
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
    // Zeilen der Matrix: Personen (oder unbekannte Einträge) × Schichten.
    const zeilen = new Map<string, { schluessel: string; name: string; rang_name: string | null; rang_reihenfolge: number | null; vorname: string | null; nachname: string | null; personId: number | null; zellen: Map<number, any> }>();
    for (const a of eintraege) {
      const schluessel = a.person_id !== null ? `p${a.person_id}` : `u${a.id}`;
      if (!zeilen.has(schluessel)) {
        zeilen.set(schluessel, {
          schluessel, name: a.name_text, rang_name: a.rang_name, rang_reihenfolge: a.rang_reihenfolge,
          vorname: a.vorname ?? a.name_text, nachname: a.nachname ?? '', personId: a.person_id, zellen: new Map(),
        });
      }
      zeilen.get(schluessel)!.zellen.set(a.schicht_id, a);
    }
    const sortiert = [...zeilen.values()].sort(nachRangTiefZuerst);
    const hier = aktuellerPfad(req);
    const jetzt = jetztIso();
    const warnZahl = (sid: number) => {
      const x = w.get(sid)!;
      return [...x.anmeldungen.values()].reduce((n, l) => n + l.length, 0);
    };

    const zelle = (z: (typeof sortiert)[number], sid: number) => {
      const a = z.zellen.get(sid);
      const wl = a ? w.get(sid)?.anmeldungen.get(a.id) : undefined;
      if (a) {
        return html`<td class="zelle${wl?.length ? ' mit-warnung' : ''}"><details><summary>${statusMarke(a.status as Status)}${a.rolle ? html`<small>${a.rolle}</small>` : ''}${wl?.length ? '⚠' : ''}</summary>
          <form method="post" action="/anmeldungen/${a.id}" class="mini-form">
            ${formFelder(kx, hier)}
            ${warnungen(wl)}
            <label>Status ${statusAuswahl('status', a.status)}</label>
            <label>Rolle ${rolleAuswahl('rolle', rollen, a.rolle)}</label>
            <label>Kanal ${kanalAuswahl('kanal', a.kanal)}</label>
            <label>Bemerkung <textarea name="bemerkung" rows="2" maxlength="5000">${a.bemerkung ?? ''}</textarea></label>
            <button type="submit" class="knopf haupt klein">Speichern</button>
          </form></details></td>`;
      }
      if (z.personId === null) return html`<td class="zelle"></td>`;
      return html`<td class="zelle"><details><summary>${statusMarke(null)}</summary>
        <form method="post" action="/schichten/${sid}/anmeldungen" class="mini-form">
          ${formFelder(kx, hier)}
          <input type="hidden" name="person" value="${z.personId}">
          <label>Status ${statusAuswahl('status', 'angemeldet')}</label>
          <label>Rolle ${rolleAuswahl('rolle', rollen, null)}</label>
          <label>Kanal ${kanalAuswahl('kanal', 'telefon', true)}</label>
          <button type="submit" class="knopf haupt klein">Eintragen</button>
        </form></details></td>`;
    };

    const inhalt = html`
<div class="titelzeile">
  <div><h1>${e.name}</h1><p class="unter">${schichten.length ? zeitraum(schichten[0].start_zeit, schichten.reduce((m, s) => (s.end_zeit > m ? s.end_zeit : m), schichten[0].end_zeit)) : ''}${e.ort ? ` · ${e.ort}` : ''}</p></div>
  <div class="knopfreihe">
    <a class="knopf" href="/einsaetze/${e.id}/bearbeiten">Bearbeiten</a>
    <a class="knopf" href="/einsaetze/${e.id}/kopieren">Kopieren</a>
    <a class="knopf" href="/einsaetze/${e.id}/schichten/neu">Schicht hinzufügen</a>
    <a class="knopf" href="/einsaetze/${e.id}/teilnehmerliste">Teilnehmerliste drucken</a>
    <a class="knopf" href="/einsaetze/${e.id}/export.csv">CSV</a>
    <a class="knopf gefahr" href="/einsaetze/${e.id}/loeschen">Löschen</a>
  </div>
</div>
${e.bemerkung_intern ? html`<p class="bemerkung intern"><strong>Intern:</strong> ${mehrzeilig(e.bemerkung_intern)}</p>` : ''}
${e.bemerkung_extern ? html`<p class="bemerkung"><strong>Extern:</strong> ${mehrzeilig(e.bemerkung_extern)}</p>` : ''}
<div class="karten schichten">
${schichten.map((s) => {
  const z = zahlen.get(s.id)!;
  const ws = w.get(s.id)!;
  return html`<section class="karte schicht-karte${s.end_zeit <= jetzt ? ' vergangen' : ''}">
    <header>
      <h3>${abgleichPunkt(ws.abgleich)} <a href="/schichten/${s.id}">${s.name}</a></h3>
      <form method="post" action="/schichten/${s.id}/publizieren" class="inline">
        ${formFelder(kx, hier)}
        <input type="hidden" name="publiziert" value="${s.publiziert ? '0' : '1'}">
        <button type="submit" class="schalter${s.publiziert ? ' an' : ''}" aria-pressed="${s.publiziert ? 'true' : 'false'}">${s.publiziert ? 'Publiziert' : 'Nicht publiziert'}</button>
      </form>
    </header>
    <p class="unter">${zeitraum(s.start_zeit, s.end_zeit)}${s.ort ? ` · ${s.ort}` : ''}</p>
    <div class="zahlen">
      <div><span class="titel">Ist / Soll</span>${istSoll(z.teilnehmende, s.soll_anzahl)}</div>
      <div><span class="titel">Unbestätigt</span><span class="${z.unbestaetigt ? 'orange-text' : ''}">${z.unbestaetigt}</span></div>
      <div><span class="titel">Unsicher</span>${z.unsicher}</div>
      <div><span class="titel">Nachricht</span>${z.nachricht}</div>
      <div><span class="titel">Essen</span>${z.essen}</div>
    </div>
    ${z.rollen.length ? html`<p class="rollen">${z.rollen.map((r) => html`<span class="pille ${r.ist >= r.soll ? 'gruen' : 'rot'}">${r.rolle} ${r.ist}/${r.soll}</span> `)}</p>` : ''}
    ${warnungen(ws.schicht)}
    ${warnZahl(s.id) ? html`<p class="warn-text">⚠ ${warnZahl(s.id)} Warnungen bei Einträgen</p>` : ''}
  </section>`;
})}
</div>
<h2>Personen × Schichten</h2>
${legende()}
${sortiert.length === 0 ? html`<p class="leer">Noch keine Einträge.</p>` : html`
<div class="rahmen matrix-rahmen"><table class="tabelle matrix">
  <thead><tr><th class="name-spalte">Person</th>${schichten.map((s) => html`<th><a href="/schichten/${s.id}">${s.name}</a><small>${lokalesDatum(s.start_zeit).split('-').reverse().join('.')} ${lokaleZeit(s.start_zeit)}</small></th>`)}</tr></thead>
  <tbody>${sortiert.map((z) => html`<tr>
    <th class="name-spalte">${z.personId !== null ? html`<a href="/personen/${z.personId}">${z.rang_name ? html`<span class="rang">${z.rang_name}</span> ` : ''}${z.name}</a>` : html`<a href="/anmeldungen/unbekannt">${z.name}</a> <span class="pille orange">unbekannt</span>`}</th>
    ${schichten.map((s) => zelle(z, s.id))}
  </tr>`)}</tbody>
</table></div>`}`;
    res.send(seite(kx, e.name, 'einsaetze', inhalt, { breit: true }));
  });

  app.get('/einsaetze/:id/bearbeiten', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const e = await ladeEinsatz(db, leseId(req.params.id));
    res.send(seite(kx, `${e.name} bearbeiten`, 'einsaetze', html`<p><a href="/einsaetze/${e.id}">← ${e.name}</a></p><h1>Einsatz bearbeiten</h1>${einsatzFormular(kx, `/einsaetze/${e.id}`, e as unknown as Record<string, unknown>, false, null)}`));
  });

  app.post('/einsaetze/:id', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const id = leseId(req.params.id);
    try {
      await aendereEinsatz(db, id, req.body);
      zurueck(req, res, `/einsaetze/${id}`);
    } catch (e) {
      if (!(e instanceof Eingabefehler)) throw e;
      res.status(400).send(seite(kx, 'Einsatz bearbeiten', 'einsaetze', html`<h1>Einsatz bearbeiten</h1>${einsatzFormular(kx, `/einsaetze/${id}`, req.body, false, e.message)}`));
    }
  });

  app.get('/einsaetze/:id/kopieren', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const e = await ladeEinsatz(db, leseId(req.params.id));
    const v = await vorgabeKopie(db, e.id);
    res.send(seite(kx, 'Einsatz kopieren', 'einsaetze', html`
<p><a href="/einsaetze/${e.id}">← ${e.name}</a></p>
<h1>Einsatz kopieren</h1>
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
<h1>Einsatz «${e.name}» löschen?</h1>
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

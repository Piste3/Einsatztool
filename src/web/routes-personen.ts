// Personen (14.4) und Rückmeldungen (Abschnitt 3 des Auftrags).
import type { Express } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot } from './app.js';
import { ladeVorlage } from '../domain/vorlagen.js';
import { aenderungMailText, aenderungMailto, alterHeute, ladePerson, personenListe, telefonText } from '../domain/personen.js';
import { personUebersicht, rueckmeldungen, type RueckmeldungOptionen } from '../domain/listen.js';
import { filterFuerListe } from '../domain/filter.js';
import { anmeldungVonPerson, verlauf } from '../domain/anmeldung.js';
import { ladeSchicht, schichtenVonEinsatz } from '../domain/schicht.js';
import { passtZuSchicht, warnungenFuerSchicht } from '../domain/warnungen.js';
import { rollen as ladeRollen } from '../domain/stammdaten.js';
import { sicheresZiel } from './kontext.js';
import { STATUS_TEXT, KANAELE, KANAL_TEXT, id as leseId, type Kanal, type Status } from '../domain/eingabe.js';
import { html, Roh } from './html.js';
import { k, aktuellerPfad } from './kontext.js';
import { formFelder, seite, seitenKopf } from './views/layout.js';
import { bestaetigenFrage, datumZeit, istSoll, kachel, kachelLegende, KACHEL_TEXT, kanalAuswahl, legende, rolleAuswahl, statusMarke, statusText, telefon, warnungen, zeitraum } from './views/teile.js';
import { verlaufListe } from './routes-schichten.js';
import { alterAm, datumCh, datumChVonIso, lokalesDatum, lokaleZeit, wochentagKurz } from '../domain/zeit.js';

export function registrierePersonen(app: Express, deps: Abhaengigkeiten): void {
  const { db, konfig } = deps;

  app.get('/personen', nurAufgebot, async (_req, res) => {
    const kx = k(res);
    const liste = await personenListe(db);
    res.send(seite(kx, 'Personen', 'personen', html`
${seitenKopf({ titel: 'Personen', angaben: [`${liste.length} Personen`, 'Die Daten kommen aus Clubdesk. Das Tool ändert keine Personendaten.'] })}
<div class="titelzeile filterzeile">
  <input type="search" class="suche" data-filter=".filterbar tbody tr" placeholder="Name, Rang oder E-Mail …" aria-label="Personen suchen">
</div>
<div class="rahmen"><table class="tabelle filterbar">
  <thead><tr><th>Rang</th><th>Name</th><th>Alter</th><th>Telefon</th><th>E-Mail</th><th>Essen</th></tr></thead>
  <tbody>${liste.map((p) => html`<tr data-suche="${`${p.vorname ?? ''} ${p.nachname ?? ''} ${p.rang_name ?? ''} ${p.email ?? ''}`.toLowerCase()}">
    <td>${p.rang_name ?? ''}</td>
    <td><a href="/personen/${p.clubdesk_id}">${p.nachname ?? ''} ${p.vorname ?? ''}</a></td>
    <td>${alterHeute(p.geburtsdatum) ?? ''}</td>
    <td>${telefon(p)}</td>
    <td>${p.email ? html`<a href="mailto:${p.email}">${p.email}</a>` : ''}</td>
    <td>${p.essenseinschraenkung ?? ''}</td>
  </tr>`)}</tbody>
</table></div>`));
  });

  app.get('/personen/:id', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const p = await ladePerson(db, leseId(req.params.id));
    const u = await personUebersicht(db, p.clubdesk_id);
    const logs = await verlauf(db, [...u.kommend, ...u.vergangen].map((e) => e.id));
    const name = `${p.vorname ?? ''} ${p.nachname ?? ''}`.trim() || `Gelöschte Person ${p.clubdesk_id}`;
    const hier = aktuellerPfad(req);
    // Regel 14.4: mailto an die Informatik (MAIL_INFORMATIK) mit einer allgemeinen Vorlage.
    const mailto = konfig.mailInformatik
      ? aenderungMailto(konfig.mailInformatik, aenderungMailText(p, name, await ladeVorlage(db)))
      : null;
    const gruppe = (titel: string, liste: typeof u.kommend) => liste.length
      ? html`<h3>${titel} (${liste.length})</h3><ul class="liste">${liste.map((e) => html`<li>
          <a href="/schichten/${e.schicht_id}">${e.einsatz}${e.einsatz === e.schicht ? '' : ` – ${e.schicht}`}</a> · ${zeitraum(e.start_zeit, e.end_zeit)} · ${statusText(e.status)}${e.rolle ? ` · ${e.rolle}` : ''}
        </li>`)}</ul>`
      : '';
    const zeigen = (feld: string, wert: unknown) => (wert ? html`<tr><th>${feld}</th><td>${wert as string}</td></tr>` : '');
    res.send(seite(kx, name, 'personen', html`
${seitenKopf({
  pfad: [{ text: 'Personen', href: '/personen' }, { text: name }],
  titel: html`${p.rang_name ? html`<span class="rang">${p.rang_name}</span> ` : ''}${name}`,
  angaben: [`Clubdesk-ID ${p.clubdesk_id}`],
  aktionen: mailto ? html`<a class="knopf" href="${mailto}">Änderung melden</a>` : html`<span class="unter">MAIL_INFORMATIK fehlt in der Konfiguration.</span>`,
})}
${p.geloescht_am ? html`<p class="meldung hinweis">Die Personendaten sind gelöscht (${datumZeit(p.geloescht_am)}). Die ID bleibt.</p>` : ''}
<div class="zwei-spalten">
<section class="karte">
  <h2>Stammdaten</h2>
  <table class="tabelle schmal">
    ${zeigen('Clubdesk-ID', String(p.clubdesk_id))}
    ${zeigen('Geburtsdatum', p.geburtsdatum ? `${datumCh(p.geburtsdatum)} (${alterHeute(p.geburtsdatum)} Jahre)` : '')}
    ${p.telefon || p.telefon_privat ? html`<tr><th>Telefon</th><td>${telefon(p)}</td></tr>` : ''}
    ${p.email ? html`<tr><th>E-Mail</th><td><a href="mailto:${p.email}">${p.email}</a></td></tr>` : ''}
    ${zeigen('Adresse', [p.strasse, p.adresszusatz, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}
    ${zeigen('Essenseinschränkungen', p.essenseinschraenkung)}
    ${zeigen('Importiert', datumZeit(p.importiert_am))}
  </table>
</section>
<section class="karte">
  <h2>Nächste Einsätze</h2>
  ${gruppe('Bestätigt', u.kommend.filter((e) => e.status === 'bestaetigt'))}
  ${gruppe('Angemeldet', u.kommend.filter((e) => e.status === 'angemeldet'))}
  ${gruppe('Unsicher', u.kommend.filter((e) => e.status === 'unsicher'))}
  ${gruppe('Nachricht gesendet', u.kommend.filter((e) => e.status === 'nachricht_gesendet'))}
  ${gruppe('Abgemeldet', u.kommend.filter((e) => e.status === 'abgemeldet'))}
  ${!p.geloescht_am && u.offen.length ? html`<h3>Offen – nicht gefragt (${u.offen.length})</h3><ul class="liste">${u.offen.map((s) => html`<li class="zeilen-form">
    <span class="wachsen"><a href="/schichten/${s.id}">${s.einsatz}${s.einsatz === s.name ? '' : ` – ${s.name}`}</a> · ${zeitraum(s.start_zeit, s.end_zeit)}${s.publiziert ? '' : html` <span class="pille grau">intern</span>`}</span>
    <form method="post" action="/schichten/${s.id}/anmeldungen" class="zeilen-form">
      ${formFelder(kx, hier)}
      <input type="hidden" name="person" value="${p.clubdesk_id}">
      <input type="hidden" name="status" value="angemeldet">
      ${kanalAuswahl('kanal', 'telefon', true)}
      <button type="submit" class="knopf klein">Eintragen</button>
    </form></li>`)}</ul>` : ''}
</section>
</div>
<details class="gruppe"><summary><h2>Vergangene Einsätze (${u.vergangen.length})</h2></summary>
  <ul class="liste">${u.vergangen.map((e) => html`<li><a href="/schichten/${e.schicht_id}">${e.einsatz}${e.einsatz === e.schicht ? '' : ` – ${e.schicht}`}</a> · ${datumChVonIso(e.start_zeit)} · ${STATUS_TEXT[e.status]}${e.rolle ? ` · ${e.rolle}` : ''}</li>`)}</ul>
</details>
<details class="gruppe"><summary><h2>Verlauf</h2></summary>
  ${[...u.kommend, ...u.vergangen].map((e) => html`<h3>${e.einsatz}${e.einsatz === e.schicht ? '' : ` – ${e.schicht}`}</h3>${verlaufListe(logs.get(e.id))}`)}
</details>`));
  });

  app.get('/rueckmeldungen', nurAufgebot, async (req, res) => {
    const kx = k(res);
    // Filter je Benutzer: Adresse mit Filtern speichert sie, Adresse ohne Filter nimmt die gespeicherten.
    const { werte: q, gespeichert } = await filterFuerListe(db, kx.benutzer!.id, 'rueckmeldungen', req.query, ['monate', 'offen', 'unpubliziert', 'suche', 'sort'], req.get('x-live-abfrage') !== '1');
    const monate = ([1, 3, 6, 12] as const).find((m) => String(m) === q.monate) ?? 3;
    const o: RueckmeldungOptionen = {
      monate,
      nurOffen: q.offen === '1',
      unpublizierte: q.unpubliziert === '1',
      suche: typeof q.suche === 'string' ? q.suche.slice(0, 100) : '',
      sortierung: q.sort === 'name' ? 'name' : 'rang',
    };
    const r = await rueckmeldungen(db, o);
    const hier = aktuellerPfad(req);
    const auswahl = (wert: string, aktuell: string) => (wert === aktuell ? new Roh(' selected') : '');
    // Kopf: aufeinanderfolgende Schichten desselben Einsatzes stehen unter einem gemeinsamen Einsatz-Kopf.
    const gruppen: { einsatz_id: number; einsatz_name: string; schichten: typeof r.schichten; mehrtaegig: boolean }[] = [];
    const gruppenStart = new Set<number>();
    r.schichten.forEach((s, i) => {
      const letzte = gruppen[gruppen.length - 1];
      if (letzte && letzte.einsatz_id === s.einsatz_id) letzte.schichten.push(s);
      else { gruppen.push({ einsatz_id: s.einsatz_id, einsatz_name: s.einsatz_name, schichten: [s], mehrtaegig: false }); gruppenStart.add(i); }
    });
    for (const g of gruppen) g.mehrtaegig = new Set(g.schichten.map((s) => lokalesDatum(s.start_zeit))).size > 1;
    const tag = (iso: string) => `${wochentagKurz(iso)} ${datumChVonIso(iso).slice(0, 6)}`;
    const tagText = (liste: typeof r.schichten) => {
      const erster = liste[0].start_zeit;
      const letzter = liste[liste.length - 1].start_zeit;
      return lokalesDatum(erster) === lokalesDatum(letzter) ? tag(erster) : `${tag(erster)} – ${tag(letzter)}`;
    };
    res.send(seite(kx, 'Rückmeldungen', 'rueckmeldungen', html`
${seitenKopf({ titel: 'Rückmeldungen', angaben: ['Wer hat sich wofür gemeldet: alle kommenden Schichten im Zeitraum.'] })}
<form method="get" action="/rueckmeldungen" class="filter-form zeilen-form">
  <label>Zeitraum <select name="monate">${[1, 3, 6, 12].map((m) => html`<option value="${m}"${auswahl(String(m), String(monate))}>${m} ${m === 1 ? 'Monat' : 'Monate'}</option>`)}</select></label>
  <label>Sortierung <select name="sort"><option value="rang"${auswahl('rang', o.sortierung)}>Rang</option><option value="name"${auswahl('name', o.sortierung)}>Name</option></select></label>
  <label class="haken"><input type="checkbox" name="offen" value="1"${o.nurOffen ? new Roh(' checked') : ''}> Nur mit offenen Schichten</label>
  <label class="haken"><input type="checkbox" name="unpubliziert" value="1"${o.unpublizierte ? new Roh(' checked') : ''}> Unpublizierte zeigen</label>
  <input type="search" name="suche" value="${o.suche}" placeholder="Name …" aria-label="Name suchen">
  <button type="submit" class="knopf">Anzeigen</button>
  ${gespeichert ? html`<a class="link-knopf" href="/rueckmeldungen?zuruecksetzen=1" title="Gespeicherte Filter löschen">Filter zurücksetzen</a>` : ''}
</form>
${kachelLegende()}
<p class="unter">Klick auf ein Feld: Person eintragen oder Status ändern. Grau = passt nicht zu Mindestalter oder Mindestrang. Eintragen geht trotzdem.</p>
${r.schichten.length === 0 ? html`<p class="leer">Keine kommenden Schichten im Zeitraum.</p>` : html`
<div class="rahmen rueck-rahmen"><table class="tabelle rueck">
  <thead>
    <tr class="einsatz-zeile"><th class="name-spalte" rowspan="2">Mitglied</th>${gruppen.map((g) => html`<th colspan="${g.schichten.length}" class="einsatz-kopf"><span class="d">${tagText(g.schichten)}</span><a class="e" href="${g.schichten.length === 1 ? `/schichten/${g.schichten[0].id}` : `/einsaetze/${g.einsatz_id}`}">${g.einsatz_name}</a></th>`)}</tr>
    <tr class="schicht-zeile">${gruppen.map((g) => g.schichten.map((s, i) => html`<th class="schicht-kopf${i === 0 ? ' gruppe-start' : ''}">${g.schichten.length > 1 || s.name !== s.einsatz_name ? html`<a class="s" href="/schichten/${s.id}">${s.name}</a>` : ''}${g.mehrtaegig ? html`<span class="d">${wochentagKurz(s.start_zeit)} ${datumChVonIso(s.start_zeit).slice(0, 6)}</span>` : ''}${s.publiziert ? '' : html`<span class="pille grau">intern</span>`}${istSoll(s.teilnehmende, s.soll_anzahl)}</th>`))}</tr>
  </thead>
  <tbody>${r.personen.map((p) => html`<tr>
    <th class="name-spalte"><a href="/personen/${p.clubdesk_id}"><span class="rang">${p.rang_name ?? ''}</span><span class="name">${p.vorname ?? ''} ${p.nachname ?? ''}</span></a></th>
    ${p.zellen.map((c, i) => { const sch = r.schichten[i]; const art = c.status ?? c.andere; return html`<td class="zelle-klick${c.passt ? '' : ' passt-nicht'}${gruppenStart.has(i) ? ' gruppe-start' : ''}"><a href="/rueckmeldungen/eintrag?schicht=${sch.id}&amp;person=${p.clubdesk_id}&amp;zurueck=${encodeURIComponent(hier)}" data-eintrag${bestaetigenFrage(c, `${p.vorname ?? ''} ${p.nachname ?? ''}`.trim())} title="${c.status ? `${STATUS_TEXT[c.status]} · ${datumChVonIso(c.geaendert_am!)} ${lokaleZeit(c.geaendert_am!)} · ${KANAL_TEXT[c.kanal as Kanal]}${c.bemerkung ? ` · Bemerkung: ${c.bemerkung}` : ''}` : c.andere ? KACHEL_TEXT[c.andere] : c.passt ? 'nicht gefragt' : 'passt nicht zu Mindestalter oder Mindestrang'} – Klick zum Eintragen">${kachel(art)}${c.bemerkung ? html`<span class="bemerkung-marke" aria-hidden="true">✎</span>` : ''}<span class="sr">${c.status ? STATUS_TEXT[c.status] : c.andere ? KACHEL_TEXT[c.andere] : 'nicht gefragt'}${c.bemerkung ? ', mit Bemerkung' : ''}${c.passt ? '' : ', passt nicht'}</span></a></td>`; })}
  </tr>`)}</tbody>
  <tfoot>
    ${(['an', 'ab', 'unsicher', 'offen'] as const).map((n) => html`<tr><th class="name-spalte">${{ an: 'An', ab: 'Ab', unsicher: 'Unsicher', offen: 'Offen' }[n]}</th>${r.schichten.map((s, i) => html`<td${gruppenStart.has(i) ? new Roh(' class="gruppe-start"') : ''}>${s.summe[n]}</td>`)}</tr>`)}
  </tfoot>
</table></div>`}`, { breit: true, fest: true }));
  });
  // Rückmeldungen: Fenster für ein Feld (Person × Schicht). Eintragen oder ändern über die bestehenden Routen.
  // Mit Header «X-Fragment: 1» nur der Inhalt (für das Fenster), sonst eine ganze Seite (ohne Skript).
  app.get('/rueckmeldungen/eintrag', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const s = await ladeSchicht(db, leseId(req.query.schicht, 'Schicht'));
    const p = await ladePerson(db, leseId(req.query.person, 'Person'));
    const ziel = sicheresZiel(req.query.zurueck, '/rueckmeldungen');
    const a = await anmeldungVonPerson(db, s.id, p.clubdesk_id);
    const logs = a ? (await verlauf(db, [a.id])).get(a.id) : undefined;
    const wl = a ? (await warnungenFuerSchicht(db, s.id)).anmeldungen.get(a.id) : undefined;
    const rollenListe = await ladeRollen(db);
    const passt = passtZuSchicht(p, s);
    const name = `${p.vorname ?? ''} ${p.nachname ?? ''}`.trim();
    // Weitere Schichten desselben Einsatzes: Stand der Person und Hinweis bei gleicher Zeit.
    const andere = (await schichtenVonEinsatz(db, s.einsatz_id)).filter((x) => x.id !== s.id);
    const eintraegePerson = (await personUebersicht(db, p.clubdesk_id)).kommend;
    const statusIn = (sid: number) => eintraegePerson.find((e) => e.schicht_id === sid)?.status ?? null;
    const gleicheZeit = (x: { start_zeit: string; end_zeit: string }) => x.start_zeit < s.end_zeit && s.start_zeit < x.end_zeit;
    const kanaele = KANAELE.filter((kn) => kn !== 'formular' || a?.kanal === 'formular');
    // Bestätigen geht hier noch nicht (Wunsch Yann). Nur ein schon bestätigter Eintrag zeigt «bestätigt», damit Speichern ihn nicht ändert.
    const reihenfolge: Status[] = a?.status === 'bestaetigt'
      ? ['angemeldet', 'bestaetigt', 'unsicher', 'nachricht_gesendet', 'abgemeldet']
      : ['angemeldet', 'unsicher', 'nachricht_gesendet', 'abgemeldet'];
    const vorgabeStatus: Status = a ? (a.status as Status) : 'angemeldet';
    const vorgabeKanal: Kanal = a ? (a.kanal as Kanal) : 'telefon';
    const wahl = (feld: string, werte: readonly string[], text: (w: string) => string, aktuell: string) => html`<div class="wahl" role="radiogroup">${werte.map((w) => html`<label class="wahl-knopf${feld === 'status' ? ` s-${w}` : ''}"><input type="radio" name="${feld}" value="${w}"${w === aktuell ? new Roh(' checked') : ''}><span>${feld === 'status' ? html`<span class="punkt-marke" aria-hidden="true"></span>` : ''}${text(w)}</span></label>`)}</div>`;

    const inhalt = html`<div class="eintrag-fenster">
  <header class="eintrag-kopf">
    <div>
      <h2>${p.rang_name ? html`<span class="rang">${p.rang_name}</span> ` : ''}${name}</h2>
      <p class="unter">${s.einsatz_name}${s.einsatz_name === s.name ? '' : ` · ${s.name}`} · ${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)}</p>
    </div>
    <button type="button" class="toast-zu" data-fenster-zu aria-label="Fenster schliessen">×</button>
  </header>
  <p class="eintrag-person">${telefon(p)}${p.geburtsdatum ? html` <span class="unter">· ${alterAm(p.geburtsdatum, lokalesDatum(s.start_zeit))} Jahre</span>` : ''} <a href="/personen/${p.clubdesk_id}">Personenseite</a></p>
  ${passt ? '' : html`<p class="meldung hinweis">Die Person passt nicht zu Mindestalter oder Mindestrang der Schicht. Eintragen geht trotzdem.</p>`}
  <div class="eintrag-aktuell">${a
    ? html`<strong>Aktuell:</strong> ${statusText(a.status as Status)} · ${KANAL_TEXT[a.kanal as Kanal]}${a.rolle ? ` · ${a.rolle}` : ''} · geändert ${datumZeit(a.geaendert_am)} · <a href="/schichten/${s.id}">zur Schicht</a>`
    : html`<strong>Aktuell:</strong> nicht gefragt. Es gibt noch keinen Eintrag.`}</div>
  ${warnungen(wl)}
  ${andere.length ? html`<div class="eintrag-andere"><span class="unter">Andere Schichten dieses Einsatzes:</span>
    <ul class="ohne-punkte">${andere.map((x) => { const st = statusIn(x.id); return html`<li>${st ? statusMarke(st) : statusMarke(null)} ${x.name} · ${zeitraum(x.start_zeit, x.end_zeit, x.zeit_offen)}${gleicheZeit(x) ? html` <span class="pille rot">gleiche Zeit</span>` : ''}</li>`; })}</ul></div>` : ''}

  <form method="post" action="${a ? `/anmeldungen/${a.id}` : `/schichten/${s.id}/anmeldungen`}" class="eintrag-form">
    ${formFelder(kx, ziel)}
    ${a ? html`<input type="hidden" name="version" value="${a.version}">` : html`<input type="hidden" name="person" value="${p.clubdesk_id}">`}
    <fieldset><legend>Kanal</legend>${wahl('kanal', kanaele, (w) => KANAL_TEXT[w as Kanal], vorgabeKanal)}</fieldset>
    <fieldset><legend>Ergebnis</legend>${wahl('status', reihenfolge, (w) => STATUS_TEXT[w as Status], vorgabeStatus)}</fieldset>
    <label class="feld">Rolle ${rolleAuswahl('rolle', rollenListe, a?.rolle ?? null)}</label>
    <label class="feld">Bemerkung <textarea name="bemerkung" rows="2" maxlength="5000">${a?.bemerkung ?? ''}</textarea></label>
    <div class="eintrag-knoepfe">
      ${a ? html`<a class="knopf gefahr klein" href="/anmeldungen/${a.id}/loeschen?zurueck=${encodeURIComponent(ziel)}">Eintrag entfernen</a>` : html`<span></span>`}
      <span class="knopfreihe"><a class="knopf" href="${ziel}" data-fenster-zu>Abbrechen</a><button type="submit" class="knopf haupt">${a ? 'Speichern' : 'Eintragen'}</button></span>
    </div>
  </form>
  ${a ? html`<details class="aufklapp eintrag-verlauf"${logs && logs.length ? new Roh(' open') : ''}><summary>Verlauf (${logs?.length ?? 0})</summary>${verlaufListe(logs)}</details>` : ''}
</div>`;
    if (req.get('x-fragment') === '1') {
      res.type('html').send(inhalt.toString());
      return;
    }
    res.send(seite(kx, `${name} · ${s.name}`, 'rueckmeldungen', html`${seitenKopf({ pfad: [{ text: 'Rückmeldungen', href: ziel }, { text: name }], titel: 'Eintragen' })}<div class="karte eintrag-seite">${inhalt}</div>`));
  });

}

export { telefonText };

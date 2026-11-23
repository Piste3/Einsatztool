// Handyversion (Wunsch Yann 23.11.2026). Eigene, einfache Seiten für Smartphones unter /m.
// Nur Eintragen und Ansicht nach Person. Speichern läuft über die bestehenden Routen (Konfliktschutz,
// Statusprotokoll, Rückgängig, Live, Toast). Anlegen und Bearbeiten von Einsätzen und Schichten geht nur in der vollen Version.
import type { Express } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { nurAufgebot, setzeCookie } from './app.js';
import { startUebersicht } from '../domain/listen.js';
import {
  BESETZEN_FILTER, BESETZEN_FILTER_TEXT, besetzenDaten, filtereBesetzen, vorgabeFilter, zaehleBesetzen,
  type BesetzenEintrag, type BesetzenFilter, type BesetzenSchicht, type BesetzenZeile,
} from '../domain/besetzen.js';
import { ladeEinsatz } from '../domain/einsatz.js';
import { ANSICHT_COOKIE, personStatus, zaehlePersonStatus, type PersonSchicht } from '../domain/handy.js';
import { hauptnummer, ladePerson, personenListe, telLink, whatsappNummer, alterHeute } from '../domain/personen.js';
import { zahlenFuerSchichten } from '../domain/zaehlung.js';
import { STATUS_TEXT, id as leseId, type Status } from '../domain/eingabe.js';
import { alterAm, datumChVonIso, jetztIso, lokalesDatum, lokaleZeit, wochentagKurz } from '../domain/zeit.js';
import { html, Roh } from './html.js';
import { aktuellerPfad, k } from './kontext.js';
import { formFelder, handySeite } from './views/layout.js';
import { symbol } from './views/symbole.js';
import { bestaetigenFrage, istSoll, kachel, KACHEL_TEXT, knopfPost, punktMarke, zeitraum, type KachelArt } from './views/teile.js';

/** Kurzes Datum, z. B. «Sa 28.11.». */
const tag = (iso: string) => `${wochentagKurz(iso)} ${datumChVonIso(iso).slice(0, 6)}`;

/** Beginn und Ende, z. B. «13:00–18:00». Ohne Zeiten «Zeit offen». */
const uhr = (s: { start_zeit: string; end_zeit: string; zeit_offen?: number | boolean }) =>
  s.zeit_offen && Number(s.zeit_offen) ? 'Zeit offen' : `${lokaleZeit(s.start_zeit)}–${lokaleZeit(s.end_zeit)}`;

const an = (a: BesetzenEintrag | undefined) => !!a && (a.status === 'angemeldet' || a.status === 'bestaetigt');

/** Knopf «Anrufen» als Symbol. Ohne Nummer leer. */
function anrufen(p: { telefon: string | null; telefon_privat: string | null }, name: string): Roh {
  const n = hauptnummer(p);
  return n ? html`<a class="handy-tel" href="tel:${telLink(n)}" title="${name} anrufen: ${n}" aria-label="${name} anrufen">${symbol('telefon')}</a>` : html`<span class="handy-tel leer" aria-hidden="true"></span>`;
}

export function registriereHandy(app: Express, deps: Abhaengigkeiten): void {
  const { db, konfig } = deps;

  // ---------- Wechsel zwischen den Versionen ----------
  // Die Wahl gilt in diesem Browser (Cookie, ein Jahr). Die Startseite öffnet auf dem Handy sonst die Handyversion.
  app.get('/m/voll', nurAufgebot, (_req, res) => {
    setzeCookie(res, konfig, ANSICHT_COOKIE, 'voll', 365 * 24 * 3600);
    res.redirect(303, '/');
  });
  app.get('/m/handy', nurAufgebot, (_req, res) => {
    setzeCookie(res, konfig, ANSICHT_COOKIE, '', 0);
    res.redirect(303, '/m');
  });

  // ---------- Einsätze ----------
  app.get('/m', nurAufgebot, async (_req, res) => {
    const kx = k(res);
    const u = await startUebersicht(db);
    const jetzt = jetztIso();
    const karten = u.einsaetze.map((e) => {
      const kommend = e.schichten.filter((s) => s.end_zeit > jetzt);
      const erste = kommend[0] ?? e.schichten[0];
      const publiziert = e.schichten.some((s) => s.publiziert);
      return html`<li><a class="handy-einsatz" href="/m/einsaetze/${e.id}">
  <span class="he-kopf"><span class="he-datum">${tag(erste.start_zeit)}${kommend.length > 1 && lokalesDatum(kommend[kommend.length - 1].start_zeit) !== lokalesDatum(erste.start_zeit) ? ` – ${tag(kommend[kommend.length - 1].start_zeit)}` : ''}</span>
    ${e.unbestaetigt ? punktMarke(`${e.unbestaetigt} neu`, 'blau') : ''}${publiziert ? '' : punktMarke('Entwurf', 'grau')}</span>
  <strong class="he-name">${e.name}</strong>
  <span class="he-schichten">${kommend.map((s) => html`<span class="he-schicht"><span>${kommend.length > 1 ? html`<strong class="he-schicht-name">${s.name}</strong> ${lokalesDatum(s.start_zeit) !== lokalesDatum(erste.start_zeit) ? `${tag(s.start_zeit)} ` : ''}${uhr(s)}` : zeitraum(s.start_zeit, s.end_zeit)}</span>${istSoll(s.zahlen.teilnehmende, s.soll_anzahl)}</span>`)}</span>
</a></li>`;
    });
    res.send(handySeite(kx, 'Einsätze', 'einsaetze', html`
${u.unbekannt ? html`<p class="meldung hinweis">${u.unbekannt} ${u.unbekannt === 1 ? 'Anmeldung' : 'Anmeldungen'} ohne Zuordnung. Zuordnen geht in der <a href="/m/voll" data-normal>vollen Version</a>.</p>` : ''}
${karten.length ? html`<ul class="handy-karten">${karten}</ul>` : html`<p class="leer">Keine kommenden Einsätze.</p>`}`, { unter: 'Kommende Einsätze' }));
  });

  // ---------- Eintragen in einem Einsatz ----------
  app.get('/m/einsaetze/:id', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const e = await ladeEinsatz(db, leseId(req.params.id));
    const d = await besetzenDaten(db, e.id);
    const { schichten, zeilen } = d;
    const hier = aktuellerPfad(req);
    if (!schichten.length) {
      res.send(handySeite(kx, e.name, 'einsaetze', html`<p class="leer">Der Einsatz hat keine Schicht.</p>`, { zurueck: '/m' }));
      return;
    }
    const zahlen = await zahlenFuerSchichten(db, schichten.map((s) => s.id));
    const q = req.query;
    // Ein Einsatz mit einer Schicht zeigt immer diese Schicht. Sonst «Alle» als Vorgabe.
    const gewaehlt: BesetzenSchicht | null = schichten.length === 1
      ? schichten[0]
      : schichten.find((s) => String(s.id) === String(q.schicht)) ?? null;
    const sids = gewaehlt ? [gewaehlt.id] : schichten.map((s) => s.id);
    const zahl = zaehleBesetzen(zeilen, sids);
    const filter: BesetzenFilter = (BESETZEN_FILTER as readonly string[]).includes(String(q.filter)) ? (q.filter as BesetzenFilter) : vorgabeFilter(zahl);
    const unpassend = q.unpassend === '1';
    const liste = filtereBesetzen(zeilen, sids, filter, unpassend);
    const pfad = (f: BesetzenFilter, s: number | 'alle' | null = gewaehlt ? gewaehlt.id : 'alle', u = false) => {
      const teile = [schichten.length > 1 && s !== null ? `schicht=${s}` : '', `filter=${f}`, u ? 'unpassend=1' : ''].filter(Boolean);
      return `/m/einsaetze/${e.id}?${teile.join('&')}`;
    };
    const eintragLink = (sid: number, personId: number) => `/rueckmeldungen/eintrag?schicht=${sid}&person=${personId}&zurueck=${encodeURIComponent(hier)}`;

    // Schicht wählen: waagrecht scrollende Chips mit Ist / Soll.
    const schichtWahl = schichten.length > 1 ? html`<nav class="handy-chips" aria-label="Schicht wählen">
  <a href="${pfad(filter, 'alle')}"${gewaehlt ? '' : new Roh(' aria-current="page"')}><strong>Alle</strong><small>${schichten.length} Schichten</small></a>
  ${schichten.map((s) => { const z = zahlen.get(s.id)!; return html`<a href="${pfad(filter, s.id)}"${gewaehlt?.id === s.id ? new Roh(' aria-current="page"') : ''}><strong>${s.name}</strong><small>${tag(s.start_zeit)}</small><small class="chip-zeit">${uhr(s)}</small>${istSoll(z.teilnehmende, s.soll_anzahl)}</a>`; })}
</nav>` : '';
    const info = gewaehlt ? html`<p class="handy-info">${zeitraum(gewaehlt.start_zeit, gewaehlt.end_zeit, gewaehlt.zeit_offen)}${gewaehlt.ort ? html` · ${gewaehlt.ort}` : ''}${gewaehlt.min_alter !== null ? ` · ab ${gewaehlt.min_alter} J.` : ''}${gewaehlt.min_rang_name ? ` · ab ${gewaehlt.min_rang_name}` : ''}${schichten.length === 1 ? html` ${istSoll(zahlen.get(gewaehlt.id)!.teilnehmende, gewaehlt.soll_anzahl)}` : ''}${gewaehlt.publiziert ? '' : html` ${punktMarke('Nicht publiziert', 'grau')}`}</p>` : '';
    const filterChips = html`<nav class="handy-filter" aria-label="Filter">${BESETZEN_FILTER
      .filter((f) => f !== 'warnung' || zahl.warnung > 0 || filter === 'warnung')
      .map((f) => html`<a class="f-${f}" href="${pfad(f)}"${filter === f ? new Roh(' aria-current="page"') : ''}>${BESETZEN_FILTER_TEXT[f]} <span class="zahl">${zahl[f]}</span></a>`)}</nav>`;
    const unpassendHinweis = filter === 'nicht' && (zahl.unpassend > 0 || unpassend)
      ? html`<p class="unter">${unpassend
        ? html`Alle Personen sichtbar. <a href="${pfad('nicht')}">Unpassende ausblenden</a>`
        : html`${zahl.unpassend} ${zahl.unpassend === 1 ? 'Person passt' : 'Personen passen'} nicht zu Mindestalter oder Mindestrang. <a href="${pfad('nicht', undefined, true)}">Einblenden</a>`}</p>`
      : '';
    const alleBestaetigen = (filter === 'neu' || filter === 'an') && zahl.neu > 0
      ? knopfPost(kx, gewaehlt ? `/schichten/${gewaehlt.id}/alle-bestaetigen` : `/einsaetze/${e.id}/alle-bestaetigen`, zahl.neu === 1 ? '1 Neue bestätigen' : `Alle ${zahl.neu} Neuen bestätigen`, {}, 'knopf haupt handy-breit', hier)
      : '';

    // Kachel: Ein Klick öffnet das Fenster zum Eintragen, bei «angemeldet» zuerst «Bestätigen?».
    const feld = (z: BesetzenZeile, s: BesetzenSchicht) => {
      const a = z.zellen.get(s.id);
      const nWarn = z.warnungen.get(s.id) ?? 0;
      let art: KachelArt = a ? a.status : null;
      if (!a && z.personId !== null) {
        const andere = schichten.filter((x) => x.id !== s.id && an(z.zellen.get(x.id)));
        if (andere.length) art = andere.some((x) => x.start_zeit < s.end_zeit && s.start_zeit < x.end_zeit) ? 'gleich' : 'moeglich';
      }
      const titel = `${s.name}: ${a ? `${STATUS_TEXT[a.status]}${a.rolle ? ` · ${a.rolle}` : ''}${a.bemerkung ? ` · ${a.bemerkung}` : ''}` : art ? KACHEL_TEXT[art as 'gleich' | 'moeglich'] : 'nicht gefragt'}`;
      const passt = z.passt.get(s.id) !== false;
      const innen = html`<span class="kachel-huelle">${kachel(art)}${nWarn ? html`<span class="warn-marke" aria-hidden="true">!</span>` : ''}${a?.bemerkung ? html`<span class="bemerkung-marke" aria-hidden="true">✎</span>` : ''}</span><span class="sr">${titel}</span>`;
      if (z.personId === null) return html`<span class="handy-kachel" title="${titel}">${innen}</span>`;
      return html`<a class="handy-kachel${passt ? '' : ' passt-nicht'}" href="${eintragLink(s.id, z.personId)}" data-eintrag${bestaetigenFrage(a, z.name)} title="${titel}">${innen}</a>`;
    };

    // Antwort-Knöpfe wie in «Besetzen»: ein Tipp setzt den Status. Ohne Eintrag entsteht einer.
    const antwort = (z: BesetzenZeile, s: BesetzenSchicht, a?: BesetzenEintrag) => {
      if (z.personId === null) return '';
      const knopf = (status: Status, text: string, klasse: string) => a
        ? knopfPost(kx, `/anmeldungen/${a.id}`, text, { status }, `knopf klein ${klasse}`, hier)
        : knopfPost(kx, `/schichten/${s.id}/sammelstatus`, text, { status, kanal: status === 'nachricht_gesendet' ? 'whatsapp' : 'telefon', personen: String(z.personId) }, `knopf klein ${klasse}`, hier);
      const st = a?.status ?? null;
      if (st === 'bestaetigt') return '';
      if (st === 'angemeldet') return html`${knopf('bestaetigt', 'Bestätigen', 'haupt')}${knopf('abgemeldet', 'Ab', 'a-ab')}`;
      if (st === 'abgemeldet') return knopf('angemeldet', 'An', 'a-an');
      return html`${knopf('angemeldet', 'An', 'a-an')}${st === 'unsicher' ? '' : knopf('unsicher', 'Unsicher', 'a-unsicher')}${knopf('abgemeldet', 'Ab', 'a-ab')}${st === 'nachricht_gesendet' ? '' : knopf('nachricht_gesendet', 'Nachricht', 'a-nachricht')}`;
    };

    const stichtag = lokalesDatum((gewaehlt ?? schichten[0]).start_zeit);
    const nameBlock = (z: BesetzenZeile, a?: BesetzenEintrag) => {
      const info = [
        z.geburtsdatum ? `${alterAm(z.geburtsdatum, stichtag)} J.` : '',
        a?.rolle ?? '',
      ].filter(Boolean).join(' · ');
      return html`<span class="hz-name">
  ${z.personId !== null && z.name
    ? html`<a href="/m/personen/${z.personId}"><small class="rang">${z.rang_name ?? ''}</small><span>${z.name}</span></a>`
    : html`<span><span>${z.name}</span> ${punktMarke('unbekannt', 'orange')}</span>`}
  ${info ? html`<small>${info}</small>` : ''}
  ${a?.bemerkung ? html`<small class="hz-notiz">✎ ${a.bemerkung}</small>` : ''}
</span>`;
    };
    const suche = (z: BesetzenZeile) => `${z.name} ${z.rang_name ?? ''}`.toLowerCase();

    const listeEine = (s: BesetzenSchicht) => html`<ul class="handy-zeilen">${liste.map((z) => {
      const a = z.zellen.get(s.id);
      const knoepfe = antwort(z, s, a);
      return html`<li class="handy-zeile${a?.status === 'angemeldet' ? ' neu' : ''}" data-suche="${suche(z)}">
  <div class="hz-haupt">${feld(z, s)}${nameBlock(z, a)}${anrufen(z, z.name)}</div>
  ${knoepfe ? html`<div class="hz-knoepfe">${knoepfe}</div>` : ''}
</li>`;
    })}</ul>`;

    // Alle Schichten: je Person eine Zeile mit einer Kachel je Schicht (wie Rückmeldungen).
    const listeAlle = html`<div class="handy-matrix">
<div class="hm-zeile hm-kopf" aria-hidden="true"><span class="hm-name"></span><span class="hm-kacheln">${schichten.map((s) => html`<a href="${pfad(filter, s.id)}" title="${s.name} · ${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)}"><span>${s.name}</span><small>${tag(s.start_zeit).replace(/\.$/, '')}</small><small>${s.zeit_offen ? 'offen' : lokaleZeit(s.start_zeit)}</small><small>${s.zeit_offen ? '' : lokaleZeit(s.end_zeit)}</small></a>`)}</span></div>
<ul class="handy-zeilen">${liste.map((z) => html`<li class="hm-zeile" data-suche="${suche(z)}"><span class="hm-name">${nameBlock(z)}</span><span class="hm-kacheln">${schichten.map((s) => feld(z, s))}</span></li>`)}</ul>
</div>`;

    const leer = filter === 'nicht' ? 'Alle passenden Personen sind schon gefragt.' : 'Keine Person in diesem Filter.';
    res.send(handySeite(kx, e.name, 'einsaetze', html`
${schichtWahl}
${info}
${filterChips}
${unpassendHinweis}
${alleBestaetigen}
<input type="search" class="suche handy-suche" data-filter=".handy-zeilen > li" placeholder="Name suchen …" aria-label="Personen suchen">
${!liste.length ? html`<p class="leer">${leer}</p>` : gewaehlt ? listeEine(gewaehlt) : listeAlle}
<p class="unter handy-fuss">Tipp auf eine Kachel: eintragen oder ändern. Tipp auf den Namen: alle Einsätze der Person.</p>`, {
      zurueck: '/m',
      unter: gewaehlt
        ? `${schichten.length > 1 ? `${gewaehlt.name} · ` : ''}${tag(gewaehlt.start_zeit)} ${uhr(gewaehlt)}`
        : `${tag(schichten[0].start_zeit)} ${lokaleZeit(schichten[0].start_zeit)} – ${tag(schichten[schichten.length - 1].end_zeit)} ${lokaleZeit(schichten[schichten.length - 1].end_zeit)}`,
    }));
  });

  // ---------- Personen ----------
  app.get('/m/personen', nurAufgebot, async (_req, res) => {
    const kx = k(res);
    const liste = await personenListe(db);
    res.send(handySeite(kx, 'Personen', 'personen', html`
<input type="search" class="suche handy-suche" data-filter=".handy-personen > li" placeholder="Name oder Rang suchen …" aria-label="Personen suchen">
<ul class="handy-personen">${liste.map((p) => html`<li data-suche="${`${p.vorname ?? ''} ${p.nachname ?? ''} ${p.nachname ?? ''} ${p.vorname ?? ''} ${p.rang_name ?? ''}`.toLowerCase()}">
  <a href="/m/personen/${p.clubdesk_id}"><span class="hz-name"><small class="rang">${p.rang_name ?? ''}</small><span>${p.nachname ?? ''} ${p.vorname ?? ''}</span></span><span class="pfeil" aria-hidden="true">›</span></a>
</li>`)}</ul>`, { unter: `${liste.length} Personen` }));
  });

  // ---------- Ansicht nach Person: Status in allen kommenden Schichten ----------
  app.get('/m/personen/:id', nurAufgebot, async (req, res) => {
    const kx = k(res);
    const p = await ladePerson(db, leseId(req.params.id));
    const name = `${p.vorname ?? ''} ${p.nachname ?? ''}`.trim() || `Gelöschte Person ${p.clubdesk_id}`;
    const hier = aktuellerPfad(req);
    const einsaetze = await personStatus(db, p);
    const z = zaehlePersonStatus(einsaetze);
    const nummer = hauptnummer(p);
    const wa = whatsappNummer(nummer);
    const alter = alterHeute(p.geburtsdatum);

    const zeile = (s: PersonSchicht) => {
      const art: KachelArt = s.status;
      const text = s.status ? STATUS_TEXT[s.status] : 'nicht gefragt';
      return html`<li class="handy-zeile">
  <div class="hz-haupt">
    ${p.geloescht_am
      ? html`<span class="handy-kachel">${kachel(art)}</span>`
      : html`<a class="handy-kachel${s.passt ? '' : ' passt-nicht'}" href="/rueckmeldungen/eintrag?schicht=${s.schicht_id}&amp;person=${p.clubdesk_id}&amp;zurueck=${encodeURIComponent(hier)}" data-eintrag${bestaetigenFrage({ id: s.anmeldung_id, version: s.version, status: s.status }, name)} title="${text}"><span class="kachel-huelle">${kachel(art)}${s.bemerkung ? html`<span class="bemerkung-marke" aria-hidden="true">✎</span>` : ''}</span><span class="sr">${text}</span></a>`}
    <span class="hz-name">
      <span>${s.schicht === s.einsatz ? zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen) : s.schicht}</span>
      <small>${s.schicht === s.einsatz ? '' : `${zeitraum(s.start_zeit, s.end_zeit, s.zeit_offen)} · `}${text}${s.rolle ? ` · ${s.rolle}` : ''}${s.passt ? '' : ' · passt nicht'}</small>
      ${s.bemerkung ? html`<small class="hz-notiz">✎ ${s.bemerkung}</small>` : ''}
    </span>
    ${s.publiziert ? '' : html`<span class="pille grau">intern</span>`}
  </div>
</li>`;
    };
    const zaehler = (['bestaetigt', 'angemeldet', 'unsicher', 'nachricht_gesendet', 'abgemeldet'] as Status[])
      .filter((st) => z[st] > 0)
      .map((st) => html`<span class="hp-zahl">${kachel(st)}<strong>${z[st]}</strong> ${STATUS_TEXT[st]}</span>`);
    if (z.nicht) zaehler.push(html`<span class="hp-zahl">${kachel(null)}<strong>${z.nicht}</strong> nicht gefragt</span>`);

    res.send(handySeite(kx, name, 'personen', html`
<section class="handy-person">
  ${p.geloescht_am ? html`<p class="meldung hinweis">Die Personendaten sind gelöscht.</p>` : ''}
  ${nummer ? html`<p class="hp-knoepfe"><a class="knopf" href="tel:${telLink(nummer)}">${symbol('telefon')} Anrufen</a>${wa ? html`<a class="knopf" href="https://wa.me/${wa}" rel="noopener noreferrer" target="_blank">${symbol('chat')} WhatsApp</a>` : ''}</p>` : ''}
  ${p.essenseinschraenkung ? html`<p class="unter">Essen: ${p.essenseinschraenkung}</p>` : ''}
  ${zaehler.length ? html`<p class="hp-zahlen">${zaehler}</p>` : ''}
</section>
${einsaetze.length ? einsaetze.map((e) => html`<section class="handy-gruppe">
  <h2><a href="/m/einsaetze/${e.einsatz_id}">${e.einsatz}</a>${e.schichten.length === 1 || e.schichten[0].schicht !== e.einsatz ? html` <small>${tag(e.schichten[0].start_zeit)}</small>` : ''}</h2>
  <ul class="handy-zeilen">${e.schichten.map(zeile)}</ul>
</section>`) : html`<p class="leer">Keine kommenden Schichten.</p>`}
<p class="unter handy-fuss">Tipp auf eine Kachel: eintragen oder ändern. Vergangene Einsätze und Verlauf: <a href="/personen/${p.clubdesk_id}" data-normal>volle Version</a>.</p>`, { zurueck: '/m/personen', unter: [p.rang_name, alter !== null ? `${alter} Jahre` : ''].filter(Boolean).join(' · ') || undefined }));
  });

  // ---------- Mehr ----------
  app.get('/m/mehr', nurAufgebot, (_req, res) => {
    const kx = k(res);
    const b = kx.benutzer!;
    res.send(handySeite(kx, 'Mehr', 'mehr', html`
<ul class="handy-karten handy-mehr">
  <li><span class="hm-benutzer"><strong>${b.name}</strong><small>${b.rolle === 'admin' ? 'Admin' : 'Aufgebotsstelle'}</small></span></li>
  <li><button type="button" class="handy-mehr-knopf thema-knopf" data-thema title="Darstellung: wie System">${symbol('bildschirm', 'thema-system')}${symbol('sonne', 'thema-hell')}${symbol('mond', 'thema-dunkel')}<span>Darstellung wechseln</span></button></li>
  <li><a class="handy-mehr-knopf" href="/m/voll" data-normal>${symbol('cockpit')}<span>Zur vollen Version</span></a></li>
  <li><form method="post" action="/logout" data-normal>${formFelder(kx)}<button type="submit" class="handy-mehr-knopf">${symbol('export')}<span>Abmelden</span></button></form></li>
</ul>
<p class="unter">Die Handyversion zeigt nur Eintragen und die Ansicht nach Person. Einsätze und Schichten anlegen und bearbeiten geht in der vollen Version.</p>`));
  });
}

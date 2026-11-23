// Sperre während eines Updates oder Neustarts (Wunsch Yann, 23.11.2026).
//
// - Während ein Admin ein Update installiert, zeigt jede Seite ein Fenster «Bitte warten».
//   Es sperrt jede Eingabe (Maus und Tastatur).
// - Offene Eingaben (Formulare mit Änderungen) speichert die Seite im Browser (sessionStorage).
//   Eine Eingabe, die der Server während der Sperre nicht gespeichert hat, gehört dazu.
// - Nach dem Neustart erkennt die Seite die neue Version (andere Start-Kennung). Sie lädt sich neu,
//   holt so das neue Skript und CSS und setzt die Eingaben wieder ein. Speichern bleibt Sache des Benutzers.
// - Bricht das Update ab, schliesst sich das Fenster. Alle arbeiten auf dem alten Stand weiter.
// Die Live-Meldungen kommen von app.js (Ereignisse «einsatz:live», «einsatz:getrennt», «einsatz:abgelehnt»).
(function () {
  'use strict';

  var body = document.body;
  if (!body || !body.hasAttribute('data-start') || body.hasAttribute('data-ohne-live') || !window.fetch) return;

  var START = body.getAttribute('data-start');
  var SCHLUESSEL = 'wartung:eingaben';
  var HOECHSTENS_MS = 2 * 60 * 60 * 1000;
  var aktiv = null;
  var fenster = null;
  var abfrageUhr = null;
  var laedtNeu = false;

  var speicher = {
    lies: function () {
      try { return JSON.parse(sessionStorage.getItem(SCHLUESSEL) || 'null'); } catch (e) { return null; }
    },
    schreibe: function (w) {
      try { sessionStorage.setItem(SCHLUESSEL, JSON.stringify(w)); } catch (e) { /* kein Speicher */ }
    },
    weg: function () {
      try { sessionStorage.removeItem(SCHLUESSEL); } catch (e) { /* kein Speicher */ }
    },
  };

  var adresse = function () { return location.pathname + location.search; };

  /** Formulare im Inhalt mit Schlüssel: Ziel, Methode und Nummer unter den Formularen mit demselben Ziel (wie app.js). */
  var formulare = function () {
    var zaehler = {};
    var liste = [];
    document.querySelectorAll('main.inhalt form').forEach(function (f) {
      var ziel = (f.getAttribute('action') || '') + '|' + (f.getAttribute('method') || 'get').toLowerCase();
      zaehler[ziel] = (zaehler[ziel] || 0) + 1;
      liste.push({ form: f, schluessel: ziel + '#' + zaehler[ziel] });
    });
    return liste;
  };

  /** Felder, die das Skript sichert. Ohne CSRF-Token, Knöpfe und Dateien. */
  var felder = function (form) {
    return Array.prototype.filter.call(form.elements, function (el) {
      var typ = (el.type || '').toLowerCase();
      return el.name && el.name !== '_csrf' && ['submit', 'button', 'reset', 'file', 'image'].indexOf(typ) === -1 &&
        el.tagName !== 'BUTTON' && el.tagName !== 'FIELDSET' && el.tagName !== 'OUTPUT';
    });
  };

  var lieseFelder = function (form) {
    return felder(form).map(function (el) {
      var typ = (el.type || '').toLowerCase();
      if (typ === 'checkbox' || typ === 'radio') return { n: el.name, v: el.value, c: el.checked };
      if (el.multiple && el.options) {
        return { n: el.name, m: Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; }) };
      }
      return { n: el.name, v: el.value };
    });
  };

  /** Hat das Formular Felder zum Ausfüllen (nicht nur versteckte Werte)? */
  var mitEingabe = function (form) {
    return felder(form).some(function (el) { return (el.type || '').toLowerCase() !== 'hidden'; });
  };

  /** Kurzer Name einer Aktion für den Hinweis (Text des Knopfs). */
  var aktionsName = function (form) {
    var k = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
    var t = k ? (k.textContent || k.value || '').replace(/\s+/g, ' ').trim() : '';
    return t || 'Aktion';
  };

  /**
   * Speichert offene Eingaben dieser Seite im Browser.
   * Ein leerer Stand überschreibt keinen früheren Stand derselben Seite (z. B. nach einem Neuladen).
   */
  var sichere = function () {
    var liste = [];
    var aktionen = [];
    formulare().forEach(function (x) {
      var f = x.form;
      if ((f.getAttribute('method') || 'get').toLowerCase() !== 'post') return;
      var abgelehnt = f.hasAttribute('data-wartung-abgelehnt');
      if (!f.hasAttribute('data-geaendert') && !abgelehnt) return;
      if (mitEingabe(f)) liste.push({ schluessel: x.schluessel, felder: lieseFelder(f), abgelehnt: abgelehnt });
      else if (abgelehnt) aktionen.push(aktionsName(f));
    });
    // Formulare in einem Fenster (z. B. Eintragen in den Rückmeldungen) lassen sich nicht wieder öffnen.
    var verloren = 0;
    document.querySelectorAll('dialog form').forEach(function (f) {
      if (f.closest('.wartung-fenster')) return;
      if (f.hasAttribute('data-geaendert') || f.hasAttribute('data-wartung-abgelehnt')) {
        verloren++;
        if (!mitEingabe(f)) aktionen.push(aktionsName(f));
      }
    });
    var alt = speicher.lies();
    var gleicheSeite = alt && alt.adresse === adresse() && alt.start === START;
    if (!liste.length && !aktionen.length && !verloren && gleicheSeite) return alt;
    var w = {
      adresse: adresse(), start: START, zeit: Date.now(), scroll: window.scrollY,
      formulare: liste, aktionen: aktionen, fenster: verloren,
    };
    speicher.schreibe(w);
    return w;
  };

  // ---------- Fenster «Bitte warten» ----------

  var TITEL = { update: 'Update wird installiert', neustart: 'Server startet neu' };
  var TEXT = {
    update: 'Ein Admin installiert gerade ein Update. Bitte warte einen Moment. Danach geht es mit der neuen Version weiter.',
    neustart: 'Der Server startet gerade neu. Bitte warte einen Moment. Danach geht es automatisch weiter.',
  };

  var element = function (tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text) e.textContent = text;
    return e;
  };

  var zeigeStand = function (text) {
    if (!fenster) return;
    fenster.querySelector('.wartung-stand').textContent = text;
  };

  var zeigeEingaben = function (w) {
    if (!fenster) return;
    var p = fenster.querySelector('.wartung-eingaben');
    var n = w ? w.formulare.length : 0;
    var a = w ? w.aktionen.length : 0;
    p.textContent = n ? 'Deine offenen Eingaben sind gesichert. Nach dem Update stehen sie wieder da.'
      : a ? 'Deine letzte Aktion ist noch nicht gespeichert. Führe sie nach dem Update erneut aus.'
        : 'Du verlierst nichts. Die Seite lädt danach von selbst.';
  };

  var oeffneFenster = function (grund) {
    if (!fenster) {
      fenster = element('dialog', 'fenster wartung-fenster');
      fenster.setAttribute('aria-labelledby', 'wartung-titel');
      fenster.setAttribute('aria-describedby', 'wartung-text');
      var inhalt = element('div', 'wartung-inhalt');
      var rad = element('span', 'wartung-rad');
      rad.setAttribute('aria-hidden', 'true');
      var h = element('h2', '', '');
      h.id = 'wartung-titel';
      var t = element('p', 'wartung-text');
      t.id = 'wartung-text';
      var s = element('p', 'wartung-stand');
      s.setAttribute('role', 'status');
      s.setAttribute('aria-live', 'polite');
      inhalt.appendChild(rad); inhalt.appendChild(h); inhalt.appendChild(t); inhalt.appendChild(s);
      inhalt.appendChild(element('p', 'wartung-eingaben unter'));
      fenster.appendChild(inhalt);
      // Escape schliesst dieses Fenster nicht.
      fenster.addEventListener('cancel', function (ev) { ev.preventDefault(); });
      body.appendChild(fenster);
    }
    fenster.querySelector('h2').textContent = TITEL[grund] || TITEL.update;
    fenster.querySelector('.wartung-text').textContent = TEXT[grund] || TEXT.update;
    if (!fenster.open) {
      // Andere offene Fenster und Menüs schliessen. Das Fenster liegt über allem und sperrt die Seite.
      document.querySelectorAll('details.menue[open]').forEach(function (m) { m.open = false; });
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      try { fenster.showModal(); } catch (e) { fenster.setAttribute('open', ''); }
    }
    body.classList.add('wartung-aktiv');
  };

  var schliesseFenster = function () {
    body.classList.remove('wartung-aktiv');
    if (fenster && fenster.open) fenster.close();
  };

  // Während der Sperre gehen keine Tasten an die Seite (z. B. Ctrl+Z für Rückgängig).
  document.addEventListener('keydown', function (ev) {
    if (!aktiv) return;
    if (ev.key === 'F5' || ((ev.ctrlKey || ev.metaKey) && (ev.key || '').toLowerCase() === 'r')) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }, true);
  // Sicherheitsnetz: kein Senden während der Sperre.
  document.addEventListener('submit', function (ev) {
    if (!aktiv) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }, true);

  // ---------- Ablauf ----------

  var frageStand = function () {
    fetch('/live/stand', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d) verarbeite(d);
        else if (aktiv) zeigeStand('Der Server startet neu …');
      })
      .catch(function () { if (aktiv) zeigeStand('Der Server startet neu …'); });
  };

  var starteAbfrage = function () {
    if (abfrageUhr) return;
    abfrageUhr = setInterval(frageStand, 2000);
  };
  var stoppeAbfrage = function () {
    if (abfrageUhr) clearInterval(abfrageUhr);
    abfrageUhr = null;
  };

  var beginne = function (grund) {
    aktiv = grund;
    var w = sichere();
    oeffneFenster(grund);
    zeigeStand(grund === 'update' ? 'Das Update läuft …' : 'Der Server startet neu …');
    zeigeEingaben(w);
    starteAbfrage();
  };

  /** Die neue Version läuft: Eingaben sichern und die Seite neu laden. */
  var neueVersion = function () {
    if (laedtNeu) return;
    laedtNeu = true;
    var w = sichere();
    w.neueVersion = true;
    w.grund = aktiv || 'neustart';
    speicher.schreibe(w);
    if (fenster && fenster.open) zeigeStand('Fertig. Die neue Version lädt …');
    location.reload();
  };

  /** Das Update ist abgebrochen. Der alte Stand läuft weiter. */
  var beende = function () {
    var war = aktiv;
    aktiv = null;
    stoppeAbfrage();
    schliesseFenster();
    var w = speicher.lies();
    var abgelehnt = w && w.adresse === adresse() && (w.formulare.some(function (f) { return f.abgelehnt; }) || w.aktionen.length);
    speicher.weg();
    document.querySelectorAll('[data-wartung-abgelehnt]').forEach(function (f) { f.removeAttribute('data-wartung-abgelehnt'); });
    zeigeToast('hinweis', (war === 'update' ? 'Das Update ist abgebrochen. Du kannst weiterarbeiten.' : 'Du kannst weiterarbeiten.') +
      (abgelehnt ? ' Sende deine letzte Eingabe erneut.' : ''));
  };

  var verarbeite = function (d) {
    if (!d || laedtNeu) return;
    if (d.start && d.start !== START) { neueVersion(); return; }
    if (d.wartung && !aktiv) beginne(d.wartung);
    else if (d.wartung && aktiv) zeigeStand(d.wartung === 'update' ? 'Das Update läuft …' : 'Der Server startet neu …');
    else if (!d.wartung && aktiv) beende();
  };

  document.addEventListener('einsatz:live', function (ev) { verarbeite(ev.detail); });
  document.addEventListener('einsatz:getrennt', function () {
    if (aktiv) zeigeStand('Der Server startet neu …');
    // Nach einem Neustart prüft die Seite selbst, ob die neue Version läuft.
    starteAbfrage();
  });
  document.addEventListener('einsatz:abgelehnt', function (ev) {
    var form = ev.detail && ev.detail.form;
    if (form) { form.setAttribute('data-wartung-abgelehnt', '1'); form.setAttribute('data-geaendert', '1'); }
    if (!aktiv) beginne(ev.detail && ev.detail.grund === 'neustart' ? 'neustart' : 'update');
    else zeigeEingaben(sichere());
  });
  document.addEventListener('einsatz:sendefehler', function (ev) {
    if (!aktiv) return;
    // Der Server startet gerade neu. Die Eingabe ist gesichert. Statt der Fehlermeldung bleibt das Fenster.
    ev.preventDefault();
    var form = ev.detail && ev.detail.form;
    if (form) { form.setAttribute('data-wartung-abgelehnt', '1'); form.setAttribute('data-geaendert', '1'); }
    zeigeEingaben(sichere());
  });
  // Lädt jemand die Seite während der Sperre selbst neu, bleiben die Eingaben gesichert.
  window.addEventListener('pagehide', function () { if (aktiv && !laedtNeu) sichere(); });

  // ---------- Nach dem Neuladen: Eingaben wieder einsetzen ----------

  var zeigeToast = function (art, text) {
    var div = element('div', 'toast ' + art);
    div.setAttribute('role', art === 'fehler' ? 'alert' : 'status');
    div.setAttribute('data-toast', art);
    var z = element('span', 'toast-zeichen', art === 'ok' ? '✓' : art === 'fehler' ? '!' : 'i');
    z.setAttribute('aria-hidden', 'true');
    var k = element('button', 'toast-zu', '×');
    k.type = 'button';
    k.setAttribute('data-toast-zu', '');
    k.setAttribute('aria-label', 'Meldung schliessen');
    div.appendChild(z); div.appendChild(element('span', 'toast-text', text)); div.appendChild(k);
    var stapel = document.querySelector('.toast-stapel');
    if (stapel) { stapel.appendChild(div); return; }
    // Beim Laden sammelt app.js die Meldungen aus dem Inhalt ein.
    var main = document.querySelector('main.inhalt');
    if (main) main.insertBefore(div, main.firstChild);
  };

  var setzeFelder = function (form, gespeichert) {
    var warteschlange = {};
    gespeichert.forEach(function (g) {
      if (g.c !== undefined) return;
      (warteschlange[g.n] = warteschlange[g.n] || []).push(g);
    });
    felder(form).forEach(function (el) {
      var typ = (el.type || '').toLowerCase();
      if (typ === 'checkbox' || typ === 'radio') {
        var treffer = gespeichert.filter(function (g) { return g.n === el.name && g.c !== undefined && g.v === el.value; })[0];
        if (treffer) el.checked = treffer.c;
        return;
      }
      var q = warteschlange[el.name];
      var g = q && q.shift();
      if (!g) return;
      if (g.m && el.options) {
        Array.prototype.forEach.call(el.options, function (o) { o.selected = g.m.indexOf(o.value) >= 0; });
      } else if (g.v !== undefined) {
        el.value = g.v;
      }
    });
    form.setAttribute('data-geaendert', '1');
    // Aufgeklappte Bereiche um das Formular öffnen (z. B. eine Schicht im Reiter «Schichten»).
    for (var d = form.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  };

  var stelleWiederHer = function () {
    var w = speicher.lies();
    if (!w || w.start === START || !w.neueVersion) return;
    speicher.weg();
    if (Date.now() - w.zeit > HOECHSTENS_MS) return;
    var titel = w.grund === 'update' ? 'Update installiert.' : 'Der Server ist wieder da.';
    if (w.adresse !== adresse()) {
      if (w.formulare.length) zeigeToast('fehler', titel + ' Deine Eingaben gehören zu einer anderen Seite. Gib sie dort erneut ein.');
      else zeigeToast('ok', titel + ' Du arbeitest mit der neuen Version.');
      return;
    }
    var gefunden = {};
    formulare().forEach(function (x) { gefunden[x.schluessel] = x.form; });
    var ok = 0;
    var fehlt = w.fenster || 0;
    w.formulare.forEach(function (f) {
      var form = gefunden[f.schluessel];
      if (form) { setzeFelder(form, f.felder); ok++; } else fehlt++;
    });
    if (typeof w.scroll === 'number') window.scrollTo(0, w.scroll);
    if (ok) zeigeToast('hinweis', titel + ' Deine Eingaben sind wieder da. Prüfe sie und speichere sie.');
    else zeigeToast('ok', titel + ' Du arbeitest mit der neuen Version.');
    if (w.aktionen.length) zeigeToast('fehler', 'Nicht gespeichert: ' + w.aktionen.join(', ') + '. Führe die Aktion erneut aus.');
    if (fehlt) zeigeToast('fehler', fehlt === 1 ? 'Eine Eingabe in einem Fenster ist verloren. Gib sie erneut ein.' : fehlt + ' Eingaben in Fenstern sind verloren. Gib sie erneut ein.');
  };

  var anfangsGrund = body.getAttribute('data-wartung');
  if (anfangsGrund) beginne(anfangsGrund === 'neustart' ? 'neustart' : 'update');
  else stelleWiederHer();
})();

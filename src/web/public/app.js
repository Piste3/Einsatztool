// Wenig JavaScript für die Bedienung. Ohne Skript funktioniert jede Seite weiter.
//
// Live-Aktualisierung:
// - Formulare speichern im Hintergrund. Die Seite lädt nicht neu.
// - Der Server meldet jede Änderung sofort (Server-Sent Events, GET /live).
//   Dann holt die Seite ihren neuen Stand und tauscht den Inhalt aus.
// - Offene Eingaben bleiben stehen: ein Formular mit Änderungen, das Feld mit dem Cursor,
//   aufgeklappte Bereiche und Suchfelder.
// - Hält ein Proxy die Meldungen zurück, fragt die Seite alle 10 Sekunden nach (GET /live/stand).
(function () {
  'use strict';

  var body = document.body;
  var LIVE = !!(body && body.hasAttribute('data-live-nr') && !body.hasAttribute('data-ohne-live') &&
    window.fetch && window.DOMParser && window.FormData && window.history && history.pushState);

  // ---------- Bedienung (über Delegation, gilt auch nach dem Austausch des Inhalts) ----------

  // Menü auf dem Handy
  document.addEventListener('click', function (ev) {
    var knopf = ev.target.closest ? ev.target.closest('.knopf-menue') : null;
    var leiste = document.getElementById('leiste');
    if (!knopf || !leiste) return;
    var offen = leiste.classList.toggle('offen');
    knopf.setAttribute('aria-expanded', offen ? 'true' : 'false');
  });

  // Darstellung wechseln: wie System → Hell → Dunkel.
  var themaText = { system: 'Darstellung: wie System', hell: 'Darstellung: Hell', dunkel: 'Darstellung: Dunkel' };
  var themaLesen = function () {
    try { return localStorage.getItem('thema') || 'system'; } catch (e) { return 'system'; }
  };
  var themaZeigen = function (t) {
    var w = document.documentElement;
    if (t === 'hell') w.setAttribute('data-theme', 'light');
    else if (t === 'dunkel') w.setAttribute('data-theme', 'dark');
    else w.removeAttribute('data-theme');
    document.querySelectorAll('[data-thema]').forEach(function (k) {
      k.setAttribute('data-wahl', t);
      k.title = themaText[t];
    });
  };
  themaZeigen(themaLesen());
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest || !ev.target.closest('[data-thema]')) return;
    var naechste = { system: 'hell', hell: 'dunkel', dunkel: 'system' }[themaLesen()] || 'system';
    try { localStorage.setItem('thema', naechste); } catch (e) { /* kein Speicher */ }
    themaZeigen(naechste);
  });

  // Menü «Mehr»: ein Klick daneben oder Escape schliesst es.
  document.addEventListener('click', function (ev) {
    document.querySelectorAll('details.menue[open]').forEach(function (m) {
      if (!m.contains(ev.target)) m.open = false;
    });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    document.querySelectorAll('details.menue[open]').forEach(function (m) { m.open = false; });
  });

  // Suchfeld filtert beim Tippen.
  var filtere = function (feld) {
    var q = feld.value.trim().toLowerCase();
    document.querySelectorAll(feld.getAttribute('data-filter')).forEach(function (zeile) {
      var text = zeile.getAttribute('data-suche') || zeile.textContent.toLowerCase();
      zeile.hidden = q !== '' && text.indexOf(q) === -1;
    });
  };
  document.addEventListener('input', function (ev) {
    if (ev.target.matches && ev.target.matches('input[data-filter]')) filtere(ev.target);
  });

  // Kopieren in die Zwischenablage, Drucken
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest) return;
    var k = ev.target.closest('[data-kopieren]');
    if (k) {
      var quelle = document.querySelector(k.getAttribute('data-kopieren'));
      if (!quelle) return;
      var text = quelle.value !== undefined ? quelle.value : quelle.textContent;
      var fertig = function () {
        var alt = k.textContent;
        k.textContent = 'Kopiert';
        setTimeout(function () { k.textContent = alt; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(fertig, function () { if (quelle.select) quelle.select(); });
      } else if (quelle.select) {
        quelle.select();
      }
      return;
    }
    if (ev.target.closest('[data-drucken]')) window.print();
  });

  // Alle wählen (Anrufliste)
  document.addEventListener('change', function (ev) {
    var k = ev.target;
    if (!k.matches || !k.matches('[data-alle-waehlen]')) return;
    var name = k.getAttribute('data-alle-waehlen');
    document.querySelectorAll('input[type="checkbox"][name="' + name + '"]').forEach(function (c) {
      var zeile = c.closest('tr');
      if (!zeile || !zeile.hidden) c.checked = k.checked;
    });
  });

  // Offene Detail-Formulare in der Matrix: nur eines gleichzeitig offen.
  // «toggle» steigt nicht auf. Darum hört das Dokument in der Capture-Phase mit.
  document.addEventListener('toggle', function (ev) {
    var d = ev.target;
    if (!d.matches || !d.matches('td.zelle details') || !d.open) return;
    document.querySelectorAll('td.zelle details[open]').forEach(function (andere) {
      if (andere !== d) andere.open = false;
    });
  }, true);

  // Meldungen wie «Gespeichert» verschwinden nach einigen Sekunden.
  var meldungenAusblenden = function (wurzel) {
    wurzel.querySelectorAll('.meldung[data-verschwinden="1"]').forEach(function (m) {
      setTimeout(function () {
        m.classList.add('weg');
        setTimeout(function () { m.remove(); }, 600);
      }, 4000);
    });
  };
  meldungenAusblenden(document);

  // Nach dem Speichern ohne Live-Aktualisierung bleibt die Seite an derselben Stelle.
  var schluessel = 'scroll:' + location.pathname + location.search;
  try {
    var gespeichert = sessionStorage.getItem(schluessel);
    if (gespeichert !== null) {
      sessionStorage.removeItem(schluessel);
      window.scrollTo(0, Number(gespeichert) || 0);
    }
  } catch (e) { /* kein Speicher */ }
  var merkeScroll = function (form) {
    var ziel = form.querySelector('input[name="zurueck"]');
    var pfad = ziel ? ziel.value : location.pathname + location.search;
    try { sessionStorage.setItem('scroll:' + pfad, String(window.scrollY)); } catch (e) { /* kein Speicher */ }
  };

  // Formulare mit Änderungen merken. Die Live-Aktualisierung lässt sie stehen.
  var markiere = function (ev) {
    var form = ev.target && ev.target.form;
    if (form && !(ev.target.matches && ev.target.matches('input[data-filter]'))) form.setAttribute('data-geaendert', '1');
  };
  document.addEventListener('input', markiere);
  document.addEventListener('change', markiere);

  if (!LIVE) {
    document.addEventListener('submit', function (ev) {
      var form = ev.target;
      if (form && (form.method || '').toLowerCase() === 'post') merkeScroll(form);
    }, true);
    return;
  }

  // ---------- Live: Inhalt austauschen ----------

  var main = function () { return document.querySelector('main.inhalt'); };
  var liveNr = body.getAttribute('data-live-nr');
  var sendetFormular = false;

  /** Schlüssel eines Formulars: Ziel und Nummer unter den Formularen mit demselben Ziel. */
  var formSchluessel = function (wurzel) {
    var zaehler = {};
    var liste = [];
    wurzel.querySelectorAll('form').forEach(function (f) {
      var ziel = (f.getAttribute('action') || '') + '|' + (f.getAttribute('method') || 'get').toLowerCase();
      zaehler[ziel] = (zaehler[ziel] || 0) + 1;
      liste.push({ form: f, schluessel: ziel + '#' + zaehler[ziel] });
    });
    return liste;
  };

  /** Schlüssel eines aufklappbaren Bereichs: erstes Formular darin oder Text der Überschrift. */
  var detailsSchluessel = function (wurzel) {
    var zaehler = {};
    var liste = [];
    wurzel.querySelectorAll('details').forEach(function (d) {
      var f = d.querySelector('form');
      var s = d.querySelector('summary');
      var basis = f ? 'f:' + (f.getAttribute('action') || '') : 't:' + (s ? s.textContent.trim() : '');
      zaehler[basis] = (zaehler[basis] || 0) + 1;
      liste.push({ details: d, schluessel: basis + '#' + zaehler[basis] });
    });
    return liste;
  };

  var suchSchluessel = function (feld, i) { return (feld.getAttribute('data-filter') || '') + '#' + i; };

  /**
   * Tauscht Navigation und Inhalt gegen die neue Seite aus.
   * schuetzen: Formulare mit Änderungen und das Feld mit dem Cursor bleiben stehen.
   * ausser: Dieses Formular wird immer ersetzt (es ist gerade gespeichert).
   */
  var tausche = function (neu, o) {
    var neuMain = neu.querySelector('main.inhalt');
    var neuLeiste = neu.getElementById('leiste');
    var altMain = main();
    var altLeiste = document.getElementById('leiste');
    if (!neuMain || !neuLeiste || !altMain || !altLeiste) return false;

    var aktiv = document.activeElement;
    var auswahl = null;
    try {
      if (aktiv && typeof aktiv.selectionStart === 'number') auswahl = [aktiv.selectionStart, aktiv.selectionEnd];
    } catch (e) { /* Feld ohne Auswahl */ }

    if (o.schuetzen) {
      // Zuerst alles am alten Inhalt ablesen, dann erst Knoten verschieben.
      // Aufgeklappte Bereiche bleiben offen.
      var offen = {};
      detailsSchluessel(altMain).forEach(function (x) { if (x.details.open) offen[x.schluessel] = true; });
      // Suchfelder behalten ihren Text.
      var alteSuche = {};
      altMain.querySelectorAll('input[data-filter]').forEach(function (f, i) { alteSuche[suchSchluessel(f, i)] = f.value; });
      // Geschützte Formulare: alte Knoten in die neue Seite übernehmen.
      var neuForms = {};
      formSchluessel(neuMain).forEach(function (x) { neuForms[x.schluessel] = x.form; });
      var tausch = [];
      formSchluessel(altMain).forEach(function (x) {
        if (x.form === o.ausser) return;
        var geschuetzt = x.form.hasAttribute('data-geaendert') || (aktiv && x.form.contains(aktiv));
        var ziel = neuForms[x.schluessel];
        if (geschuetzt && ziel) tausch.push([ziel, x.form]);
      });
      detailsSchluessel(neuMain).forEach(function (x) { if (offen[x.schluessel]) x.details.open = true; });
      neuMain.querySelectorAll('input[data-filter]').forEach(function (f, i) {
        var w = alteSuche[suchSchluessel(f, i)];
        if (w) f.value = w;
      });
      tausch.forEach(function (p) { p[0].replaceWith(p[1]); });
    }

    // Navigation: Zähler und markierte Seite. Das Menü auf dem Handy bleibt offen oder zu.
    altLeiste.innerHTML = neuLeiste.innerHTML;
    themaZeigen(themaLesen());
    altMain.className = neuMain.className;
    altMain.replaceChildren.apply(altMain, Array.prototype.slice.call(neuMain.childNodes));
    if (neu.title) document.title = neu.title;
    var nr = neu.body && neu.body.getAttribute('data-live-nr');
    if (nr !== null && nr !== undefined) liveNr = nr;

    // Suchfilter neu anwenden, Cursor zurücksetzen.
    altMain.querySelectorAll('input[data-filter]').forEach(function (f) { if (f.value) filtere(f); });
    if (aktiv && aktiv !== document.body && document.contains(aktiv) && document.activeElement !== aktiv) {
      try {
        aktiv.focus({ preventScroll: true });
        if (auswahl) aktiv.setSelectionRange(auswahl[0], auswahl[1]);
      } catch (e) { /* Feld ohne Auswahl */ }
    }
    meldungenAusblenden(altMain);
    liveZeigen();
    return true;
  };

  /** Ersetzt die ganze Seite (z. B. Fehlerseite ohne Navigation). */
  var ersetzeAlles = function (neu) {
    document.title = neu.title;
    document.body.className = neu.body.className;
    document.body.innerHTML = neu.body.innerHTML;
    stoppeLive();
  };

  var lese = function (text) { return new DOMParser().parseFromString(text, 'text/html'); };

  // ---------- Live: Formulare im Hintergrund senden ----------

  var meldeFehler = function (text) {
    var m = main();
    if (!m) return;
    var div = document.createElement('div');
    div.className = 'meldung fehler';
    div.setAttribute('role', 'alert');
    div.textContent = text;
    m.insertBefore(div, m.firstChild);
  };

  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (ev.defaultPrevented || !form || (form.getAttribute('method') || 'get').toLowerCase() !== 'post') return;
    if (form.closest('[data-normal]') || (form.target && form.target !== '_self')) {
      merkeScroll(form);
      return;
    }
    ev.preventDefault();
    if (form.getAttribute('aria-busy') === 'true') return;

    var daten;
    try {
      daten = new FormData(form, ev.submitter || undefined);
    } catch (e) {
      daten = new FormData(form);
      if (ev.submitter && ev.submitter.name) daten.append(ev.submitter.name, ev.submitter.value);
    }
    var mehrteilig = (form.getAttribute('enctype') || '').toLowerCase() === 'multipart/form-data';
    var inhalt = mehrteilig ? daten : new URLSearchParams(daten);
    var knoepfe = form.querySelectorAll('button, input[type="submit"]');
    form.setAttribute('aria-busy', 'true');
    knoepfe.forEach(function (k) { k.disabled = true; });
    sendetFormular = true;

    var freigeben = function () {
      sendetFormular = false;
      form.removeAttribute('aria-busy');
      knoepfe.forEach(function (k) { k.disabled = false; });
      if (liveWartet) holeNeuenStand();
    };

    fetch(form.action, { method: 'POST', body: inhalt, credentials: 'same-origin', headers: { 'X-Live-Formular': '1' } })
      .then(function (r) {
        var art = r.headers.get('content-type') || '';
        if (art.indexOf('text/html') === -1) {
          // Keine Seite (z. B. eine Datei): normal senden.
          freigeben();
          merkeScroll(form);
          HTMLFormElement.prototype.submit.call(form);
          return null;
        }
        if (r.headers.get('refresh')) {
          location.assign(r.url);
          return null;
        }
        return r.text().then(function (text) {
          var neu = lese(text);
          var vorher = location.pathname + location.search;
          var ziel = new URL(r.url, location.href);
          var neueAdresse = r.redirected && ziel.origin === location.origin && (ziel.pathname + ziel.search) !== vorher;
          if (!tausche(neu, { schuetzen: true, ausser: form })) {
            ersetzeAlles(neu);
          } else if (neueAdresse) {
            history.pushState({ live: true }, '', ziel.pathname + ziel.search + ziel.hash);
            window.scrollTo(0, 0);
          }
          freigeben();
        });
      })
      .catch(function () {
        freigeben();
        meldeFehler('Die Verbindung zum Server ist unterbrochen. Prüfe, ob die Änderung gespeichert ist, und versuche es erneut.');
      });
  });

  // Zurück und Vorwärts im Browser: die Seite normal laden.
  window.addEventListener('popstate', function () { location.reload(); });

  // ---------- Live: Änderungen anderer Benutzer ----------

  var liveWartet = false;
  var holtGerade = false;
  var quelle = null;
  var letzteMeldung = Date.now();
  var abfrageUhr = null;
  var wachUhr = null;
  var verbunden = false;
  var gestoppt = false;

  var liveZeigen = function () {
    document.querySelectorAll('[data-live]').forEach(function (l) {
      l.classList.toggle('an', verbunden || !!abfrageUhr);
      l.classList.toggle('getrennt', !verbunden && !abfrageUhr);
      var t = l.querySelector('.live-text');
      if (t) t.textContent = verbunden || abfrageUhr ? 'Live' : 'Getrennt';
      l.title = verbunden ? 'Die Seite zeigt Änderungen aller Benutzer sofort an.'
        : abfrageUhr ? 'Die Seite prüft alle 10 Sekunden auf Änderungen.'
          : 'Keine Verbindung zum Server. Die Seite versucht es weiter.';
    });
  };

  var holeNeuenStand = function () {
    if (gestoppt) return;
    if (holtGerade || sendetFormular || document.visibilityState === 'hidden') {
      liveWartet = true;
      return;
    }
    liveWartet = false;
    holtGerade = true;
    var adresse = location.pathname + location.search;
    fetch(adresse, { credentials: 'same-origin', headers: { 'X-Live-Abfrage': '1', Accept: 'text/html' } })
      .then(function (r) {
        if (r.redirected || !r.ok) {
          // Abgemeldet, Einsatz gelöscht o. Ä.: nichts austauschen. Der Benutzer sieht den alten Stand.
          return null;
        }
        return r.text();
      })
      .then(function (text) {
        // Ein Formular wurde inzwischen gesendet oder die Adresse hat gewechselt: verwerfen.
        if (text && !sendetFormular && adresse === location.pathname + location.search) tausche(lese(text), { schuetzen: true });
      })
      .catch(function () { liveWartet = true; })
      .then(function () {
        holtGerade = false;
        if (liveWartet && !sendetFormular) setTimeout(holeNeuenStand, 500);
      });
  };

  var neueNr = function (nr) {
    letzteMeldung = Date.now();
    if (nr === undefined || nr === null) return;
    nr = String(nr);
    if (nr === liveNr) return;
    liveNr = nr;
    holeNeuenStand();
  };

  var lies = function (ev) {
    try { return JSON.parse(ev.data).nr; } catch (e) { return null; }
  };

  // Ersatz: alle 10 Sekunden nachfragen, solange keine Live-Meldung ankommt.
  var starteAbfrage = function () {
    if (abfrageUhr || gestoppt) return;
    abfrageUhr = setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      fetch('/live/stand', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) {
          if (r.status === 401) { stoppeLive(); return null; }
          return r.ok ? r.json() : null;
        })
        .then(function (d) { if (d) neueNr(d.nr); })
        .catch(function () { /* beim nächsten Mal erneut */ });
    }, 10000);
    liveZeigen();
  };
  var stoppeAbfrage = function () {
    if (abfrageUhr) clearInterval(abfrageUhr);
    abfrageUhr = null;
    liveZeigen();
  };

  var stoppeLive = function () {
    gestoppt = true;
    if (quelle) quelle.close();
    stoppeAbfrage();
    if (wachUhr) clearInterval(wachUhr);
  };

  if (window.EventSource) {
    quelle = new EventSource('/live');
    quelle.addEventListener('open', function () { verbunden = true; letzteMeldung = Date.now(); liveZeigen(); });
    quelle.addEventListener('stand', function (ev) { verbunden = true; stoppeAbfrage(); neueNr(lies(ev)); });
    quelle.addEventListener('aenderung', function (ev) { verbunden = true; stoppeAbfrage(); neueNr(lies(ev)); });
    quelle.addEventListener('puls', function (ev) { verbunden = true; stoppeAbfrage(); neueNr(lies(ev)); });
    quelle.addEventListener('error', function () {
      verbunden = false;
      liveZeigen();
      // 401 oder Server weg: Der Browser versucht es selbst erneut. Bis dahin hilft die Abfrage.
      starteAbfrage();
    });
    // Kommt 45 Sekunden lang nichts an (z. B. Proxy mit Puffer), hilft die Abfrage.
    wachUhr = setInterval(function () {
      if (Date.now() - letzteMeldung > 45000) {
        verbunden = false;
        starteAbfrage();
      }
    }, 5000);
  } else {
    starteAbfrage();
  }
  liveZeigen();

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && liveWartet) holeNeuenStand();
  });
  window.addEventListener('pagehide', function () { if (quelle) quelle.close(); });
})();

// Wenig JavaScript für die Bedienung. Ohne Skript funktioniert jede Seite weiter.
//
// Live-Aktualisierung:
// - Formulare speichern im Hintergrund. Die Seite lädt nicht neu.
// - Links im Tool, Filter und Zurück/Vorwärts laden die neue Seite im Hintergrund (Navigation ohne Neuladen).
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
    // Kopieren mit Formatierung (Clubdesk-Text): HTML und reiner Text zusammen in die Zwischenablage.
    var r = ev.target.closest('[data-kopieren-html]');
    if (r) {
      var htmlQ = document.querySelector(r.getAttribute('data-kopieren-html'));
      var textQ = document.querySelector(r.getAttribute('data-kopieren-text'));
      var auswahlQ = document.querySelector(r.getAttribute('data-kopieren-auswahl'));
      var gemeldet = function () {
        var alt = r.textContent;
        r.textContent = 'Kopiert';
        setTimeout(function () { r.textContent = alt; }, 2000);
      };
      // Ohne ClipboardItem: den angezeigten Text markieren und kopieren. Der Browser nimmt die Formatierung mit.
      var ueberAuswahl = function () {
        if (!auswahlQ) return;
        var bereich = document.createRange();
        bereich.selectNodeContents(auswahlQ);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(bereich);
        try { if (document.execCommand('copy')) gemeldet(); } catch (e) { /* Auswahl bleibt zum Kopieren von Hand */ }
      };
      if (htmlQ && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        var daten = {
          'text/html': new Blob([htmlQ.value], { type: 'text/html' }),
          'text/plain': new Blob([textQ ? textQ.value : htmlQ.value], { type: 'text/plain' })
        };
        navigator.clipboard.write([new ClipboardItem(daten)]).then(gemeldet, ueberAuswahl);
      } else {
        ueberAuswahl();
      }
      return;
    }
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

  // Meldungen («Gespeichert»): kleine Toasts unten rechts. Sie verschieben das Layout nicht.
  // ok verschwindet nach 3 s, ein Hinweis nach 6 s. Ein Fehler bleibt, bis man ihn schliesst.
  // Fährt die Maus über einen Toast, wartet er. Ein Toast mit «Rückgängig» bleibt 10 s.
  var DAUER = { ok: 3000, hinweis: 6000 };
  var stapel = null;
  var toastWeg = function (t) {
    if (!t || t.classList.contains('weg')) return;
    t.classList.add('weg');
    setTimeout(function () { t.remove(); }, 250);
  };
  var toastStarten = function (t) {
    var dauer = DAUER[t.getAttribute('data-toast')];
    if (!dauer) return;
    if (t.hasAttribute('data-toast-aktion')) dauer = 10000;
    var uhr = null;
    var los = function () { uhr = setTimeout(function () { toastWeg(t); }, dauer); };
    t.addEventListener('mouseenter', function () { clearTimeout(uhr); });
    t.addEventListener('mouseleave', los);
    los();
  };
  var meldungenAusblenden = function (wurzel) {
    var toasts = wurzel.querySelectorAll('.toast[data-toast]');
    if (!toasts.length) return;
    if (!stapel || !document.body.contains(stapel)) {
      stapel = document.createElement('div');
      stapel.className = 'toast-stapel';
      stapel.setAttribute('aria-live', 'polite');
      document.body.appendChild(stapel);
    }
    Array.prototype.forEach.call(toasts, function (t) {
      if (t.parentNode === stapel) return;
      // Dieselbe Meldung nur einmal zeigen.
      var text = t.textContent.trim();
      // Ein neuer Knopf «Rückgängig» oder «Wiederholen» ersetzt den alten (sein Schlüssel ist verbraucht).
      var mitAktion = t.hasAttribute('data-toast-aktion');
      Array.prototype.forEach.call(stapel.children, function (alt) {
        if (alt.textContent.trim() === text || (mitAktion && alt.hasAttribute('data-toast-aktion'))) toastWeg(alt);
      });
      stapel.appendChild(t);
      toastStarten(t);
    });
    while (stapel.children.length > 4) stapel.removeChild(stapel.firstChild);
  };
  // Ctrl+Z (Mac: Cmd+Z) ausserhalb von Eingabefeldern: neueste eigene Aktion rückgängig machen.
  // Ctrl+Y oder Ctrl+Shift+Z: den zuletzt rückgängig gemachten Schritt wiederholen.
  // In einem Eingabefeld bleiben die Tasten beim Browser (Text rückgängig).
  document.addEventListener('keydown', function (ev) {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    var taste = (ev.key || '').toLowerCase();
    var wiederholen = taste === 'y' || (taste === 'z' && ev.shiftKey);
    if (!wiederholen && (taste !== 'z' || ev.shiftKey)) return;
    var z = ev.target;
    if (z && (z.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(z.tagName || ''))) return;
    if (document.querySelector('dialog[open]')) return;
    var f = document.querySelector(wiederholen ? 'form[data-wiederholen]' : 'form[data-rueckgaengig]');
    if (!f || !f.requestSubmit) return;
    ev.preventDefault();
    f.requestSubmit();
  });

  // «Rückgängig» geht nur einmal: Der Toast verschwindet nach dem Klick.
  document.addEventListener('submit', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('.toast') : null;
    if (t) setTimeout(function () { toastWeg(t); }, 0);
  });
  document.addEventListener('click', function (ev) {
    var zu = ev.target && ev.target.closest ? ev.target.closest('[data-toast-zu]') : null;
    if (zu) toastWeg(zu.closest('.toast'));
  });
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

  // Rückfrage vor wichtigen Aktionen (z. B. «Update installieren»). Ohne Skript sendet der Knopf direkt.
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    var frage = form && form.getAttribute && form.getAttribute('data-bestaetigen');
    if (frage && !window.confirm(frage)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, true);

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
    // Knopf «Rückgängig» im Kopf auf dem Handy.
    var neuMobil = neu.querySelector('.kopf-mobil .rueckgaengig-reihe');
    var altMobil = document.querySelector('.kopf-mobil .rueckgaengig-reihe');
    if (neuMobil && altMobil) altMobil.replaceWith(document.importNode(neuMobil, true));
    themaZeigen(themaLesen());
    altMain.className = neuMain.className;
    // Tabellen mit eigenem Scrollbereich behalten ihre Position (z. B. Rückmeldungen nach einem Eintrag).
    var scrollStand = Array.prototype.map.call(altMain.querySelectorAll('.rahmen'), function (r) { return [r.scrollTop, r.scrollLeft]; });
    var seitenScroll = window.scrollY;
    altMain.replaceChildren.apply(altMain, Array.prototype.slice.call(neuMain.childNodes));
    if (!o.neueSeite) {
      altMain.querySelectorAll('.rahmen').forEach(function (r, i) {
        if (scrollStand[i]) { r.scrollTop = scrollStand[i][0]; r.scrollLeft = scrollStand[i][1]; }
      });
      if (window.scrollY !== seitenScroll) window.scrollTo(0, seitenScroll);
    }
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

  // ---------- Filter: sofort anwenden ----------
  // Ein Filterformular mit data-sofort sendet sich bei jeder Änderung selbst (Auswahl, Häkchen, Datum, Name nach Enter
  // oder beim Verlassen des Felds). Der Server speichert die Filter je Benutzer. Ohne Skript gilt der Knopf «Anzeigen».
  document.addEventListener('change', function (ev) {
    var feld = ev.target;
    var form = feld && feld.form;
    if (!form || !form.hasAttribute('data-sofort')) return;
    if (form.requestSubmit) form.requestSubmit(); else form.submit();
  });

  // ---------- Rückmeldungen: Fenster zum Eintragen ----------
  // Ein Klick auf ein Feld lädt das Formular in ein Fenster. Speichern läuft über die
  // bestehenden Routen (Konfliktschutz, Warnungen, Live, Toast). Ohne Skript öffnet der Link eine Seite.
  var fenster = null;
  var fensterZu = function () { if (fenster && fenster.open) fenster.close(); };
  var oeffneFenster = function (link) {
      // Die Rücksprung-Adresse ist immer die aktuelle Ansicht (Filter bleiben).
      var url = new URL(link.href);
      url.searchParams.set('zurueck', location.pathname + location.search);
      fetch(url.pathname + url.search, { credentials: 'same-origin', headers: { 'X-Fragment': '1', 'X-Live-Abfrage': '1' } })
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
        .then(function (text) {
          if (!fenster) {
            fenster = document.createElement('dialog');
            fenster.className = 'fenster';
            fenster.setAttribute('aria-label', 'Eintragen');
            fenster.addEventListener('click', function (e) { if (e.target === fenster) fensterZu(); });
            document.body.appendChild(fenster);
          }
          fenster.innerHTML = text;
          if (!fenster.open) fenster.showModal();
          var erstes = fenster.querySelector('input[type="radio"]:checked');
          if (erstes) erstes.focus();
        })
        .catch(function () { location.assign(link.href); });
  };

  // Fenster «Bestätigen?» (Wunsch Yann 20.11.2026): Ein Klick auf eine Kachel mit «angemeldet» fragt zuerst.
  // Der Knopf «Bestätigen» hat den Fokus. Enter bestätigt nur in diesem Fenster. «Menü öffnen» zeigt das normale Fenster.
  var frage = null;
  var csrfWert = function () {
    var f = document.querySelector('input[name="_csrf"]');
    return f ? f.value : '';
  };
  var feld = function (form, name, wert) {
    var i = document.createElement('input');
    i.type = 'hidden'; i.name = name; i.value = wert;
    form.appendChild(i);
  };
  var frageBestaetigen = function (link) {
    if (!frage) {
      frage = document.createElement('dialog');
      frage.className = 'fenster frage-fenster';
      frage.setAttribute('aria-labelledby', 'frage-titel');
      frage.addEventListener('click', function (e) { if (e.target === frage) frage.close(); });
      document.body.appendChild(frage);
    }
    frage.textContent = '';
    var form = document.createElement('form');
    form.method = 'post';
    form.action = '/anmeldungen/' + link.getAttribute('data-bestaetigen');
    form.className = 'frage-form';
    feld(form, '_csrf', csrfWert());
    feld(form, 'zurueck', location.pathname + location.search);
    feld(form, 'status', 'bestaetigt');
    feld(form, 'version', link.getAttribute('data-version') || '');
    var titel = document.createElement('p');
    titel.id = 'frage-titel';
    titel.className = 'frage-titel';
    titel.textContent = (link.getAttribute('data-name') || 'Eintrag') + ' bestätigen?';
    var hinweis = document.createElement('p');
    hinweis.className = 'unter';
    hinweis.textContent = 'Enter = Bestätigen. Esc = Abbrechen.';
    var reihe = document.createElement('div');
    reihe.className = 'knopfreihe';
    var ja = document.createElement('button');
    ja.type = 'submit'; ja.className = 'knopf haupt'; ja.textContent = 'Bestätigen';
    var menue = document.createElement('button');
    menue.type = 'button'; menue.className = 'knopf'; menue.textContent = 'Menü öffnen';
    menue.addEventListener('click', function () { frage.close(); oeffneFenster(link); });
    var nein = document.createElement('button');
    nein.type = 'button'; nein.className = 'knopf'; nein.textContent = 'Abbrechen';
    nein.addEventListener('click', function () { frage.close(); });
    reihe.appendChild(ja); reihe.appendChild(menue); reihe.appendChild(nein);
    form.appendChild(titel); form.appendChild(hinweis); form.appendChild(reihe);
    form.addEventListener('submit', function () { setTimeout(function () { if (frage.open) frage.close(); }, 0); });
    frage.appendChild(form);
    frage.showModal();
    ja.focus();
  };

  document.addEventListener('click', function (ev) {
    var link = ev.target && ev.target.closest ? ev.target.closest('a[data-eintrag]') : null;
    if (link) {
      if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || !window.fetch || !window.HTMLDialogElement) return;
      ev.preventDefault();
      if (link.hasAttribute('data-bestaetigen')) frageBestaetigen(link);
      else oeffneFenster(link);
      return;
    }
    var zu = ev.target && ev.target.closest ? ev.target.closest('[data-fenster-zu]') : null;
    if (zu && fenster && fenster.contains(zu)) { ev.preventDefault(); fensterZu(); }
  });
  // Beim Speichern schliesst das Fenster. Das Senden übernimmt der Live-Teil unten.
  document.addEventListener('submit', function (ev) {
    if (fenster && fenster.contains(ev.target)) setTimeout(fensterZu, 0);
  }, true);

  // Kanal «WhatsApp» gewählt: Das Ergebnis springt auf «Nachricht gesendet» (Wunsch Yann 20.11.2026).
  // Danach lässt es sich von Hand ändern. Gilt für Optionsfelder und Auswahllisten im selben Formular.
  document.addEventListener('change', function (ev) {
    var feld = ev.target;
    if (!feld || feld.name !== 'kanal' || feld.value !== 'whatsapp' || !feld.form) return;
    var knopf = feld.form.querySelector('input[name="status"][value="nachricht_gesendet"]');
    if (knopf) { knopf.checked = true; return; }
    var liste = feld.form.querySelector('select[name="status"]');
    if (liste && liste.querySelector('option[value="nachricht_gesendet"]')) liste.value = 'nachricht_gesendet';
  });

  // Tenue-Vorlage gewählt: Der Text ersetzt das Feld «Tenue» (Wunsch Yann 20.11.2026).
  // Die Auswahl springt zurück auf leer. So sendet das Formular den Text im Feld, auch nach einer Änderung von Hand.
  document.addEventListener('change', function (ev) {
    var auswahl = ev.target;
    if (!auswahl || auswahl.name !== 'tenue_vorlage' || !auswahl.value) return;
    var ziel = document.getElementById(auswahl.getAttribute('data-tenue-ziel'));
    var option = auswahl.options[auswahl.selectedIndex];
    if (!ziel || !option) return;
    ziel.value = option.getAttribute('data-text') || '';
    auswahl.value = '';
    ziel.dispatchEvent(new Event('input', { bubbles: true }));
    ziel.focus();
  });

  // ---------- Reiter «Schichten»: Personen verschieben (Wunsch Yann 20.11.2026) ----------
  // Ziehen einer Karte in eine andere Spalte wählt die Schicht im Menü ⇄ und sendet dessen Formular.
  // Ohne Ziehen (Handy, Tastatur, ohne Skript) geht dasselbe über das Menü ⇄.
  var gezogen = null;
  var spalteVon = function (el) { return el && el.closest ? el.closest('.zieh-spalte[data-ziel-schicht]') : null; };
  document.addEventListener('dragstart', function (ev) {
    var karte = ev.target && ev.target.closest ? ev.target.closest('.zieh-karte[data-zieh]') : null;
    if (!karte) return;
    gezogen = karte;
    karte.classList.add('zieht');
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', karte.getAttribute('data-zieh')); } catch (e) { /* alter Browser */ }
  });
  document.addEventListener('dragend', function () {
    if (gezogen) gezogen.classList.remove('zieht');
    gezogen = null;
    document.querySelectorAll('.zieh-spalte.ziel-aktiv').forEach(function (s) { s.classList.remove('ziel-aktiv'); });
  });
  document.addEventListener('dragover', function (ev) {
    var spalte = spalteVon(ev.target);
    if (!gezogen || !spalte || spalte.contains(gezogen)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.zieh-spalte.ziel-aktiv').forEach(function (s) { if (s !== spalte) s.classList.remove('ziel-aktiv'); });
    spalte.classList.add('ziel-aktiv');
  });
  document.addEventListener('drop', function (ev) {
    var spalte = spalteVon(ev.target);
    if (!gezogen || !spalte || spalte.contains(gezogen)) return;
    ev.preventDefault();
    var form = gezogen.querySelector('form.zieh-form');
    var wahl = form && form.querySelector('select[name="schicht"]');
    spalte.classList.remove('ziel-aktiv');
    if (!form || !wahl) return;
    wahl.value = spalte.getAttribute('data-ziel-schicht');
    if (wahl.value !== spalte.getAttribute('data-ziel-schicht')) return;
    // Sofort in der Zielspalte zeigen. Die Antwort des Servers ersetzt die Ansicht danach.
    var liste = spalte.querySelector('.zieh-liste');
    var leer = liste && liste.querySelector('.zieh-leer');
    if (leer) leer.remove();
    if (liste) liste.appendChild(gezogen);
    if (form.requestSubmit) form.requestSubmit(); else form.submit();
  });

  // ---------- Reihenfolge ziehen: Ränge und Rollen (Wunsch Yann 20.11.2026) ----------
  // Nur der Griff ⠿ startet das Ziehen. So bleiben Eingabefelder in der Zeile bedienbar.
  // Nach dem Loslassen sendet das Skript die ganze neue Reihenfolge. Ohne Ziehen geht es über das Menü ⋮.
  var ordnenZeile = null;
  document.addEventListener('mousedown', function (ev) {
    var griff = ev.target && ev.target.closest ? ev.target.closest('.ordnen-griff') : null;
    var zeile = griff && griff.closest('tr.ordnen-zeile');
    if (zeile) zeile.setAttribute('draggable', 'true');
  });
  document.addEventListener('dragstart', function (ev) {
    var zeile = ev.target && ev.target.closest ? ev.target.closest('tr.ordnen-zeile[draggable="true"]') : null;
    if (!zeile) return;
    ordnenZeile = zeile;
    zeile.classList.add('zieht');
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', zeile.getAttribute('data-ordnen-wert')); } catch (e) { /* alter Browser */ }
  });
  document.addEventListener('dragover', function (ev) {
    if (!ordnenZeile) return;
    var ziel = ev.target && ev.target.closest ? ev.target.closest('tr.ordnen-zeile') : null;
    if (!ziel || ziel.parentNode !== ordnenZeile.parentNode) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    if (ziel === ordnenZeile) return;
    var r = ziel.getBoundingClientRect();
    var davor = ev.clientY < r.top + r.height / 2;
    ziel.parentNode.insertBefore(ordnenZeile, davor ? ziel : ziel.nextSibling);
  });
  document.addEventListener('drop', function (ev) {
    if (ordnenZeile && ev.target && ev.target.closest && ev.target.closest('tbody[data-ordnen]')) ev.preventDefault();
  });
  document.addEventListener('dragend', function () {
    var zeile = ordnenZeile;
    ordnenZeile = null;
    if (!zeile) return;
    zeile.classList.remove('zieht');
    zeile.removeAttribute('draggable');
    var tbody = zeile.parentNode;
    var liste = tbody.getAttribute('data-ordnen');
    var form = document.querySelector('form[data-ordnen-form="' + liste + '"]');
    if (!form) return;
    var werte = Array.prototype.map.call(tbody.querySelectorAll('tr.ordnen-zeile'), function (z) { return z.getAttribute('data-ordnen-wert'); });
    if (werte.join('\n') === tbody.getAttribute('data-ordnen-vorher')) return;
    form.querySelectorAll('input[name="reihenfolge"]').forEach(function (i) { i.remove(); });
    werte.forEach(function (w) {
      var i = document.createElement('input');
      i.type = 'hidden'; i.name = 'reihenfolge'; i.value = w;
      form.appendChild(i);
    });
    if (form.requestSubmit) form.requestSubmit(); else form.submit();
  });
  // Reihenfolge beim Start merken: Ohne Änderung sendet das Ziehen nichts.
  document.addEventListener('dragstart', function () {
    document.querySelectorAll('tbody[data-ordnen]').forEach(function (t) {
      t.setAttribute('data-ordnen-vorher', Array.prototype.map.call(t.querySelectorAll('tr.ordnen-zeile'), function (z) { return z.getAttribute('data-ordnen-wert'); }).join('\n'));
    });
  }, true);

  // ---------- Live: Formulare im Hintergrund senden ----------

  var meldeFehler = function (text) {
    var div = document.createElement('div');
    div.className = 'toast fehler';
    div.setAttribute('role', 'alert');
    div.setAttribute('data-toast', 'fehler');
    var z = document.createElement('span'); z.className = 'toast-zeichen'; z.setAttribute('aria-hidden', 'true'); z.textContent = '!';
    var t = document.createElement('span'); t.className = 'toast-text'; t.textContent = text;
    var k = document.createElement('button'); k.type = 'button'; k.className = 'toast-zu'; k.setAttribute('data-toast-zu', ''); k.setAttribute('aria-label', 'Meldung schliessen'); k.textContent = '×';
    div.appendChild(z); div.appendChild(t); div.appendChild(k);
    var w = document.createElement('div'); w.appendChild(div);
    meldungenAusblenden(w);
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
          if (neu.body && neu.body.hasAttribute('data-ohne-live')) {
            // Zielseite mit eigenem Neuladen (z. B. Admin › Update).
            location.assign(ziel.href);
            return;
          }
          if (!tausche(neu, { schuetzen: true, ausser: form })) {
            ersetzeAlles(neu);
          } else if (neueAdresse) {
            merkeStand();
            history.pushState({ live: true, scroll: 0 }, '', ziel.pathname + ziel.search + ziel.hash);
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

  // ---------- Navigation ohne Neuladen ----------
  // Ein Klick auf einen Link im Tool und ein Filterformular (GET) laden die neue Seite im Hintergrund.
  // Das Skript tauscht Navigation und Inhalt aus und ändert die Adresse (history.pushState).
  // Zurück und Vorwärts im Browser laden ebenfalls ohne Neuladen.
  // Normal geladen werden: neuer Tab, Dateien (CSV, ICS), andere Websites, data-normal,
  // Seiten ohne Navigation (z. B. Anmeldung) und Seiten mit data-ohne-live (Admin › Update).
  var stilVersion = function (doc) {
    var l = doc.querySelector('link[rel="stylesheet"]');
    return l ? l.getAttribute('href') : '';
  };
  var navNr = 0;

  /** Merkt die Scrollposition der aktuellen Seite im Verlauf des Browsers. */
  var merkeStand = function () {
    try { history.replaceState({ live: true, scroll: window.scrollY }, '', location.href); } catch (e) { /* ohne Verlauf */ }
  };

  /**
   * Lädt eine Seite im Hintergrund und zeigt sie an.
   * o.verlauf: 'push' (neuer Eintrag), 'keiner' (Zurück/Vorwärts). o.scroll: Position nach Zurück.
   * o.fokus: [Ziel des Formulars, Feldname] – dieses Feld erhält den Cursor wieder.
   */
  var navigiere = function (adresse, o) {
    o = o || {};
    var nr = ++navNr;
    var vorherPfad = location.pathname;
    if (o.verlauf === 'push') merkeStand();
    body.classList.add('laedt');
    fensterZu();
    if (frage && frage.open) frage.close();
    var fertig = function () { if (nr === navNr) body.classList.remove('laedt'); };
    fetch(adresse, { credentials: 'same-origin', headers: { Accept: 'text/html', 'X-Live-Navigation': '1' } })
      .then(function (r) {
        if (nr !== navNr) return null;
        var art = r.headers.get('content-type') || '';
        if (art.indexOf('text/html') === -1 || r.headers.get('refresh')) {
          // Datei oder Seite mit eigenem Neuladen: normal öffnen.
          fertig();
          location.assign(r.url || adresse);
          return null;
        }
        return r.text().then(function (text) {
          if (nr !== navNr) return;
          var neu = lese(text);
          var ziel = new URL(r.url || adresse, location.href);
          if (ziel.hash === '' && adresse.indexOf('#') >= 0) ziel.hash = adresse.slice(adresse.indexOf('#'));
          var neueSeite = ziel.pathname !== vorherPfad;
          var passt = neu.body && neu.body.hasAttribute('data-live-nr') && !neu.body.hasAttribute('data-ohne-live') &&
            stilVersion(neu) === stilVersion(document);
          if (!passt || !tausche(neu, { neueSeite: neueSeite })) {
            location.assign(ziel.href);
            return;
          }
          if (o.verlauf === 'push') history.pushState({ live: true, scroll: 0 }, '', ziel.pathname + ziel.search + ziel.hash);
          else if (r.redirected) history.replaceState({ live: true, scroll: 0 }, '', ziel.pathname + ziel.search + ziel.hash);
          // Menü auf dem Handy schliessen.
          var leiste = document.getElementById('leiste');
          if (leiste) leiste.classList.remove('offen');
          document.querySelectorAll('.knopf-menue').forEach(function (k) { k.setAttribute('aria-expanded', 'false'); });
          // Cursor im Filterfeld behalten.
          if (o.fokus) {
            var feldNeu = null;
            document.querySelectorAll('main.inhalt form').forEach(function (f) {
              if (!feldNeu && f.getAttribute('action') === o.fokus[0] && f.elements[o.fokus[1]]) feldNeu = f.elements[o.fokus[1]];
            });
            if (feldNeu && feldNeu.focus) { try { feldNeu.focus({ preventScroll: true }); } catch (e) { /* ohne Fokus */ } }
          }
          // Scrollen: Zurück = alte Position, Sprungmarke = dorthin, neue Seite = nach oben.
          var marke = ziel.hash ? document.getElementById(decodeURIComponent(ziel.hash.slice(1))) : null;
          if (typeof o.scroll === 'number') window.scrollTo(0, o.scroll);
          else if (marke) marke.scrollIntoView();
          else if (neueSeite) window.scrollTo(0, 0);
          // Für Bildschirmleser: Der Titel der neuen Seite erhält den Fokus.
          if (neueSeite && !o.fokus) {
            var h = document.querySelector('main.inhalt h1');
            if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { /* ohne Fokus */ } }
          }
        });
      })
      .catch(function () {
        // Server nicht erreichbar oder Weiterleitung auf eine andere Website (Login): normal laden.
        if (nr === navNr) location.assign(adresse);
      })
      .then(function () {
        fertig();
        if (nr === navNr && liveWartet) holeNeuenStand();
      });
  };

  /** Prüft, ob ein Link im Tool ohne Neuladen öffnen darf. */
  var linkImTool = function (a, ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return false;
    if (a.hasAttribute('download') || a.closest('[data-normal]')) return false;
    if (a.target && a.target !== '_self') return false;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return false;
    var url;
    try { url = new URL(a.href, location.href); } catch (e) { return false; }
    if (url.origin !== location.origin) return false;
    if (/\.(csv|ics|sql|png|pdf)$/i.test(url.pathname) || url.pathname.indexOf('/static/') === 0) return false;
    if (/^\/(login|logout|anmeldung)(\/|$)/.test(url.pathname)) return false;
    // Nur die Sprungmarke ändert sich: Das macht der Browser selbst.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return false;
    return true;
  };

  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || !linkImTool(a, ev)) return;
    ev.preventDefault();
    var url = new URL(a.href, location.href);
    navigiere(url.pathname + url.search + url.hash, { verlauf: 'push' });
  });

  // Formulare mit GET (Filter, Suche): im Hintergrund laden.
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (ev.defaultPrevented || !form || (form.getAttribute('method') || 'get').toLowerCase() !== 'get') return;
    if (form.closest('[data-normal]') || (form.target && form.target !== '_self')) return;
    var url;
    try { url = new URL(form.action, location.href); } catch (e) { return; }
    if (url.origin !== location.origin) return;
    ev.preventDefault();
    var daten;
    try {
      daten = new FormData(form, ev.submitter || undefined);
    } catch (e) {
      daten = new FormData(form);
      if (ev.submitter && ev.submitter.name) daten.append(ev.submitter.name, ev.submitter.value);
    }
    var suche = new URLSearchParams();
    daten.forEach(function (w, n) { if (typeof w === 'string') suche.append(n, w); });
    url.search = suche.toString();
    var aktiv = document.activeElement;
    var fokus = aktiv && aktiv.form === form && aktiv.name && aktiv.type !== 'submit' ? [form.getAttribute('action'), aktiv.name] : null;
    form.removeAttribute('data-geaendert');
    navigiere(url.pathname + url.search + url.hash, { verlauf: 'push', fokus: fokus });
  });

  // Zurück und Vorwärts im Browser: Seite im Hintergrund laden, Scrollposition wiederherstellen.
  try { history.scrollRestoration = 'manual'; } catch (e) { /* älterer Browser */ }
  merkeStand();
  window.addEventListener('popstate', function (ev) {
    var scroll = ev.state && typeof ev.state.scroll === 'number' ? ev.state.scroll : 0;
    navigiere(location.pathname + location.search + location.hash, { verlauf: 'keiner', scroll: scroll });
  });

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
    if (holtGerade || sendetFormular || body.classList.contains('laedt') || document.visibilityState === 'hidden') {
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

// Wenig JavaScript für die Bedienung. Ohne Skript funktioniert jede Seite weiter.
(function () {
  'use strict';

  // Menü auf dem Handy
  var knopf = document.querySelector('.knopf-menue');
  var leiste = document.getElementById('leiste');
  if (knopf && leiste) {
    knopf.addEventListener('click', function () {
      var offen = leiste.classList.toggle('offen');
      knopf.setAttribute('aria-expanded', offen ? 'true' : 'false');
    });
  }

  // Meldungen wie «Gespeichert» verschwinden nach einigen Sekunden.
  document.querySelectorAll('.meldung[data-verschwinden="1"]').forEach(function (m) {
    setTimeout(function () {
      m.classList.add('weg');
      setTimeout(function () { m.remove(); }, 600);
    }, 4000);
  });

  // Nach dem Speichern bleibt die Seite an derselben Stelle.
  var schluessel = 'scroll:' + location.pathname + location.search;
  try {
    var gespeichert = sessionStorage.getItem(schluessel);
    if (gespeichert !== null) {
      sessionStorage.removeItem(schluessel);
      window.scrollTo(0, Number(gespeichert) || 0);
    }
  } catch (e) { /* kein Speicher */ }
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (!form || (form.method || '').toLowerCase() !== 'post') return;
    var ziel = form.querySelector('input[name="zurueck"]');
    var pfad = ziel ? ziel.value : location.pathname + location.search;
    try { sessionStorage.setItem('scroll:' + pfad, String(window.scrollY)); } catch (e) { /* kein Speicher */ }
  }, true);

  // Suchfeld filtert beim Tippen.
  document.querySelectorAll('input[data-filter]').forEach(function (feld) {
    var auswahl = feld.getAttribute('data-filter');
    feld.addEventListener('input', function () {
      var q = feld.value.trim().toLowerCase();
      document.querySelectorAll(auswahl).forEach(function (zeile) {
        var text = zeile.getAttribute('data-suche') || zeile.textContent.toLowerCase();
        zeile.hidden = q !== '' && text.indexOf(q) === -1;
      });
    });
  });

  // Kopieren in die Zwischenablage
  document.querySelectorAll('[data-kopieren]').forEach(function (k) {
    k.addEventListener('click', function () {
      var quelle = document.querySelector(k.getAttribute('data-kopieren'));
      if (!quelle) return;
      var text = quelle.value !== undefined ? quelle.value : quelle.textContent;
      var fertig = function () {
        var alt = k.textContent;
        k.textContent = 'Kopiert';
        setTimeout(function () { k.textContent = alt; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(fertig, function () { quelle.select(); });
      } else if (quelle.select) {
        quelle.select();
      }
    });
  });

  // Drucken
  document.querySelectorAll('[data-drucken]').forEach(function (k) {
    k.addEventListener('click', function () { window.print(); });
  });

  // Alle wählen (Anrufliste)
  document.querySelectorAll('[data-alle-waehlen]').forEach(function (k) {
    var name = k.getAttribute('data-alle-waehlen');
    k.addEventListener('change', function () {
      document.querySelectorAll('input[type="checkbox"][name="' + name + '"]').forEach(function (c) {
        var zeile = c.closest('tr');
        if (!zeile || !zeile.hidden) c.checked = k.checked;
      });
    });
  });

  // Offene Detail-Formulare in der Matrix: nur eines gleichzeitig offen.
  document.querySelectorAll('td.zelle details').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      document.querySelectorAll('td.zelle details[open]').forEach(function (andere) {
        if (andere !== d) andere.open = false;
      });
    });
  });
  // Änderungen anderer Benutzer: Die Seite fragt den Datenstand alle 15 Sekunden ab.
  // Ändert er sich, erscheint ein Hinweis mit dem Knopf «Neu laden».
  // Das Tool lädt nicht von selbst neu. So gehen keine Eingaben verloren.
  var hinweis = document.querySelector('.datenstand[data-stand-url]');
  if (hinweis && window.fetch) {
    var url = hinweis.getAttribute('data-stand-url');
    var stand = hinweis.getAttribute('data-stand');
    var fertigGemeldet = false;
    var laufend = false;
    var uhr = null;
    var frage = function () {
      if (fertigGemeldet || laufend || document.visibilityState === 'hidden') return;
      laufend = true;
      fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) {
          if (r.status === 401) { clearInterval(uhr); return null; }
          return r.ok ? r.json() : null;
        })
        .then(function (d) {
          if (d && typeof d.stand === 'string' && d.stand !== stand) {
            fertigGemeldet = true;
            hinweis.hidden = false;
          }
        })
        .catch(function () { /* Netz kurz weg: beim nächsten Mal erneut */ })
        .then(function () { laufend = false; });
    };
    uhr = setInterval(frage, 15000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') frage();
    });
    var neu = hinweis.querySelector('[data-neu-laden]');
    if (neu) neu.addEventListener('click', function () { location.reload(); });
  }
})();

// Darstellung vor dem ersten Zeichnen setzen: «wie System», «Hell» oder «Dunkel».
// Die Wahl gilt in diesem Browser (localStorage). Ohne Skript gilt die Einstellung des Geräts.
(function () {
  'use strict';
  try {
    var t = localStorage.getItem('thema');
    if (t === 'hell') document.documentElement.setAttribute('data-theme', 'light');
    else if (t === 'dunkel') document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) { /* kein Speicher */ }
})();

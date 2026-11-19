// Live-Aktualisierung: Der Server meldet jede gespeicherte Änderung sofort an alle offenen Seiten.
// Technik: Server-Sent Events (GET /live). Kein weiterer Dienst nötig.
// Ersatz, falls ein Proxy die Meldungen zurückhält: Die Seite fragt GET /live/stand ab.
import type { Express, Response } from 'express';
import type { Abhaengigkeiten } from './app.js';
import { aenderungsStand, hoereAenderungen } from '../db/aenderungen.js';
import { k } from './kontext.js';

/** Pfade der Live-Aktualisierung. Sie verlängern die Sitzung nicht. */
export const LIVE_PFAD = '/live';

/** Ein «Puls» alle 20 Sekunden hält die Verbindung durch den Reverse-Proxy offen. */
export const PULS_MS = 20000;

/** Mehrere Änderungen kurz nacheinander gehen als eine Meldung hinaus. */
const BUENDELN_MS = 150;

/** Höchstens so viele Live-Verbindungen gleichzeitig (Schutz vor Überlast). */
const MAX_VERBINDUNGEN = 200;

const offen = new Set<Response>();

/** Schliesst alle Live-Verbindungen, z. B. beim Beenden des Servers. */
export function beendeLive(): void {
  for (const res of offen) res.end();
  offen.clear();
}

export function anzahlLiveVerbindungen(): number {
  return offen.size;
}

export function registriereLive(app: Express, _deps: Abhaengigkeiten): void {
  app.get(LIVE_PFAD, (req, res) => {
    if (!k(res).benutzer) {
      res.status(401).json({ fehler: 'nicht angemeldet' });
      return;
    }
    if (offen.size >= MAX_VERBINDUNGEN) {
      res.status(503).json({ fehler: 'zu viele Verbindungen' });
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Nginx (auch Nginx Proxy Manager) hält die Meldungen sonst im Puffer zurück.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    offen.add(res);

    const sende = (ereignis: string, daten: unknown) => {
      res.write(`event: ${ereignis}\ndata: ${JSON.stringify(daten)}\n\n`);
    };
    // Nach einem Abbruch verbindet sich der Browser nach 3 Sekunden neu.
    res.write('retry: 3000\n\n');
    sende('stand', { nr: aenderungsStand() });

    let zeitgeber: NodeJS.Timeout | null = null;
    const abmelden = hoereAenderungen(() => {
      if (zeitgeber) return;
      zeitgeber = setTimeout(() => {
        zeitgeber = null;
        sende('aenderung', { nr: aenderungsStand() });
      }, BUENDELN_MS);
    });
    const puls = setInterval(() => sende('puls', { nr: aenderungsStand() }), PULS_MS);

    res.on('close', () => {
      abmelden();
      clearInterval(puls);
      if (zeitgeber) clearTimeout(zeitgeber);
      offen.delete(res);
    });
  });

  // Ersatz für Server-Sent Events: aktueller Stand als JSON.
  app.get(`${LIVE_PFAD}/stand`, (_req, res) => {
    if (!k(res).benutzer) {
      res.status(401).json({ fehler: 'nicht angemeldet' });
      return;
    }
    res.json({ nr: aenderungsStand() });
  });
}

// Express-App: Sicherheit, Sitzung, CSRF, Meldungen, Routen.
import express, { type NextFunction, type Request, type Response } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/db.js';
import { alle, schreibe } from '../db/db.js';
import type { Konfiguration } from '../config.js';
import { Eingabefehler, NichtGefunden } from '../domain/eingabe.js';
import type { Benutzer } from '../domain/stammdaten.js';
import { zaehlerSeitenleiste } from '../domain/listen.js';
import { isoUtc } from '../domain/zeit.js';
import { gueltigerSchluessel } from '../domain/rueckgaengig.js';
import { log } from '../log.js';
import { herkunft } from '../config.js';
import { html } from './html.js';
import { einfacheSeite } from './views/layout.js';
import { multipart } from './multipart.js';
import { k, sicheresZiel, type Kontext, type Meldung } from './kontext.js';
import { registriereOeffentlich } from './routes-oeffentlich.js';
import { registriereLogin } from './routes-login.js';
import { registriereStart } from './routes-start.js';
import { registriereEinsaetze } from './routes-einsaetze.js';
import { registriereSchichten } from './routes-schichten.js';
import { registriereAnmeldungen } from './routes-anmeldungen.js';
import { registriereFormular } from './routes-formular.js';
import { registrierePersonen } from './routes-personen.js';
import { registriereAdmin } from './routes-admin.js';
import { registriereLive, LIVE_PFAD } from './routes-live.js';
import type { Updater } from '../jobs/update.js';
import { registriereKonfiguration } from './routes-konfiguration.js';
import type { Quelle } from '../domain/konfiguration.js';

const ordner = dirname(fileURLToPath(import.meta.url));

export interface Abhaengigkeiten {
  db: Db;
  konfig: Konfiguration;
  /** Tagesexport jetzt auslösen. */
  tagesexportJetzt: () => Promise<{ ok: boolean; meldung: string }>;
  /** Bestätigungen jetzt senden. */
  bestaetigungenJetzt: () => Promise<{ ok: boolean; meldung: string }>;
  updater: Updater | null;
  /** Datei und Startwerte für Admin › Konfiguration. Ohne Angabe: ENV_FILE und process.env. */
  konfigQuelle?: Quelle;
  /** Beendet den Server mit Exit-Code 75. Das Startskript startet ihn neu. */
  neustart?: () => void;
}

export const SITZUNG_DAUER_MS = 8 * 60 * 60 * 1000;

export function signiere(secret: string, zweck: string, wert: string): string {
  return createHmac('sha256', secret).update(`${zweck}:${wert}`).digest('base64url');
}

export function gleich(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function leseCookies(req: Request): Record<string, string> {
  const ergebnis: Record<string, string> = {};
  for (const teil of (req.headers.cookie ?? '').split(';')) {
    const i = teil.indexOf('=');
    if (i < 1) continue;
    try {
      ergebnis[teil.slice(0, i).trim()] = decodeURIComponent(teil.slice(i + 1).trim());
    } catch {
      // ungültiges Cookie ignorieren
    }
  }
  return ergebnis;
}

export function setzeCookie(res: Response, konfig: Konfiguration, name: string, wert: string, maxAlterSek: number | null): void {
  res.cookie(name, wert, {
    httpOnly: true,
    sameSite: 'lax',
    // Entscheid Yann: «Secure» nur, wenn BASE_URL mit https:// beginnt.
    secure: konfig.cookieSecure,
    path: '/',
    ...(maxAlterSek === null ? {} : { maxAge: maxAlterSek * 1000 }),
  });
}

/** Meldung für die nächste Seite (z. B. «Gespeichert»). Signiertes Cookie, eine Minute gültig. */
export function setzeMeldung(
  res: Response,
  konfig: Konfiguration,
  art: Meldung['art'],
  text: string,
  rueckgaengig?: string | null,
  wiederholen?: string | null,
): void {
  const m: Meldung = { art, text: text.slice(0, 500) };
  if (rueckgaengig) m.rueckgaengig = rueckgaengig;
  if (wiederholen) m.wiederholen = wiederholen;
  const wert = Buffer.from(JSON.stringify(m)).toString('base64url');
  setzeCookie(res, konfig, 'meldung', `${wert}.${signiere(konfig.sessionSecret, 'meldung', wert)}`, 60);
}

function leseMeldung(req: Request, res: Response, konfig: Konfiguration): Meldung | null {
  const roh = leseCookies(req).meldung;
  if (!roh) return null;
  res.clearCookie('meldung', { path: '/' });
  const [wert, sig] = roh.split('.');
  if (!wert || !sig || !gleich(sig, signiere(konfig.sessionSecret, 'meldung', wert))) return null;
  try {
    const m = JSON.parse(Buffer.from(wert, 'base64url').toString('utf8'));
    if (['ok', 'fehler', 'hinweis'].includes(m.art) && typeof m.text === 'string') {
      const meldung: Meldung = { art: m.art, text: m.text };
      const r = gueltigerSchluessel(m.rueckgaengig);
      const w = gueltigerSchluessel(m.wiederholen);
      if (r) meldung.rueckgaengig = r;
      if (w) meldung.wiederholen = w;
      return meldung;
    }
  } catch {
    // ignorieren
  }
  return null;
}

export async function neueSitzung(db: Db, benutzerId: number): Promise<string> {
  const id = randomBytes(32).toString('hex');
  await schreibe(db, 'INSERT INTO sitzung (id, benutzer_id, ablauf) VALUES (?, ?, ?)', [
    id, benutzerId, isoUtc(new Date(Date.now() + SITZUNG_DAUER_MS)),
  ]);
  return id;
}

export function csrfToken(secret: string, sitzungId: string): string {
  return signiere(secret, 'csrf', sitzungId);
}

/** Leitet nach dem Speichern zurück an dieselbe Stelle, mit Meldung. */
export function zurueck(
  req: Request,
  res: Response,
  standard: string,
  text = 'Gespeichert.',
  art: Meldung['art'] = 'ok',
  rueckgaengig: string | null = null,
  wiederholen: string | null = null,
): void {
  const deps = res.locals.deps as Abhaengigkeiten;
  if (text) setzeMeldung(res, deps.konfig, art, text, rueckgaengig, wiederholen);
  res.redirect(303, sicheresZiel(req.body?.zurueck, standard));
}

/** Pfad der vorherigen Seite, nur innerhalb dieser Seite. */
export function refererPfad(req: Request): string {
  const r = req.get('referer');
  if (!r) return '/';
  try {
    const u = new URL(r);
    return sicheresZiel(u.pathname + u.search, '/');
  } catch {
    return '/';
  }
}

export function nurAufgebot(req: Request, res: Response, next: NextFunction): void {
  const kx = k(res);
  if (!kx.benutzer) {
    if (req.method === 'GET') {
      res.redirect(302, `/login?ziel=${encodeURIComponent(req.originalUrl)}`);
    } else {
      res.status(401).send(einfacheSeite('Nicht angemeldet', html`<h1>Nicht angemeldet</h1><p><a href="/login">Anmelden</a></p>`));
    }
    return;
  }
  next();
}

export function nurAdmin(req: Request, res: Response, next: NextFunction): void {
  nurAufgebot(req, res, () => {
    if (k(res).benutzer!.rolle !== 'admin') {
      res.status(403).send(einfacheSeite('Kein Zugriff', html`<h1>Kein Zugriff</h1><p>Diese Seite ist nur für Admins.</p><p><a href="/">Zur Startseite</a></p>`));
      return;
    }
    next();
  });
}

export function erstelleApp(deps: Abhaengigkeiten): express.Express {
  const { db, konfig } = deps;
  if (!konfig.sessionSecret || konfig.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen.');
  }
  const app = express();
  app.disable('x-powered-by');
  // Entscheid Yann: X-Forwarded-For nur von Adressen im lokalen oder privaten Netz.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.set('query parser', 'extended');

  // Sicherheits-Header (15.1, 22.2.4). Keine Inline-Skripte, keine Inline-Styles.
  app.use((req, res, next) => {
    const formular = req.path === '/anmeldung' || req.path === '/anmeldung/danke';
    const rahmen = formular && konfig.formAllowedOrigin ? konfig.formAllowedOrigin : "'none'";
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors ${rahmen}`,
    );
    if (!formular) res.setHeader('X-Frame-Options', 'DENY');
    // Hilfe bei der Fehlersuche: Ein iframe von einer nicht erlaubten Website sperrt der Browser. Das Log nennt die Website.
    if (formular && req.method === 'GET' && req.get('sec-fetch-dest') === 'iframe') {
      const quelle = herkunft(req.get('referer'));
      const erlaubt = konfig.formAllowedOrigin.split(' ');
      if (quelle && !erlaubt.includes(quelle)) {
        log('warn', `Formular im iframe von ${quelle}. Diese Website ist nicht erlaubt (FORM_ALLOWED_ORIGIN). Der Browser sperrt die Anzeige.`);
      }
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/static', express.static(join(ordner, 'public'), { maxAge: '1h', index: false }));
  app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 5000 }));
  // CSV-Upload (22.2.7: höchstens 5 MB).
  app.use(multipart);

  // Sitzung laden (22.1.7). Die Sitzung läuft nach 8 Stunden Inaktivität ab.
  app.use(async (req, res, next) => {
    res.locals.deps = deps;
    const kx: Kontext = { benutzer: null, sitzungId: null, csrf: '', zaehler: { unbestaetigt: 0, unbekannt: 0 }, meldung: null, pfad: req.originalUrl };
    res.locals.k = kx;
    const sid = leseCookies(req).sid;
    // Live-Aktualisierung: Diese Abfragen kommen automatisch und zählen nicht als Aktivität.
    // Sonst läuft die Sitzung in einem offenen Tab nie ab.
    const abfrageStand = req.path === LIVE_PFAD || req.path.startsWith(`${LIVE_PFAD}/`);
    // Eine Seite holt sich im Hintergrund den neuen Stand. Sie darf keine Meldung («Gespeichert») abholen.
    const hintergrund = req.get('x-live-abfrage') === '1';
    if (sid && /^[a-f0-9]{64}$/.test(sid)) {
      const jetzt = isoUtc(new Date());
      const z = await alle<Benutzer & { ablauf: string }>(
        db,
        'SELECT b.*, s.ablauf FROM sitzung s JOIN benutzer b ON b.id = s.benutzer_id WHERE s.id = ? AND s.ablauf > ? AND b.aktiv = 1',
        [sid, jetzt],
      );
      if (z.length) {
        kx.benutzer = z[0];
        kx.sitzungId = sid;
        kx.csrf = csrfToken(konfig.sessionSecret, sid);
        if (!abfrageStand && !hintergrund) {
          await schreibe(db, 'UPDATE sitzung SET ablauf = ? WHERE id = ?', [isoUtc(new Date(Date.now() + SITZUNG_DAUER_MS)), sid]);
        }
      }
    }
    if (req.method === 'GET' && !abfrageStand) {
      if (!hintergrund) kx.meldung = leseMeldung(req, res, konfig);
      if (kx.benutzer && !req.path.startsWith('/static')) kx.zaehler = await zaehlerSeitenleiste(db);
    }
    next();
  });

  // CSRF-Prüfung (22.2.3): Jede POST-Route mit Sitzung prüft ein Token, das an die Sitzung gebunden ist.
  // Das öffentliche Formular nutzt ein eigenes signiertes Token (15.1.3).
  app.use((req, res, next) => {
    if (req.method !== 'POST' || req.path === '/anmeldung' || (konfig.devLogin && req.path === '/login/dev')) return next();
    const kx = k(res);
    const token = typeof req.body?._csrf === 'string' ? req.body._csrf : String(req.headers['x-csrf-token'] ?? '');
    if (!kx.sitzungId || !token || !gleich(token, kx.csrf)) {
      res.status(403).send(einfacheSeite('Ungültige Anfrage', html`<h1>Ungültige Anfrage</h1><p>Das Sicherheits-Token fehlt oder ist abgelaufen. Lade die Seite neu.</p><p><a href="/">Zur Startseite</a></p>`));
      return;
    }
    next();
  });

  registriereOeffentlich(app, deps);
  registriereLogin(app, deps);
  registriereStart(app, deps);
  registriereEinsaetze(app, deps);
  registriereSchichten(app, deps);
  registriereAnmeldungen(app, deps);
  registriereFormular(app, deps);
  registrierePersonen(app, deps);
  registriereAdmin(app, deps);
  registriereKonfiguration(app, deps);
  registriereLive(app, deps);

  app.use((req, res) => {
    res.status(404).send(einfacheSeite('Nicht gefunden', html`<h1>Nicht gefunden</h1><p><a href="/">Zur Startseite</a></p>`));
  });

  app.use((fehler: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (fehler instanceof NichtGefunden) {
      res.status(404).send(einfacheSeite('Nicht gefunden', html`<h1>${fehler.message}</h1><p><a href="/">Zur Startseite</a></p>`));
      return;
    }
    if (fehler instanceof Eingabefehler) {
      if (req.method === 'POST' && k(res).benutzer) {
        setzeMeldung(res, konfig, 'fehler', fehler.message);
        res.redirect(303, sicheresZiel(req.body?.zurueck, refererPfad(req)));
        return;
      }
      res.status(400).send(einfacheSeite('Fehler', html`<h1>Fehler</h1><p>${fehler.message}</p>`));
      return;
    }
    const e = fehler as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.too.large') {
      res.status(413).send(einfacheSeite('Zu gross', html`<h1>Die Datei ist zu gross</h1><p>Höchstens 5 MB.</p>`));
      return;
    }
    log('error', `${req.method} ${req.path}: ${(fehler as Error)?.stack ?? fehler}`);
    res.status(500).send(einfacheSeite('Fehler', html`<h1>Ein Fehler ist aufgetreten</h1><p>Das Log enthält die Einzelheiten.</p><p><a href="/">Zur Startseite</a></p>`));
  });
  return app;
}

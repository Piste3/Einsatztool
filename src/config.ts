// Liest die Konfiguration aus Umgebungsvariablen und aus der Datei ENV_FILE.
// Umgebungsvariablen haben Vorrang vor der Datei.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Konfiguration {
  port: number;
  listenHost: string;
  baseUrl: string;
  sessionSecret: string;
  db: { host: string; port: number; name: string; user: string; password: string };
  dataDir: string;
  exportDir: string;
  entra: { tenantId: string; clientId: string; clientSecret: string };
  smtp: { host: string; port: number; user: string; pass: string };
  mailFrom: string;
  /** Adresse der Informatik für «Änderung melden». */
  mailInformatik: string;
  bestaetigungStunde: number;
  exportStunde: number;
  clubdeskIcalUrl: string;
  formAllowedOrigin: string;
  sharepoint: { siteId: string; driveId: string; ordner: string };
  updateErlaubt: boolean;
  updateBranch: string;
  devLogin: boolean;
  cookieSecure: boolean;
}

/** Liest eine Datei im Format SCHLUESSEL=WERT. Kommentare beginnen mit #. */
export function leseEnvDatei(text: string): Record<string, string> {
  const werte: Record<string, string> = {};
  for (const roh of text.split(/\r?\n/)) {
    const zeile = roh.trim();
    if (!zeile || zeile.startsWith('#')) continue;
    const gleich = zeile.indexOf('=');
    if (gleich < 1) continue;
    const schluessel = zeile.slice(0, gleich).trim();
    let wert = zeile.slice(gleich + 1).trim();
    if ((wert.startsWith('"') && wert.endsWith('"')) || (wert.startsWith("'") && wert.endsWith("'"))) {
      wert = wert.slice(1, -1);
    }
    werte[schluessel] = wert;
  }
  return werte;
}

/** Pfad der Konfigurationsdatei (ENV_FILE, Standard: .env im aktuellen Ordner). */
export function envDateiPfad(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.ENV_FILE || '.env');
}

/** Schlüssel, die vor dem Laden der Datei schon als Umgebungsvariable gesetzt waren. Sie haben Vorrang. */
export const ausUmgebung = new Set<string>();

/** Lädt die Datei ENV_FILE (Standard: .env im aktuellen Ordner) in process.env. Bestehende Variablen bleiben. */
export function ladeEnvDatei(): void {
  for (const k of Object.keys(process.env)) ausUmgebung.add(k);
  const pfad = envDateiPfad();
  if (!existsSync(pfad)) return;
  const werte = leseEnvDatei(readFileSync(pfad, 'utf8'));
  for (const [k, v] of Object.entries(werte)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function zahl(wert: string | undefined, standard: number): number {
  const n = Number(wert);
  return wert !== undefined && wert !== '' && Number.isFinite(n) ? n : standard;
}

/** Erstellt die Konfiguration aus den Umgebungsvariablen. */
export function leseKonfiguration(env: NodeJS.ProcessEnv = process.env): Konfiguration {
  const baseUrl = (env.BASE_URL || 'http://localhost:3010').replace(/\/+$/, '');
  const entraTenant = env.ENTRA_TENANT_ID || '';
  // Test-Login nur ohne Entra und nur im Entwicklungsmodus (Entscheid Yann).
  const devLogin = env.DEV_LOGIN === '1' && !entraTenant && env.NODE_ENV === 'development';
  const updateBranch = env.UPDATE_BRANCH || 'main';
  if (!/^[A-Za-z0-9._\/-]+$/.test(updateBranch) || updateBranch.includes('..') || updateBranch.startsWith('-')) {
    throw new Error('UPDATE_BRANCH enthält unerlaubte Zeichen.');
  }
  return {
    port: zahl(env.PORT, 3010),
    // Im Test-Login lauscht der Server nur auf 127.0.0.1.
    listenHost: devLogin ? '127.0.0.1' : env.LISTEN_HOST || '127.0.0.1',
    baseUrl,
    sessionSecret: env.SESSION_SECRET || '',
    db: {
      host: env.DB_HOST || '127.0.0.1',
      port: zahl(env.DB_PORT, 3306),
      name: env.DB_NAME || 'einsatzplaner',
      user: env.DB_USER || 'einsatzplaner',
      password: env.DB_PASSWORD || '',
    },
    dataDir: resolve(env.DATA_DIR || 'data'),
    exportDir: resolve(env.EXPORT_DIR || 'export'),
    entra: {
      tenantId: entraTenant,
      clientId: env.ENTRA_CLIENT_ID || '',
      clientSecret: env.ENTRA_CLIENT_SECRET || '',
    },
    smtp: {
      host: env.SMTP_HOST || '',
      port: zahl(env.SMTP_PORT, 587),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
    },
    mailFrom: env.MAIL_FROM || 'aufgebot@kkb.ch',
    // MAIL_ROMAN ist der alte Name. Bestehende Dateien gelten weiter.
    mailInformatik: env.MAIL_INFORMATIK || env.MAIL_ROMAN || '',
    bestaetigungStunde: zahl(env.BESTAETIGUNG_STUNDE, 18),
    exportStunde: zahl(env.EXPORT_HOUR, 2),
    clubdeskIcalUrl: env.CLUBDESK_ICAL_URL || '',
    formAllowedOrigin: herkunft(env.FORM_ALLOWED_ORIGIN),
    sharepoint: {
      siteId: env.SHAREPOINT_SITE_ID || '',
      driveId: env.SHAREPOINT_DRIVE_ID || '',
      ordner: (env.SHAREPOINT_ORDNER || 'Einsatzplaner').replace(/^\/+|\/+$/g, ''),
    },
    updateErlaubt: env.UPDATE_ERLAUBT === '1',
    updateBranch,
    devLogin,
    // Cookie «Secure» nur bei HTTPS (Entscheid Yann).
    cookieSecure: baseUrl.startsWith('https://'),
  };
}

/**
 * Herkünfte für CSP `frame-ancestors`: nur Schema, Host und Port (z. B. https://web.kkb.ch).
 * Mehrere Werte mit Leerzeichen oder Komma trennen. Ein Pfad wie /termine/einsaetze würde in manchen Browsern
 * die Einbettung sperren. Ungültige Werte entfallen. Leer = nicht einbettbar.
 */
export function herkunft(wert: string | undefined): string {
  const liste: string[] = [];
  for (const teil of (wert ?? '').split(/[\s,]+/)) {
    if (!teil) continue;
    try {
      const u = new URL(teil);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !liste.includes(u.origin)) liste.push(u.origin);
    } catch {
      // ungültig: entfällt
    }
  }
  return liste.join(' ');
}

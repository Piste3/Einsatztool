// Sendet Einträge aus mail_queue über SMTP. Prüft die Tabelle alle 10 Sekunden (18.1).
import nodemailer from 'nodemailer';
import type { Db } from '../db/db.js';
import { faelligeMails, markiereFehler, markiereGesendet } from '../domain/bestaetigung.js';
import { ABSENDER_NAME } from '../domain/mail-vorlagen.js';
import type { Konfiguration } from '../config.js';
import { log } from '../log.js';

export interface Versender {
  sende(m: { from: string; to: string; replyTo?: string; subject: string; text: string }): Promise<unknown>;
}

/** Ein Durchgang: sendet fällige Mails. */
export async function sendeFaellige(db: Db, versender: Versender, mailFrom: string): Promise<number> {
  let n = 0;
  for (const m of await faelligeMails(db)) {
    try {
      await versender.sende({
        from: `"${ABSENDER_NAME}" <${mailFrom}>`,
        to: m.an,
        replyTo: m.reply_to ?? mailFrom,
        subject: m.betreff,
        text: m.text,
      });
      await markiereGesendet(db, m.id);
      n++;
    } catch (e) {
      await markiereFehler(db, m.id, (e as Error).message);
      log('warn', `Mail ${m.id} nicht gesendet: ${(e as Error).message}`);
    }
  }
  return n;
}

export function starteMailWorker(db: Db, k: Konfiguration): () => void {
  if (!k.smtp.host) {
    log('warn', 'SMTP ist nicht eingerichtet. Mails bleiben in der Warteschlange.');
    return () => undefined;
  }
  const transport = nodemailer.createTransport({
    host: k.smtp.host,
    port: k.smtp.port,
    secure: k.smtp.port === 465,
    requireTLS: k.smtp.port === 587,
    auth: k.smtp.user ? { user: k.smtp.user, pass: k.smtp.pass } : undefined,
  });
  const versender: Versender = { sende: (m) => transport.sendMail(m) };
  let laeuft = false;
  const t = setInterval(async () => {
    if (laeuft) return;
    laeuft = true;
    try {
      await sendeFaellige(db, versender, k.mailFrom);
    } catch (e) {
      log('error', `Mail-Worker: ${(e as Error).message}`);
    } finally {
      laeuft = false;
    }
  }, 10000);
  return () => clearInterval(t);
}

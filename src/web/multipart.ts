// Kleiner Leser für multipart/form-data (nur für den CSV-Upload). Keine zusätzliche Abhängigkeit.
import type { NextFunction, Request, Response } from 'express';
import express from 'express';

export interface HochgeladeneDatei {
  feld: string;
  dateiname: string;
  inhalt: Buffer;
}

export function leseMultipart(body: Buffer, contentType: string): { felder: Record<string, string>; dateien: HochgeladeneDatei[] } {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new Error('multipart ohne boundary');
  const grenze = Buffer.from(`--${m[1] ?? m[2]}`);
  const felder: Record<string, string> = {};
  const dateien: HochgeladeneDatei[] = [];
  let pos = body.indexOf(grenze);
  while (pos !== -1) {
    const start = pos + grenze.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const naechste = body.indexOf(grenze, start);
    if (naechste === -1) break;
    // Teil ohne führendes CRLF und ohne abschliessendes CRLF.
    const teil = body.subarray(start + 2, naechste - 2);
    const trenner = teil.indexOf('\r\n\r\n');
    if (trenner !== -1) {
      const kopf = teil.subarray(0, trenner).toString('utf8');
      const inhalt = teil.subarray(trenner + 4);
      const name = /name="([^"]*)"/i.exec(kopf)?.[1];
      const datei = /filename="([^"]*)"/i.exec(kopf)?.[1];
      if (name !== undefined) {
        if (datei !== undefined) dateien.push({ feld: name, dateiname: datei.replace(/^.*[\\/]/, ''), inhalt: Buffer.from(inhalt) });
        else felder[name] = inhalt.toString('utf8');
      }
    }
    pos = naechste;
  }
  return { felder, dateien };
}

const roh = express.raw({ type: 'multipart/form-data', limit: '5500kb' });

/** Liest multipart-Anfragen. Felder kommen nach req.body, Dateien nach req.dateien. */
export function multipart(req: Request, res: Response, next: NextFunction): void {
  if (!req.is('multipart/form-data')) return next();
  roh(req, res, (fehler?: unknown) => {
    if (fehler) return next(fehler);
    try {
      const { felder, dateien } = leseMultipart(req.body as Buffer, req.get('content-type') ?? '');
      req.body = felder;
      (req as Request & { dateien?: HochgeladeneDatei[] }).dateien = dateien;
      next();
    } catch (e) {
      next(e);
    }
  });
}

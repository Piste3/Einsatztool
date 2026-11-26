// Zeit-Hilfen. Die Datenbank speichert UTC (ISO 8601). Die Oberfläche zeigt Europe/Zurich (11.1).
export const ZEITZONE = 'Europe/Zurich';

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const WOCHENTAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** UTC-Zeit im Speicherformat, z. B. 2026-11-18T07:00:00Z. */
export function isoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function jetztIso(): string {
  return isoUtc(new Date());
}

const teileFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZEITZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface LokaleTeile {
  jahr: number;
  monat: number;
  tag: number;
  stunde: number;
  minute: number;
  sekunde: number;
}

export function lokaleTeile(d: Date): LokaleTeile {
  const t: Record<string, number> = {};
  for (const p of teileFormat.formatToParts(d)) {
    if (p.type !== 'literal') t[p.type] = Number(p.value);
  }
  return { jahr: t.year, monat: t.month, tag: t.day, stunde: t.hour === 24 ? 0 : t.hour, minute: t.minute, sekunde: t.second };
}

/** Versatz der Zeitzone in Millisekunden zu einem Zeitpunkt. */
function versatz(ms: number): number {
  const t = lokaleTeile(new Date(ms));
  const alsUtc = Date.UTC(t.jahr, t.monat - 1, t.tag, t.stunde, t.minute, t.sekunde);
  return alsUtc - Math.floor(ms / 1000) * 1000;
}

/** Wandelt lokales Datum (JJJJ-MM-TT) und Zeit (HH:MM) in UTC (ISO). */
export function lokalZuUtc(datum: string, zeit: string): string {
  const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  const mz = /^(\d{2}):(\d{2})$/.exec(zeit);
  if (!md || !mz) throw new Error('Ungültiges Datum oder ungültige Zeit.');
  const naiv = Date.UTC(Number(md[1]), Number(md[2]) - 1, Number(md[3]), Number(mz[1]), Number(mz[2]));
  let ms = naiv - versatz(naiv);
  ms = naiv - versatz(ms);
  return isoUtc(new Date(ms));
}

function zwei(n: number): string {
  return String(n).padStart(2, '0');
}

/** Lokales Datum JJJJ-MM-TT. */
export function lokalesDatum(iso: string | Date): string {
  const t = lokaleTeile(typeof iso === 'string' ? new Date(iso) : iso);
  return `${t.jahr}-${zwei(t.monat)}-${zwei(t.tag)}`;
}

/** Lokale Zeit HH:MM. */
export function lokaleZeit(iso: string | Date): string {
  const t = lokaleTeile(typeof iso === 'string' ? new Date(iso) : iso);
  return `${zwei(t.stunde)}:${zwei(t.minute)}`;
}

/** Lokale Stunde (0–23). */
export function lokaleStunde(d: Date = new Date()): number {
  return lokaleTeile(d).stunde;
}

/** TT.MM.JJJJ aus einem Datum JJJJ-MM-TT. */
export function datumCh(datum: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(datum);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

const MONATE_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Langes Datum der lokalen Zeit, z. B. «14. November 2026». */
export function datumLangVonIso(iso: string): string {
  const [j, m, t] = lokalesDatum(iso).split('-').map(Number);
  return `${t}. ${MONATE_LANG[m - 1]} ${j}`;
}

/** TT.MM.JJJJ der lokalen Zeit. */
export function datumChVonIso(iso: string): string {
  return datumCh(lokalesDatum(iso));
}

function wochentagIndex(datum: string): number {
  const [j, m, t] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t)).getUTCDay();
}

export function wochentag(iso: string): string {
  return WOCHENTAGE[wochentagIndex(lokalesDatum(iso))];
}

export function wochentagKurz(iso: string): string {
  return WOCHENTAGE_KURZ[wochentagIndex(lokalesDatum(iso))];
}

/** Addiert Tage zu einem Datum JJJJ-MM-TT. */
export function plusTage(datum: string, tage: number): string {
  const [j, m, t] = datum.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1, t + tage));
  return `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`;
}

/** Differenz in Tagen zwischen zwei Daten JJJJ-MM-TT (b − a). */
export function tageZwischen(a: string, b: string): number {
  const [ja, ma, ta] = a.split('-').map(Number);
  const [jb, mb, tb] = b.split('-').map(Number);
  return Math.round((Date.UTC(jb, mb - 1, tb) - Date.UTC(ja, ma - 1, ta)) / 86400000);
}

/**
 * Alter in vollen Jahren zwischen Geburtsdatum und Stichtag (beide JJJJ-MM-TT) (13.8).
 */
export function alterAm(geburtsdatum: string, stichtag: string): number {
  const [gj, gm, gt] = geburtsdatum.split('-').map(Number);
  const [sj, sm, st] = stichtag.split('-').map(Number);
  let alter = sj - gj;
  if (sm < gm || (sm === gm && st < gt)) alter -= 1;
  return alter;
}

/** Prüft ein Datum JJJJ-MM-TT. */
export function istDatum(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function istZeit(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Text für einen Zeitraum, z. B. «Sa 18.11.2026, 08:00–17:00». */
export function zeitraumText(start: string, ende: string): string {
  const sd = lokalesDatum(start);
  const ed = lokalesDatum(ende);
  const anfang = `${wochentagKurz(start)} ${datumCh(sd)}, ${lokaleZeit(start)}`;
  if (sd === ed) return `${anfang}–${lokaleZeit(ende)}`;
  return `${anfang} – ${wochentagKurz(ende)} ${datumCh(ed)}, ${lokaleZeit(ende)}`;
}

// Holt den iCal-Feed von Clubdesk beim Start und danach alle 15 Minuten (17.4.1).
import ical from 'node-ical';
import { isoUtc, jetztIso } from '../domain/zeit.js';
import { setzeFeed, setzeFeedFehler, type FeedTermin } from '../domain/ical-abgleich.js';
import { log } from '../log.js';

/** Liest Titel, Start und Ende aller Termine aus einem iCal-Text. */
export function leseFeed(text: string): FeedTermin[] {
  const daten = ical.sync.parseICS(text);
  const termine: FeedTermin[] = [];
  for (const k of Object.values(daten)) {
    if (!k || (k as { type?: string }).type !== 'VEVENT') continue;
    const e = k as unknown as { summary?: unknown; start?: Date; end?: Date };
    const titel = typeof e.summary === 'string' ? e.summary : (e.summary as { val?: string } | undefined)?.val ?? '';
    if (!(e.start instanceof Date) || Number.isNaN(e.start.getTime())) continue;
    const ende = e.end instanceof Date && !Number.isNaN(e.end.getTime()) ? e.end : e.start;
    termine.push({ titel, start: isoUtc(e.start), ende: isoUtc(ende) });
  }
  return termine;
}

export async function holeFeed(url: string, f: typeof fetch = fetch): Promise<void> {
  try {
    const r = await f(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setzeFeed(leseFeed(await r.text()), jetztIso());
  } catch (e) {
    // Regel 17.4.2: Der alte Stand bleibt.
    setzeFeedFehler((e as Error).message, jetztIso());
    log('warn', `iCal-Feed nicht geladen: ${(e as Error).message}`);
  }
}

export function starteIcalCache(url: string): () => void {
  if (!url) return () => undefined;
  void holeFeed(url);
  const t = setInterval(() => void holeFeed(url), 15 * 60 * 1000);
  return () => clearInterval(t);
}

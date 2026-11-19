// Update über Admin › Update (Entscheid Yann, nicht im Konzept).
// Ablauf: prüfen (git fetch, neue Commits, keine lokalen Änderungen), Datenbank sichern,
// git merge --ff-only, npm ci, npm run build, Neustart mit Exit-Code 75.
// Befehle und Argumente sind fest im Code. Git fragt nie interaktiv.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.js';

export const NEUSTART_CODE = 75;
const BEHALTEN = 5;

/**
 * Argumente für npm ci. start.cmd setzt NODE_ENV=production. Dann lässt npm ci die
 * devDependencies weg, also auch TypeScript (tsc). Zum Bauen braucht das Tool sie aber.
 * Darum installiert «--include=dev» sie immer.
 */
export const NPM_CI_ARGS = ['ci', '--include=dev', '--no-audit', '--no-fund'];

export interface Schritt {
  text: string;
  ok: boolean | null;
  ausgabe: string;
}

export interface UpdateZustand {
  laeuft: boolean;
  phase: 'bereit' | 'geprueft' | 'laeuft' | 'fertig' | 'fehler';
  schritte: Schritt[];
  neueCommits: string[];
  aktuellerCommit: string | null;
  zeit: string | null;
}

export type Ausfuehren = (befehl: string, args: string[], cwd: string) => Promise<{ code: number; ausgabe: string }>;

/** Führt einen festen Befehl ohne Shell aus. Auf Windows läuft npm über cmd.exe mit festen Argumenten. */
export const fuehreAus: Ausfuehren = (befehl, args, cwd) =>
  new Promise((aufloesen) => {
    let datei = befehl;
    let argumente = args;
    if (process.platform === 'win32' && befehl === 'npm') {
      datei = process.env.ComSpec || 'cmd.exe';
      argumente = ['/d', '/s', '/c', 'npm', ...args];
    }
    execFile(
      datei,
      argumente,
      {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
        maxBuffer: 20 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
        windowsHide: true,
      },
      (fehler, stdout, stderr) => {
        const ausgabe = `${stdout ?? ''}${stderr ?? ''}`.trim();
        const code = fehler ? (typeof (fehler as { code?: unknown }).code === 'number' ? ((fehler as { code: number }).code) : 1) : 0;
        aufloesen({ code, ausgabe: fehler && !ausgabe ? fehler.message : ausgabe });
      },
    );
  });

export interface UpdaterOptionen {
  appDir: string;
  dataDir: string;
  exportDir: string;
  branch: string;
  sichern: (datei: string) => Promise<void>;
  neustart: () => void;
  ausfuehren?: Ausfuehren;
}

export class Updater {
  zustand: UpdateZustand = { laeuft: false, phase: 'bereit', schritte: [], neueCommits: [], aktuellerCommit: null, zeit: null };
  private run: Ausfuehren;

  constructor(private o: UpdaterOptionen) {
    if (!/^[A-Za-z0-9._\/-]+$/.test(o.branch) || o.branch.includes('..') || o.branch.startsWith('-')) {
      throw new Error('UPDATE_BRANCH enthält unerlaubte Zeichen.');
    }
    this.run = o.ausfuehren ?? fuehreAus;
    this.ladeLetztenStand();
  }

  private statusDatei(): string {
    return join(this.o.dataDir, 'update-status.json');
  }

  private ladeLetztenStand(): void {
    try {
      if (existsSync(this.statusDatei())) {
        const z = JSON.parse(readFileSync(this.statusDatei(), 'utf8')) as UpdateZustand;
        this.zustand = { ...z, laeuft: false };
      }
    } catch {
      // ignorieren
    }
  }

  private speichere(): void {
    try {
      mkdirSync(this.o.dataDir, { recursive: true });
      writeFileSync(this.statusDatei(), JSON.stringify(this.zustand, null, 1));
    } catch (e) {
      log('warn', `Update-Status nicht gespeichert: ${(e as Error).message}`);
    }
  }

  private async schritt(text: string, befehl: string, args: string[]): Promise<{ ok: boolean; ausgabe: string }> {
    const s: Schritt = { text, ok: null, ausgabe: '' };
    this.zustand.schritte.push(s);
    this.speichere();
    const r = await this.run(befehl, args, this.o.appDir);
    s.ok = r.code === 0;
    s.ausgabe = r.ausgabe;
    this.speichere();
    return { ok: s.ok, ausgabe: r.ausgabe };
  }

  private notiz(text: string, ok: boolean, ausgabe = ''): void {
    this.zustand.schritte.push({ text, ok, ausgabe });
    this.speichere();
  }

  /** Schritt 1: prüfen. Holt neue Commits und prüft auf lokale Änderungen. */
  async pruefe(): Promise<UpdateZustand> {
    if (this.zustand.laeuft) return this.zustand;
    this.zustand = { laeuft: true, phase: 'laeuft', schritte: [], neueCommits: [], aktuellerCommit: null, zeit: new Date().toISOString() };
    try {
      const head = await this.schritt('Aktuellen Commit lesen', 'git', ['rev-parse', '--short', 'HEAD']);
      if (!head.ok) return this.ende('fehler');
      this.zustand.aktuellerCommit = head.ausgabe.trim();
      if (!(await this.schritt(`Von GitHub holen (${this.o.branch})`, 'git', ['fetch', '--prune', 'origin', this.o.branch])).ok) return this.ende('fehler');
      const status = await this.schritt('Lokale Änderungen prüfen', 'git', ['status', '--porcelain', '--untracked-files=no']);
      if (!status.ok) return this.ende('fehler');
      if (status.ausgabe.trim()) {
        this.notiz('Es gibt lokale Änderungen. Das Update ist gesperrt.', false, status.ausgabe);
        return this.ende('fehler');
      }
      const commits = await this.schritt('Neue Commits suchen', 'git', ['log', '--oneline', '--no-decorate', `HEAD..origin/${this.o.branch}`]);
      if (!commits.ok) return this.ende('fehler');
      this.zustand.neueCommits = commits.ausgabe.split(/\r?\n/).filter(Boolean);
      return this.ende('geprueft');
    } catch (e) {
      this.notiz('Unerwarteter Fehler', false, (e as Error).message);
      return this.ende('fehler');
    }
  }

  private ende(phase: UpdateZustand['phase']): UpdateZustand {
    this.zustand.laeuft = false;
    this.zustand.phase = phase;
    this.speichere();
    return this.zustand;
  }

  /** Schritt 2: Update ausführen. Läuft im Hintergrund. Die Seite lädt sich selbst neu. */
  starte(): boolean {
    if (this.zustand.laeuft || this.zustand.phase !== 'geprueft' || !this.zustand.neueCommits.length) return false;
    this.zustand.laeuft = true;
    this.zustand.phase = 'laeuft';
    this.speichere();
    void this.fuehreUpdateAus();
    return true;
  }

  private async fuehreUpdateAus(): Promise<void> {
    const alt = await this.run('git', ['rev-parse', 'HEAD'], this.o.appDir);
    if (alt.code !== 0) {
      this.notiz('Aktuellen Commit lesen', false, alt.ausgabe);
      this.ende('fehler');
      return;
    }
    const alterCommit = alt.ausgabe.trim();
    if (!/^[0-9a-f]{7,64}$/.test(alterCommit)) {
      this.notiz('Aktuellen Commit lesen', false, alterCommit);
      this.ende('fehler');
      return;
    }
    // Ohne Sicherung kein Update.
    const ordner = join(this.o.exportDir, 'update-sicherung');
    try {
      mkdirSync(ordner, { recursive: true });
      const datei = join(ordner, `datenbank-vor-update-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
      await this.o.sichern(datei);
      this.notiz(`Datenbank gesichert: ${datei}`, true);
      const alle = readdirSync(ordner).filter((n) => /^datenbank-vor-update-.*\.sql$/.test(n)).sort();
      for (const n of alle.slice(0, Math.max(0, alle.length - BEHALTEN))) unlinkSync(join(ordner, n));
    } catch (e) {
      this.notiz('Datenbank sichern', false, (e as Error).message);
      this.ende('fehler');
      return;
    }
    const merge = await this.schritt('Code übernehmen', 'git', ['merge', '--ff-only', `origin/${this.o.branch}`]);
    if (!merge.ok) {
      this.ende('fehler');
      return;
    }
    const ok = (await this.schritt('Pakete installieren (npm ci)', 'npm', NPM_CI_ARGS)).ok &&
      (await this.schritt('Bauen (npm run build)', 'npm', ['run', 'build'])).ok;
    if (!ok) {
      // Ein Fehler nach dem Holen setzt den Code auf den alten Commit zurück.
      await this.schritt('Alten Stand wiederherstellen', 'git', ['reset', '--hard', alterCommit]);
      await this.schritt('Pakete des alten Stands installieren', 'npm', NPM_CI_ARGS);
      await this.schritt('Alten Stand bauen', 'npm', ['run', 'build']);
      this.ende('fehler');
      return;
    }
    this.notiz('Neustart', true, `Der Prozess beendet sich mit Code ${NEUSTART_CODE}. Das Startskript startet ihn neu.`);
    this.ende('fertig');
    setTimeout(() => this.o.neustart(), 1500);
  }
}

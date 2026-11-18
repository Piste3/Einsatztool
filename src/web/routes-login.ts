// Login über Microsoft Entra ID (OpenID Connect, Authorization-Code-Flow mit PKCE) (22.1).
import type { Express, Request, Response } from 'express';
import * as oidc from 'openid-client';
import type { Abhaengigkeiten } from './app.js';
import { gleich, leseCookies, neueSitzung, setzeCookie, signiere } from './app.js';
import { benutzerNachLogin } from '../domain/stammdaten.js';
import { schreibe } from '../db/db.js';
import { html } from './html.js';
import { einfacheSeite } from './views/layout.js';
import { k, sicheresZiel } from './kontext.js';
import type { Konfiguration } from '../config.js';
import { log } from '../log.js';

/** Bekannte Endpunkte von Entra. So braucht /login keinen Netzwerkzugriff. */
export function entraKonfiguration(konfig: Konfiguration): oidc.Configuration {
  const t = encodeURIComponent(konfig.entra.tenantId);
  return new oidc.Configuration(
    {
      issuer: `https://login.microsoftonline.com/${t}/v2.0`,
      authorization_endpoint: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
      token_endpoint: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
      jwks_uri: `https://login.microsoftonline.com/${t}/discovery/v2.0/keys`,
    },
    konfig.entra.clientId,
    konfig.entra.clientSecret,
  );
}

interface LoginZustand {
  state: string;
  nonce: string;
  verifier: string;
  ziel: string;
  zeit: number;
}

function packe(konfig: Konfiguration, z: LoginZustand): string {
  const wert = Buffer.from(JSON.stringify(z)).toString('base64url');
  return `${wert}.${signiere(konfig.sessionSecret, 'login', wert)}`;
}

function entpacke(konfig: Konfiguration, roh: string | undefined): LoginZustand | null {
  if (!roh) return null;
  const [wert, sig] = roh.split('.');
  if (!wert || !sig || !gleich(sig, signiere(konfig.sessionSecret, 'login', wert))) return null;
  try {
    const z = JSON.parse(Buffer.from(wert, 'base64url').toString('utf8')) as LoginZustand;
    if (Date.now() - z.zeit > 10 * 60 * 1000) return null;
    return z;
  } catch {
    return null;
  }
}

/** Regel 22.1.5: Admin vor Aufgebot. Keine Rolle = kein Zugriff. */
export function rolleAusClaims(roles: unknown): 'admin' | 'aufgebot' | null {
  const liste = Array.isArray(roles) ? roles.map((r) => String(r).toLowerCase()) : [];
  if (liste.includes('admin')) return 'admin';
  if (liste.includes('aufgebot')) return 'aufgebot';
  return null;
}

function keinZugriff(res: Response, text: string): void {
  res.status(403).send(einfacheSeite('Kein Zugriff', html`<h1>Kein Zugriff</h1><p>${text}</p><p><a href="/login">Erneut anmelden</a></p>`));
}

export function registriereLogin(app: Express, deps: Abhaengigkeiten): void {
  const { konfig, db } = deps;
  const entraBereit = !!(konfig.entra.tenantId && konfig.entra.clientId);
  const config = entraBereit ? entraKonfiguration(konfig) : null;
  const redirectUri = `${konfig.baseUrl}/login/callback`;

  app.get('/login', async (req: Request, res: Response) => {
    const ziel = sicheresZiel(req.query.ziel, '/');
    if (k(res).benutzer) {
      res.redirect(302, ziel);
      return;
    }
    if (konfig.devLogin) {
      // Test-Login nur lokal (Entscheid Yann). Nie auf dem Server.
      res.send(einfacheSeite('Test-Login', html`<h1>Test-Login</h1>
<p class="meldung hinweis">Nur für lokale Tests. Microsoft Entra ist nicht eingerichtet.</p>
<form method="post" action="/login/dev" class="stapel">
  <input type="hidden" name="ziel" value="${ziel}">
  <div class="feld"><label for="name">Name</label><input id="name" name="name" required value="Test Admin"></div>
  <div class="feld"><label for="rolle">Rolle</label><select id="rolle" name="rolle"><option value="admin">Admin</option><option value="aufgebot">Aufgebot</option></select></div>
  <button class="knopf haupt" type="submit">Anmelden</button>
</form>`));
      return;
    }
    if (!config) {
      res.status(503).send(einfacheSeite('Login nicht eingerichtet', html`<h1>Login nicht eingerichtet</h1><p>ENTRA_TENANT_ID und ENTRA_CLIENT_ID fehlen in der Konfiguration.</p>`));
      return;
    }
    const z: LoginZustand = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      verifier: oidc.randomPKCECodeVerifier(),
      ziel,
      zeit: Date.now(),
    };
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      response_type: 'code',
      code_challenge: await oidc.calculatePKCECodeChallenge(z.verifier),
      code_challenge_method: 'S256',
      state: z.state,
      nonce: z.nonce,
      response_mode: 'query',
    });
    setzeCookie(res, konfig, 'login', packe(konfig, z), 600);
    res.redirect(302, url.href);
  });

  app.get('/login/callback', async (req: Request, res: Response) => {
    if (!config) {
      res.redirect(302, '/login');
      return;
    }
    const z = entpacke(konfig, leseCookies(req).login);
    res.clearCookie('login', { path: '/' });
    if (!z) {
      keinZugriff(res, 'Die Anmeldung ist abgelaufen.');
      return;
    }
    let claims: Record<string, unknown>;
    try {
      // Regel 22.1.4: openid-client prüft Aussteller, Zielgruppe, Ablaufzeit und nonce des ID-Tokens.
      const tokens = await oidc.authorizationCodeGrant(config, new URL(req.originalUrl, konfig.baseUrl), {
        pkceCodeVerifier: z.verifier,
        expectedState: z.state,
        expectedNonce: z.nonce,
        idTokenExpected: true,
      });
      claims = (tokens.claims() ?? {}) as Record<string, unknown>;
    } catch (e) {
      log('warn', `Login fehlgeschlagen: ${(e as Error).message}`);
      keinZugriff(res, 'Die Anmeldung bei Microsoft ist fehlgeschlagen.');
      return;
    }
    const rolle = rolleAusClaims(claims.roles);
    if (!rolle) {
      keinZugriff(res, 'Dein Konto hat weder die Rolle Admin noch Aufgebot.');
      return;
    }
    const oid = String(claims.oid ?? claims.sub ?? '');
    const email = String(claims.preferred_username ?? claims.email ?? '');
    const name = String(claims.name ?? email);
    if (!oid || !email) {
      keinZugriff(res, 'Das Konto liefert keine Kennung.');
      return;
    }
    const b = await benutzerNachLogin(db, { oid, name, email, rolle });
    if (!b.aktiv) {
      keinZugriff(res, 'Dein Benutzer ist inaktiv.');
      return;
    }
    const sid = await neueSitzung(db, b.id);
    setzeCookie(res, konfig, 'sid', sid, null);
    res.redirect(302, z.ziel);
  });

  if (konfig.devLogin) {
    app.post('/login/dev', async (req: Request, res: Response) => {
      const rolle = req.body?.rolle === 'aufgebot' ? 'aufgebot' : 'admin';
      const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 100) : 'Test';
      const b = await benutzerNachLogin(db, { oid: `dev-${rolle}-${name}`, name, email: `${rolle}.${name.replace(/\W+/g, '')}@dev.local`, rolle });
      if (!b.aktiv) {
        keinZugriff(res, 'Dein Benutzer ist inaktiv.');
        return;
      }
      const sid = await neueSitzung(db, b.id);
      setzeCookie(res, konfig, 'sid', sid, null);
      res.redirect(303, sicheresZiel(req.body?.ziel, '/'));
    });
  }

  // Regel 22.1.7: /logout löscht die Sitzung.
  app.post('/logout', async (_req: Request, res: Response) => {
    const sid = k(res).sitzungId;
    if (sid) await schreibe(db, 'DELETE FROM sitzung WHERE id = ?', [sid]);
    res.clearCookie('sid', { path: '/' });
    res.send(einfacheSeite('Abgemeldet', html`<h1>Abgemeldet</h1><p><a href="/login">Wieder anmelden</a></p>`));
  });
}

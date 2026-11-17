// POST /api/admin-password {"idToken": "...", "user": "bob", "password": "..."}: lets the
// administrator set a new password for a player from the Admin tab.
import {ADMIN, DOMAIN, whoIs, signInMailer, database, logEvent, missingSettings} from './lib/pickem.mjs';
import {adminReady, setPassword} from './lib/admin.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

export default async req => {
  if (req.method !== 'POST') return reply({error: 'Use POST.'}, 405);
  const {idToken, user, password} = await req.json().catch(() => ({}));
  let who = '';
  try { who = idToken ? await whoIs(idToken) : ''; } catch (e) { /* invalid or expired */ }
  if (who !== ADMIN + DOMAIN) return reply({error: 'Only the administrator can reset passwords.'}, 403);
  if (!adminReady()) return reply({error: 'Netlify is missing the FIREBASE_SERVICE_ACCOUNT setting.'}, 503);
  const u = String(user || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(u)) return reply({error: 'That name is not a username.'}, 400);
  if (String(password || '').length < 6) return reply({error: 'The new password needs at least 6 characters.'}, 400);
  try {
    await setPassword(u, String(password));
    if (!missingSettings().length) await logEvent(database(await signInMailer()), ADMIN, `Set a new password for "${u}"`);
    return reply({ok: true});
  }
  catch (e) { return reply({error: /NO_SUCH_USER/.test(e.message) ? `There's no login named "${u}".` : 'Could not change the password: ' + e.message}, 500); }
};

export const config = {path: '/api/admin-password'};

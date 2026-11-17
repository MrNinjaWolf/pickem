// POST /api/admin-create-login {"idToken": "...", "user": "bob", "password": "..."}: creates a login
// with the administrator credential, so Firebase's public sign-up can stay switched off.
// The app then gives it access to a database and adds it to the player list.
import {ADMIN, DOMAIN, whoIs, signInMailer, database, logEvent, missingSettings} from './lib/pickem.mjs';
import {adminReady, createUser} from './lib/admin.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

export default async req => {
  if (req.method !== 'POST') return reply({error: 'Use POST.'}, 405);
  const {idToken, user, password} = await req.json().catch(() => ({}));
  let who = '';
  try { who = idToken ? await whoIs(idToken) : ''; } catch (e) { /* invalid */ }
  if (who !== ADMIN + DOMAIN) return reply({error: 'Only the administrator can create logins.'}, 403);
  if (!adminReady()) return reply({error: 'Netlify is missing the FIREBASE_SERVICE_ACCOUNT setting.', code: 'NOT_SET_UP'}, 503);
  const u = String(user || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(u)) return reply({error: 'Usernames can only use letters, numbers, - and _.'}, 400);
  if (String(password || '').length < 6) return reply({error: 'The password needs at least 6 characters.'}, 400);
  try { await createUser(u, String(password)); }
  catch (e) { return /EMAIL_EXISTS|DUPLICATE/.test(e.message) ? reply({error: 'EMAIL_EXISTS'}, 409) : reply({error: 'Could not create the login: ' + e.message}, 500); }
  if (!missingSettings().length) await logEvent(database(await signInMailer()), ADMIN, `Created the login "${u}"`);
  return reply({ok: true});
};

export const config = {path: '/api/admin-create-login'};

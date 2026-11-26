// POST /api/reset {"token": "...", "password": "..."}: sets a new password using a link from
// /api/reset-request. Each link works once, for one hour.
import crypto from 'node:crypto';
import {signInMailer, database, logEvent} from './lib/pickem.mjs';
import {adminReady, setPassword} from './lib/admin.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

export default async req => {
  if (req.method !== 'POST') return reply({error: 'Use POST.'}, 405);
  if (!adminReady()) return reply({error: "Password reset isn't set up yet. Ask the administrator to reset it for you."}, 503);
  const {token, password} = await req.json().catch(() => ({}));
  if (String(password || '').length < 6) return reply({error: 'The new password needs at least 6 characters.'}, 400);
  const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const q = database(await signInMailer());
  const rec = await q('GET', `/resets/${hash}`);
  if (!rec || !rec.user || rec.exp < Date.now()) return reply({error: 'This reset link has expired or was already used. Ask for a new one.'}, 400);
  try { await setPassword(rec.user, String(password)); }
  catch (e) {
    console.log('reset: could not set the password:', e.message);     // details stay in the Netlify log
    return reply({error: /NO_SUCH_USER/.test(e.message) ? 'That account no longer exists.' : 'Could not change the password right now. Try the link again in a minute.'}, 500);
  }
  await q('DELETE', `/resets/${hash}`);               // used up only once the password has changed
  await logEvent(q, rec.user, `${rec.user} reset their password with an email link`);
  return reply({ok: true, user: rec.user});
};

export const config = {path: '/api/reset'};

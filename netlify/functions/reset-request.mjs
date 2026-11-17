// POST /api/reset-request {"username": "bob"}: emails a one-hour password reset link to the
// address saved for that login. The reply is the same whether or not the login exists, so it
// can't be used to find out who has an account.
import crypto from 'node:crypto';
import {missingSettings, signInMailer, database, mailer, send, appUrl} from './lib/pickem.mjs';
import {adminReady} from './lib/admin.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const DONE = {ok: true, message: 'If that account has an email on file, a reset link is on its way. It works for one hour.'};

export default async req => {
  if (req.method !== 'POST') return reply({error: 'Use POST.'}, 405);
  if (missingSettings().length || !adminReady()) return reply({error: "Password reset isn't set up yet. Ask the administrator to reset it for you."}, 503);
  const {username} = await req.json().catch(() => ({}));
  const u = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(u)) return reply({error: 'Enter your username.'}, 400);
  const q = database(await signInMailer());
  const [email, last] = await Promise.all([q('GET', `/emails/${u}`), q('GET', `/resetlog/${u}`)]);
  if (!email) return reply(DONE);
  if (last && Date.now() - last < 5 * 60000) return reply(DONE);         // one email per 5 minutes
  const token = crypto.randomBytes(24).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await q('PUT', `/resets/${hash}`, {user: u, exp: Date.now() + 3600e3});
  await q('PUT', `/resetlog/${u}`, Date.now());
  const link = `${appUrl()}/?reset=${token}`;
  await send(mailer(), email, "Reset your Pick'Em password", 'Reset your password', [
    `Someone asked to reset the password for <b>${u}</b>. If that was you, use the button below within an hour.`,
    `<a href="${link}" style="color:#ffc53d">Choose a new password</a>`,
    "If you didn't ask for this, you can ignore this email. Your password won't change."]);
  return reply(DONE);
};

export const config = {path: '/api/reset-request'};

// POST /api/test-email with {"idToken": "..."} from the app's Admin page.
// Only the administrator's login may call it. Sends one test email to the administrator's saved address.
import {ADMIN, DOMAIN, missingSettings, whoIs, signInMailer, database, mailer, send} from './lib/pickem.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

export default async req => {
  if (req.method !== 'POST') return reply({error: 'Use POST.'}, 405);
  const missing = missingSettings();
  if (missing.length) return reply({error: 'Netlify is missing these environment variables: ' + missing.join(', ')}, 500);
  const {idToken} = await req.json().catch(() => ({}));
  let who = '';
  try { who = idToken ? await whoIs(idToken) : ''; } catch (e) { /* invalid or expired token */ }
  if (who !== ADMIN + DOMAIN) return reply({error: 'Only the administrator can send a test email.'}, 403);
  try {
    const q = database(await signInMailer());
    const to = await q('GET', `/emails/${ADMIN}`);
    if (!to) return reply({error: 'Save your own email address on the Admin page first.'}, 400);
    await send(mailer(), to, "Pick'Em test email", 'Reminder emails are working',
      ['This is a test from your Pick\'Em app. Players with an email address get a message when a week\'s games are all final, and a reminder 2 hours before the next week\'s first kickoff if they still have picks to make.']);
    return reply({ok: true, to});
  } catch (e) {
    const m = String(e.message || e);
    const hint = /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(m) ? 'The mailer login or PICKEM_MAILER_PASSWORD is wrong.'
      : /HTTP 40[13]/.test(m) ? 'The database refused the mailer. Publish the latest database rules.'
      : /Invalid login|Username and Password not accepted|EAUTH/i.test(m) ? 'Gmail refused the login. Check GMAIL_USER and GMAIL_APP_PASSWORD.'
      : m;
    return reply({error: hint}, 500);
  }
};

export const config = {path: '/api/test-email'};

// POST /api/test-push {"idToken": "..."}: sends a test notification to every phone the
// caller has turned notifications on for.
import {DOMAIN, whoIs, signInMailer, database, missingSettings} from './lib/pickem.mjs';
import {vapidKeys, pushTo} from './lib/push.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

export default async req => {
  if (req.method !== 'POST') return reply({error: 'Use POST.'}, 405);
  if (missingSettings().length) return reply({error: "Notifications aren't set up on the server yet."}, 503);
  const {idToken} = await req.json().catch(() => ({}));
  let who = '';
  try { who = idToken ? await whoIs(idToken) : ''; } catch (e) { /* invalid */ }
  if (!who.endsWith(DOMAIN)) return reply({error: 'Please log in again.'}, 403);
  const user = who.slice(0, -DOMAIN.length);
  const q = database(await signInMailer());
  const keys = await vapidKeys(q, {create: true});
  const subs = await q('GET', `/push/${user}`);
  if (!keys || !subs) return reply({error: 'Turn notifications on first.'}, 400);
  const n = await pushTo(q, keys, user, subs, {title: "Pick'Em notifications are on", body: "You'll get pick reminders and your results here.", url: '/'});
  return n ? reply({ok: true, sent: n}) : reply({error: "Couldn't reach your phone. Turn notifications off and on again."}, 500);
};

export const config = {path: '/api/test-push'};

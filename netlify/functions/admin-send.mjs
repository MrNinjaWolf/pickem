// POST /api/admin-send {"idToken": "..."}: the Admin tab's "Send a reminder now".
import {ADMIN, DOMAIN, whoIs, missingSettings, remindNow} from './lib/pickem.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

export default async req => {
  if (req.method !== 'POST') return reply({error: 'Use POST.'}, 405);
  const {idToken} = await req.json().catch(() => ({}));
  let who = '';
  try { who = idToken ? await whoIs(idToken) : ''; } catch (e) { /* invalid */ }
  if (who !== ADMIN + DOMAIN) return reply({error: 'Only the administrator can do this.'}, 403);
  if (missingSettings().length) return reply({error: 'Netlify is missing: ' + missingSettings().join(', ')}, 503);
  try { return reply({ok: true, ...(await remindNow())}); }
  catch (e) { return reply({error: e.message}, 500); }
};

export const config = {path: '/api/admin-send'};

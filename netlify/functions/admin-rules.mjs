// POST /api/admin-rules {"idToken": "...", "install": true|false}: checks whether the database's
// security rules match database.rules.json in this repo, and (with install) publishes them, using
// the service account. Saves copying the long rules into the Firebase console by hand.
import rules from '../../database.rules.json' with {type: 'json'};
import {ADMIN, DOMAIN, whoIs, signInMailer, database, logEvent, missingSettings} from './lib/pickem.mjs';
import {adminReady, adminDb} from './lib/admin.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
// Same rules, ignoring formatting and key order
const norm = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

export default async req => {
  if (req.method !== 'POST') return reply({error: 'Use POST.'}, 405);
  const {idToken, install} = await req.json().catch(() => ({}));
  let who = '';
  try { who = idToken ? await whoIs(idToken) : ''; } catch (e) { /* invalid */ }
  if (who !== ADMIN + DOMAIN) return reply({error: 'Only the administrator can do this.'}, 403);
  if (!adminReady()) return reply({error: 'Netlify is missing the FIREBASE_SERVICE_ACCOUNT setting.'}, 503);
  const q = adminDb();
  try {
    if (install) {
      await q('PUT', '/.settings/rules', rules);
      if (!missingSettings().length) await logEvent(database(await signInMailer()), ADMIN, 'Installed the latest database rules');
    }
    let current = await q('GET', '/.settings/rules');
    if (typeof current === 'string') { try { current = JSON.parse(current); } catch (e) { current = null; } }
    return reply({ok: true, upToDate: !!current && norm(current) === norm(rules), installed: !!install});
  } catch (e) {
    return reply({error: 'Firebase refused: ' + e.message + '. Check that the service account belongs to this Firebase project.'}, 500);
  }
};

export const config = {path: '/api/admin-rules'};

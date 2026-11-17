// GET /api/config: the Firebase database URL and Web API key from the site's Netlify settings,
// so the login screen doesn't have to ask for them, plus the public key phones need to turn on
// notifications. None of these values are secret: every browser that opens the app receives them.
import {missingSettings, signInMailer, database} from './lib/pickem.mjs';
import {vapidKeys} from './lib/push.mjs';

let vapidPublic = '';
export default async () => {
  if (!vapidPublic && !missingSettings().length) {
    try { const k = await vapidKeys(database(await signInMailer()), {create: true}); vapidPublic = (k && k.publicKey) || ''; }
    catch (e) { /* notifications stay off until the settings work */ }
  }
  return new Response(JSON.stringify({
    databaseUrl: (process.env.PICKEM_DB_URL || '').trim(),
    apiKey: (process.env.PICKEM_API_KEY || '').trim(),
    vapidPublicKey: vapidPublic
  }), {headers: {'content-type': 'application/json', 'cache-control': 'public, max-age=300'}});
};

export const config = {path: '/api/config'};

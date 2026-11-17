// Administrator access to Firebase Authentication, used only to set a player's password
// (forgotten-password links and the Admin tab's reset). It signs in with a Firebase service
// account; no extra library is needed.
//
// Netlify environment variable:
//   FIREBASE_SERVICE_ACCOUNT  the whole JSON file from Firebase console > Project settings >
//                             Service accounts > Generate new private key
import crypto from 'node:crypto';
import {DOMAIN} from './pickem.mjs';

const E = k => (process.env[k] || '').trim();
const AUTH = () => E('PICKEM_AUTH_BASE') || 'https://identitytoolkit.googleapis.com';

function account() {
  try { return JSON.parse(E('FIREBASE_SERVICE_ACCOUNT')); } catch (e) { return null; }
}
export const adminReady = () => !!E('PICKEM_ADMIN_TEST_TOKEN') || !!(account() && account().private_key && account().client_email);
const projectId = () => E('FIREBASE_PROJECT_ID') || (account() || {}).project_id || '';

const b64url = s => Buffer.from(s).toString('base64url');
let cached = {token: '', exp: 0};
async function accessToken() {
  if (E('PICKEM_ADMIN_TEST_TOKEN')) return E('PICKEM_ADMIN_TEST_TOKEN');          // tests against the Firebase emulator
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const sa = account(), now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({alg: 'RS256', typ: 'JWT'}));
  const claim = b64url(JSON.stringify({iss: sa.client_email, scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600}));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}`}).toString()});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google refused the service account: ' + (j.error_description || j.error || r.status));
  cached = {token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000};
  return cached.token;
}
async function call(path, body) {
  const r = await fetch(`${AUTH()}/v1/projects/${encodeURIComponent(projectId())}/${path}`, {method: 'POST',
    headers: {'content-type': 'application/json', authorization: 'Bearer ' + await accessToken()}, body: JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
  return j;
}
/** Sets a new password for a username. Throws "NO_SUCH_USER" if the login doesn't exist. */
export async function setPassword(username, password) {
  const found = await call('accounts:lookup', {email: [username + DOMAIN]});
  const user = (found.users || [])[0];
  if (!user) throw new Error('NO_SUCH_USER');
  await call('accounts:update', {localId: user.localId, password});
}

/** Creates a login (used by the Admin tab, so public sign-up can be switched off). Throws "EMAIL_EXISTS" if taken. */
export async function createUser(username, password) {
  await call('accounts', {email: username + DOMAIN, password, emailVerified: false});
}

/** Database access as the administrator credential (bypasses the rules). Used only for renaming a player. */
export function adminDb() {
  const base = E('PICKEM_DB_URL').replace(/\/+$/, ''), ns = E('PICKEM_DB_NS');
  return async (method, path, body) => {
    const r = await fetch(`${base}${path}.json${ns ? '?ns=' + encodeURIComponent(ns) : ''}`, {method,
      headers: {authorization: 'Bearer ' + await accessToken(), ...(body === undefined ? {} : {'content-type': 'application/json'})},
      body: body === undefined ? undefined : JSON.stringify(body)});
    if (!r.ok) throw new Error(`database ${method} ${path}: HTTP ${r.status}`);
    return r.json();
  };
}

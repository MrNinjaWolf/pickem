// POST /api/admin-rename {"idToken": "...", "league": "family", "from": "Dad", "to": "Dakota"}:
// renames a player on one database and moves all of their picks (and CFP brackets) to the new name. Done here because
// the database rules only let each player write their own picks.
import {ADMIN, DOMAIN, whoIs, signInMailer, database, logEvent, missingSettings} from './lib/pickem.mjs';
import {adminReady, adminDb} from './lib/admin.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const NAME = /^[^.$#\[\]\/"\\|\t\r\n]{1,24}$/;

export default async req => {
  if (req.method !== 'POST') return reply({error: 'Use POST.'}, 405);
  const {idToken, league, from, to} = await req.json().catch(() => ({}));
  let who = '';
  try { who = idToken ? await whoIs(idToken) : ''; } catch (e) { /* invalid */ }
  if (who !== ADMIN + DOMAIN) return reply({error: 'Only the administrator can rename players.'}, 403);
  if (!adminReady()) return reply({error: 'Netlify is missing the FIREBASE_SERVICE_ACCOUNT setting.'}, 503);
  const f = String(from || ''), t = String(to || '').trim(), lg = String(league || '');
  if (!NAME.test(f) || !NAME.test(t) || !/^[A-Za-z0-9 _-]{1,30}$/.test(lg)) return reply({error: 'That name has characters that can\'t be used.'}, 400);
  if (f === t) return reply({ok: true, moved: 0});
  const q = adminDb(), base = `/leagues/${encodeURIComponent(lg)}`;
  const [profiles, picks, cfp] = await Promise.all([q('GET', `${base}/profiles`), q('GET', `${base}/picks`), q('GET', '/cfp').catch(() => null)]);
  if (!profiles || !profiles[f]) return reply({error: `"${f}" isn't on the player list.`}, 404);
  if (Object.keys(profiles).some(n => n !== f && n.toLowerCase() === t.toLowerCase())) return reply({error: `"${t}" is already on the player list.`}, 409);
  const L = `leagues/${lg}`, patch = {[`${L}/profiles/${t}`]: true, [`${L}/profiles/${f}`]: null};
  let moved = 0;
  for (const [week, byName] of Object.entries(picks || {})) {
    if (!byName || !byName[f]) continue;
    patch[`${L}/picks/${week}/${t}`] = byName[f]; patch[`${L}/picks/${week}/${f}`] = null; moved += Object.keys(byName[f]).length;
  }
  for (const [season, c] of Object.entries(cfp || {})) {          // CFP brackets move too
    const b = (((c || {}).brackets || {})[lg] || {})[f];
    if (b) { patch[`cfp/${season}/brackets/${lg}/${t}`] = b; patch[`cfp/${season}/brackets/${lg}/${f}`] = null; }
  }
  await q('PATCH', '/', patch);                        // one update, so it all moves or nothing does
  if (!missingSettings().length) await logEvent(database(await signInMailer()), ADMIN, `Renamed "${f}" to "${t}" in ${lg} (${moved} picks moved)`);
  return reply({ok: true, moved});
};

export const config = {path: '/api/admin-rename'};

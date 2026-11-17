// Shared code for the reminder emails. It reads Firebase as the read-only "mailer" login,
// reads the schedule from ESPN, and sends through Gmail.
//
// Netlify environment variables (Site configuration > Environment variables):
//   PICKEM_DB_URL           Firebase Realtime Database URL
//   PICKEM_API_KEY          Firebase Web API key
//   PICKEM_MAILER_PASSWORD  password of the mailer@pickem.app login
//   GMAIL_USER              the Gmail address emails are sent from
//   GMAIL_APP_PASSWORD      a Gmail app password for that address
import nodemailer from 'nodemailer';

const E = k => (process.env[k] || '').trim();
export const DOMAIN = '@pickem.app', ADMIN = 'dakota', MAILER = 'mailer';
const REQUIRED = ['PICKEM_DB_URL', 'PICKEM_API_KEY', 'PICKEM_MAILER_PASSWORD', 'GMAIL_USER', 'GMAIL_APP_PASSWORD'];
export const missingSettings = () => REQUIRED.filter(k => !E(k));

// Overrides used only by tests: ESPN_BASE, PICKEM_AUTH_BASE, PICKEM_DB_NS, SMTP_HOST, SMTP_PORT, PICKEM_NOW
const ESPN = () => E('ESPN_BASE') || 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const AUTH = () => E('PICKEM_AUTH_BASE') || 'https://identitytoolkit.googleapis.com';
const now = () => E('PICKEM_NOW') ? Date.parse(E('PICKEM_NOW')) : Date.now();
const appUrl = () => E('APP_URL') || E('URL') || 'https://dak-nfl.netlify.app';

export const PERIODS = Array.from({length: 18}, (_, i) => ({label: 'Week ' + (i + 1), type: 2, week: i + 1})).concat([
  {label: 'Wild Card', type: 3, week: 1}, {label: 'Divisional', type: 3, week: 2},
  {label: 'Conference Championship', type: 3, week: 3}, {label: 'Super Bowl', type: 3, week: 5}]);

// ---------------------------------------------------------------- Firebase
async function post(url, body) {
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
  return j;
}
export async function signInMailer() {
  const j = await post(`${AUTH()}/v1/accounts:signInWithPassword?key=${encodeURIComponent(E('PICKEM_API_KEY'))}`,
    {email: MAILER + DOMAIN, password: E('PICKEM_MAILER_PASSWORD'), returnSecureToken: true});
  return j.idToken;
}
/** Which login an ID token belongs to (checked by Firebase, so it can't be faked). */
export async function whoIs(idToken) {
  const j = await post(`${AUTH()}/v1/accounts:lookup?key=${encodeURIComponent(E('PICKEM_API_KEY'))}`, {idToken});
  return ((j.users && j.users[0] && j.users[0].email) || '').toLowerCase();
}
export function database(token) {
  const base = E('PICKEM_DB_URL').replace(/\/+$/, ''), ns = E('PICKEM_DB_NS');
  return async (method, path, body) => {
    const r = await fetch(`${base}${path}.json?auth=${encodeURIComponent(token)}${ns ? '&ns=' + encodeURIComponent(ns) : ''}`, {
      method, headers: body === undefined ? {} : {'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
    if (!r.ok) throw new Error(`database ${method} ${path}: HTTP ${r.status}`);
    return r.json();
  };
}

// ---------------------------------------------------------------- ESPN
function parseGame(ev) {
  const comp = ev.competitions[0], g = {id: String(ev.id), date: ev.date || '', away: {}, home: {}};
  for (const c of comp.competitors) {
    const t = c.team || {};
    g[c.homeAway === 'home' ? 'home' : 'away'] = {abbr: t.abbreviation || '', name: t.displayName || '', score: parseInt(c.score, 10) || 0};
  }
  const ty = (ev.status && ev.status.type) || {};
  g.state = ty.state || 'pre';
  if (g.state === 'post' && ty.completed === false) g.state = 'pre';   // postponed
  return g;
}
async function espn(query) {
  const r = await fetch(`${ESPN()}/scoreboard?limit=100${query}`);
  if (!r.ok) throw new Error('ESPN HTTP ' + r.status);
  return r.json();
}
async function loadWeek(season, i) {
  const p = PERIODS[i];
  const j = await espn(`&dates=${season}&seasontype=${p.type}&week=${p.week}`);
  return {i, label: p.label, key: `${season}-${p.type}-${p.week}`, games: (j.events || []).map(parseGame)};
}
/** The week ESPN calls current, plus the weeks either side of it. */
async function nearbyWeeks() {
  const j = await espn('');
  const season = (j.season && j.season.year) || new Date(now()).getFullYear();
  const st = j.season && j.season.type, type = (st && typeof st === 'object' ? st.type : st) || 2;
  const i = PERIODS.findIndex(p => p.type === type && p.week === ((j.week && j.week.number) || 1));
  if (i < 0) return [];                                       // preseason or offseason: nothing to send
  const cur = {i, label: PERIODS[i].label, key: `${season}-${type}-${PERIODS[i].week}`, games: (j.events || []).map(parseGame)};
  const out = [];
  if (i > 0) out.push(await loadWeek(season, i - 1));
  out.push(cur);
  if (i < PERIODS.length - 1) out.push(await loadWeek(season, i + 1));
  return out;
}

// ---------------------------------------------------------------- email
export function mailer() {
  if (E('SMTP_HOST')) return nodemailer.createTransport({host: E('SMTP_HOST'), port: +E('SMTP_PORT') || 25, secure: false, ignoreTLS: true});
  return nodemailer.createTransport({service: 'gmail', auth: {user: E('GMAIL_USER'), pass: E('GMAIL_APP_PASSWORD').replace(/\s+/g, '')}});
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const et = t => new Date(t).toLocaleString('en-US', {timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) + ' ET';
export function page(title, lines) {
  const html = `<!doctype html><html><body style="margin:0;background:#0a1630;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#f3f6fb">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">
<div style="font-size:22px;font-weight:800;margin-bottom:18px">&#127944; Pick<span style="color:#ffc53d">'Em</span></div>
<div style="background:#13213f;border:1px solid #24345a;border-radius:18px;padding:22px">
<h1 style="margin:0 0 12px;font-size:20px">${esc(title)}</h1>
${lines.map(l => `<p style="margin:0 0 10px;font-size:15px;line-height:1.5;color:#c9d4e6">${l}</p>`).join('\n')}
<p style="margin:18px 0 0"><a href="${esc(appUrl())}" style="display:inline-block;background:#ef4444;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px">Open Pick'Em</a></p>
</div><p style="font-size:12px;color:#8a9bb8;margin-top:16px">You get these because the Pick'Em administrator added your email.</p></div></body></html>`;
  const text = `${title}\n\n${lines.map(l => l.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&')).join('\n')}\n\n${appUrl()}`;
  return {html, text};
}
export async function send(transport, to, subject, title, lines) {
  const {html, text} = page(title, lines);
  await transport.sendMail({from: `"NFL Pick'Em" <${E('GMAIL_USER') || 'pickem@localhost'}>`, to, subject, html, text});
}

// ---------------------------------------------------------------- what to send
/** Each login with an email, and the databases where it has access and a name on the player list. */
function recipients(d) {
  const out = [];
  for (const [user, email] of Object.entries(d.emails || {})) {
    if (typeof email !== 'string' || !email.includes('@')) continue;
    const tagged = ((d.access[user] || {}).leagues) || {};
    const leagues = Object.keys(tagged).filter(lg => tagged[lg] === true && d.leagues[lg]).map(lg => {
      const name = Object.keys(d.leagues[lg].profiles || {}).find(n => n.toLowerCase() === user);
      return name && {lg, name};
    }).filter(Boolean);
    if (leagues.length) out.push({user, email, leagues});
  }
  return out;
}
const picksOf = (d, lg, key, name) => ((((d.leagues[lg] || {}).picks || {})[key] || {})[name]) || {};
const winner = g => g.away.score > g.home.score ? g.away.abbr : g.home.score > g.away.score ? g.home.abbr : 'TIE';

function doneEmail(d, r, w, next) {
  const lines = [];
  for (const {lg, name} of r.leagues) {
    const tally = n => { let c = 0, l = 0; const p = picksOf(d, lg, w.key, n);
      for (const g of w.games) { if (!p[g.id]) continue; const win = winner(g); if (win === 'TIE') continue; if (p[g.id] === win) c++; else l++; } return {c, l}; };
    const me = tally(name), all = Object.keys(d.leagues[lg].profiles || {}).map(n => ({n, ...tally(n)}));
    const best = Math.max(0, ...all.map(x => x.c)), top = all.filter(x => x.c === best && best > 0).map(x => esc(x.n));
    lines.push(`<b>${esc(lg)}</b>: you went <b>${me.c}-${me.l}</b>.${top.length ? ` Week winner: <b>${top.join(', ')}</b> (${best} correct).` : ''}`);
  }
  if (next && next.games.length) {
    const first = Math.min(...next.games.map(g => Date.parse(g.date)));
    lines.push(`<b>${esc(next.label)}</b> picks are open now. The first game kicks off <b>${esc(et(first))}</b>, and each pick locks at its game's kickoff.`);
  }
  return {subject: `${w.label} is final${next ? ` — make your ${next.label} picks` : ''}`, title: `${w.label} results are in`, lines};
}
function remindEmail(d, r, w, first) {
  const open = w.games.filter(g => g.state === 'pre' && Date.parse(g.date) > now());
  const lines = [`The first <b>${esc(w.label)}</b> game kicks off <b>${esc(et(first))}</b>, about 2 hours from now. Picks lock at each game's kickoff.`];
  let missing = 0;
  for (const {lg, name} of r.leagues) {
    const p = picksOf(d, lg, w.key, name), left = open.filter(g => !p[g.id]).length;
    missing += left;
    lines.push(`<b>${esc(lg)}</b>: you've picked <b>${open.length - left} of ${open.length}</b> open games${left ? '' : ' ✔'}.`);
  }
  return missing ? {subject: `⏰ ${w.label} picks lock in 2 hours`, title: `Don't forget your ${w.label} picks`, lines} : null;
}

/** One pass of the schedule. Each email goes to each person at most once (recorded under /mail/sent). */
export async function runOnce({transport = mailer(), log = console.log} = {}) {
  const q = database(await signInMailer());
  const weeks = await nearbyWeeks();
  const [access, emails, leagues, sent] = await Promise.all(['/access', '/emails', '/leagues', '/mail/sent'].map(p => q('GET', p)));
  const d = {access: access || {}, emails: emails || {}, leagues: leagues || {}, sent: sent || {}};
  const people = recipients(d), t = now();
  let count = 0;
  for (const w of weeks) {
    if (!w.games.length) continue;
    const times = w.games.map(g => Date.parse(g.date)).filter(x => !isNaN(x));
    const first = Math.min(...times), last = Math.max(...times);
    const jobs = [];
    if (w.games.every(g => g.state === 'post') && t - last < 4 * 86400e3) jobs.push('done');   // finished in the last few days
    if (t >= first - 2 * 3600e3 && t < first) jobs.push('remind');                             // 2 hours before the first kickoff
    for (const kind of jobs) {
      const done = ((d.sent[w.key] || {})[kind]) || {};
      for (const r of people) {
        if (done[r.user]) continue;
        const msg = kind === 'done' ? doneEmail(d, r, w, weeks.find(x => x.i === w.i + 1)) : remindEmail(d, r, w, first);
        if (!msg) continue;                                   // reminder: nothing missing
        try {
          await send(transport, r.email, msg.subject, msg.title, msg.lines);
          await q('PUT', `/mail/sent/${w.key}/${kind}/${r.user}`, t);
          count++; log(`sent ${kind} for ${w.label} to ${r.user}`);
        } catch (e) { log(`could not send ${kind} for ${w.label} to ${r.user}: ${e.message}`); }
      }
    }
  }
  return count;
}

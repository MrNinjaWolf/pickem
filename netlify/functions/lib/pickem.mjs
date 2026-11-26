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
import {vapidKeys, pushTo} from './push.mjs';
import {bracketFrom, leaderboard, cfpSeason, ORDER, ROUND_NAMES, SCORING} from '../../../phone-app/cfp-core.js';

const E = k => (process.env[k] || '').trim();
export const DOMAIN = '@pickem.app', ADMIN = 'dakota', MAILER = 'mailer';
const REQUIRED = ['PICKEM_DB_URL', 'PICKEM_API_KEY', 'PICKEM_MAILER_PASSWORD', 'GMAIL_USER', 'GMAIL_APP_PASSWORD'];
export const missingSettings = () => REQUIRED.filter(k => !E(k));

// Overrides used only by tests: ESPN_BASE, PICKEM_AUTH_BASE, PICKEM_DB_NS, SMTP_HOST, SMTP_PORT, PICKEM_NOW
const ESPN = () => E('ESPN_BASE') || 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CFB = () => E('ESPN_CFB_BASE') || 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const AUTH = () => E('PICKEM_AUTH_BASE') || 'https://identitytoolkit.googleapis.com';
const now = () => E('PICKEM_NOW') ? Date.parse(E('PICKEM_NOW')) : Date.now();
export const appUrl = () => E('APP_URL') || E('URL') || 'https://dak-nfl.netlify.app';

// The weeks of a season, in order, from ESPN's own calendar (it changes: the 2026 season dropped the
// Pro Bowl week, so the Super Bowl moved from playoff week 5 to week 4). The Pro Bowl is never picked.
// Preseason weeks are marked pre: their picks count only toward the preseason rankings, and no
// emails or notifications go out for them.
const PLAYOFF_NAMES = {'Divisional Round': 'Divisional', 'Conference Championships': 'Conference Championship'};
export function periodsFrom(calendar, season) {
  const out = [];
  for (const c of calendar || []) {
    const type = +c.value;
    if (type < 1 || type > 3) continue;
    for (const e of c.entries || []) {
      if (/pro bowl/i.test(e.label || '')) continue;
      out.push({label: PLAYOFF_NAMES[e.label] || e.label || `Week ${e.value}`, type, week: +e.value, pre: type === 1});
    }
  }
  if (out.some(p => p.type === 2)) return out;
  return [{label: 'Hall of Fame Weekend', type: 1, week: 1, pre: true}].concat([1, 2, 3].map(n => ({label: 'Preseason Week ' + n, type: 1, week: n + 1, pre: true})),
    Array.from({length: 18}, (_, i) => ({label: 'Week ' + (i + 1), type: 2, week: i + 1})),
    [{label: 'Wild Card', type: 3, week: 1}, {label: 'Divisional', type: 3, week: 2},
     {label: 'Conference Championship', type: 3, week: 3}, {label: 'Super Bowl', type: 3, week: season >= 2026 ? 4 : 5}]);
}
const order = p => p.type * 100 + p.week;

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
async function loadWeek(season, list, i) {
  const p = list[i];
  const j = await espn(`&dates=${season}&seasontype=${p.type}&week=${p.week}`);
  return {i, label: p.label, pre: !!p.pre, key: `${season}-${p.type}-${p.week}`, games: (j.events || []).map(parseGame)};
}
/** The week ESPN calls current, plus the weeks either side of it. During the Pro Bowl week that is the
 *  Super Bowl week; in the offseason there is none. */
async function nearbyWeeks() {
  const j = await espn('');
  const season = (j.season && j.season.year) || new Date(now()).getFullYear();
  const st = j.season && j.season.type, type = (st && typeof st === 'object' ? st.type : st) || 2;
  if (type < 1 || type > 3) return [];                        // offseason: nothing to send
  const list = periodsFrom(((j.leagues || [])[0] || {}).calendar, season);
  const at = {type, week: (j.week && j.week.number) || 1};
  let i = list.findIndex(p => p.type === at.type && p.week === at.week);
  let cur;
  if (i >= 0) cur = {i, label: list[i].label, pre: !!list[i].pre, key: `${season}-${type}-${list[i].week}`, games: (j.events || []).map(parseGame)};
  else {                                                      // a week that isn't picked (the Pro Bowl): use the next one
    i = list.findIndex(p => order(p) > order(at));
    if (i < 0) return [];
    cur = await loadWeek(season, list, i);
  }
  const out = [];
  if (i > 0) out.push(await loadWeek(season, list, i - 1));
  out.push(cur);
  if (i < list.length - 1) out.push(await loadWeek(season, list, i + 1));
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
export async function send(transport, to, subject, title, lines, {fromName = "NFL Pick'Em", note = ''} = {}) {
  const {html, text} = page(title, note ? [...lines, `<i>From the administrator:</i> ${esc(note)}`] : lines);
  await transport.sendMail({from: `"${fromName}" <${E('GMAIL_USER') || 'pickem@localhost'}>`, to, subject, html, text});
}

// ---------------------------------------------------------------- what to send
/** Each login with an email, and the databases where it has access and a name on the player list. */
function leaguesOf(d, user) {
  const tagged = ((d.access[user] || {}).leagues) || {};
  return Object.keys(tagged).filter(lg => tagged[lg] === true && d.leagues[lg]).map(lg => {
    const name = Object.keys(d.leagues[lg].profiles || {}).find(n => n.toLowerCase() === user);
    return name && {lg, name};
  }).filter(Boolean);
}
/** Each player's own choices (Profile page). Anything not switched off is on. The admin settings still apply on top. */
export const PREF_KEYS = ['resultsEmail', 'resultsPush', 'remindEmail', 'remindPush', 'gamePush', 'cfpEmail', 'cfpPush'];
export const wants = (d, user, key) => ((((d || {}).prefs || {})[user]) || {})[key] !== false;
function recipients(d) {
  const out = [];
  for (const [user, email] of Object.entries(d.emails || {})) {
    if (typeof email !== 'string' || !email.includes('@')) continue;
    const leagues = leaguesOf(d, user);
    if (leagues.length) out.push({user, email, leagues});
  }
  return out;
}
const picksOf = (d, lg, key, name) => ((((d.leagues[lg] || {}).picks || {})[key] || {})[name]) || {};
const winner = g => g.away.score > g.home.score ? g.away.abbr : g.home.score > g.away.score ? g.home.abbr : 'TIE';

/** Season standings for one database, ranked like the app: Pct, then point differential, then total correct. */
async function seasonTable(d, lg, season, weekGames) {
  const all = ((d.leagues[lg] || {}).picks) || {};
  const st = Object.keys(d.leagues[lg].profiles || {}).map(n => ({n, c: 0, l: 0, d: 0}));
  for (const key of Object.keys(all).filter(k => k.startsWith(season + '-') && k.split('-')[1] !== '1')) {   // preseason doesn't count
    const games = await weekGames(key);
    for (const s of st) {
      const p = (all[key] || {})[s.n] || {};
      for (const g of games) {
        if (g.state !== 'post' || !p[g.id]) continue;
        const w = winner(g); if (w === 'TIE') continue;
        if (p[g.id] === w) s.c++; else s.l++;
        const t = g.away.abbr === p[g.id] ? g.away : g.home.abbr === p[g.id] ? g.home : null;
        if (t) s.d += t.score - (t === g.away ? g.home : g.away).score;
      }
    }
  }
  const pct = s => s.c + s.l ? s.c / (s.c + s.l) : -1;
  return st.filter(s => s.c + s.l).sort((a, b) => pct(b) - pct(a) || b.d - a.d || b.c - a.c || a.n.localeCompare(b.n));
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const fmtPct = s => (s.c / (s.c + s.l)).toFixed(3).replace(/^0/, '');
const fmtDiff = s => (s.d > 0 ? '+' : '') + s.d;

function doneEmail(d, r, w, next, tables = {}) {
  const lines = [];
  for (const {lg, name} of r.leagues) {
    const tally = n => { let c = 0, l = 0; const p = picksOf(d, lg, w.key, n);
      for (const g of w.games) { if (!p[g.id]) continue; const win = winner(g); if (win === 'TIE') continue; if (p[g.id] === win) c++; else l++; } return {c, l}; };
    const me = tally(name), all = Object.keys(d.leagues[lg].profiles || {}).map(n => ({n, ...tally(n)}));
    const best = Math.max(0, ...all.map(x => x.c)), top = all.filter(x => x.c === best && best > 0).map(x => esc(x.n));
    lines.push(`<b>${esc(lg)}</b>: you went <b>${me.c}-${me.l}</b>.${top.length ? ` Week winner: <b>${top.join(', ')}</b> (${best} correct).` : ''}`);
    const table = tables[lg] || [], at = table.findIndex(x => x.n === name);
    if (table.length) lines.push(`Season standings${at >= 0 ? ` \u2014 you're <b>${ordinal(at + 1)}</b> of ${table.length}` : ''}: ` +
      table.slice(0, 5).map((x, i) => `${i + 1}. ${x.n === name ? '<b>' : ''}${esc(x.n)} ${fmtPct(x)} (${fmtDiff(x)})${x.n === name ? '</b>' : ''}`).join(' \u2022 '));
  }
  if (next && next.games.length) {
    const first = Math.min(...next.games.map(g => Date.parse(g.date)));
    lines.push(`<b>${esc(next.label)}</b> picks are open now. The first game kicks off <b>${esc(et(first))}</b>, and each pick locks at its game's kickoff.`);
  }
  return {subject: `${w.label} is final${next ? ` — make your ${next.label} picks` : ''}`, title: `${w.label} results are in`, lines};
}
// ---------------------------------------------------------------- settings (Admin tab > Emails & notifications)
// Stored under /settings/notify by the administrator; read on every run, so changes apply within 15 minutes.
export const DEFAULT_SETTINGS = {paused: false, resultsEmail: true, resultsPush: true, resultsDelayMin: 0,
  remindEmail: true, remindPush: true, leads: '2', everyGameDay: false, gamePush: true, note: '', fromName: "NFL Pick'Em"};
export function readSettings(raw) {
  const s = {...DEFAULT_SETTINGS}, r = raw && typeof raw === 'object' ? raw : {};
  for (const k of ['paused', 'resultsEmail', 'resultsPush', 'remindEmail', 'remindPush', 'everyGameDay', 'gamePush'])
    if (typeof r[k] === 'boolean') s[k] = r[k];
  if (Number.isFinite(+r.resultsDelayMin)) s.resultsDelayMin = Math.min(2880, Math.max(0, Math.round(+r.resultsDelayMin)));
  if (typeof r.leads === 'string') s.leads = r.leads;
  s.leadList = [...new Set(String(s.leads).split(',').map(Number).filter(x => x >= 0.25 && x <= 72))].sort((a, b) => b - a).slice(0, 4);
  if (typeof r.note === 'string') s.note = r.note.trim().slice(0, 400);
  if (typeof r.fromName === 'string' && r.fromName.trim()) s.fromName = r.fromName.trim().replace(/["<>\\\r\n]/g, '').slice(0, 40);
  return s;
}

const etDay = t => new Date(t).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});            // 2026-11-20
const etWeekday = t => new Date(t).toLocaleDateString('en-US', {timeZone: 'America/New_York', weekday: 'long'});
function untilText(ms) {
  const m = ms / 60000;
  if (m < 60) return `in about ${Math.max(5, Math.round(m / 5) * 5)} minutes`;
  if (m < 36 * 60) { const h = Math.round(m / 60); return `in about ${h} hour${h === 1 ? '' : 's'}`; }
  const dd = Math.round(m / 1440); return `in about ${dd} day${dd === 1 ? '' : 's'}`;
}
/** Reminders due now for a week: for each group (the whole week, or each game day), the closest reminder time that has arrived. */
function reminderSlots(w, s, t) {
  const groups = [];
  if (s.everyGameDay) {
    const by = {};
    for (const g of w.games) { const k = etDay(Date.parse(g.date)); (by[k] = by[k] || []).push(g); }
    for (const [day, gs] of Object.entries(by)) groups.push({tag: '-d' + day.replace(/-/g, ''), games: gs, perDay: true});
  } else groups.push({tag: '', games: w.games, perDay: false});
  const out = [];
  for (const gr of groups) {
    const first = Math.min(...gr.games.map(g => Date.parse(g.date)).filter(x => !isNaN(x)));
    const active = s.leadList.filter(L => t >= first - L * 3600e3 && t < first);
    if (!active.length) continue;
    const L = Math.min(...active);                              // a missed earlier reminder isn't sent late
    out.push({suffix: (L === 2 && !gr.tag ? '' : '-' + String(L).replace('.', '_') + 'h') + gr.tag, first, games: gr.games, perDay: gr.perDay});
  }
  return out;
}
function missingFor(d, leagues, w, slot, t) {
  const open = slot.games.filter(g => g.state === 'pre' && Date.parse(g.date) > t);
  return {open, per: leagues.map(({lg, name}) => { const p = picksOf(d, lg, w.key, name); return {lg, left: open.filter(g => !p[g.id]).length}; })};
}
function remindEmail(d, r, w, slot, t) {
  const {open, per} = missingFor(d, r.leagues, w, slot, t);
  if (!per.some(x => x.left)) return null;
  const which = slot.perDay ? `${etWeekday(slot.first)}'s first game` : `The first ${esc(w.label)} game`;
  const lines = [`${which} kicks off <b>${esc(et(slot.first))}</b>, ${untilText(slot.first - t)}. Picks lock at each game's kickoff.`];
  for (const x of per) lines.push(`<b>${esc(x.lg)}</b>: you've picked <b>${open.length - x.left} of ${open.length}</b> open games${x.left ? '' : ' ✔'}.`);
  const subject = slot.perDay ? `⏰ ${etWeekday(slot.first)}'s games start ${untilText(slot.first - t)}` : `⏰ ${w.label} picks lock ${untilText(slot.first - t)}`;
  return {subject, title: `Don't forget your ${w.label} picks`, lines};
}

/** Once a day: removes records nobody needs any more, so the database doesn't grow forever. */
async function tidyUp(q, kick, t, log) {
  const last = await q('GET', '/mail/cleaned').catch(() => null);
  if (last && t - last < 86400e3) return;
  try {
    const old = t - 60 * 86400e3;
    for (const [key, games] of Object.entries(kick || {})) {
      const times = Object.values(games || {}).filter(x => typeof x === 'number');
      if (times.length && Math.max(...times) < old) {
        // Kickoff times are kept: the database rules use them to keep old picks locked.
        for (const path of [`/mail/sent/${key}`, `/mail/final/${key}`]) await q('DELETE', path).catch(() => {});
      }
    }
    for (const [h, r] of Object.entries((await q('GET', '/resets')) || {})) if (!r || !(r.exp > t)) await q('DELETE', `/resets/${h}`);
    for (const [u, ts] of Object.entries((await q('GET', '/resetlog')) || {})) if (t - ts > 86400e3) await q('DELETE', `/resetlog/${u}`);
    for (const [id, e] of Object.entries((await q('GET', '/log')) || {})) if (!e || t - e.t > 180 * 86400e3) await q('DELETE', `/log/${id}`);
    await q('PUT', '/mail/cleaned', t);
    log('old records tidied up');
  } catch (e) { log('could not tidy up old records: ' + e.message); }
}

/** Loads everything a run needs. */
async function loadState(q) {
  const [access, emails, leagues, sent, kick, subs, settings, final, prefs] = await Promise.all(
    ['/access', '/emails', '/leagues', '/mail/sent', '/kickoffs', '/push', '/settings/notify', '/mail/final', '/prefs'].map(p => q('GET', p).catch(() => null)));
  const d = {access: access || {}, emails: emails || {}, leagues: leagues || {}, sent: sent || {}, prefs: prefs || {}};
  const phones = Object.entries(subs || {}).filter(([, s]) => s && Object.keys(s).length)
    .map(([user, s]) => ({user, subs: s, leagues: leaguesOf(d, user)})).filter(p => p.leagues.length);
  return {d, kick: kick || {}, phones, s: readSettings(settings), final: final || {}};
}

/** One pass of the schedule. Each message goes to each person at most once (recorded under /mail/sent). */
export async function runOnce({transport = mailer(), log = console.log} = {}) {
  const q = database(await signInMailer());
  const weeks = await nearbyWeeks();
  const {d, kick, phones, s, final} = await loadState(q);
  const people = recipients(d), t = now();
  const opts = {fromName: s.fromName, note: s.note};
  let count = 0;

  // Kickoff times, so the database refuses a pick (or a change to one) once its game has started.
  for (const w of weeks) {
    const have = kick[w.key] || {}, changed = {};
    for (const g of w.games) { const k = Date.parse(g.date); if (!isNaN(k) && have[g.id] !== k) changed[g.id] = k; }
    if (Object.keys(changed).length) {
      try { await q('PATCH', `/kickoffs/${w.key}`, changed); log(`kickoff times saved for ${w.label}`); }
      catch (e) { log(`could not save kickoff times for ${w.label}: ${e.message}`); }
    }
  }
  await tidyUp(q, kick, t, log);
  if (s.paused) { log('emails and notifications are paused (Admin tab)'); return 0; }

  // Games for any week, for season standings (fetched once per run)
  const cache = new Map(weeks.map(w => [w.key, w.games]));
  const weekGames = async key => {
    if (!cache.has(key)) {
      const [yr, type, week] = key.split('-');
      try { const j = await espn(`&dates=${yr}&seasontype=${type}&week=${week}`); cache.set(key, (j.events || []).map(parseGame)); }
      catch (e) { cache.set(key, []); }
    }
    return cache.get(key);
  };
  const tableCache = {};
  const tablesFor = async (leagues, season) => {
    const out = {};
    for (const {lg} of leagues) out[lg] = tableCache[lg] || (tableCache[lg] = await seasonTable(d, lg, season, weekGames));
    return out;
  };
  const was = (key, kind, user) => !!(((d.sent[key] || {})[kind] || {})[user]);
  const mark = (key, kind, user) => q('PUT', `/mail/sent/${key}/${kind}/${user}`, t);
  const keys = await vapidKeys(q, {create: true});              // created once, so phones can subscribe
  const canPush = !!(keys && phones.length);

  for (const w of weeks) {
    if (!w.games.length || w.pre) continue;                     // no emails or notifications for the preseason
    const times = w.games.map(g => Date.parse(g.date)).filter(x => !isNaN(x));
    const last = Math.max(...times);

    // ---- the week is final (after the chosen delay)
    if (w.games.every(g => g.state === 'post') && t - last < 4 * 86400e3) {
      let seen = final[w.key];
      if (!seen) { seen = t; await q('PUT', `/mail/final/${w.key}`, t).catch(() => {}); }
      if (t - seen >= s.resultsDelayMin * 60000) {
        const next = weeks.find(x => x.i === w.i + 1);
        if (s.resultsEmail) for (const r of people) {
          if (was(w.key, 'done', r.user) || !wants(d, r.user, 'resultsEmail')) continue;
          const msg = doneEmail(d, r, w, next, await tablesFor(r.leagues, w.key.split('-')[0]));
          try { await send(transport, r.email, msg.subject, msg.title, msg.lines, opts); await mark(w.key, 'done', r.user); count++; log(`sent results for ${w.label} to ${r.user}`); }
          catch (e) { log(`could not send results for ${w.label} to ${r.user}: ${e.message}`); }
        }
        if (s.resultsPush && canPush) for (const p of phones) {
          if (was(w.key, 'pushdone', p.user) || !wants(d, p.user, 'resultsPush')) continue;
          const {lg, name} = p.leagues[0], pk = picksOf(d, lg, w.key, name);
          let c = 0, l = 0;
          for (const g of w.games) { if (!pk[g.id]) continue; const win = winner(g); if (win === 'TIE') continue; if (pk[g.id] === win) c++; else l++; }
          if (!c && !l) continue;
          const n = await pushTo(q, keys, p.user, p.subs, {title: `${w.label} is final`, body: `You went ${c}-${l}. Open Pick'Em for the standings.`, url: appUrl()}, log);
          if (n) { await mark(w.key, 'pushdone', p.user); count += n; }
        }
      }
    }

    // ---- reminders before kickoff
    for (const slot of reminderSlots(w, s, t)) {
      if (s.remindEmail) for (const r of people) {
        const kind = 'remind' + slot.suffix;
        if (was(w.key, kind, r.user) || !wants(d, r.user, 'remindEmail')) continue;
        const msg = remindEmail(d, r, w, slot, t);
        if (!msg) continue;
        try { await send(transport, r.email, msg.subject, msg.title, msg.lines, opts); await mark(w.key, kind, r.user); count++; log(`sent ${kind} for ${w.label} to ${r.user}`); }
        catch (e) { log(`could not send ${kind} for ${w.label} to ${r.user}: ${e.message}`); }
      }
      if (s.remindPush && canPush) for (const p of phones) {
        const kind = 'pushremind' + slot.suffix;
        if (was(w.key, kind, p.user) || !wants(d, p.user, 'remindPush')) continue;
        const {per} = missingFor(d, p.leagues, w, slot, t), missing = Math.max(0, ...per.map(x => x.left));
        if (!missing) continue;
        const n = await pushTo(q, keys, p.user, p.subs, {title: slot.perDay ? `⏰ ${etWeekday(slot.first)}'s games start ${untilText(slot.first - t)}` : `⏰ ${w.label} picks lock soon`,
          body: `You still have ${missing} game${missing === 1 ? '' : 's'} to pick. First kickoff ${et(slot.first)}.`, url: appUrl()}, log);
        if (n) { await mark(w.key, kind, p.user); count += n; log(`notified ${p.user}: ${kind} ${w.label}`); }
      }
    }

    // ---- the result of each game you picked
    if (s.gamePush && canPush) for (const g of w.games) {
      if (g.state !== 'post' || t - Date.parse(g.date) > 12 * 3600e3) continue;   // games that finished recently
      const win = winner(g), kind = 'g' + g.id;
      for (const p of phones) {
        if (was(w.key, kind, p.user) || !wants(d, p.user, 'gamePush')) continue;
        const pick = p.leagues.map(({lg, name}) => picksOf(d, lg, w.key, name)[g.id]).find(Boolean);
        if (!pick) continue;
        const right = pick === win, score = `${g.away.abbr} ${g.away.score} – ${g.home.score} ${g.home.abbr}`;
        const title = win === 'TIE' ? `${score}: a tie` : right ? `✅ Your pick ${pick} won` : `❌ Your pick ${pick} lost`;
        const n = await pushTo(q, keys, p.user, p.subs, {title, body: `Final: ${score}`, url: appUrl()}, log);
        if (n) { await mark(w.key, kind, p.user); count += n; log(`notified ${p.user}: result of ${score}`); }
      }
    }
  }
  try { count += await runCfp({q, d, people, phones, keys: canPush ? keys : null, opts, transport, log, t, was, mark}); }
  catch (e) { log('CFP bracket step failed: ' + e.message); }
  return count;
}

/** Admin tab "Send a reminder now": everyone still missing picks for the next games gets an email and/or a
 *  notification right away (whichever channels are turned on). Not recorded, so scheduled reminders still go out. */
export async function remindNow({transport = mailer(), log = console.log} = {}) {
  const q = database(await signInMailer());
  const weeks = await nearbyWeeks(), t = now();
  const {d, phones, s} = await loadState(q);
  const w = weeks.find(x => !x.pre && x.games.some(g => g.state === 'pre' && Date.parse(g.date) > t));
  if (!w) return {emails: 0, phones: 0, week: null};
  const open = w.games.filter(g => g.state === 'pre' && Date.parse(g.date) > t);
  const slot = {suffix: '-now', first: Math.min(...open.map(g => Date.parse(g.date))), games: open, perDay: false};
  let emails = 0, pushes = 0;
  if (s.remindEmail) for (const r of recipients(d)) {
    if (!wants(d, r.user, 'remindEmail')) continue;
    const msg = remindEmail(d, r, w, slot, t);
    if (!msg) continue;
    try { await send(transport, r.email, msg.subject, msg.title, msg.lines, {fromName: s.fromName, note: s.note}); emails++; }
    catch (e) { log(`could not send reminder to ${r.user}: ${e.message}`); }
  }
  const keys = s.remindPush && phones.length ? await vapidKeys(q, {create: true}) : null;
  if (keys) for (const p of phones) {
    if (!wants(d, p.user, 'remindPush')) continue;
    const missing = Math.max(0, ...missingFor(d, p.leagues, w, slot, t).per.map(x => x.left));
    if (!missing) continue;
    pushes += await pushTo(q, keys, p.user, p.subs, {title: `⏰ ${w.label} picks`, body: `You still have ${missing} game${missing === 1 ? '' : 's'} to pick. Next kickoff ${et(slot.first)}.`, url: appUrl()}, log);
  }
  return {emails, phones: pushes, week: w.label};
}

/** Adds a line to the administrator's activity log (Admin tab). Never throws. */
export async function logEvent(q, who, what) {
  try { await q('POST', '/log', {t: Date.now(), who: String(who).slice(0, 40), what: String(what).slice(0, 300)}); } catch (e) { /* the log is best effort */ }
}

// ---------------------------------------------------------------- CFP bracket
export const CFP_DEFAULTS = {on: true, scoring: 'A', remind: true, rounds: true};
export const readCfpSettings = v => ({...CFP_DEFAULTS, ...(v && typeof v === 'object' ? v : {})});
const fullBracket = b => !!b && ORDER.every(k => (b.p || {})[k]);

/** The bracket announcement, the reminder a day before the lock, and a notification after each round. */
async function runCfp({q, d, people, phones, keys, opts, transport, log, t, was, mark}) {
  const cs = readCfpSettings(await q('GET', '/settings/cfp').catch(() => null));
  if (!cs.on) return 0;
  const season = cfpSeason(t), key = `cfp-${season}`;
  const r = await fetch(`${CFB()}/scoreboard?dates=${season}&seasontype=3&limit=200&groups=80`);
  if (!r.ok) throw new Error('ESPN HTTP ' + r.status);
  const br = bracketFrom((await r.json()).events);
  if (!br.set || !br.lock) return 0;
  if ((await q('GET', `/cfp/${season}/lock`).catch(() => null)) !== br.lock) {
    await q('PUT', `/cfp/${season}/lock`, br.lock); log(`CFP bracket lock saved: ${et(br.lock)}`);
  }
  const url = appUrl() + '/?cfp=1';
  let count = 0;
  const email = async (kind, who, subject, title, lines) => {
    if (was(key, kind, who.user) || !wants(d, who.user, 'cfpEmail')) return;
    try { await send(transport, who.email, subject, title, lines, opts); await mark(key, kind, who.user); count++; log(`sent CFP ${kind} to ${who.user}`); }
    catch (e) { log(`could not send CFP ${kind} to ${who.user}: ${e.message}`); }
  };
  const push = async (kind, ph, msg) => {
    if (!keys || was(key, kind, ph.user) || !wants(d, ph.user, 'cfpPush')) return;
    const n = await pushTo(q, keys, ph.user, ph.subs, {...msg, url}, log);
    if (n) { await mark(key, kind, ph.user); count += n; }
  };
  const button = `<a href="${url}" style="color:#ffc53d">Fill out your bracket</a>`;

  // ---- the bracket is set
  if (t < br.lock) {
    const top = [1, 2, 3, 4].map(n => br.seeds[n]).filter(Boolean).map(x => `${esc(x.name)}`).join(', ');
    for (const who of people) await email('announce', who, 'The CFP bracket is set: make your picks', 'Pick your CFP bracket',
      [`The College Football Playoff bracket is out. The top four seeds: <b>${top}</b>.`,
       `Pick every game through the national championship on the <b>CFP</b> page of Pick'Em. Brackets lock at the first kickoff, <b>${esc(et(br.lock))}</b>.`, button]);
    for (const ph of phones) await push('pushannounce', ph, {title: '🏈 The CFP bracket is set', body: `Pick your bracket before ${et(br.lock)}.`});
  }

  const brackets = (await q('GET', `/cfp/${season}/brackets`).catch(() => null)) || {};
  const bracketOf = (lg, name) => ((brackets[lg] || {})[name]) || null;

  // ---- a day before the lock, to anyone who hasn't finished
  if (cs.remind && t >= br.lock - 24 * 3600e3 && t < br.lock) {
    const missing = who => who.leagues.some(({lg, name}) => !fullBracket(bracketOf(lg, name)));
    for (const who of people) if (missing(who)) await email('remind', who, 'Your CFP bracket locks tomorrow', 'Finish your CFP bracket',
      [`Your College Football Playoff bracket isn't finished. Picks lock at the first kickoff, <b>${esc(et(br.lock))}</b>.`, button]);
    for (const ph of phones) if (missing(ph)) await push('pushremind', ph, {title: '⏰ Your CFP bracket locks soon', body: `Finish it before ${et(br.lock)}.`});
  }

  // ---- after each round: your points and place
  if (cs.rounds) for (let rd = 0; rd < 4; rd++) {
    if (!br.roundsDone[rd]) continue;
    const ends = br.games.filter(g => g.round === rd).map(g => Date.parse(g.date));
    if (!ends.length || t - Math.max(...ends) > 3 * 86400e3) continue;
    for (const ph of phones) {
      const {lg, name} = ph.leagues.find(x => bracketOf(x.lg, x.name)) || {};
      if (!lg) continue;
      const board = leaderboard(br, brackets[lg], cs.scoring), me = board.find(x => x.name === name);
      if (!me) continue;
      const place = `${ordinal(me.rank)} of ${board.length}`;
      await push('pushround' + rd, ph, rd === 3
        ? {title: me.rank === 1 ? '🏆 You won the CFP bracket!' : `🏈 CFP bracket final: ${place}`, body: `${me.pts} points. Winner: ${board.filter(x => x.rank === 1).map(x => x.name).join(', ')}.`}
        : {title: `🏈 CFP ${ROUND_NAMES[rd]} done`, body: `You have ${me.pts} points (${place}). ${me.max - me.pts} more still possible.`});
    }
  }
  return count;
}
export {SCORING as CFP_SCORING};

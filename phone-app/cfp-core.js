// College Football Playoff bracket: shared by the web app (loaded when the CFP page opens) and the
// Netlify email job. Everything comes from ESPN's college football postseason schedule.
//
// The 12-team bracket is fixed by seed:
//   First round  r1: 8 v 9    r2: 5 v 12   r3: 6 v 11   r4: 7 v 10
//   Quarterfinal q1: 1 v r1   q2: 4 v r2   q3: 3 v r3   q4: 2 v r4
//   Semifinal    s1: q1 v q2  s2: q3 v q4
//   Final        f:  s1 v s2
// ESPN lists each playoff team with its seed (curatedRank) in these games.

export const ESPN_CFB = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
export const SLOTS = {
  r1: [8, 9], r2: [5, 12], r3: [6, 11], r4: [7, 10],
  q1: [1, 'r1'], q2: [4, 'r2'], q3: [3, 'r3'], q4: [2, 'r4'],
  s1: ['q1', 'q2'], s2: ['q3', 'q4'], f: ['s1', 's2']};
export const ORDER = ['r1', 'r2', 'r3', 'r4', 'q1', 'q2', 'q3', 'q4', 's1', 's2', 'f'];
export const ROUND_NAMES = ['First Round', 'Quarterfinals', 'Semifinals', 'National Championship'];
export const roundOf = slot => ({r: 0, q: 1, s: 2, f: 3})[slot[0]];

export const SCORING = {
  A: {name: 'Classic doubling', about: '1 / 2 / 4 / 8 points per correct pick, by round'},
  B: {name: 'Flat', about: '1 point per correct pick'},
  C: {name: 'Gentle ramp', about: '1 / 2 / 3 / 5 points per correct pick, by round'},
  D: {name: 'Upset bonus', about: '1 / 2 / 4 / 8, plus the seed difference when a lower seed wins'},
  E: {name: 'Seed multiplier', about: '1 / 2 / 4 / 8 times the winning team’s seed'}};
const BASE = {A: [1, 2, 4, 8], B: [1, 1, 1, 1], C: [1, 2, 3, 5], D: [1, 2, 4, 8], E: [1, 2, 4, 8]};
/** Points for a correct pick. loserSeed may be unknown (null) when working out the most still possible. */
export function points(scheme, round, winSeed, loserSeed) {
  const s = BASE[scheme] ? scheme : 'A', base = BASE[s][round];
  if (s === 'D') return base + (loserSeed && winSeed > loserSeed ? winSeed - loserSeed : 0);
  if (s === 'E') return base * (winSeed || 1);
  return base;
}

/** The college football season a date belongs to (the playoff runs into January). */
export const cfpSeason = (t = Date.now()) => { const d = new Date(t); return d.getMonth() < 7 ? d.getFullYear() - 1 : d.getFullYear(); };

/** Playoff games from an ESPN postseason scoreboard: {id, round, date, state, detail, teams: [...]}. */
export function playoffGames(events) {
  const out = [];
  for (const ev of events || []) {
    const c = (ev.competitions || [])[0] || {};
    const head = (c.notes || []).map(n => n.headline || '').join(' '), note = head + ' ' + (ev.name || '');
    if (!/college football playoff/i.test(note)) continue;
    const round = /first round/i.test(note) ? 0 : /quarterfinal/i.test(note) ? 1 : /semifinal/i.test(note) ? 2 : /national championship/i.test(note) ? 3 : -1;
    if (round < 0) continue;
    const st = (ev.status && ev.status.type) || {};
    let state = st.state || 'pre';
    if (state === 'post' && st.completed === false) state = 'pre';
    const bowl = (head.match(/at the (.+?)(?: Presented by| presented by|$)/) || [])[1] || '';
    out.push({id: String(ev.id), round, date: ev.date, state, detail: st.shortDetail || '', bowl: bowl.trim(),
      teams: (c.competitors || []).map(x => {
        const t = x.team || {}, seed = (x.curatedRank || {}).current;
        const known = !!t.id && +t.id > 0 && !/^tbd$/i.test(t.displayName || t.abbreviation || '');
        return known ? {id: String(t.id), abbr: t.abbreviation || '', name: t.shortDisplayName || t.displayName || '', logo: t.logo || '',
          color: t.color ? '#' + t.color : '#334155', seed: seed >= 1 && seed <= 12 ? seed : null, score: parseInt(x.score, 10) || 0, home: x.homeAway === 'home'} : null;
      }).filter(Boolean)});
  }
  return out.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * The bracket: teams by seed, when it locks (first kickoff), and each slot's real game and winner.
 * set is true once all 12 teams are placed.
 */
export function bracketFrom(events) {
  const games = playoffGames(events), seeds = {}, teams = {};
  for (const g of games) for (const t of g.teams) { teams[t.id] = t; if (t.seed && g.round <= 1) seeds[t.seed] = t; }
  const set = Object.keys(seeds).length === 12;
  const first = games.filter(g => g.round === 0).map(g => Date.parse(g.date)).filter(x => !isNaN(x));
  const lock = first.length ? Math.min(...first) : null;
  const slot = {};                                   // slot -> {game, a, b, winner}: a and b are team ids (or null)
  const side = s => typeof s === 'number' ? (seeds[s] || {}).id || null : (slot[s] || {}).winner || null;
  for (const k of ORDER) {
    const [x, y] = SLOTS[k], a = side(x), b = side(y);
    const game = a && b ? games.find(g => g.round === roundOf(k) && g.teams.some(t => t.id === a) && g.teams.some(t => t.id === b))
      : games.find(g => g.round === roundOf(k) && g.teams.some(t => t.id === (a || b)) && (a || b)) || null;
    let winner = null;
    if (game && game.state === 'post' && game.teams.length === 2 && a && b) {
      const [p, q] = game.teams; if (p.score !== q.score) winner = p.score > q.score ? p.id : q.id;
    }
    slot[k] = {game: game || null, a, b, winner};
  }
  const roundsDone = [0, 1, 2, 3].map(r => ORDER.filter(k => roundOf(k) === r).every(k => slot[k].winner));
  const fin = slot.f.game && slot.f.winner ? slot.f.game.teams.reduce((n, t) => n + t.score, 0) : null;
  return {games, seeds, teams, set, lock, slot, roundsDone, finalTotal: fin};
}

/** Each pick's teams in someone's bracket: the two teams they have meeting in a slot. */
export function pickedSides(br, picks) {
  const out = {};
  const side = s => typeof s === 'number' ? (br.seeds[s] || {}).id || null : (picks || {})[s] || null;
  for (const k of ORDER) { const [x, y] = SLOTS[k]; out[k] = [side(x), side(y)]; }
  return out;
}

/** Clears later picks that no longer make sense after a change (a team that isn't in that game any more). */
export function tidyPicks(br, picks) {
  const p = {...(picks || {})};
  for (const k of ORDER) { const sides = pickedSides(br, p)[k]; if (p[k] && !sides.includes(p[k])) delete p[k]; }
  return p;
}

/** Score one bracket: points so far, most still possible, and how each slot went. */
export function scoreBracket(br, picks, scheme) {
  const p = picks || {}, out = {pts: 0, max: 0, right: 0, wrong: 0, by: {}, champ: p.f || null, done: ORDER.every(k => p[k])};
  const seedOf = id => (br.teams[id] || {}).seed || null;
  const out_ = new Set();                             // teams already knocked out
  for (const k of ORDER) { const s = br.slot[k]; if (s.winner) out_.add(s.winner === s.a ? s.b : s.a); }
  for (const k of ORDER) {
    const s = br.slot[k], pick = p[k], r = roundOf(k);
    if (!pick) { out.by[k] = 'none'; continue; }
    if (s.winner) {
      if (s.winner === pick) { const v = points(scheme, r, seedOf(pick), seedOf(s.winner === s.a ? s.b : s.a)); out.pts += v; out.max += v; out.right++; out.by[k] = 'right'; }
      else { out.wrong++; out.by[k] = 'wrong'; }
    } else if (out_.has(pick)) out.by[k] = 'dead';
    else { out.max += points(scheme, r, seedOf(pick), null); out.by[k] = 'open'; }
  }
  return out;
}

/** Leaderboard: points, then most still possible, then closest title-game total, then name. */
export function leaderboard(br, brackets, scheme) {
  const rows = Object.entries(brackets || {}).map(([name, b]) => {
    const s = scoreBracket(br, (b || {}).p, scheme), tb = typeof (b || {}).tb === 'number' ? b.tb : null;
    return {name, ...s, tb, off: br.finalTotal !== null && tb !== null ? Math.abs(tb - br.finalTotal) : null};
  });
  rows.sort((a, b) => b.pts - a.pts || b.max - a.max || (a.off ?? 1e9) - (b.off ?? 1e9) || a.name.localeCompare(b.name));
  let rank = 0;
  rows.forEach((r, i) => { const q = rows[i - 1]; if (!q || q.pts !== r.pts || q.max !== r.max || q.off !== r.off) rank = i + 1; r.rank = rank; });
  return rows;
}

// ---------------------------------------------------------------- projected bracket ("if the season ended today")
// The 12-team field: the five highest-ranked conference champions get in, plus the next seven highest-ranked
// teams. Before the title games, each conference's highest-ranked team is treated as its champion. The 12 are
// seeded in ranking order (straight seeding, as since 2025). Independents (Notre Dame) can't be champions.

/** Conference of every FBS team, from ESPN's standings: {teamId: {key, name}}. */
export function confMapFrom(standings) {
  const out = {};
  const walk = (c, conf) => {
    const me = conf || {key: c.abbreviation || c.name || '', name: c.shortName || c.abbreviation || c.name || ''};
    for (const e of ((c.standings || {}).entries) || []) if (e.team && e.team.id) out[String(e.team.id)] = me;
    for (const k of c.children || []) walk(k, me);
  };
  for (const c of (standings && standings.children) || []) walk(c, null);
  return out;
}
const isConference = c => !!c && !!c.key && !/^ind/i.test(c.key);

/** Each conference's best team by overall record (then point differential): its likely champion when
 *  no team from it is ranked. {confKey: team} */
export function confLeadersFrom(standings) {
  const best = {};
  const walk = (c, conf) => {
    const me = conf || {key: c.abbreviation || c.name || '', name: c.shortName || c.abbreviation || c.name || ''};
    for (const e of ((c.standings || {}).entries) || []) {
      const t = e.team || {}, st = {};
      for (const x of e.stats || []) if (!(x.name in st)) st[x.name] = x.displayValue;   // the first block is the overall record
      const [w, l] = String(st.overall || '0-0').split('-').map(Number), pct = w + l ? w / (w + l) : 0, diff = parseInt(st.pointDifferential, 10) || 0;
      const logo = ((t.logos || [])[0] || {}).href || '';
      const cand = {id: String(t.id), abbr: t.abbreviation || '', name: t.location || t.shortDisplayName || t.displayName || '', logo, color: '#334155', rank: null, rec: st.overall || '', conf: me.name, pct, diff};
      const cur = best[me.key];
      if (isConference(me) && (!cur || pct > cur.pct || (pct === cur.pct && diff > cur.diff))) best[me.key] = cand;
    }
    for (const k of c.children || []) walk(k, me);
  };
  for (const c of (standings && standings.children) || []) walk(c, null);
  return best;
}

/** A ranking entry as a bracket team. */
export function rankedTeam(r) {
  const t = r.team || {}, logo = ((t.logos || []).find(l => (l.rel || []).includes('default')) || (t.logos || [])[0] || {}).href || '';
  return {id: String(t.id), abbr: t.abbreviation || '', name: t.location || t.nickname || t.name || '', logo, color: t.color ? '#' + t.color : '#334155', rank: r.current, rec: r.recordSummary || ''};
}

/** The projected field from a Top 25: {field: [12 teams with seed, conf, auto], out: [next four], bumped, champs}.
 *  leaders (optional, from confLeadersFrom) fill the five champion spots when fewer than five champions are ranked. */
export function projectField(ranks, confs, leaders) {
  const list = [...(ranks || [])].sort((a, b) => a.current - b.current).map(rankedTeam);
  const seen = new Set(), champs = [];
  for (const t of list) {
    const c = (confs || {})[t.id];
    t.conf = c ? c.name : '';
    if (isConference(c) && !seen.has(c.key)) { seen.add(c.key); champs.push(t); t.champ = true; }
  }
  const auto = champs.slice(0, 5);
  if (auto.length < 5 && leaders) {                   // the best champions of conferences with nobody ranked
    const have = new Set(list.map(t => ((confs || {})[t.id] || {}).key).filter(Boolean));
    const extra = Object.entries(leaders).filter(([k, t]) => !have.has(k) && !list.some(x => x.id === t.id)).map(([, t]) => ({...t, champ: true}))
      .sort((a, b) => b.pct - a.pct || b.diff - a.diff);
    auto.push(...extra.slice(0, 5 - auto.length));
  }
  auto.forEach(t => { t.auto = true; });
  const field = [...auto];
  for (const t of list) { if (field.length >= 12) break; if (!field.includes(t)) field.push(t); }
  field.sort((a, b) => (a.rank || 99) - (b.rank || 99)).forEach((t, i) => { t.seed = i + 1; });
  const rest = list.filter(t => !field.includes(t));
  return {field, out: rest.slice(0, 4), bumped: list.slice(0, 12).filter(t => !field.includes(t)), champs: auto.length};
}

/** A bracket (same shape as bracketFrom) for a projected field: first-round games and byes, nothing played. */
export function projectedBracket(field) {
  const seeds = {}, teams = {};
  for (const t of field) { seeds[t.seed] = t; teams[t.id] = t; }
  const slot = {};
  for (const k of ORDER) {
    const [x, y] = SLOTS[k], side = s => typeof s === 'number' ? (seeds[s] || {}).id || null : null;
    slot[k] = {game: null, a: side(x), b: side(y), winner: null};
  }
  return {games: [], seeds, teams, set: field.length === 12, projected: true, lock: null, slot, roundsDone: [false, false, false, false], finalTotal: null};
}

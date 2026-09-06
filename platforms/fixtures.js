const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data');
const CACHE_PATH = path.join(CACHE_DIR, 'suggested-fixtures.json');

/** ESPN soccer league slugs — public scoreboard API, no key needed */
const ESPN_LEAGUES = [
  { slug: 'eng.1', name: 'Premier League', short: 'EPL' },
  { slug: 'esp.1', name: 'La Liga', short: 'La Liga' },
  { slug: 'ita.1', name: 'Serie A', short: 'Serie A' },
  { slug: 'ger.1', name: 'Bundesliga', short: 'Bundesliga' },
  { slug: 'fra.1', name: 'Ligue 1', short: 'Ligue 1' },
  { slug: 'uefa.champions', name: 'UEFA Champions League', short: 'UCL' },
  { slug: 'uefa.europa', name: 'UEFA Europa League', short: 'UEL' },
];

const BIG_CLUBS = new Set(
  [
    'Arsenal',
    'Chelsea',
    'Liverpool',
    'Manchester City',
    'Manchester United',
    'Tottenham',
    'Tottenham Hotspur',
    'Newcastle United',
    'Aston Villa',
    'West Ham United',
    'Everton',
    'Brighton',
    'Brighton & Hove Albion',
    'Crystal Palace',
    'Wolverhampton Wanderers',
    'Wolves',
    'Nottingham Forest',
    'Fulham',
    'Brentford',
    'Bournemouth',
    'Leicester City',
    'Barcelona',
    'Real Madrid',
    'Atletico Madrid',
    'Atlético Madrid',
    'Sevilla',
    'Villarreal',
    'Real Sociedad',
    'Athletic Club',
    'Real Betis',
    'Inter',
    'Internazionale',
    'Inter Milan',
    'AC Milan',
    'Milan',
    'Juventus',
    'Napoli',
    'Roma',
    'AS Roma',
    'Lazio',
    'Fiorentina',
    'Atalanta',
    'Bayern Munich',
    'Bayern München',
    'Borussia Dortmund',
    'RB Leipzig',
    'Bayer Leverkusen',
    'Eintracht Frankfurt',
    'Paris Saint Germain',
    'Paris Saint-Germain',
    'Marseille',
    'Monaco',
    'Lyon',
    'Lille',
    'Ajax',
    'PSV',
    'PSV Eindhoven',
    'Feyenoord',
    'Benfica',
    'Porto',
    'FC Porto',
    'Sporting CP',
    'Celtic',
    'Rangers',
    'Galatasaray',
  ].map((s) => s.toLowerCase())
);

const DERBIES = [
  ['arsenal', 'chelsea'],
  ['arsenal', 'tottenham'],
  ['liverpool', 'everton'],
  ['liverpool', 'manchester united'],
  ['manchester city', 'manchester united'],
  ['manchester united', 'everton'],
  ['chelsea', 'tottenham'],
  ['barcelona', 'real madrid'],
  ['barcelona', 'espanyol'],
  ['real madrid', 'atletico'],
  ['inter', 'milan'],
  ['juventus', 'milan'],
  ['juventus', 'inter'],
  ['roma', 'lazio'],
  ['borussia dortmund', 'schalke'],
  ['bayern', 'dortmund'],
  ['celtic', 'rangers'],
  ['benfica', 'porto'],
  ['benfica', 'sporting'],
  ['porto', 'sporting'],
  ['marseille', 'paris'],
];

/** Keep any match with a big club, any UCL game, or a decent score */
const INTERESTING_MIN = 25;

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function espnDateParam(d) {
  return todayKey(d).replace(/-/g, '');
}

function isBig(name) {
  const n = String(name || '').toLowerCase();
  if (BIG_CLUBS.has(n)) return true;
  for (const club of BIG_CLUBS) {
    if (n.includes(club) || club.includes(n)) return true;
  }
  return false;
}

function isDerby(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  return DERBIES.some(([p, q]) => {
    const hit = (n, k) => n.includes(k) || k.includes(n);
    return (hit(x, p) && hit(y, q)) || (hit(x, q) && hit(y, p));
  });
}

function scoreMatch(home, away, leagueShort) {
  let score = 0;
  if (leagueShort === 'UCL') score += 45;
  if (leagueShort === 'UEL') score += 20;
  if (leagueShort === 'EPL') score += 10; // keep Premier League fixtures visible vs midweek UCL noise
  if (isBig(home)) score += 25;
  if (isBig(away)) score += 25;
  if (isBig(home) && isBig(away)) score += 25;
  if (isDerby(home, away)) score += 40;
  return score;
}

function whyInteresting(home, away, leagueShort, score) {
  const reasons = [];
  if (leagueShort === 'UCL') reasons.push('Champions League night');
  if (leagueShort === 'UEL') reasons.push('Europa League');
  if (isDerby(home, away)) reasons.push('derby');
  if (isBig(home) && isBig(away)) reasons.push('big-club clash');
  else if (isBig(home) || isBig(away)) reasons.push('marquee team');
  if (!reasons.length) reasons.push('solid watch');
  if (score >= 80) reasons.push('top pick');
  return reasons.join(' · ');
}

async function fetchEspnScoreboard(slug, dateKeyYmd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(
    slug
  )}/scoreboard?dates=${encodeURIComponent(dateKeyYmd)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'UCL-Simulator/1.0',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`ESPN ${slug} HTTP ${res.status}`);
  return res.json();
}

function parseEspnEvents(data, league) {
  const out = [];
  for (const ev of data?.events || []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const competitors = comp.competitors || [];
    const homeSide = competitors.find((c) => c.homeAway === 'home');
    const awaySide = competitors.find((c) => c.homeAway === 'away');
    const home = homeSide?.team?.displayName || homeSide?.team?.name;
    const away = awaySide?.team?.displayName || awaySide?.team?.name;
    if (!home || !away) continue;
    const kickoff = ev.date || comp.date || null;
    const when = kickoff ? new Date(kickoff) : null;
    if (!when || Number.isNaN(when.getTime())) continue;
    const score = scoreMatch(home, away, league.short);
    out.push({
      id: String(ev.id || `${league.short}-${home}-${away}-${todayKey(when)}`),
      league: league.short,
      leagueName: league.name,
      home,
      away,
      kickoff: when.toISOString(),
      kickoffLocal: when.toISOString(),
      time: when.toISOString().slice(11, 16),
      venue: comp.venue?.fullName || null,
      status: comp.status?.type?.description || comp.status?.type?.detail || null,
      score,
      why: whyInteresting(home, away, league.short, score),
      label: `${home} vs ${away}`,
    });
  }
  return out;
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(payload) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2));
}

function buildDays(matches, fromDate) {
  const startKey = todayKey(fromDate);
  const start = new Date(`${startKey}T00:00:00Z`);
  const end = addDays(start, 5);
  const byDay = new Map();
  for (let i = 0; i < 5; i++) {
    byDay.set(todayKey(addDays(start, i)), []);
  }

  for (const m of matches) {
    const when = new Date(m.kickoff);
    if (Number.isNaN(when.getTime()) || when < start || when >= end) continue;
    const key = todayKey(when);
    if (!byDay.has(key)) continue;
    byDay.get(key).push(m);
  }

  return [...byDay.entries()].map(([date, list]) => {
    list.sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.kickoff).localeCompare(String(b.kickoff)));
    // Keep marquee / UCL games — any match with a big club (score >= 25), not only top derbies
    const strong = list.filter(
      (m) => (m.score || 0) >= INTERESTING_MIN || m.league === 'UCL'
    );
    const picks = (strong.length ? strong : list).slice(0, 10);
    return {
      date,
      label: new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }),
      matches: picks,
    };
  });
}

async function fetchEspnWindow() {
  const byId = new Map();
  const start = new Date();
  for (let i = 0; i < 5; i++) {
    const day = addDays(start, i);
    const ymd = espnDateParam(day);
    for (const league of ESPN_LEAGUES) {
      try {
        const data = await fetchEspnScoreboard(league.slug, ymd);
        for (const m of parseEspnEvents(data, league)) {
          const prev = byId.get(m.id);
          if (!prev || (m.score || 0) >= (prev.score || 0)) byId.set(m.id, m);
        }
      } catch (err) {
        console.warn(`Fixtures ESPN ${league.short} ${ymd}:`, err.message);
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  return [...byId.values()];
}

/**
 * Optional Gemini polish: re-rank / rewrite "why" from real ESPN matches.
 * Never invents fixtures — only annotates the ESPN list.
 */
async function polishWithGemini(days) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { days, ai: false };

  const flat = days.flatMap((d) =>
    (d.matches || []).map((m) => ({
      date: d.date,
      home: m.home,
      away: m.away,
      league: m.league,
      kickoff: m.kickoff,
      id: m.id,
    }))
  );
  if (!flat.length) return { days, ai: false };

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const prompt = `You help football fans pick interesting matches to watch / recreate.

Today is ${todayKey()}. Below is a REAL fixture list (do not add or invent matches).

Return ONLY JSON:
{"picks":[{"id":"...","why":"short reason under 80 chars","interesting":true|false}]}

Mark interesting=true for derbies, big clubs, Champions League, title races, rivalry games.
Keep why punchy for social creators.

FIXTURES:
${JSON.stringify(flat)}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim());
    const map = new Map();
    for (const p of parsed?.picks || []) {
      if (p?.id) map.set(String(p.id), p);
    }
    if (!map.size) return { days, ai: false };

    const next = days.map((day) => {
      const matches = (day.matches || [])
        .map((m) => {
          const p = map.get(m.id);
          if (!p) return m;
          return {
            ...m,
            why: p.why || m.why,
            score: p.interesting === false ? Math.min(m.score, 35) : Math.max(m.score, 70),
          };
        })
        .filter((m) => (m.score || 0) >= INTERESTING_MIN || m.league === 'UCL')
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 10);
      return { ...day, matches };
    });
    return { days: next, ai: true };
  } catch (err) {
    console.warn('Fixtures Gemini polish skipped:', err.message.split('\n')[0].slice(0, 160));
    return { days, ai: false };
  }
}

async function generateSuggestions() {
  const matches = await fetchEspnWindow();
  let days = buildDays(matches, new Date());
  const polished = await polishWithGemini(days);
  days = polished.days;

  const generatedAt = new Date().toISOString();
  const payload = {
    generatedOn: todayKey(),
    generatedAt,
    source: polished.ai ? 'ESPN + Gemini' : 'ESPN',
    days,
    count: days.reduce((n, d) => n + d.matches.length, 0),
  };
  saveCache(payload);
  return payload;
}

async function getSuggestedFixtures({ force = false } = {}) {
  const cache = loadCache();
  if (!force && cache?.generatedOn === todayKey() && Array.isArray(cache.days)) {
    return { ...cache, cached: true };
  }
  const fresh = await generateSuggestions();
  return { ...fresh, cached: false };
}

module.exports = {
  getSuggestedFixtures,
  generateSuggestions,
};

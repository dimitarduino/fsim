/**
 * Competition / league → social hashtags + SEO tags for match metadata.
 */

const LEAGUE_META = {
  UCL: {
    name: 'UEFA Champions League',
    hashtags: ['#UCL', '#ChampionsLeague', '#UEFAChampionsLeague'],
    tags: ['UCL', 'Champions League', 'UEFA Champions League', 'Champions League prediction'],
  },
  UEL: {
    name: 'UEFA Europa League',
    hashtags: ['#UEL', '#EuropaLeague', '#UEFAEuropaLeague'],
    tags: ['UEL', 'Europa League', 'UEFA Europa League', 'Europa League prediction'],
  },
  EPL: {
    name: 'Premier League',
    hashtags: ['#PremierLeague', '#EPL', '#PL'],
    tags: ['Premier League', 'EPL', 'Premier League prediction', 'English Premier League'],
  },
  'LA LIGA': {
    name: 'La Liga',
    hashtags: ['#LaLiga', '#LaLigaEASports'],
    tags: ['La Liga', 'Spanish La Liga', 'La Liga prediction'],
  },
  'SERIE A': {
    name: 'Serie A',
    hashtags: ['#SerieA', '#SerieATim'],
    tags: ['Serie A', 'Italian Serie A', 'Serie A prediction'],
  },
  BUNDESLIGA: {
    name: 'Bundesliga',
    hashtags: ['#Bundesliga', '#BundesligaEN'],
    tags: ['Bundesliga', 'German Bundesliga', 'Bundesliga prediction'],
  },
  'LIGUE 1': {
    name: 'Ligue 1',
    hashtags: ['#Ligue1', '#Ligue1McDonalds'],
    tags: ['Ligue 1', 'French Ligue 1', 'Ligue 1 prediction'],
  },
  EREDIVISIE: {
    name: 'Eredivisie',
    hashtags: ['#Eredivisie'],
    tags: ['Eredivisie', 'Dutch Eredivisie', 'Eredivisie prediction'],
  },
  'PRIMEIRA LIGA': {
    name: 'Primeira Liga',
    hashtags: ['#PrimeiraLiga', '#LigaPortugal'],
    tags: ['Primeira Liga', 'Liga Portugal', 'Primeira Liga prediction'],
  },
  'SÜPER LIG': {
    name: 'Süper Lig',
    hashtags: ['#SüperLig', '#SuperLig', '#TurkishSuperLig'],
    tags: ['Süper Lig', 'Super Lig', 'Turkish Super Lig', 'Süper Lig prediction'],
  },
  'SUPER LIG': {
    name: 'Süper Lig',
    hashtags: ['#SüperLig', '#SuperLig', '#TurkishSuperLig'],
    tags: ['Süper Lig', 'Super Lig', 'Turkish Super Lig', 'Süper Lig prediction'],
  },
  'PRO LEAGUE': {
    name: 'Belgian Pro League',
    hashtags: ['#ProLeague', '#BelgianProLeague'],
    tags: ['Pro League', 'Belgian Pro League', 'Pro League prediction'],
  },
  SPL: {
    name: 'Scottish Premiership',
    hashtags: ['#ScottishPremiership', '#SPFL', '#SPL'],
    tags: ['Scottish Premiership', 'SPFL', 'SPL', 'Scottish Premiership prediction'],
  },
};

const ALIASES = {
  UCL: 'UCL',
  'CHAMPIONS LEAGUE': 'UCL',
  'UEFA CHAMPIONS LEAGUE': 'UCL',
  UEL: 'UEL',
  'EUROPA LEAGUE': 'UEL',
  'UEFA EUROPA LEAGUE': 'UEL',
  EPL: 'EPL',
  PL: 'EPL',
  'PREMIER LEAGUE': 'EPL',
  'ENGLISH PREMIER LEAGUE': 'EPL',
  'LA LIGA': 'LA LIGA',
  LALIGA: 'LA LIGA',
  'SERIE A': 'SERIE A',
  BUNDESLIGA: 'BUNDESLIGA',
  'LIGUE 1': 'LIGUE 1',
  LIGUE1: 'LIGUE 1',
  EREDIVISIE: 'EREDIVISIE',
  'PRIMEIRA LIGA': 'PRIMEIRA LIGA',
  'LIGA PORTUGAL': 'PRIMEIRA LIGA',
  'SÜPER LIG': 'SÜPER LIG',
  'SUPER LIG': 'SUPER LIG',
  'PRO LEAGUE': 'PRO LEAGUE',
  'BELGIAN PRO LEAGUE': 'PRO LEAGUE',
  SPL: 'SPL',
  SPFL: 'SPL',
  'SCOTTISH PREMIERSHIP': 'SPL',
  'SCOTTISH PREM': 'SPL',
};

function normalizeLeagueKey(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
  if (!s) return null;
  if (ALIASES[s]) return ALIASES[s];
  if (LEAGUE_META[s]) return s;
  // partial: "England - Premier League", club.leagueId style
  if (/CHAMPIONS|UCL/.test(s)) return 'UCL';
  if (/EUROPA|UEL/.test(s)) return 'UEL';
  if (/PREMIER/.test(s) && !/SCOTTISH/.test(s)) return 'EPL';
  if (/LA.?LIGA|LALIGA/.test(s)) return 'LA LIGA';
  if (/SERIE.?A/.test(s)) return 'SERIE A';
  if (/BUNDESLIGA/.test(s)) return 'BUNDESLIGA';
  if (/LIGUE.?1/.test(s)) return 'LIGUE 1';
  if (/EREDIVISIE/.test(s)) return 'EREDIVISIE';
  if (/PRIMEIRA|LIGA PORTUGAL/.test(s)) return 'PRIMEIRA LIGA';
  if (/S[ÜU]PER.?LIG/.test(s)) return 'SÜPER LIG';
  if (/PRO.?LEAGUE|BELGIAN/.test(s)) return 'PRO LEAGUE';
  if (/SCOTTISH|SPFL|\bSPL\b/.test(s)) return 'SPL';
  return null;
}

/**
 * Decide competition for hashtags.
 * Priority: explicit league/competition → same club league → cross-league → UCL.
 */
function resolveLeagueContext(match = {}) {
  const explicit = normalizeLeagueKey(match.league || match.competition || match.leagueName);
  if (explicit && LEAGUE_META[explicit]) {
    return { key: explicit, ...LEAGUE_META[explicit], source: 'explicit' };
  }

  const l1 = normalizeLeagueKey(match.team1League || match.league1);
  const l2 = normalizeLeagueKey(match.team2League || match.league2);

  if (l1 && l2 && l1 === l2 && LEAGUE_META[l1]) {
    return { key: l1, ...LEAGUE_META[l1], source: 'same-league' };
  }

  // Different domestic leagues (e.g. PSG vs Inter) → Champions League framing
  if (l1 && l2 && l1 !== l2) {
    return { key: 'UCL', ...LEAGUE_META.UCL, source: 'cross-league' };
  }

  if (l1 && LEAGUE_META[l1]) return { key: l1, ...LEAGUE_META[l1], source: 'team1' };
  if (l2 && LEAGUE_META[l2]) return { key: l2, ...LEAGUE_META[l2], source: 'team2' };

  // App default vibe
  return { key: 'UCL', ...LEAGUE_META.UCL, source: 'default' };
}

function ensureHashtagsInText(text, hashtags, { maxExtra = 3 } = {}) {
  let out = String(text || '');
  const missing = hashtags.filter((h) => !new RegExp(h.replace('#', '\\#'), 'i').test(out));
  if (!missing.length) return out;
  const add = missing.slice(0, maxExtra).join(' ');
  const trimmed = out.trimEnd();
  return trimmed ? `${trimmed} ${add}` : add;
}

function mergeLeagueIntoMetadata(metadata, leagueCtx) {
  if (!metadata || !leagueCtx) return metadata;
  const hashtags = leagueCtx.hashtags || [];
  const tags = leagueCtx.tags || [];
  return {
    ...metadata,
    title: ensureHashtagsInText(metadata.title, hashtags.slice(0, 1), { maxExtra: 1 }),
    caption: ensureHashtagsInText(metadata.caption, hashtags.slice(0, 2), { maxExtra: 2 }),
    description: ensureHashtagsInText(metadata.description, hashtags, { maxExtra: 3 }),
    tags: [...new Set([...(metadata.tags || []).map(String), ...tags])].slice(0, 16),
    league: leagueCtx.key,
    leagueName: leagueCtx.name,
  };
}

module.exports = {
  LEAGUE_META,
  normalizeLeagueKey,
  resolveLeagueContext,
  mergeLeagueIntoMetadata,
  ensureHashtagsInText,
};

#!/usr/bin/env node
/**
 * Downloads first-division club logos for top European leagues from
 * https://github.com/luukhopman/football-logos into ./clubs
 * and writes clubs/clubs.json for the simulator UI.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'clubs');
const OUT_JSON = path.join(OUT_DIR, 'clubs.json');
const GH_API = 'https://api.github.com/repos/luukhopman/football-logos/contents/logos';
const RAW = 'https://raw.githubusercontent.com/luukhopman/football-logos/master';

/** Top first divisions to include */
const LEAGUES = [
  { folder: 'England - Premier League', id: 'premier-league', short: 'EPL', color: '#38003c' },
  { folder: 'Spain - LaLiga', id: 'la-liga', short: 'La Liga', color: '#ee8707' },
  { folder: 'Italy - Serie A', id: 'serie-a', short: 'Serie A', color: '#024494' },
  { folder: 'Germany - Bundesliga', id: 'bundesliga', short: 'Bundesliga', color: '#d20515' },
  { folder: 'France - Ligue 1', id: 'ligue-1', short: 'Ligue 1', color: '#091c3e' },
  { folder: 'Netherlands - Eredivisie', id: 'eredivisie', short: 'Eredivisie', color: '#ff6600' },
  { folder: 'Portugal - Liga Portugal', id: 'primeira-liga', short: 'Primeira Liga', color: '#006600' },
  { folder: 'Türkiye - Süper Lig', id: 'super-lig', short: 'Süper Lig', color: '#e30a17' },
  { folder: 'Belgium - Jupiler Pro League', id: 'belgian-pro', short: 'Pro League', color: '#f6e700' },
  { folder: 'Scotland - Scottish Premiership', id: 'scottish-prem', short: 'SPL', color: '#002b5c' },
];

const KNOWN_SHORT = {
  Arsenal: 'ARS',
  Chelsea: 'CHE',
  Liverpool: 'LIV',
  'Manchester City': 'MCI',
  'Manchester United': 'MUN',
  Tottenham: 'TOT',
  'Tottenham Hotspur': 'TOT',
  'Newcastle United': 'NEW',
  'Aston Villa': 'AVL',
  Brighton: 'BHA',
  'Brighton & Hove Albion': 'BHA',
  'West Ham United': 'WHU',
  'Crystal Palace': 'CRY',
  Fulham: 'FUL',
  Brentford: 'BRE',
  Everton: 'EVE',
  'Nottingham Forest': 'NFO',
  'Wolverhampton Wanderers': 'WOL',
  Bournemouth: 'BOU',
  'AFC Bournemouth': 'BOU',
  'Leicester City': 'LEI',
  'Ipswich Town': 'IPS',
  Southampton: 'SOU',
  'Leeds United': 'LEE',
  Barcelona: 'BAR',
  'Real Madrid': 'RMA',
  'Atlético Madrid': 'ATM',
  'Atletico Madrid': 'ATM',
  Sevilla: 'SEV',
  Valencia: 'VAL',
  Villarreal: 'VIL',
  'Real Sociedad': 'RSO',
  'Athletic Club': 'ATH',
  Betis: 'BET',
  'Real Betis': 'BET',
  Juventus: 'JUV',
  Inter: 'INT',
  Internazionale: 'INT',
  'Inter Milan': 'INT',
  Milan: 'MIL',
  'AC Milan': 'MIL',
  Napoli: 'NAP',
  Roma: 'ROM',
  Lazio: 'LAZ',
  Fiorentina: 'FIO',
  Atalanta: 'ATA',
  'Bayern Munich': 'BAY',
  'Bayern München': 'BAY',
  'Borussia Dortmund': 'BVB',
  'RB Leipzig': 'RBL',
  'Bayer Leverkusen': 'B04',
  'Eintracht Frankfurt': 'SGE',
  'Paris Saint-Germain': 'PSG',
  'Paris Saint Germain': 'PSG',
  Marseille: 'OM',
  Lyon: 'OL',
  Monaco: 'ASM',
  Lille: 'LOSC',
  Ajax: 'AJX',
  PSV: 'PSV',
  Feyenoord: 'FEY',
  Benfica: 'BEN',
  Porto: 'POR',
  'FC Porto': 'POR',
  Sporting: 'SCP',
  'Sporting CP': 'SCP',
  Celtic: 'CEL',
  Rangers: 'RAN',
  Galatasaray: 'GAL',
  Fenerbahçe: 'FEN',
  'Fenerbahce': 'FEN',
  Beşiktaş: 'BES',
  Besiktas: 'BES',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'UCL-Simulator/1.0',
            Accept: 'application/vnd.github+json',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode} for ${url}: ${data.slice(0, 120)}`));
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(err);
            }
          });
        }
      )
      .on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { 'User-Agent': 'UCL-Simulator/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(dest, () => {});
          downloadFile(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      })
      .on('error', (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

function slugify(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function shortCode(name) {
  if (KNOWN_SHORT[name]) return KNOWN_SHORT[name];
  for (const [k, v] of Object.entries(KNOWN_SHORT)) {
    if (name.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(name.toLowerCase())) {
      return v;
    }
  }
  const words = name.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 5);
  }
  return name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5) || 'CLUB';
}

/** Per-club neon colors (not league brand purple/orange/etc.) */
const KNOWN_COLORS = [
  [/arsenal/i, '#ef0107'],
  [/chelsea/i, '#034694'],
  [/liverpool/i, '#c8102e'],
  [/manchester city/i, '#6cabdd'],
  [/manchester united/i, '#da291c'],
  [/tottenham/i, '#132257'],
  [/newcastle/i, '#241f20'],
  [/aston villa/i, '#95bfe5'],
  [/west ham/i, '#7a263a'],
  [/brighton/i, '#0057b8'],
  [/everton/i, '#003399'],
  [/crystal palace/i, '#1b458f'],
  [/wolverhampton|wolves/i, '#fdb913'],
  [/nottingham|forest/i, '#e53233'],
  [/brentford/i, '#e30613'],
  [/bournemouth/i, '#da291c'],
  [/leicester/i, '#003090'],
  [/southampton/i, '#d71920'],
  [/real madrid/i, '#f5f5f5'],
  [/barcelona/i, '#a50044'],
  [/atl[eé]tico/i, '#cb3524'],
  [/sevilla/i, '#d4a574'],
  [/valencia/i, '#ee3524'],
  [/villarreal/i, '#ffe14d'],
  [/real sociedad/i, '#0067b1'],
  [/athletic|bilbao/i, '#ee2523'],
  [/real betis/i, '#0bb363'],
  [/juventus/i, '#f5f5f5'],
  [/inter milan|^inter$|internazionale/i, '#010E80'],
  [/\bac milan\b|^milan$/i, '#fb090b'],
  [/napoli/i, '#12a0d7'],
  [/roma/i, '#8e1f2f'],
  [/lazio/i, '#87d8f7'],
  [/fiorentina/i, '#482e92'],
  [/atalanta/i, '#1e71b8'],
  [/bayern/i, '#dc052d'],
  [/dortmund|borussia dortmund/i, '#fde100'],
  [/leverkusen/i, '#e32221'],
  [/rb leipzig/i, '#dd0741'],
  [/frankfurt/i, '#e1000f'],
  [/paris saint-germain|psg/i, '#004170'],
  [/marseille/i, '#2faee0'],
  [/lyon|olympique lyonnais/i, '#003399'],
  [/monaco/i, '#e30613'],
  [/lille/i, '#e01a22'],
  [/ajax/i, '#d2122e'],
  [/psv/i, '#ed1c24'],
  [/feyenoord/i, '#ff1e00'],
  [/benfica/i, '#e41513'],
  [/porto/i, '#003893'],
  [/sporting/i, '#008057'],
  [/celtic/i, '#018749'],
  [/rangers/i, '#1b458f'],
  [/galatasaray/i, '#a90432'],
  [/fenerbah/i, '#0a2f6c'],
];

function hashNeon(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const sat = 70 + (h % 25);
  const light = 42 + (h % 16);
  const s = sat / 100;
  const l = light / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function clubNeonColor(name, fallback) {
  for (const [re, c] of KNOWN_COLORS) {
    if (re.test(name)) return c;
  }
  return hashNeon(name) || fallback;
}

function clearOldLogos() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f === 'clubs.json') continue;
    fs.unlinkSync(path.join(OUT_DIR, f));
  }
}

async function listLeagueFolders() {
  const items = await fetchJson(GH_API);
  return new Map(items.filter((i) => i.type === 'dir').map((i) => [i.name, i]));
}

async function main() {
  clearOldLogos();
  const folders = await listLeagueFolders();
  const clubs = [];

  for (const league of LEAGUES) {
    let folderName = league.folder;
    if (!folders.has(folderName)) {
      // fuzzy match (La Liga naming varies)
      const found = [...folders.keys()].find(
        (n) =>
          n.toLowerCase().includes(league.id.replace(/-/g, ' ')) ||
          n.toLowerCase().includes(league.short.toLowerCase()) ||
          (league.id === 'la-liga' && /laliga|la.?liga/i.test(n)) ||
          (league.id === 'premier-league' && /premier/i.test(n) && /england/i.test(n)) ||
          (league.id === 'serie-a' && /serie a/i.test(n)) ||
          (league.id === 'bundesliga' && /germany/i.test(n) && /bundesliga/i.test(n)) ||
          (league.id === 'ligue-1' && /ligue 1/i.test(n)) ||
          (league.id === 'eredivisie' && /eredivisie/i.test(n)) ||
          (league.id === 'primeira-liga' && /portugal/i.test(n)) ||
          (league.id === 'super-lig' && /süper|super lig/i.test(n)) ||
          (league.id === 'belgian-pro' && /belgium/i.test(n)) ||
          (league.id === 'scottish-prem' && /scotland/i.test(n))
      );
      if (!found) {
        console.warn(`Skip missing league folder: ${league.folder}`);
        continue;
      }
      folderName = found;
    }

    console.log(`Fetching ${folderName}…`);
    const files = await fetchJson(`${GH_API}/${encodeURIComponent(folderName)}`);
    const pngs = files.filter((f) => f.type === 'file' && /\.png$/i.test(f.name));
    console.log(`  ${pngs.length} logos`);

    for (const file of pngs) {
      const name = file.name.replace(/\.png$/i, '');
      const id = `${league.id}-${slugify(name)}`;
      const filename = `${id}.png`;
      const dest = path.join(OUT_DIR, filename);
      const url = file.download_url || `${RAW}/logos/${encodeURIComponent(folderName)}/${encodeURIComponent(file.name)}`;
      try {
        await downloadFile(url, dest);
        await sleep(40);
      } catch (err) {
        console.warn(`  skip ${name}: ${err.message}`);
        continue;
      }
      clubs.push({
        id,
        name,
        short: shortCode(name),
        league: league.short,
        leagueId: league.id,
        color: clubNeonColor(name, league.color),
        logo: `/clubs/${filename}`,
      });
    }
    await sleep(200);
  }

  clubs.sort((a, b) => {
    if (a.league !== b.league) return a.league.localeCompare(b.league);
    return a.name.localeCompare(b.name);
  });

  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        source: 'https://github.com/luukhopman/football-logos',
        count: clubs.length,
        leagues: LEAGUES.map((l) => ({ id: l.id, name: l.short })),
        clubs,
      },
      null,
      2
    )
  );
  console.log(`Wrote ${clubs.length} clubs → ${OUT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Prompt + schema for viral match social metadata (YouTube / TikTok / X).
 * Always expects a single JSON object back from the model.
 */

const { resolveLeagueContext } = require('./leagueHashtags');

function buildMatchMetadataPrompt(match, { uniquenessSeed } = {}) {
  const t1 = String(match.team1Name || match.team1 || 'Team 1');
  const t2 = String(match.team2Name || match.team2 || 'Team 2');
  const s1 = String(match.score1 ?? '0');
  const s2 = String(match.score2 ?? '0');
  const seed = uniquenessSeed || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const league = resolveLeagueContext(match);
  const leagueHashtagLine = (league.hashtags || []).join(' ');
  const leagueTagLine = (league.tags || []).join(', ');

  return `You write VIRAL football Shorts / TikTok / Reels copy that stops the scroll.

This is an AI football PREDICTION simulator video (neon arcade match sim). Framing must feel like "AI prediction / football prediction" content — not a real broadcast highlight.

Goal: max watch time, comments, shares, and saves. Sound like a top sports creator — not a bot, not a press release.

Match:
- Home/Team A: ${t1}
- Away/Team B: ${t2}
- Competition / league: ${league.name} (${league.key})
- Required competition hashtags (MUST appear in title OR caption, and in description + tags): ${leagueHashtagLine}
- Required competition tag strings (no #): ${leagueTagLine}
- Final score (SPOILER — description only, never title/caption): ${t1} ${s1}-${s2} ${t2}
- Seed (force unique wording every time): ${seed}
- Visual: neon arcade football simulation / AI prediction, vertical short

PREDICTION FRAMING (required):
- Title, caption, description, AND tags must clearly signal this is a prediction / AI prediction
- Rotate natural phrases (pick fresh ones per seed): "AI prediction", "AI predicts", "football prediction", "match prediction", "predicted this", "AI sim prediction", "prediction short"
- Do NOT say "real match footage", "highlights from yesterday", or imply it was a live broadcast
- Still tease drama — curiosity about the predicted ending, not the score itself

COMPETITION HASHTAGS (required):
- This fixture is framed as ${league.name}
- ALWAYS include the competition hashtags ${leagueHashtagLine} in description hashtag block
- Include at least one of them in the YouTube title OR TikTok caption (prefer title when it fits in 90 chars)
- Tags array MUST include competition keywords: ${leagueTagLine}
- Examples: UCL → #UCL #ChampionsLeague; EPL → #PremierLeague #EPL; La Liga → #LaLiga; etc.

VIRAL CRAFT (use these techniques):
- Open loops / curiosity gaps ("wait for…", "the part nobody expects…", "this ending…")
- Pattern interrupt in the first 3–6 words
- Emotion: shock, rivalry, unfair, clutch, chaos, "I can't believe…"
- Specificity > vague hype (name both teams; tease a moment, not the score)
- Comment bait (soft): "who wins this rivalry?", "team A or team B?", "unfair or genius?"
- Never use banned fluff: "football fans need to see this", "football fans only", "pure chaos", "watch till the end", "you won't believe", "insane", "epic", "must watch", "viral video", "link in bio"

TITLE (YouTube Shorts) — this is 70% of the click:
- Max 90 characters TOTAL including hashtags
- Structure: HOOK + prediction cue + ${t1} vs ${t2} + 2–3 hashtags (include a competition hashtag when space allows)
- MUST include both team names
- MUST include at least one of: prediction / AI prediction / AI predicts / predicted
- NEVER include score / result / "wins" / "beats"
- Hook styles to rotate (pick ONE fresh angle for this seed):
  * unfinished sentence / cliffhanger
  * "POV:" / "Tell me why…" / "AI prediction: ${t1} vs ${t2}…"
  * rivalry roast / banter framed as a prediction
  * "0:12 changes everything" style tease WITHOUT saying the score
  * "I ran an AI prediction on ${t1} vs ${t2}…"
- Hashtags at the end only: prefer competition hashtag + #Football #Shorts (max 3)

DESCRIPTION (YouTube) — built to convert:
- 5–8 short lines, mobile-first
- Line 1: hook with ZERO spoiler + prediction / AI prediction angle
- Lines 2–3: tension / what to look for (still no score); mention it's an AI football prediction sim for ${league.name}
- Then: Final: ${t1} ${s1}-${s2} ${t2}
- Then 1 line of soft CTA (comment / duel which club / agree with the prediction?)
- End with 14–20 hashtags: MUST include ${leagueHashtagLine} plus #Football #Soccer #Shorts #FootballTikTok #Matchday #Prediction #AIPrediction + #${t1.replace(/\s+/g, '')} #${t2.replace(/\s+/g, '')}

CAPTION (TikTok / X) — native & punchy:
- Max 200 characters including hashtags
- Feels like a real TikTok caption (not a YouTube title paste)
- Must include prediction / AI prediction / AI predicts wording
- Include at least one competition hashtag from ${leagueHashtagLine} if not already in the title
- No spoilers / no score
- 5–8 hashtags max (include #Prediction or #AIPrediction when it fits)
- Include both team names somehow

TAGS:
- 10–14 SEO strings WITHOUT #
- MUST include several of: prediction, AI prediction, football prediction, match prediction, AI predicts, football AI
- MUST include competition tags: ${leagueTagLine}
- Also include: football, soccer, shorts, ${t1}, ${t2}, matchday, sports, football shorts

CATEGORY: prefer "Sports" (or Gaming/Entertainment only if clearly better)

Return ONLY valid JSON (no markdown):
{
  "title": "string",
  "description": "string",
  "caption": "string",
  "tags": ["string"],
  "category": "Sports"
}`;
}

module.exports = { buildMatchMetadataPrompt };

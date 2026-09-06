/**
 * Prompt + schema for viral match social metadata (YouTube / TikTok / X).
 * Always expects a single JSON object back from the model.
 */

function buildMatchMetadataPrompt(match, { uniquenessSeed } = {}) {
  const t1 = String(match.team1Name || match.team1 || 'Team 1');
  const t2 = String(match.team2Name || match.team2 || 'Team 2');
  const s1 = String(match.score1 ?? '0');
  const s2 = String(match.score2 ?? '0');
  const seed = uniquenessSeed || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return `You write VIRAL football Shorts / TikTok / Reels copy that stops the scroll.

Goal: max watch time, comments, shares, and saves. Sound like a top sports creator — not a bot, not a press release.

Match:
- Home/Team A: ${t1}
- Away/Team B: ${t2}
- Final score (SPOILER — description only, never title/caption): ${t1} ${s1}-${s2} ${t2}
- Seed (force unique wording every time): ${seed}
- Visual: neon arcade football simulation, vertical short

VIRAL CRAFT (use these techniques):
- Open loops / curiosity gaps ("wait for…", "the part nobody expects…", "this ending…")
- Pattern interrupt in the first 3–6 words
- Emotion: shock, rivalry, unfair, clutch, chaos, "I can't believe…"
- Specificity > vague hype (name both teams; tease a moment, not the score)
- Comment bait (soft): "who wins this rivalry?", "team A or team B?", "unfair or genius?"
- Never use banned fluff: "football fans need to see this", "football fans only", "pure chaos", "watch till the end", "you won't believe", "insane", "epic", "must watch", "viral video", "link in bio"

TITLE (YouTube Shorts) — this is 70% of the click:
- Max 90 characters TOTAL including hashtags
- Structure: HOOK + ${t1} vs ${t2} + 2–3 hashtags
- Hook styles to rotate (pick ONE fresh angle for this seed):
  * unfinished sentence / cliffhanger
  * "POV:" / "Tell me why…" / "This ${t1}–${t2} clip…"
  * rivalry roast / banter
  * "0:12 changes everything" style tease WITHOUT saying the score
  * "I showed this to a ${t1} fan…"
- MUST include both team names
- NEVER include score / result / "wins" / "beats"
- Hashtags at the end only: prefer #Football #Shorts #Soccer (max 3)

DESCRIPTION (YouTube) — built to convert:
- 5–8 short lines, mobile-first
- Line 1: hook with ZERO spoiler
- Lines 2–3: tension / what to look for (still no score)
- Then: Final: ${t1} ${s1}-${s2} ${t2}
- Then 1 line of soft CTA (comment / duel which club)
- End with 14–20 hashtags: mix #Football #Soccer #Shorts #FootballTikTok #Matchday + #${t1.replace(/\s+/g, '')} #${t2.replace(/\s+/g, '')} + related

CAPTION (TikTok / X) — native & punchy:
- Max 200 characters including hashtags
- Feels like a real TikTok caption (not a YouTube title paste)
- No spoilers / no score
- 5–8 hashtags max
- Include both team names somehow

TAGS:
- 10–14 SEO strings WITHOUT #
- Include: football, soccer, shorts, highlights, ${t1}, ${t2}, matchday, sports, football shorts, viral football

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

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

  return `You are a creative football social-media copywriter for YouTube Shorts, TikTok, and X.

Write UNIQUE metadata for one short vertical neon football simulation clip.
Never reuse generic filler like "football fans need to see this", "football fans only", "pure chaos", or "watch till the end".

Match context:
- Team A: ${t1}
- Team B: ${t2}
- Final score (SPOILER — only allowed late in description): ${t1} ${s1}-${s2} ${t2}
- Uniqueness seed (make this wording different every time): ${seed}
- Vibe: neon pitch, arcade / simulation energy, viral sports edit

Creativity rules:
- Invent a fresh angle each time (rivalry tease, "don't blink", plot twist ending, neon chaos, underdog energy, last-second drama, cinematic hype, meme-y football banter, etc.)
- Title, caption, and description must feel different from each other, not copy-pasted
- Include BOTH team names in the title
- NEVER put the score or result in title or caption
- Avoid repeating the same phrase across outputs

Field rules:
1) title (YouTube Shorts)
   - Max 90 characters
   - Curiosity hook + both team names
   - Include 2–4 hashtags at the end (e.g. #Football #Soccer #Shorts #FootballFans)

2) description (YouTube)
   - 3–5 short lines
   - Hook first, no spoiler in line 1
   - Mention final score only after the hook: ${t1} ${s1}-${s2} ${t2}
   - End with 12–18 hashtags mixing broad football terms + team names

3) caption (TikTok / X)
   - Max 220 characters including hashtags
   - Punchy, no spoilers
   - 4–8 hashtags

4) tags
   - Array of 10–14 SEO keywords WITHOUT #
   - Mix: football, soccer, shorts, highlights, sports, matchday, team names, related phrases

5) category
   - One of: Sports, Gaming, Entertainment, People & Blogs, Music, Comedy
   - Prefer Sports unless another fits better

Return ONLY valid JSON (no markdown, no commentary) with exactly these keys:
{
  "title": "string",
  "description": "string",
  "caption": "string",
  "tags": ["string"],
  "category": "Sports"
}`;
}

module.exports = { buildMatchMetadataPrompt };

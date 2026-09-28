const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { getOpenAI } = require("../openaiClient");

const router = express.Router();

// GET /api/schemes?query=storage - simple keyword search across the reference dataset
router.get("/", requireAuth, async (req, res) => {
  const { query } = req.query;
  try {
    const result = query
      ? await pool.query(
          `SELECT * FROM schemes
           WHERE name ILIKE $1 OR category ILIKE $1 OR eligibility ILIKE $1 OR benefit ILIKE $1
           ORDER BY name`,
          [`%${query}%`]
        )
      : await pool.query("SELECT * FROM schemes ORDER BY name");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch schemes" });
  }
});

// GET /api/schemes/recommend - schemes most relevant to the logged-in user's role/situation.
// Uses the OpenAI API for a semantic match when a key is configured; otherwise falls back
// to a transparent keyword rule (still real, just simpler).
router.get("/recommend", requireAuth, async (req, res) => {
  try {
    const schemesResult = await pool.query("SELECT * FROM schemes ORDER BY name");
    const schemes = schemesResult.rows;

    const userResult = await pool.query("SELECT role, location FROM users WHERE id = $1", [req.user.id]);
    const user = userResult.rows[0];

    const openai = getOpenAI();
    if (openai) {
      const prompt = `A ${user.role} in ${user.location || "Maharashtra"} is using an agricultural
market-linkage app. Given this list of government schemes (as JSON), return a JSON array of the
3 most relevant scheme names for this user, each with a one-sentence "whyRelevant" explanation.
Schemes: ${JSON.stringify(schemes.map((s) => ({ name: s.name, category: s.category, eligibility: s.eligibility })))}
Respond with ONLY a JSON array like [{"name": "...", "whyRelevant": "..."}], no other text.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });

      const raw = completion.choices[0].message.content.trim();
      const parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
      const withDetails = parsed
        .map((p) => {
          const full = schemes.find((s) => s.name === p.name);
          return full ? { ...full, whyRelevant: p.whyRelevant } : null;
        })
        .filter(Boolean);

      return res.json({ method: "llm", recommendations: withDetails });
    }

    // Fallback: simple, transparent keyword rule (no API key configured)
    const fallback = schemes
      .filter((s) => {
        if (user.role === "farmer") return true; // most schemes here apply to farmers
        return s.category === "Market Access"; // vendors mainly care about market-access schemes
      })
      .slice(0, 3)
      .map((s) => ({ ...s, whyRelevant: `Matches your role (${user.role}) by category: ${s.category}.` }));

    res.json({ method: "keyword-fallback", recommendations: fallback });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate recommendations" });
  }
});

module.exports = router;

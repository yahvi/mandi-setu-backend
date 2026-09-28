const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getOpenAI } = require("../openaiClient");

const router = express.Router();

const KNOWN_CROPS = ["Onion", "Tomato", "Wheat", "Rice", "Cotton", "Soybean", "Sugarcane", "Maize", "Potato", "Groundnut"];

// A simple, transparent keyword/regex extractor used when no OpenAI key is configured.
// Real, working code \u2014 just less flexible with natural phrasing than an LLM.
function fallbackExtract(text) {
  const lower = text.toLowerCase();
  const crop = KNOWN_CROPS.find((c) => lower.includes(c.toLowerCase())) || null;

  const qtyMatch = text.match(/(\d+(\.\d+)?)\s*(quintal|qtl|kg|ton)/i);
  const quantity = qtyMatch ? parseFloat(qtyMatch[1]) : null;

  const priceMatch = text.match(/(?:\u20b9|rs\.?|inr)\s*(\d+(\.\d+)?)/i) || text.match(/(\d{3,6})\s*(?:per|\/)\s*quintal/i);
  const price = priceMatch ? parseFloat(priceMatch[1]) : null;

  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  const deadline = dateMatch ? dateMatch[1] : null;

  return { crop, quantity, price, deadline, confidence: "low", method: "keyword-fallback" };
}

// POST /api/llm/parse-requirement  { text }
// "Requirement Understanding & Intent Detection" \u2014 turns a free-text description
// into structured listing fields (crop, quantity, price, deadline).
router.post("/parse-requirement", requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  const openai = getOpenAI();
  if (!openai) {
    return res.json(fallbackExtract(text));
  }

  try {
    const prompt = `Extract structured fields from this farmer/buyer requirement description.
Return ONLY a JSON object with keys: crop (one of ${KNOWN_CROPS.join(", ")} or null),
quantity (number, in quintals, or null), price (number, INR per quintal, or null),
deadline (YYYY-MM-DD or null). No other text.

Description: "${text}"`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    const raw = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
    res.json({ ...parsed, confidence: "high", method: "llm" });
  } catch (err) {
    console.error("LLM parse failed, falling back to keyword extraction:", err.message);
    res.json(fallbackExtract(text));
  }
});

module.exports = router;

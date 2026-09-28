const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /api/reviews  { offerId, rating, comment }
// Only allowed once an offer is "delivered", and only by one of its two parties,
// once per offer per reviewer. Recomputes the reviewee's real average rating
// from all their reviews \u2014 this replaces the seeded static rating number.
router.post("/", requireAuth, async (req, res) => {
  const { offerId, rating, comment } = req.body;
  if (!offerId || !rating) return res.status(400).json({ error: "offerId and rating are required" });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: "rating must be between 1 and 5" });

  try {
    const offerResult = await pool.query("SELECT * FROM offers WHERE id = $1", [offerId]);
    if (offerResult.rows.length === 0) return res.status(404).json({ error: "Offer not found" });
    const offer = offerResult.rows[0];

    if (offer.status !== "delivered") {
      return res.status(400).json({ error: "You can only leave feedback after delivery is marked complete" });
    }

    const isFromUser = offer.from_user_id === req.user.id;
    const isToUser = offer.to_user_id === req.user.id;
    if (!isFromUser && !isToUser) return res.status(403).json({ error: "Not your offer" });

    const revieweeId = isFromUser ? offer.to_user_id : offer.from_user_id;

    const existing = await pool.query(
      "SELECT id FROM reviews WHERE offer_id = $1 AND reviewer_user_id = $2",
      [offerId, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "You've already left feedback on this deal" });
    }

    await pool.query(
      `INSERT INTO reviews (offer_id, reviewer_user_id, reviewee_user_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [offerId, req.user.id, revieweeId, rating, comment || null]
    );

    // Recompute the reviewee's real average rating and completed-deal count
    const agg = await pool.query(
      "SELECT AVG(rating)::NUMERIC(2,1) AS avg_rating, COUNT(*) AS review_count FROM reviews WHERE reviewee_user_id = $1",
      [revieweeId]
    );
    const dealsResult = await pool.query(
      `SELECT COUNT(*) FROM offers WHERE status = 'delivered' AND (from_user_id = $1 OR to_user_id = $1)`,
      [revieweeId]
    );

    await pool.query(
      "UPDATE users SET rating = $1, completed_deals = $2 WHERE id = $3",
      [agg.rows[0].avg_rating, Number(dealsResult.rows[0].count), revieweeId]
    );

    res.status(201).json({ ok: true, newRating: agg.rows[0].avg_rating, reviewCount: Number(agg.rows[0].review_count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

// GET /api/reviews/for-offer/:offerId - check whether the current user already reviewed this offer
router.get("/for-offer/:offerId", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM reviews WHERE offer_id = $1 AND reviewer_user_id = $2",
      [req.params.offerId, req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to check review status" });
  }
});

module.exports = router;

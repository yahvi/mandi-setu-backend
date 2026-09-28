const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /api/disputes - raise a dispute on an offer you're party to
router.post("/", requireAuth, async (req, res) => {
  const { offerId, reason } = req.body;
  if (!offerId || !reason) return res.status(400).json({ error: "offerId and reason are required" });

  try {
    const offer = await pool.query("SELECT * FROM offers WHERE id = $1", [offerId]);
    if (offer.rows.length === 0) return res.status(404).json({ error: "Offer not found" });
    const isParty = offer.rows[0].from_user_id === req.user.id || offer.rows[0].to_user_id === req.user.id;
    if (!isParty) return res.status(403).json({ error: "Not your offer" });

    const result = await pool.query(
      `INSERT INTO disputes (offer_id, raised_by_user_id, reason) VALUES ($1, $2, $3) RETURNING *`,
      [offerId, req.user.id, reason]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to raise dispute" });
  }
});

// GET /api/disputes/mine - disputes the logged-in user raised
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, l.crop, o.offer_price
       FROM disputes d
       JOIN offers o ON o.id = d.offer_id
       JOIN listings l ON l.id = o.listing_id
       WHERE d.raised_by_user_id = $1
       ORDER BY d.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch disputes" });
  }
});

module.exports = router;

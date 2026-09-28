const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Valid forward transitions. Either party can advance a status; who's allowed
// to trigger which step is enforced on the frontend for clarity, kept simple here.
const NEXT_STATUS = {
  pending: ["accepted", "rejected"],
  accepted: ["paid"],
  paid: ["delivered"],
  delivered: [],
  rejected: [],
};

// POST /api/offers - make an offer on someone else's listing
router.post("/", requireAuth, async (req, res) => {
  const { listingId, offerPrice } = req.body;
  if (!listingId || !offerPrice) {
    return res.status(400).json({ error: "listingId and offerPrice are required" });
  }

  try {
    const listingResult = await pool.query("SELECT user_id FROM listings WHERE id = $1", [listingId]);
    if (listingResult.rows.length === 0) {
      return res.status(404).json({ error: "Listing not found" });
    }
    const toUserId = listingResult.rows[0].user_id;
    if (toUserId === req.user.id) {
      return res.status(400).json({ error: "You can't make an offer on your own listing" });
    }

    const result = await pool.query(
      `INSERT INTO offers (listing_id, from_user_id, to_user_id, offer_price)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [listingId, req.user.id, toUserId, offerPrice]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create offer" });
  }
});

// GET /api/offers/mine - every offer sent or received by the logged-in user
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, l.crop, l.quality_grade,
              fu.full_name AS from_name, fu.phone AS from_phone,
              tu.full_name AS to_name, tu.phone AS to_phone
       FROM offers o
       JOIN listings l ON l.id = o.listing_id
       JOIN users fu ON fu.id = o.from_user_id
       JOIN users tu ON tu.id = o.to_user_id
       WHERE o.from_user_id = $1 OR o.to_user_id = $1
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );

    const offers = result.rows.map((r) => ({
      id: r.id,
      crop: r.crop,
      qualityGrade: r.quality_grade,
      offerPrice: Number(r.offer_price),
      status: r.status,
      createdAt: r.created_at,
      direction: r.from_user_id === req.user.id ? "sent" : "received",
      counterparty: r.from_user_id === req.user.id
        ? { name: r.to_name, phone: r.to_phone }
        : { name: r.from_name, phone: r.from_phone },
    }));

    res.json(offers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch offers" });
  }
});

// PATCH /api/offers/:id - advance the offer's status (accept/reject/mark paid/mark delivered)
router.patch("/:id", requireAuth, async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;

  try {
    const existing = await pool.query("SELECT * FROM offers WHERE id = $1", [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "Offer not found" });
    const offer = existing.rows[0];

    const isParty = offer.from_user_id === req.user.id || offer.to_user_id === req.user.id;
    if (!isParty) return res.status(403).json({ error: "Not your offer" });

    const allowed = NEXT_STATUS[offer.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Cannot move from ${offer.status} to ${status}` });
    }

    const result = await pool.query(
      "UPDATE offers SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update offer" });
  }
});

module.exports = router;

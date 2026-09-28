const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /api/listings  - create a produce listing (farmer) or requirement (vendor)
router.post("/", requireAuth, async (req, res) => {
  const { crop, quantity, qualityGrade, price, targetDate } = req.body;
  const type = req.user.role === "farmer" ? "produce" : "requirement";

  if (!crop || !price) {
    return res.status(400).json({ error: "crop and price are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO listings (user_id, type, crop, quantity, quality_grade, price, target_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, type, crop, quantity || null, qualityGrade || "Standard", price, targetDate || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create listing" });
  }
});

// GET /api/listings/mine - the logged-in user's own listing(s)
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM listings WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch your listings" });
  }
});

// PATCH /api/listings/:id - edit a listing the user owns
router.patch("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { quantity, qualityGrade, price, targetDate, status } = req.body;

  try {
    const owned = await pool.query("SELECT id FROM listings WHERE id = $1 AND user_id = $2", [id, req.user.id]);
    if (owned.rows.length === 0) {
      return res.status(404).json({ error: "Listing not found or not yours" });
    }

    const result = await pool.query(
      `UPDATE listings SET
         quantity = COALESCE($1, quantity),
         quality_grade = COALESCE($2, quality_grade),
         price = COALESCE($3, price),
         target_date = COALESCE($4, target_date),
         status = COALESCE($5, status)
       WHERE id = $6 RETURNING *`,
      [quantity, qualityGrade, price, targetDate, status, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update listing" });
  }
});

module.exports = router;

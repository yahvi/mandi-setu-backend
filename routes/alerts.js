const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/alerts - the logged-in user's alerts, newest first
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

// PATCH /api/alerts/:id/read - mark a single alert as read
router.patch("/:id/read", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE alerts SET is_read = TRUE WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update alert" });
  }
});

module.exports = router;

const express = require("express");
const pool = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/admin/users - every farmer/vendor account, for the admin to review/verify
router.get("/users", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, role, full_name, email, phone, location, rating, completed_deals, is_verified, created_at
       FROM users WHERE role != 'admin' ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// PATCH /api/admin/users/:id/verify - mark a farmer/vendor as a verified account
router.patch("/users/:id/verify", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_verified = TRUE, verified_at = NOW() WHERE id = $1 RETURNING id, full_name, is_verified`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to verify user" });
  }
});

// GET /api/admin/stats - basic platform counts for the admin overview
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const [users, listings, offers, disputes] = await Promise.all([
      pool.query("SELECT role, COUNT(*) FROM users WHERE role != 'admin' GROUP BY role"),
      pool.query("SELECT COUNT(*) FROM listings WHERE status = 'active'"),
      pool.query("SELECT status, COUNT(*) FROM offers GROUP BY status"),
      pool.query("SELECT COUNT(*) FROM disputes WHERE status = 'open'"),
    ]);
    res.json({
      usersByRole: users.rows,
      activeListings: Number(listings.rows[0].count),
      offersByStatus: offers.rows,
      openDisputes: Number(disputes.rows[0].count),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// GET /api/admin/disputes - every dispute, for admin resolution
router.get("/disputes", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.full_name AS raised_by_name, o.offer_price, l.crop
       FROM disputes d
       JOIN users u ON u.id = d.raised_by_user_id
       JOIN offers o ON o.id = d.offer_id
       JOIN listings l ON l.id = o.listing_id
       ORDER BY d.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch disputes" });
  }
});

// PATCH /api/admin/disputes/:id - resolve or reject a dispute
router.patch("/disputes/:id", requireAdmin, async (req, res) => {
  const { status, resolutionNote } = req.body;
  if (!["resolved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be resolved or rejected" });
  }
  try {
    const result = await pool.query(
      `UPDATE disputes SET status = $1, resolution_note = $2, resolved_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, resolutionNote || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Dispute not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update dispute" });
  }
});

module.exports = router;

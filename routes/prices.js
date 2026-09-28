const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Haversine distance in km between two lat/lng points
function distanceKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Simple transport cost estimate: base fee + per-km rate.
// TODO: replace with a real logistics-partner rate table later.
function estimateTransportCost(km) {
  if (km == null) return null;
  const baseFee = 40;
  const perKm = 3.2;
  return Math.round(baseFee + km * perKm);
}

// GET /api/prices/compare?crop=Onion&lat=19.99&lng=73.78
router.get("/compare", requireAuth, async (req, res) => {
  const { crop, lat, lng } = req.query;
  if (!crop) return res.status(400).json({ error: "crop is required" });

  const userLat = lat ? parseFloat(lat) : null;
  const userLng = lng ? parseFloat(lng) : null;

  try {
    const result = await pool.query(
      `SELECT mandi_name, lat, lng, price, trend, recorded_date
       FROM mandi_prices WHERE crop ILIKE $1
       ORDER BY price DESC`,
      [crop]
    );

    const rows = result.rows.map((r) => {
      const km = distanceKm(userLat, userLng, r.lat, r.lng);
      const transportCost = estimateTransportCost(km);
      const netPrice = transportCost != null ? Number(r.price) - transportCost : null;
      return {
        mandi: r.mandi_name,
        price: Number(r.price),
        trend: r.trend,
        distanceKm: km != null ? Math.round(km) : null,
        transportCost,
        netPrice,
      };
    });

    // Sort by best net price when we have location, else raw price
    rows.sort((a, b) => (b.netPrice ?? b.price) - (a.netPrice ?? a.price));

    const best = rows[0] || null;

    res.json({ crop, rows, best });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch price comparison" });
  }
});

module.exports = router;

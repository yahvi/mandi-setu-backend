const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

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

// GET /api/matches?crop=Onion
// Farmer sees vendors wanting that crop; vendor sees farmers offering it.
// Combined score = 45% price fit + 30% reliability (rating) + 25% distance.
router.get("/", requireAuth, async (req, res) => {
  const { crop } = req.query;
  if (!crop) return res.status(400).json({ error: "crop is required" });

  const wantType = req.user.role === "farmer" ? "requirement" : "produce";

  try {
    const me = await pool.query("SELECT lat, lng FROM users WHERE id = $1", [req.user.id]);
    const myLat = me.rows[0]?.lat;
    const myLng = me.rows[0]?.lng;

    const result = await pool.query(
      `SELECT l.id AS listing_id, l.crop, l.quantity, l.quality_grade, l.price, l.target_date,
              u.id AS user_id, u.full_name, u.phone, u.location, u.lat, u.lng, u.rating, u.completed_deals, u.is_verified
       FROM listings l
       JOIN users u ON u.id = l.user_id
       WHERE l.type = $1 AND l.crop ILIKE $2 AND l.status = 'active' AND u.id != $3`,
      [wantType, crop, req.user.id]
    );

    const rows = result.rows;
    if (rows.length === 0) return res.json({ crop, matches: [], best: null });

    const prices = rows.map((r) => Number(r.price));
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);
    const priceRange = maxPrice - minPrice || 1;

    const distances = rows.map((r) => distanceKm(myLat, myLng, r.lat, r.lng));
    const validDistances = distances.filter((d) => d != null);
    const maxDist = validDistances.length ? Math.max(...validDistances) : 1;

    const matches = rows.map((r, i) => {
      const price = Number(r.price);
      // Farmer wants the highest offered price; vendor wants the lowest asking price.
      const priceScore =
        req.user.role === "farmer"
          ? (price - minPrice) / priceRange
          : (maxPrice - price) / priceRange;

      const km = distances[i];
      const distanceScore = km != null ? 1 - Math.min(km / (maxDist || 1), 1) : 0.5;
      const reliabilityScore = Math.min(Number(r.rating) / 5, 1);

      const combinedScore = 0.45 * priceScore + 0.3 * reliabilityScore + 0.25 * distanceScore;

      return {
        listingId: r.listing_id,
        name: r.full_name,
        phone: r.phone,
        location: r.location,
        crop: r.crop,
        quantity: r.quantity,
        qualityGrade: r.quality_grade,
        price,
        rating: Number(r.rating),
        completedDeals: r.completed_deals,
        isVerified: r.is_verified,
        distanceKm: km != null ? Math.round(km) : null,
        combinedScore: Math.round(combinedScore * 1000) / 1000,
      };
    });

    matches.sort((a, b) => b.combinedScore - a.combinedScore);

    res.json({ crop, matches, best: matches[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch matches" });
  }
});

module.exports = router;

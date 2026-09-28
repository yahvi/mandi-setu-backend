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

// Transport mode pricing model. Rates are illustrative starting points —
// replace with a real logistics-partner rate card once one is available.
const TRANSPORT_MODES = [
  {
    mode: "Local tempo / mini-truck",
    description: "Best for short hauls, small quantities (up to ~15 quintal)",
    baseFee: 200,
    perKm: 15,
    maxRecommendedKm: 40,
  },
  {
    mode: "Shared truck (via FPO pooling)",
    description: "Cheaper per quintal when pooled with other farmers' produce",
    baseFee: 100,
    perKm: 9,
    maxRecommendedKm: 400,
  },
  {
    mode: "Refrigerated truck",
    description: "Recommended for perishables (tomato, etc.) on longer routes",
    baseFee: 500,
    perKm: 22,
    maxRecommendedKm: 400,
  },
];

// GET /api/logistics?distanceKm=45&lat=20.15&lng=74.28&crop=Onion
router.get("/", requireAuth, async (req, res) => {
  const distanceKmParam = parseFloat(req.query.distanceKm);
  const lat = req.query.lat ? parseFloat(req.query.lat) : null;
  const lng = req.query.lng ? parseFloat(req.query.lng) : null;
  const crop = req.query.crop || "";

  if (isNaN(distanceKmParam)) {
    return res.status(400).json({ error: "distanceKm is required" });
  }

  const transportOptions = TRANSPORT_MODES
    .filter((m) => distanceKmParam <= m.maxRecommendedKm)
    .map((m) => ({
      mode: m.mode,
      description: m.description,
      estimatedCost: Math.round(m.baseFee + m.perKm * distanceKmParam),
    }))
    .sort((a, b) => a.estimatedCost - b.estimatedCost);

  try {
    const result = await pool.query("SELECT * FROM storage_facilities");
    let storageOptions = result.rows.map((f) => {
      const km = distanceKm(lat, lng, f.lat, f.lng);
      return {
        name: f.name,
        location: f.location,
        distanceKm: km != null ? Math.round(km) : null,
        ratePerQuintalPerDay: Number(f.rate_per_quintal_per_day),
        capacityQuintal: f.capacity_quintal,
        handlesCrop: crop ? f.crop_types.toLowerCase().includes(crop.toLowerCase()) : true,
      };
    });

    // Prefer facilities that handle this crop, then sort by distance
    storageOptions.sort((a, b) => {
      if (a.handlesCrop !== b.handlesCrop) return a.handlesCrop ? -1 : 1;
      return (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999);
    });
    storageOptions = storageOptions.slice(0, 3);

    res.json({ transportOptions, storageOptions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch logistics options" });
  }
});

module.exports = router;

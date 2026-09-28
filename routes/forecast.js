const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Ordinary least-squares linear regression over (x, y) points.
// This is a transparent, explainable trend line \u2014 not a claim of a trained ML model.
function linearRegression(points) {
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// GET /api/prices/forecast?crop=Onion&mandi=Lasalgaon%20APMC
router.get("/forecast", requireAuth, async (req, res) => {
  const { crop, mandi } = req.query;
  if (!crop || !mandi) return res.status(400).json({ error: "crop and mandi are required" });

  try {
    const result = await pool.query(
      `SELECT price, recorded_date FROM mandi_prices
       WHERE crop ILIKE $1 AND mandi_name ILIKE $2
       ORDER BY recorded_date ASC`,
      [crop, mandi]
    );

    if (result.rows.length < 3) {
      return res.json({
        crop, mandi, history: result.rows, forecast: [],
        recommendation: "not-enough-data",
        reasoning: "Need at least 3 recorded price points to compute a trend.",
      });
    }

    const history = result.rows.map((r, i) => ({
      day: i,
      date: r.recorded_date,
      price: Number(r.price),
    }));

    const { slope, intercept } = linearRegression(history.map((h) => ({ x: h.day, y: h.price })));

    const lastDay = history[history.length - 1].day;
    const forecast = [1, 2, 3, 4].map((step) => {
      const day = lastDay + step;
      return { day, price: Math.round(intercept + slope * day) };
    });

    const currentPrice = history[history.length - 1].price;
    const projectedPrice = forecast[forecast.length - 1].price;
    const changePercent = ((projectedPrice - currentPrice) / currentPrice) * 100;

    let recommendation = "neutral";
    let reasoning = "Price is expected to stay roughly flat over the next 4 days.";
    if (changePercent > 2) {
      recommendation = "hold";
      reasoning = `Trend suggests prices may rise about ${changePercent.toFixed(1)}% over the next 4 days \u2014 holding briefly could pay off if storage is available.`;
    } else if (changePercent < -2) {
      recommendation = "sell-now";
      reasoning = `Trend suggests prices may fall about ${Math.abs(changePercent).toFixed(1)}% over the next 4 days \u2014 selling now may be safer.`;
    }

    res.json({
      crop, mandi, history, forecast, currentPrice, projectedPrice,
      changePercent: Math.round(changePercent * 10) / 10,
      recommendation, reasoning,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute forecast" });
  }
});

module.exports = router;

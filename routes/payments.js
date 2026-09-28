const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
require("dotenv").config();

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// POST /api/payments/create-order  { offerId }
// Creates a real Razorpay order (test mode by default) for an accepted offer.
router.post("/create-order", requireAuth, async (req, res) => {
  const { offerId } = req.body;
  if (!offerId) return res.status(400).json({ error: "offerId is required" });

  try {
    const offerResult = await pool.query("SELECT * FROM offers WHERE id = $1", [offerId]);
    if (offerResult.rows.length === 0) return res.status(404).json({ error: "Offer not found" });
    const offer = offerResult.rows[0];

    const isParty = offer.from_user_id === req.user.id || offer.to_user_id === req.user.id;
    if (!isParty) return res.status(403).json({ error: "Not your offer" });
    if (offer.status !== "accepted") {
      return res.status(400).json({ error: "Offer must be accepted before payment" });
    }

    // Razorpay expects amount in paise (smallest currency unit)
    const amountPaise = Math.round(Number(offer.offer_price) * 100);

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `offer_${offer.id}`,
      notes: { offerId: String(offer.id) },
    });

    await pool.query(
      `INSERT INTO payments (offer_id, razorpay_order_id, amount, status)
       VALUES ($1, $2, $3, 'created')`,
      [offer.id, order.id, offer.offer_price]
    );

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID, // public key, safe to expose to frontend
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create payment order. Check your Razorpay API keys in .env." });
  }
});

// POST /api/payments/verify  { orderId, paymentId, signature }
// Verifies Razorpay's HMAC signature (this is the real, mandatory security check
// that confirms the payment actually came from Razorpay and wasn't spoofed).
router.post("/verify", requireAuth, async (req, res) => {
  const { orderId, paymentId, signature } = req.body;
  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: "orderId, paymentId and signature are required" });
  }

  try {
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (expectedSignature !== signature) {
      await pool.query("UPDATE payments SET status = 'failed' WHERE razorpay_order_id = $1", [orderId]);
      return res.status(400).json({ error: "Payment signature verification failed" });
    }

    const paymentResult = await pool.query(
      `UPDATE payments SET razorpay_payment_id = $1, razorpay_signature = $2, status = 'paid'
       WHERE razorpay_order_id = $3 RETURNING offer_id`,
      [paymentId, signature, orderId]
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: "Matching payment order not found" });
    }

    const offerId = paymentResult.rows[0].offer_id;
    await pool.query("UPDATE offers SET status = 'paid' WHERE id = $1", [offerId]);

    res.json({ ok: true, offerId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Payment verification failed" });
  }
});

module.exports = router;

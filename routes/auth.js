const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
require("dotenv").config();

const router = express.Router();

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  const { role, fullName, email, password, phone, location, lat, lng } = req.body;

  if (!role || !fullName || !email || !password) {
    return res.status(400).json({ error: "role, fullName, email and password are required" });
  }
  if (!["farmer", "vendor"].includes(role)) {
    return res.status(400).json({ error: "role must be farmer or vendor" });
  }

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (role, full_name, email, password_hash, phone, location, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, role, full_name, email, location`,
      [role, fullName, email, passwordHash, phone || null, location || null, lat || null, lng || null]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Signup failed" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        role: user.role,
        full_name: user.full_name,
        email: user.email,
        location: user.location,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;

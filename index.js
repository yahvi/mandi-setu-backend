const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const priceRoutes = require("./routes/prices");
const forecastRoutes = require("./routes/forecast");
const listingRoutes = require("./routes/listings");
const matchRoutes = require("./routes/matches");
const alertRoutes = require("./routes/alerts");
const logisticsRoutes = require("./routes/logistics");
const offerRoutes = require("./routes/offers");
const paymentRoutes = require("./routes/payments");
const adminRoutes = require("./routes/admin");
const disputeRoutes = require("./routes/disputes");
const schemeRoutes = require("./routes/schemes");
const llmRoutes = require("./routes/llm");
const documentRoutes = require("./routes/documents");
const reviewRoutes = require("./routes/reviews");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" })); // higher limit needed for base64 document/photo uploads

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/prices", priceRoutes);
app.use("/api/prices", forecastRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/logistics", logisticsRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/disputes", disputeRoutes);
app.use("/api/schemes", schemeRoutes);
app.use("/api/llm", llmRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/reviews", reviewRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Mandi Setu API running on http://localhost:${PORT}`));

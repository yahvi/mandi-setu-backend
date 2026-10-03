```javascript
const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ============================================================
// CONFIGURATION
// ============================================================

const MAHARASHTRA_STATE_ID = 20;

// Official Government OGD mandi-price resource
const OGD_RESOURCE_ID =
  "9ef84268-d588-465a-a308-a864a43d0070";

const OGD_API_KEY = process.env.DATA_GOV_API_KEY || "";

const OGD_BASE_URL =
  `https://api.data.gov.in/resource/${OGD_RESOURCE_ID}`;

// ============================================================
// DISTANCE
// ============================================================

function distanceKm(lat1, lng1, lat2, lng2) {
  if (
    lat1 == null ||
    lng1 == null ||
    lat2 == null ||
    lng2 == null
  ) {
    return null;
  }

  const R = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );
}

// ============================================================
// TRANSPORT COST
// ============================================================

function estimateTransportCost(km) {
  if (km == null) return null;

  const baseFee = 40;
  const perKm = 3.2;

  return Math.round(baseFee + km * perKm);
}

// ============================================================
// INDIA DATE
// ============================================================

function getIndiaDate(offsetDays = 0) {
  const now = new Date();

  const indiaString = now.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
  });

  const indiaNow = new Date(indiaString);

  indiaNow.setDate(
    indiaNow.getDate() + offsetDays
  );

  const year = indiaNow.getFullYear();
  const month = String(
    indiaNow.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    indiaNow.getDate()
  ).padStart(2, "0");

  return {
    year,
    month: Number(month),
    day,
    date: `${year}-${month}-${day}`,
  };
}

// ============================================================
// CROP NORMALIZATION
// ============================================================

function normalizeCrop(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// ============================================================
// NUMBER HELPER
// ============================================================

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(
    String(value)
      .replace(/,/g, "")
      .replace(/₹/g, "")
      .trim()
  );

  return Number.isFinite(n) ? n : null;
}

// ============================================================
// FIRST AVAILABLE PROPERTY
// ============================================================

function firstValue(item, keys) {
  for (const key of keys) {
    if (
      item[key] !== undefined &&
      item[key] !== null &&
      item[key] !== ""
    ) {
      return item[key];
    }
  }

  return null;
}

// ============================================================
// RECURSIVE OBJECT COLLECTION
// ============================================================

function collectObjects(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjects(item, output);
    }

    return output;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    output.push(value);

    for (const child of Object.values(value)) {
      if (
        child &&
        typeof child === "object"
      ) {
        collectObjects(child, output);
      }
    }
  }

  return output;
}

// ============================================================
// GENERIC FETCH WITH TIMEOUT
// ============================================================

async function fetchJson(
  url,
  label,
  headers = {},
  timeoutMs = 15000
) {
  console.log(`Requesting ${label}`);

  const controller =
    new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept:
          "application/json, text/plain, */*",
        ...headers,
      },
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${text.slice(
          0,
          300
        )}`
      );
    }

    if (!text.trim()) {
      throw new Error(
        "Empty response received"
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `Invalid JSON response: ${text.slice(
          0,
          300
        )}`
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// OGD / DATA.GOV.IN
// ============================================================

function buildOgdUrl(crop, date) {
  const params =
    new URLSearchParams();

  params.set(
    "api-key",
    OGD_API_KEY
  );

  params.set("format", "json");

  params.set("limit", "10000");

  params.set("offset", "0");

  // Official OGD filters
  params.set(
    "filters[state]",
    "Maharashtra"
  );

  params.set(
    "filters[commodity]",
    crop
  );

  return `${OGD_BASE_URL}?${params.toString()}`;
}

async function fetchOgdMandiData(
  crop,
  date
) {
  if (!OGD_API_KEY) {
    console.warn(
      "DATA_GOV_API_KEY is not configured. Skipping OGD."
    );

    return null;
  }

  const url = buildOgdUrl(
    crop,
    date
  );

  return fetchJson(
    url,
    `Government OGD mandi data for ${crop}`,
    {
      "User-Agent":
        "MandiSetu/1.0",
    },
    15000
  );
}

// ============================================================
// OGD ROW EXTRACTION
// ============================================================

function extractOgdRows(
  report,
  requestedCrop,
  requestedDate
) {
  const wantedCrop =
    normalizeCrop(requestedCrop);

  let records = [];

  if (
    report &&
    Array.isArray(report.records)
  ) {
    records = report.records;
  } else {
    records =
      collectObjects(report);
  }

  const rows = [];

  for (const item of records) {
    const commodity =
      firstValue(item, [
        "commodity",
        "Commodity",
        "commodity_name",
        "Commodity Name",
        "crop",
        "cropName",
      ]);

    const state =
      firstValue(item, [
        "state",
        "State",
        "state_name",
        "State Name",
      ]);

    const mandi =
      firstValue(item, [
        "market",
        "Market",
        "market_name",
        "Market Name",
        "market_center",
        "Market Center",
        "mandi",
        "mandi_name",
        "Mandi",
      ]);

    const modalPrice =
      firstValue(item, [
        "modal_price",
        "Modal Price",
        "Modal Price (Rs./Quintal)",
        "modalPrice",
        "modal",
        "Modal",
      ]);

    if (
      !commodity ||
      !mandi ||
      modalPrice == null
    ) {
      continue;
    }

    const normalizedCommodity =
      normalizeCrop(commodity);

    const cropMatches =
      normalizedCommodity ===
        wantedCrop ||
      normalizedCommodity.includes(
        wantedCrop
      ) ||
      wantedCrop.includes(
        normalizedCommodity
      );

    if (!cropMatches) {
      continue;
    }

    if (
      state &&
      normalizeCrop(state) !==
        "maharashtra"
    ) {
      continue;
    }

    const price =
      toNumber(modalPrice);

    if (
      price == null ||
      price <= 0
    ) {
      continue;
    }

    const minimumPrice =
      toNumber(
        firstValue(item, [
          "min_price",
          "Min Price",
          "minimum_price",
          "Minimum Price",
          "minPrice",
        ])
      );

    const maximumPrice =
      toNumber(
        firstValue(item, [
          "max_price",
          "Max Price",
          "maximum_price",
          "Maximum Price",
          "maxPrice",
        ])
      );

    const arrivals =
      toNumber(
        firstValue(item, [
          "arrival",
          "arrivals",
          "Arrival",
          "Arrivals",
          "arrival_quantity",
          "Arrival Quantity",
        ])
      );

    const recordedDate =
      firstValue(item, [
        "arrival_date",
        "Arrival_Date",
        "Arrival Date",
        "date",
        "Date",
        "report_date",
        "Report Date",
      ]) ||
      requestedDate;

    rows.push({
      mandi: String(mandi).trim(),
      price,
      minimumPrice,
      maximumPrice,
      arrivals,
      recordedDate,
      trend: "steady",
      source: "data.gov.in",
    });
  }

  // Deduplicate by mandi
  const unique =
    new Map();

  for (const row of rows) {
    const key =
      normalizeMarketName(
        row.mandi
      );

    if (!unique.has(key)) {
      unique.set(key, row);
    }
  }

  return Array.from(
    unique.values()
  );
}

// ============================================================
// AGMARKNET HEADERS
// ============================================================

function agmarknetHeaders() {
  return {
    Accept:
      "application/json, text/plain, */*",

    Origin:
      "https://agmarknet.gov.in",

    Referer:
      "https://agmarknet.gov.in/",

    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36",
  };
}

// ============================================================
// AGMARKNET PRIMARY
// ============================================================

async function fetchAgmarknetStateReport(
  date
) {
  const url =
    "https://api.agmarknet.gov.in/v1/prices-and-arrivals/commodity-market/daily-report-state" +
    `?date=${encodeURIComponent(date)}` +
    `&state=${MAHARASHTRA_STATE_ID}` +
    "&includeExcel=false";

  return fetchJson(
    url,
    `AGMARKNET Maharashtra report: ${date}`,
    agmarknetHeaders(),
    15000
  );
}

// ============================================================
// AGMARKNET SECONDARY
// ============================================================

async function fetchAgmarknetCommodityWiseStateReport(
  date
) {
  const url =
    "https://api.agmarknet.gov.in/v1/prices-and-arrivals/commodity-wise/daily-report-state" +
    `?date=${encodeURIComponent(date)}` +
    `&stateIds=${MAHARASHTRA_STATE_ID}` +
    "&includeExcel=false";

  return fetchJson(
    url,
    `AGMARKNET secondary report: ${date}`,
    agmarknetHeaders(),
    15000
  );
}

// ============================================================
// AGMARKNET ROW EXTRACTION
// ============================================================

function extractAgmarknetRows(
  report,
  requestedCrop,
  sourceName,
  requestedDate
) {
  const wantedCrop =
    normalizeCrop(requestedCrop);

  const objects =
    collectObjects(report);

  const rows = [];

  for (const item of objects) {
    const commodity =
      firstValue(item, [
        "commodityName",
        "commodity",
        "commodity_name",
        "crop",
        "cropName",
        "crop_name",
        "Commodity Name",
        "Commodity",
      ]);

    const mandi =
      firstValue(item, [
        "marketCenter",
        "marketName",
        "market",
        "market_name",
        "apmc",
        "mandiName",
        "mandi",
        "mandi_name",
        "Market Center",
        "Market Name",
        "Market",
      ]);

    const modalPrice =
      firstValue(item, [
        "modalPrice",
        "modal_price",
        "modal",
        "modalprice",
        "Modal Price",
        "ModalPrice",
        "Modal",
        "Modal Price (Rs./Quintal)",
      ]);

    if (
      !commodity ||
      !mandi ||
      modalPrice == null
    ) {
      continue;
    }

    const commodityName =
      normalizeCrop(
        commodity
      );

    if (
      commodityName !==
        wantedCrop &&
      !commodityName.includes(
        wantedCrop
      ) &&
      !wantedCrop.includes(
        commodityName
      )
    ) {
      continue;
    }

    const price =
      toNumber(modalPrice);

    if (
      price == null ||
      price <= 0
    ) {
      continue;
    }

    const minimumPrice =
      toNumber(
        firstValue(item, [
          "minimumPrice",
          "minPrice",
          "min_price",
          "Minimum Price",
          "Min Price",
          "Min Price (Rs./Quintal)",
        ])
      );

    const maximumPrice =
      toNumber(
        firstValue(item, [
          "maximumPrice",
          "maxPrice",
          "max_price",
          "Maximum Price",
          "Max Price",
          "Max Price (Rs./Quintal)",
        ])
      );

    const arrivals =
      toNumber(
        firstValue(item, [
          "arrivals",
          "arrival",
          "arrivalsQty",
          "arrivalQuantity",
          "Arrival",
          "Arrivals",
        ])
      );

    const recordedDate =
      firstValue(item, [
        "date",
        "reportDate",
        "recordedDate",
        "recorded_date",
        "Date",
        "Report Date",
      ]) ||
      requestedDate;

    rows.push({
      mandi: String(mandi).trim(),
      price,
      trend: "steady",
      minimumPrice,
      maximumPrice,
      arrivals,
      recordedDate,
      source: sourceName,
    });
  }

  const unique =
    new Map();

  for (const row of rows) {
    const key =
      normalizeMarketName(
        row.mandi
      );

    if (!unique.has(key)) {
      unique.set(key, row);
    }
  }

  return Array.from(
    unique.values()
  );
}

// ============================================================
// MARKET NAME NORMALIZATION
// ============================================================

function normalizeMarketName(
  name
) {
  return String(name || "")
    .toLowerCase()
    .replace(/\bapmc\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// ============================================================
// DATABASE COORDINATES
// ============================================================

async function addDatabaseCoordinates(
  rows
) {
  if (!rows.length) {
    return rows;
  }

  try {
    const result =
      await pool.query(
        `SELECT mandi_name, lat, lng
         FROM mandi_prices
         WHERE lat IS NOT NULL
           AND lng IS NOT NULL`
      );

    const coordinates =
      new Map();

    for (const row of result.rows) {
      const key =
        normalizeMarketName(
          row.mandi_name
        );

      if (!coordinates.has(key)) {
        coordinates.set(key, {
          lat: Number(row.lat),
          lng: Number(row.lng),
        });
      }
    }

    return rows.map(
      (row) => {
        const location =
          coordinates.get(
            normalizeMarketName(
              row.mandi
            )
          );

        if (!location) {
          return row;
        }

        return {
          ...row,
          _lat: location.lat,
          _lng: location.lng,
        };
      }
    );
  } catch (err) {
    console.error(
      "Could not load market coordinates:",
      err.message
    );

    return rows;
  }
}

// ============================================================
// SAVE VERIFIED SOURCE DATA
// ============================================================

async function saveVerifiedRows(
  crop,
  rows,
  recordedDate
) {
  if (!rows.length) {
    return;
  }

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    // IMPORTANT:
    // Delete only AFTER a verified source has
    // successfully returned usable rows.
    await client.query(
      `DELETE FROM mandi_prices
       WHERE LOWER(crop) = LOWER($1)`,
      [crop]
    );

    for (const row of rows) {
      await client.query(
        `INSERT INTO mandi_prices
          (
            crop,
            mandi_name,
            lat,
            lng,
            price,
            trend,
            recorded_date
          )
         VALUES
          ($1,$2,$3,$4,$5,$6,$7)`,
        [
          crop,
          row.mandi,
          row._lat ?? null,
          row._lng ?? null,
          row.price,
          row.trend || "steady",
          row.recordedDate ||
            recordedDate ||
            null,
        ]
      );
    }

    await client.query(
      "COMMIT"
    );

    console.log(
      `Saved ${rows.length} verified ${crop} prices.`
    );
  } catch (err) {
    await client.query(
      "ROLLBACK"
    );

    console.error(
      "Could not save verified prices:",
      err.message
    );
  } finally {
    client.release();
  }
}

// ============================================================
// DATABASE FALLBACK
// ============================================================

async function getDatabaseRows(
  crop,
  userLat,
  userLng
) {
  const result =
    await pool.query(
      `SELECT
         mandi_name,
         lat,
         lng,
         price,
         trend,
         recorded_date
       FROM (
         SELECT
           mandi_name,
           lat,
           lng,
           price,
           trend,
           recorded_date,
           ROW_NUMBER() OVER (
             PARTITION BY
               LOWER(TRIM(mandi_name))
             ORDER BY
               recorded_date DESC NULLS LAST
           ) AS rn
         FROM mandi_prices
         WHERE crop ILIKE $1
       ) AS latest
       WHERE rn = 1
       ORDER BY price DESC`,
      [crop]
    );

  return result.rows.map(
    (r) => {
      const km =
        distanceKm(
          userLat,
          userLng,
          r.lat,
          r.lng
        );

      const transportCost =
        estimateTransportCost(
          km
        );

      const netPrice =
        transportCost != null
          ? Number(r.price) -
            transportCost
          : null;

      return {
        mandi: r.mandi_name,

        price: Number(
          r.price
        ),

        trend:
          r.trend ||
          "steady",

        distanceKm:
          km != null
            ? Math.round(km)
            : null,

        transportCost,

        netPrice,

        source:
          "database-fallback",

        recordedDate:
          r.recorded_date ||
          null,
      };
    }
  );
}

// ============================================================
// BUILD FINAL API ROWS
// ============================================================

function buildApiRows(
  rows,
  userLat,
  userLng
) {
  return rows.map(
    (row) => {
      const km =
        distanceKm(
          userLat,
          userLng,
          row._lat,
          row._lng
        );

      const transportCost =
        estimateTransportCost(
          km
        );

      const netPrice =
        transportCost != null
          ? Number(row.price) -
            transportCost
          : Number(row.price);

      return {
        mandi: row.mandi,

        price: Number(
          row.price
        ),

        trend:
          row.trend ||
          "steady",

        distanceKm:
          km != null
            ? Math.round(km)
            : null,

        transportCost,

        netPrice,

        minimumPrice:
          row.minimumPrice ??
          null,

        maximumPrice:
          row.maximumPrice ??
          null,

        arrivals:
          row.arrivals ??
          null,

        source:
          row.source,

        recordedDate:
          row.recordedDate ||
          null,
      };
    }
  );
}

// ============================================================
// TRY OGD
// ============================================================

async function tryOgd(
  crop
) {
  if (!OGD_API_KEY) {
    return null;
  }

  // Try today first, then yesterday.
  for (
    let daysAgo = 0;
    daysAgo <= 1;
    daysAgo++
  ) {
    const dateInfo =
      getIndiaDate(
        -daysAgo
      );

    try {
      console.log(
        `Trying Government OGD for ${crop} on ${dateInfo.date}`
      );

      const report =
        await fetchOgdMandiData(
          crop,
          dateInfo.date
        );

      const rows =
        extractOgdRows(
          report,
          crop,
          dateInfo.date
        );

      console.log(
        `Government OGD returned ${rows.length} usable ${crop} rows.`
      );

      if (rows.length > 0) {
        return {
          rows,
          date:
            dateInfo.date,
          source:
            "data.gov.in",
        };
      }
    } catch (err) {
      if (
        err.name ===
        "AbortError"
      ) {
        console.error(
          `Government OGD timed out for ${dateInfo.date}`
        );
      } else {
        console.error(
          `Government OGD failed for ${dateInfo.date}:`,
          err.message
        );
      }
    }
  }

  return null;
}

// ============================================================
// TRY AGMARKNET
// ============================================================

async function tryAgmarknet(
  crop
) {
  const sources = [
    {
      name: "AGMARKNET",
      fetch:
        fetchAgmarknetStateReport,
    },
    {
      name:
        "AGMARKNET-secondary",
      fetch:
        fetchAgmarknetCommodityWiseStateReport,
    },
  ];

  for (const source of sources) {
    for (
      let daysAgo = 0;
      daysAgo <= 1;
      daysAgo++
    ) {
      const dateInfo =
        getIndiaDate(
          -daysAgo
        );

      try {
        console.log(
          `Trying ${source.name} for ${crop} on ${dateInfo.date}`
        );

        const report =
          await source.fetch(
            dateInfo.date
          );

        const rows =
          extractAgmarknetRows(
            report,
            crop,
            source.name,
            dateInfo.date
          );

        console.log(
          `${source.name} returned ${rows.length} usable ${crop} rows.`
        );

        if (rows.length > 0) {
          return {
            rows,
            date:
              dateInfo.date,
            source:
              source.name,
          };
        }
      } catch (err) {
        if (
          err.name ===
          "AbortError"
        ) {
          console.error(
            `${source.name} timed out for ${dateInfo.date}`
          );
        } else {
          console.error(
            `${source.name} failed for ${dateInfo.date}:`,
            err.message
          );
        }
      }
    }
  }

  return null;
}

// ============================================================
// GET /api/prices/compare
// ============================================================

router.get(
  "/compare",
  requireAuth,
  async (req, res) => {
    const {
      crop,
      lat,
      lng,
    } = req.query;

    if (!crop) {
      return res.status(400).json({
        error:
          "crop is required",
      });
    }

    const userLat =
      lat &&
      Number.isFinite(
        parseFloat(lat)
      )
        ? parseFloat(lat)
        : null;

    const userLng =
      lng &&
      Number.isFinite(
        parseFloat(lng)
      )
        ? parseFloat(lng)
        : null;

    const normalizedCrop =
      String(crop).trim();

    try {
      // ======================================================
      // 1. GOVERNMENT OGD
      // ======================================================

      let verified =
        await tryOgd(
          normalizedCrop
        );

      // ======================================================
      // 2. AGMARKNET
      // ======================================================

      if (!verified) {
        verified =
          await tryAgmarknet(
            normalizedCrop
          );
      }

      // ======================================================
      // VERIFIED LIVE GOVERNMENT DATA
      // ======================================================

      if (
        verified &&
        verified.rows.length > 0
      ) {
        const rowsWithCoordinates =
          await addDatabaseCoordinates(
            verified.rows
          );

        const rows =
          buildApiRows(
            rowsWithCoordinates,
            userLat,
            userLng
          );

        rows.sort(
          (a, b) =>
            (b.netPrice ??
              b.price) -
            (a.netPrice ??
              a.price)
        );

        // Save only verified data.
        await saveVerifiedRows(
          normalizedCrop,
          rowsWithCoordinates,
          verified.date
        );

        return res.json({
          crop:
            normalizedCrop,

          state:
            "Maharashtra",

          source:
            verified.source,

          dataStatus:
            "live",

          recordedDate:
            verified.date,

          rows,

          best:
            rows[0] ||
            null,
        });
      }

      // ======================================================
      // 3. DATABASE VERIFIED CACHE
      // ======================================================

      console.warn(
        `Government sources unavailable for ${normalizedCrop}. Using PostgreSQL verified cache.`
      );

      const rows =
        await getDatabaseRows(
          normalizedCrop,
          userLat,
          userLng
        );

      rows.sort(
        (a, b) =>
          (b.netPrice ??
            b.price) -
          (a.netPrice ??
            a.price)
      );

      if (rows.length === 0) {
        return res.status(503).json({
          error:
            "No verified market price data is currently available.",
          crop:
            normalizedCrop,
          state:
            "Maharashtra",
          dataStatus:
            "unavailable",
          rows: [],
          best: null,
        });
      }

      return res.json({
        crop:
          normalizedCrop,

        state:
          "Maharashtra",

        source:
          "database-fallback",

        dataStatus:
          "cached",

        recordedDate:
          rows[0]?.recordedDate ||
          null,

        rows,

        best:
          rows[0] ||
          null,
      });
    } catch (err) {
      console.error(
        "Price comparison error:",
        err
      );

      return res.status(500).json({
        error:
          "Unable to load market prices right now.",
      }); 
    }
  }
);

module.exports = router;

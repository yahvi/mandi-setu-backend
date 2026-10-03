const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const MAHARASHTRA_STATE_ID = 20;

// ============================================================
// BASIC HELPERS
// ============================================================

function normalizeCrop(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeMarketName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\bapmc\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  var cleaned = String(value)
    .replace(/,/g, "")
    .replace(/₹/g, "")
    .trim();

  var number = Number(cleaned);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
}

// ============================================================
// INDIA DATE
// ============================================================

function getIndiaDate(offsetDays) {
  var offset = Number(offsetDays || 0);

  var now = new Date();

  var indiaString = now.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
  });

  var indiaNow = new Date(indiaString);

  if (offset !== 0) {
    indiaNow.setDate(indiaNow.getDate() + offset);
  }

  var year = indiaNow.getFullYear();
  var month = String(indiaNow.getMonth() + 1).padStart(2, "0");
  var day = String(indiaNow.getDate()).padStart(2, "0");

  return {
    year: year,
    month: Number(month),
    day: day,
    date: year + "-" + month + "-" + day,
  };
}

// ============================================================
// DATE NORMALIZATION
// ============================================================

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }

    return value.toISOString().slice(0, 10);
  }

  var text = String(value).trim();

  if (!text) {
    return null;
  }

  // YYYY-MM-DD
  var isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoMatch) {
    return (
      isoMatch[1] +
      "-" +
      isoMatch[2] +
      "-" +
      isoMatch[3]
    );
  }

  // DD/MM/YYYY
  var slashMatch = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  );

  if (slashMatch) {
    return (
      slashMatch[3] +
      "-" +
      String(slashMatch[2]).padStart(2, "0") +
      "-" +
      String(slashMatch[1]).padStart(2, "0")
    );
  }

  // DD-MM-YYYY
  var dashMatch = text.match(
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/
  );

  if (dashMatch) {
    return (
      dashMatch[3] +
      "-" +
      String(dashMatch[2]).padStart(2, "0") +
      "-" +
      String(dashMatch[1]).padStart(2, "0")
    );
  }

  var parsed = new Date(text);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

// ============================================================
// DISTANCE
// ============================================================

function distanceKm(lat1, lng1, lat2, lng2) {
  if (
    lat1 === null ||
    lat1 === undefined ||
    lng1 === null ||
    lng1 === undefined ||
    lat2 === null ||
    lat2 === undefined ||
    lng2 === null ||
    lng2 === undefined
  ) {
    return null;
  }

  var aLat = Number(lat1);
  var aLng = Number(lng1);
  var bLat = Number(lat2);
  var bLng = Number(lng2);

  if (
    !Number.isFinite(aLat) ||
    !Number.isFinite(aLng) ||
    !Number.isFinite(bLat) ||
    !Number.isFinite(bLng)
  ) {
    return null;
  }

  var earthRadius = 6371;

  var dLat = ((bLat - aLat) * Math.PI) / 180;
  var dLng = ((bLng - aLng) * Math.PI) / 180;

  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return (
    earthRadius *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

// ============================================================
// TRANSPORT COST
// ============================================================

function estimateTransportCost(km) {
  if (km === null || km === undefined) {
    return null;
  }

  if (!Number.isFinite(Number(km))) {
    return null;
  }

  var baseFee = 40;
  var perKm = 3.2;

  return Math.round(baseFee + Number(km) * perKm);
}

// ============================================================
// AGMARKNET HEADERS
// ============================================================

function getAgmarknetHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    Origin: "https://agmarknet.gov.in",
    Referer: "https://agmarknet.gov.in/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36",
  };
}

// ============================================================
// FETCH WITH TIMEOUT
// ============================================================

async function fetchWithTimeout(url, label) {
  console.log("Requesting " + label);

  var controller = new AbortController();

  var timeout = setTimeout(function () {
    controller.abort();
  }, 15000);

  try {
    var response = await fetch(url, {
      method: "GET",
      headers: getAgmarknetHeaders(),
      signal: controller.signal,
    });

    var text = await response.text();

    if (!response.ok) {
      throw new Error(
        "HTTP " +
          response.status +
          ": " +
          text.slice(0, 250)
      );
    }

    if (!text || !text.trim()) {
      throw new Error("Empty response received");
    }

    var json;

    try {
      json = JSON.parse(text);
    } catch (parseError) {
      throw new Error(
        "Invalid JSON response: " +
          text.slice(0, 250)
      );
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// AGMARKNET PRIMARY
// ============================================================

async function fetchAgmarknetPrimary(date) {
  var url =
    "https://api.agmarknet.gov.in/v1/prices-and-arrivals/commodity-market/daily-report-state" +
    "?date=" +
    encodeURIComponent(date) +
    "&state=" +
    String(MAHARASHTRA_STATE_ID) +
    "&includeExcel=false";

  return fetchWithTimeout(
    url,
    "AGMARKNET primary report for " + date
  );
}

// ============================================================
// AGMARKNET SECONDARY
// ============================================================

async function fetchAgmarknetSecondary(date) {
  var url =
    "https://api.agmarknet.gov.in/v1/prices-and-arrivals/commodity-wise/daily-report-state" +
    "?date=" +
    encodeURIComponent(date) +
    "&stateIds=" +
    String(MAHARASHTRA_STATE_ID) +
    "&includeExcel=false";

  return fetchWithTimeout(
    url,
    "AGMARKNET secondary report for " + date
  );
}

// ============================================================
// RECURSIVE OBJECT COLLECTION
// ============================================================

function collectObjects(value, output) {
  var result = output || [];

  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) {
      collectObjects(value[i], result);
    }

    return result;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    result.push(value);

    var children = Object.values(value);

    for (var j = 0; j < children.length; j++) {
      if (
        children[j] &&
        typeof children[j] === "object"
      ) {
        collectObjects(children[j], result);
      }
    }
  }

  return result;
}

// ============================================================
// PROPERTY LOOKUP
// ============================================================

function firstValue(object, keys) {
  if (!object || typeof object !== "object") {
    return null;
  }

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];

    if (
      object[key] !== undefined &&
      object[key] !== null &&
      object[key] !== ""
    ) {
      return object[key];
    }
  }

  return null;
}

// ============================================================
// EXTRACT AGMARKNET DATA
// ============================================================

function extractAgmarknetRows(
  report,
  requestedCrop,
  sourceName,
  requestedDate
) {
  var wantedCrop = normalizeCrop(requestedCrop);

  if (!report) {
    return [];
  }

  var objects = collectObjects(report, []);
  var rows = [];

  for (var i = 0; i < objects.length; i++) {
    var item = objects[i];

    var commodity = firstValue(item, [
      "commodityName",
      "commodity",
      "commodity_name",
      "crop",
      "cropName",
      "crop_name",
      "Commodity Name",
      "Commodity",
    ]);

    var mandi = firstValue(item, [
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

    var modalPrice = firstValue(item, [
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
      commodity === null ||
      commodity === undefined ||
      mandi === null ||
      mandi === undefined ||
      modalPrice === null ||
      modalPrice === undefined
    ) {
      continue;
    }

    var normalizedCommodity =
      normalizeCrop(commodity);

    var cropMatches =
      normalizedCommodity === wantedCrop ||
      normalizedCommodity.indexOf(wantedCrop) !== -1 ||
      wantedCrop.indexOf(normalizedCommodity) !== -1;

    if (!cropMatches) {
      continue;
    }

    var price = toNumber(modalPrice);

    if (
      price === null ||
      price <= 0
    ) {
      continue;
    }

    var minimumPrice = toNumber(
      firstValue(item, [
        "minimumPrice",
        "minPrice",
        "min_price",
        "minimum",
        "Minimum Price",
        "Min Price",
        "Min Price (Rs./Quintal)",
      ])
    );

    var maximumPrice = toNumber(
      firstValue(item, [
        "maximumPrice",
        "maxPrice",
        "max_price",
        "maximum",
        "Maximum Price",
        "Max Price",
        "Max Price (Rs./Quintal)",
      ])
    );

    var arrivals = toNumber(
      firstValue(item, [
        "arrivals",
        "arrival",
        "arrivalsQty",
        "arrivalQuantity",
        "Arrival",
        "Arrivals",
      ])
    );

    var sourceDate = normalizeDate(
      firstValue(item, [
        "date",
        "reportDate",
        "recordedDate",
        "recorded_date",
        "Date",
        "Report Date",
      ])
    );

    var mandiName = String(mandi).trim();

    if (!mandiName) {
      continue;
    }

    rows.push({
      mandi: mandiName,
      price: price,
      trend: "steady",
      minimumPrice: minimumPrice,
      maximumPrice: maximumPrice,
      arrivals: arrivals,
      recordedDate:
        sourceDate || requestedDate,
      source: sourceName,
    });
  }

  // ========================================================
  // REMOVE DUPLICATE MANDIS
  // ========================================================

  var unique = new Map();

  for (var k = 0; k < rows.length; k++) {
    var row = rows[k];

    var key = normalizeMarketName(
      row.mandi
    );

    if (!key) {
      continue;
    }

    if (!unique.has(key)) {
      unique.set(key, row);
    }
  }

  return Array.from(unique.values());
}

// ============================================================
// LOAD MARKET COORDINATES
// ============================================================

async function addDatabaseCoordinates(rows) {
  if (!rows || rows.length === 0) {
    return [];
  }

  try {
    var result = await pool.query(
      "SELECT mandi_name, lat, lng " +
        "FROM mandi_prices " +
        "WHERE lat IS NOT NULL " +
        "AND lng IS NOT NULL"
    );

    var coordinates = new Map();

    for (var i = 0; i < result.rows.length; i++) {
      var databaseRow = result.rows[i];

      var key = normalizeMarketName(
        databaseRow.mandi_name
      );

      if (!key) {
        continue;
      }

      if (!coordinates.has(key)) {
        coordinates.set(key, {
          lat: toNumber(databaseRow.lat),
          lng: toNumber(databaseRow.lng),
        });
      }
    }

    return rows.map(function (row) {
      var location = coordinates.get(
        normalizeMarketName(row.mandi)
      );

      if (!location) {
        return row;
      }

      return Object.assign({}, row, {
        _lat: location.lat,
        _lng: location.lng,
      });
    });
  } catch (error) {
    console.error(
      "Could not load market coordinates:",
      error.message
    );

    return rows;
  }
}

// ============================================================
// SAVE VERIFIED DATA
// ============================================================

async function saveVerifiedRows(
  crop,
  rows,
  fallbackDate
) {
  if (!rows || rows.length === 0) {
    return false;
  }

  var client = await pool.connect();

  try {
    await client.query("BEGIN");

    // IMPORTANT:
    // Delete old data ONLY after verified fresh data exists.
    await client.query(
      "DELETE FROM mandi_prices " +
        "WHERE LOWER(crop) = LOWER($1)",
      [crop]
    );

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];

      var recordedDate =
        normalizeDate(row.recordedDate) ||
        normalizeDate(fallbackDate);

      await client.query(
        "INSERT INTO mandi_prices " +
          "(crop, mandi_name, lat, lng, price, trend, recorded_date) " +
          "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          crop,
          row.mandi,
          row._lat || null,
          row._lng || null,
          row.price,
          row.trend || "steady",
          recordedDate,
        ]
      );
    }

    await client.query("COMMIT");

    console.log(
      "Saved " +
        String(rows.length) +
        " verified " +
        crop +
        " rows to PostgreSQL."
    );

    return true;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "Database rollback failed:",
        rollbackError.message
      );
    }

    console.error(
      "Could not save verified market data:",
      error.message
    );

    return false;
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
  var result = await pool.query(
    "SELECT " +
      "mandi_name, " +
      "lat, " +
      "lng, " +
      "price, " +
      "trend, " +
      "recorded_date " +
      "FROM (" +
      "SELECT " +
      "mandi_name, " +
      "lat, " +
      "lng, " +
      "price, " +
      "trend, " +
      "recorded_date, " +
      "ROW_NUMBER() OVER (" +
      "PARTITION BY LOWER(TRIM(mandi_name)) " +
      "ORDER BY recorded_date DESC NULLS LAST" +
      ") AS rn " +
      "FROM mandi_prices " +
      "WHERE LOWER(crop) = LOWER($1)" +
      ") AS latest " +
      "WHERE rn = 1 " +
      "ORDER BY price DESC",
    [crop]
  );

  return result.rows.map(function (row) {
    var km = distanceKm(
      userLat,
      userLng,
      row.lat,
      row.lng
    );

    var transportCost =
      estimateTransportCost(km);

    var price = toNumber(row.price);

    var netPrice =
      price !== null &&
      transportCost !== null
        ? price - transportCost
        : price;

    return {
      mandi: row.mandi_name,
      price: price,
      trend: row.trend || "steady",

      distanceKm:
        km !== null
          ? Math.round(km)
          : null,

      transportCost: transportCost,

      netPrice: netPrice,

      source: "database-fallback",

      recordedDate:
        normalizeDate(row.recorded_date),
    };
  });
}

// ============================================================
// FETCH FRESH MARKET DATA
// ============================================================

async function getFreshMarketData(crop) {
  var sources = [
    {
      name: "AGMARKNET",
      fetch: fetchAgmarknetPrimary,
    },
    {
      name: "AGMARKNET-secondary",
      fetch: fetchAgmarknetSecondary,
    },
  ];

  for (var sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    var source = sources[sourceIndex];

    for (var daysAgo = 0; daysAgo <= 1; daysAgo++) {
      var dateInfo = getIndiaDate(-daysAgo);

      try {
        console.log(
          "Trying " +
            source.name +
            " for " +
            crop +
            " on " +
            dateInfo.date
        );

        var report = await source.fetch(
          dateInfo.date
        );

        var rows = extractAgmarknetRows(
          report,
          crop,
          source.name,
          dateInfo.date
        );

        console.log(
          source.name +
            " returned " +
            String(rows.length) +
            " usable rows for " +
            crop +
            " on " +
            dateInfo.date
        );

        if (rows.length > 0) {
          return {
            rows: rows,
            source: source.name,
            date: dateInfo.date,
          };
        }
      } catch (error) {
        if (error.name === "AbortError") {
          console.error(
            source.name +
              " timed out for " +
              dateInfo.date
          );
        } else {
          console.error(
            source.name +
              " failed for " +
              dateInfo.date +
              ": " +
              error.message
          );
        }
      }
    }
  }

  return null;
}

// ============================================================
// PREPARE API ROWS
// ============================================================

function prepareApiRows(
  rows,
  userLat,
  userLng
) {
  return rows.map(function (row) {
    var km = distanceKm(
      userLat,
      userLng,
      row._lat,
      row._lng
    );

    var transportCost =
      estimateTransportCost(km);

    var price = toNumber(row.price);

    var netPrice =
      price !== null &&
      transportCost !== null
        ? price - transportCost
        : price;

    return {
      mandi: row.mandi,

      price: price,

      trend:
        row.trend || "steady",

      distanceKm:
        km !== null
          ? Math.round(km)
          : null,

      transportCost:
        transportCost,

      netPrice:
        netPrice,

      minimumPrice:
        row.minimumPrice,

      maximumPrice:
        row.maximumPrice,

      arrivals:
        row.arrivals,

      source:
        row.source || "AGMARKNET",

      recordedDate:
        normalizeDate(row.recordedDate),
    };
  });
}

// ============================================================
// SORT RESULTS
// ============================================================

function sortRows(rows) {
  return rows.sort(function (a, b) {
    var aValue =
      a.netPrice !== null &&
      a.netPrice !== undefined
        ? a.netPrice
        : a.price || 0;

    var bValue =
      b.netPrice !== null &&
      b.netPrice !== undefined
        ? b.netPrice
        : b.price || 0;

    return bValue - aValue;
  });
}

// ============================================================
// GET /api/prices/compare
// ============================================================

router.get(
  "/compare",
  requireAuth,
  async function (req, res) {
    var crop = req.query.crop;
    var lat = req.query.lat;
    var lng = req.query.lng;

    if (!crop) {
      return res.status(400).json({
        error: "crop is required",
      });
    }

    crop = String(crop).trim();

    var userLat = null;
    var userLng = null;

    if (
      lat !== undefined &&
      lat !== null &&
      lat !== ""
    ) {
      var parsedLat = Number(lat);

      if (Number.isFinite(parsedLat)) {
        userLat = parsedLat;
      }
    }

    if (
      lng !== undefined &&
      lng !== null &&
      lng !== ""
    ) {
      var parsedLng = Number(lng);

      if (Number.isFinite(parsedLng)) {
        userLng = parsedLng;
      }
    }

    try {
      // ======================================================
      // STEP 1:
      // Try official AGMARKNET
      // ======================================================

      var freshData =
        await getFreshMarketData(crop);

      if (
        freshData &&
        freshData.rows &&
        freshData.rows.length > 0
      ) {
        console.log(
          "Fresh verified data found from " +
            freshData.source +
            " for " +
            crop
        );

        var rowsWithCoordinates =
          await addDatabaseCoordinates(
            freshData.rows
          );

        var apiRows = prepareApiRows(
          rowsWithCoordinates,
          userLat,
          userLng
        );

        apiRows = sortRows(apiRows);

        // ====================================================
        // STEP 2:
        // Cache verified data safely
        // ====================================================

        var saved = await saveVerifiedRows(
          crop,
          rowsWithCoordinates,
          freshData.date
        );

        if (!saved) {
          console.warn(
            "Fresh data was obtained, but PostgreSQL cache update failed."
          );
        }

        return res.json({
          crop: crop,
          state: "Maharashtra",

          source:
            freshData.source,

          dataStatus: "live",

          recordedDate:
            freshData.date,

          rows: apiRows,

          best:
            apiRows.length > 0
              ? apiRows[0]
              : null,
        });
      }

      // ======================================================
      // STEP 3:
      // Official sources unavailable
      // Use PostgreSQL verified cache
      // ======================================================

      console.warn(
        "Official mandi sources unavailable for " +
          crop +
          ". Using PostgreSQL cache."
      );

      var cachedRows =
        await getDatabaseRows(
          crop,
          userLat,
          userLng
        );

      cachedRows = sortRows(
        cachedRows
      );

      return res.json({
        crop: crop,

        state: "Maharashtra",

        source:
          "database-fallback",

        dataStatus:
          cachedRows.length > 0
            ? "cached"
            : "no-data",

        recordedDate:
          cachedRows.length > 0
            ? cachedRows[0].recordedDate
            : null,

        rows: cachedRows,

        best:
          cachedRows.length > 0
            ? cachedRows[0]
            : null,
      });
    } catch (error) {
      console.error(
        "Price comparison route error:",
        error
      );

      // ======================================================
      // FINAL SAFETY FALLBACK
      // ======================================================

      try {
        var emergencyRows =
          await getDatabaseRows(
            crop,
            userLat,
            userLng
          );

        emergencyRows =
          sortRows(emergencyRows);

        return res.json({
          crop: crop,

          state: "Maharashtra",

          source:
            "database-fallback",

          dataStatus:
            emergencyRows.length > 0
              ? "cached"
              : "no-data",

          recordedDate:
            emergencyRows.length > 0
              ? emergencyRows[0].recordedDate
              : null,

          rows: emergencyRows,

          best:
            emergencyRows.length > 0
              ? emergencyRows[0]
              : null,
        });
      } catch (databaseError) {
        console.error(
          "Emergency database fallback failed:",
          databaseError
        );

        return res.status(500).json({
          error:
            "Unable to load market prices right now.",
        });
      }
    }
  }
);

module.exports = router;



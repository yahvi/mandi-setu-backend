const express = require("express");
const { createWorker } = require("tesseract.js");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Very light structured-field pull from raw OCR text. OCR output is noisy, so this
// looks for a few common patterns (survey/gat numbers, area in hectares/acres) rather
// than attempting full document understanding.
function extractStructuredFields(text) {
  const surveyMatch = text.match(/(?:survey|gat)\s*(?:no\.?|number)?\s*[:\-]?\s*(\d+[\/\-]?\d*)/i);
  const areaMatch = text.match(/(\d+(\.\d+)?)\s*(hectare|ha|acre)/i);
  const nameMatch = text.match(/name\s*[:\-]\s*([A-Za-z\s]+)/i);

  return {
    surveyNumber: surveyMatch ? surveyMatch[1] : null,
    area: areaMatch ? `${areaMatch[1]} ${areaMatch[3]}` : null,
    name: nameMatch ? nameMatch[1].trim() : null,
  };
}

// POST /api/documents/upload  { docType, fileName, imageBase64 }
// imageBase64 should be a data URL or raw base64 PNG/JPEG.
router.post("/upload", requireAuth, async (req, res) => {
  const { docType, fileName, imageBase64 } = req.body;
  if (!docType || !imageBase64) {
    return res.status(400).json({ error: "docType and imageBase64 are required" });
  }

  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    const worker = await createWorker("eng");
    const { data } = await worker.recognize(buffer);
    await worker.terminate();

    const structured = extractStructuredFields(data.text);

    const result = await pool.query(
      `INSERT INTO documents (user_id, doc_type, file_name, extracted_text, structured_data)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, docType, fileName || null, data.text, JSON.stringify(structured)]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OCR processing failed. Large or low-quality images may time out." });
  }
});

// GET /api/documents/mine
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM documents WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

module.exports = router;

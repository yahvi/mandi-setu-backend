-- Mandi Setu database schema
-- Run with: psql -U youruser -d mandisetu -f schema.sql

DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS schemes CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS offers CASCADE;
DROP TABLE IF EXISTS listings CASCADE;
DROP TABLE IF EXISTS mandi_prices CASCADE;
DROP TABLE IF EXISTS storage_facilities CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  role VARCHAR(10) NOT NULL CHECK (role IN ('farmer', 'vendor', 'admin')),
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  phone VARCHAR(20),
  location VARCHAR(200),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  rating NUMERIC(2,1) DEFAULT 4.5,
  completed_deals INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- One row per crop listing (farmer produce) or requirement (vendor need)
CREATE TABLE listings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(12) NOT NULL CHECK (type IN ('produce', 'requirement')),
  crop VARCHAR(80) NOT NULL,
  quantity NUMERIC(10,2),
  quality_grade VARCHAR(20) DEFAULT 'Standard',
  price NUMERIC(10,2) NOT NULL, -- expected price (farmer) or offered price (vendor)
  target_date DATE,
  status VARCHAR(15) DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE mandi_prices (
  id SERIAL PRIMARY KEY,
  crop VARCHAR(80) NOT NULL,
  mandi_name VARCHAR(120) NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  price NUMERIC(10,2) NOT NULL,
  trend VARCHAR(6) DEFAULT 'flat' CHECK (trend IN ('up', 'down', 'flat')),
  recorded_date DATE DEFAULT CURRENT_DATE
);

CREATE TABLE offers (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  from_user_id INTEGER REFERENCES users(id),
  to_user_id INTEGER REFERENCES users(id),
  offer_price NUMERIC(10,2),
  status VARCHAR(15) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'paid', 'delivered', 'rejected')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Real feedback left after a delivered transaction. This replaces the seeded,
-- static users.rating with a genuine average computed from actual reviews.
CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  offer_id INTEGER REFERENCES offers(id) ON DELETE CASCADE,
  reviewer_user_id INTEGER REFERENCES users(id),
  reviewee_user_id INTEGER REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (offer_id, reviewer_user_id)
);

-- Real Razorpay order/payment tracking (test-mode by default; see .env.example)
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  offer_id INTEGER REFERENCES offers(id) ON DELETE CASCADE,  razorpay_order_id VARCHAR(80) NOT NULL,
  razorpay_payment_id VARCHAR(80),
  razorpay_signature VARCHAR(200),
  amount NUMERIC(10,2) NOT NULL,
  status VARCHAR(15) DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cold storage / warehouse facilities a farmer can consider when "holding" produce
CREATE TABLE storage_facilities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  location VARCHAR(200),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  crop_types VARCHAR(200), -- comma-separated, e.g. 'Onion,Potato'
  rate_per_quintal_per_day NUMERIC(6,2) NOT NULL,
  capacity_quintal INTEGER
);

CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Uploaded documents (land records, ID, scheme notices) with real OCR text
-- (via Tesseract.js) and a structured-fields extraction pass.
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(30) NOT NULL CHECK (doc_type IN ('land_record', 'id_proof', 'scheme_notice', 'other')),
  file_name VARCHAR(200),
  extracted_text TEXT,
  structured_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Real government scheme reference data (see backend/README for sources).
-- This is a static reference dataset, not a live government feed.
CREATE TABLE schemes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  level VARCHAR(10) NOT NULL CHECK (level IN ('central', 'state')),
  category VARCHAR(80),
  eligibility TEXT,
  benefit TEXT,
  application_process TEXT,
  required_documents TEXT,
  official_url VARCHAR(300)
);

-- Grievance / dispute resolution on a completed or in-progress offer
CREATE TABLE disputes (
  id SERIAL PRIMARY KEY,
  offer_id INTEGER REFERENCES offers(id) ON DELETE CASCADE,
  raised_by_user_id INTEGER REFERENCES users(id),
  reason TEXT NOT NULL,
  status VARCHAR(15) DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'rejected')),
  resolution_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- ---------- Seed data (Maharashtra mandis, demo users) ----------

-- Current-day prices (used by the comparison table)
INSERT INTO mandi_prices (crop, mandi_name, lat, lng, price, trend) VALUES
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1840, 'up'),
('Onion', 'Pimpalgaon APMC', 20.1730, 74.0000, 1795, 'up'),
('Onion', 'Nashik APMC', 19.9975, 73.7898, 1760, 'down'),
('Onion', 'Pune / Baratati APMC', 18.5204, 73.8567, 2775, 'flat'),
('Tomato', 'Nashik APMC', 19.9975, 73.7898, 1120, 'down'),
('Tomato', 'Pune Market Yard', 18.5204, 73.8567, 1250, 'up'),
('Tomato', 'Kolhapur APMC', 16.7050, 74.2433, 1180, 'flat'),
('Wheat', 'Indore Mandi', 22.7196, 75.8577, 2410, 'up'),
('Wheat', 'Nagpur APMC', 21.1458, 79.0882, 3076, 'flat'),
('Wheat', 'Sangli APMC', 16.8524, 74.5815, 3600, 'up');

-- 14 days of history for the two highest-traffic mandis, so the forecast has a real trend to read
INSERT INTO mandi_prices (crop, mandi_name, lat, lng, price, trend, recorded_date) VALUES
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1680, 'flat', CURRENT_DATE - INTERVAL '14 days'),
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1705, 'up',   CURRENT_DATE - INTERVAL '13 days'),
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1690, 'flat', CURRENT_DATE - INTERVAL '12 days'),
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1720, 'up',   CURRENT_DATE - INTERVAL '11 days'),
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1750, 'up',   CURRENT_DATE - INTERVAL '10 days'),
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1740, 'flat', CURRENT_DATE - INTERVAL '9 days'),
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1770, 'up',   CURRENT_DATE - INTERVAL '8 days'),
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1800, 'up',   CURRENT_DATE - INTERVAL '7 days'),
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1790, 'flat', CURRENT_DATE - INTERVAL '6 days'),
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1820, 'up',   CURRENT_DATE - INTERVAL '5 days'),
('Onion', 'Lasalgaon APMC', 20.1500, 74.2833, 1840, 'up',   CURRENT_DATE - INTERVAL '4 days'),
('Tomato', 'Pune Market Yard', 18.5204, 73.8567, 980,  'flat', CURRENT_DATE - INTERVAL '14 days'),
('Tomato', 'Pune Market Yard', 18.5204, 73.8567, 1010, 'up',   CURRENT_DATE - INTERVAL '11 days'),
('Tomato', 'Pune Market Yard', 18.5204, 73.8567, 1080, 'up',   CURRENT_DATE - INTERVAL '8 days'),
('Tomato', 'Pune Market Yard', 18.5204, 73.8567, 1150, 'up',   CURRENT_DATE - INTERVAL '5 days'),
('Tomato', 'Pune Market Yard', 18.5204, 73.8567, 1250, 'up',   CURRENT_DATE - INTERVAL '2 days');

-- password for all demo users is: password123 (bcrypt hash, cost 10)
INSERT INTO users (role, full_name, email, password_hash, phone, location, lat, lng, rating, completed_deals) VALUES
('farmer', 'Ramesh Patil', 'ramesh@example.com', '$2b$10$CwTycUXWue0Thq9StjUM0uJ8s8j9Q9s8j9Q9s8j9Q9s8j9Q9s8j9Q', '9876543210', 'Lasalgaon, Nashik, MH', 20.1500, 74.2833, 4.7, 18),
('farmer', 'Sunita Devi', 'sunita@example.com', '$2b$10$CwTycUXWue0Thq9StjUM0uJ8s8j9Q9s8j9Q9s8j9Q9s8j9Q9s8j9Q', '9123456780', 'Pimpalgaon, Nashik, MH', 20.1730, 74.0000, 4.3, 9),
('vendor', 'Shree Traders', 'shree@example.com', '$2b$10$CwTycUXWue0Thq9StjUM0uJ8s8j9Q9s8j9Q9s8j9Q9s8j9Q9s8j9Q', '9822011234', 'Nashik, MH', 19.9975, 73.7898, 4.6, 42),
('vendor', 'Agarwal Agro Co.', 'agarwal@example.com', '$2b$10$CwTycUXWue0Thq9StjUM0uJ8s8j9Q9s8j9Q9s8j9Q9s8j9Q9s8j9Q', '9021055678', 'Niphad, MH', 20.0800, 74.1100, 4.1, 15);

INSERT INTO listings (user_id, type, crop, quantity, quality_grade, price, target_date) VALUES
(1, 'produce', 'Onion', 30, 'Grade A', 1830, '2026-10-05'),
(2, 'produce', 'Onion', 50, 'Grade B', 1800, '2026-10-10'),
(3, 'requirement', 'Onion', 40, 'Grade A', 1830, '2026-10-08'),
(4, 'requirement', 'Onion', 25, 'Grade A', 1810, '2026-10-06');

INSERT INTO storage_facilities (name, location, lat, lng, crop_types, rate_per_quintal_per_day, capacity_quintal) VALUES
('Lasalgaon NAFED Warehouse', 'Lasalgaon, Nashik, MH', 20.1520, 74.2810, 'Onion,Wheat', 2.0, 8000),
('Nashik District Cold Storage', 'Nashik, MH', 20.0010, 73.7920, 'Tomato,Onion', 2.5, 5000),
('Niphad Cooperative Godown', 'Niphad, MH', 20.0850, 74.1120, 'Onion,Wheat,Maize', 1.8, 3000),
('Pune Agro Cold Chain', 'Pune, MH', 18.5230, 73.8600, 'Tomato,Potato', 3.2, 4000);

INSERT INTO alerts (user_id, message) VALUES
(1, 'Onion price at Lasalgaon APMC rose 4.2% today'),
(1, 'New buyer request nearby matches your Onion listing');

-- One admin account (password: password123, same demo hash as other seed users)
INSERT INTO users (role, full_name, email, password_hash, phone, location, rating, completed_deals, is_verified) VALUES
('admin', 'Platform Admin', 'admin@example.com', '$2b$10$CwTycUXWue0Thq9StjUM0uJ8s8j9Q9s8j9Q9s8j9Q9s8j9Q9s8j9Q', NULL, NULL, 5.0, 0, TRUE);

-- Real government scheme reference data. Sources: SFAC, e-NAM, WDRA, Ministry of
-- Food Processing Industries, and the Government of Maharashtra. Static snapshot,
-- not a live feed \u2014 verify current details against the official_url before relying on it.
INSERT INTO schemes (name, level, category, eligibility, benefit, application_process, required_documents, official_url) VALUES
(
  'e-NAM (National Agriculture Market)', 'central', 'Market Access',
  'Any farmer registered with a participating APMC mandi.',
  'Online trading access to buyers across multiple mandis, transparent price discovery, reduced dependence on a single local trader.',
  'Register at the nearest e-NAM-integrated APMC mandi with your land/crop details.',
  'Land record (7/12 extract or equivalent), Aadhaar, bank account details',
  'https://www.enam.gov.in'
),
(
  '10,000 FPO Formation and Promotion Scheme', 'central', 'Farmer Aggregation',
  'Groups of farmers (typically 300+ for plains, lower thresholds for hilly/NE regions) willing to form a Farmer Producer Organisation.',
  'Financial and handholding support to form and run an FPO, improving collective bargaining power for members.',
  'Apply through a Cluster Based Business Organisation (CBBO) empanelled under the scheme, via SFAC or NABARD.',
  'List of member farmers with land records, proposed FPO business plan',
  'https://sfacindia.com'
),
(
  'Operation Greens (TOP Scheme)', 'central', 'Price Stabilisation',
  'Farmers and FPOs growing Tomato, Onion, or Potato in notified production clusters.',
  'Price stabilisation support and subsidy on transport/storage to reduce distress sale during gluts.',
  'Apply through the state horticulture department or an empanelled FPO during the scheme window.',
  'Land record, crop details, FPO membership (if applicable)',
  'https://mofpi.gov.in'
),
(
  'Electronic Negotiable Warehouse Receipt (e-NWR)', 'central', 'Storage & Finance',
  'Any farmer storing produce in a WDRA-registered warehouse.',
  'A digital, tradeable receipt for stored produce that can be used as collateral for a loan, so a farmer can hold produce for a better price without needing to sell immediately for cash.',
  'Deposit produce at a WDRA-accredited warehouse; the e-NWR is issued electronically via the repository.',
  'Land/ownership proof for the produce, warehouse deposit slip',
  'https://wdra.gov.in'
),
(
  'PM-KISAN Samman Nidhi', 'central', 'Income Support',
  'Small and marginal landholding farmer families, per central government eligibility rules.',
  'Direct income support paid to registered farmers\u2019 bank accounts in installments.',
  'Register via the PM-KISAN portal or Common Service Centre with land records and Aadhaar.',
  'Land record, Aadhaar-linked bank account',
  'https://pmkisan.gov.in'
),
(
  'e-Peek Pahani', 'state', 'Crop Survey & Records',
  'Farmers in Maharashtra with cultivated land.',
  'Self-reported digital crop survey that keeps official crop and land records current, which can reduce disputes and speed up scheme eligibility checks.',
  'Report crop details directly through the e-Peek Pahani mobile app during the survey window.',
  'Land record (7/12), location/GPS of the field',
  'https://mahaepeekpahani.mahaonline.gov.in'
);

-- Sample document uploads tied to the seeded farmer, so the Documents tab has something to show
INSERT INTO documents (user_id, doc_type, file_name, extracted_text, structured_data) VALUES
(1, 'land_record', 'sample-7-12-extract.jpg', NULL, NULL);

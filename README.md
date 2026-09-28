# Mandi Setu Backend

## Setup

1. Install PostgreSQL locally and create a database:
   ```
   createdb mandisetu
   psql -d mandisetu -f schema.sql
   ```
2. Copy `.env.example` to `.env` and fill in your values.
3. `npm install`
4. `npm run dev` (or `npm start`)

## External services and what happens without them

| Service | Required? | What breaks without it |
|---|---|---|
| PostgreSQL | Yes | Nothing runs without a database. |
| Razorpay (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`) | For real payments | `/api/payments/create-order` returns a clear error. Everything else works. Sign up free at dashboard.razorpay.com and use TEST mode keys \u2014 no business verification needed to start, and test mode never charges real money. |
| OpenAI (`OPENAI_API_KEY`) | Optional | Requirement parsing (`/api/llm/parse-requirement`) and scheme recommendations (`/api/schemes/recommend`) automatically fall back to a simpler keyword-based method. Nothing crashes \u2014 it's just less flexible with natural phrasing. |
| Tesseract.js (document OCR) | No key needed | Runs locally, no external API or account required. First run downloads its language data file, so the very first OCR request may be slow. |

## Demo login

Seeded accounts (see `schema.sql`) all use the same placeholder password hash \u2014
generate a real one before relying on them:
```
node -e "console.log(require('bcrypt').hashSync('password123', 10))"
```
Paste that hash over the placeholder in `schema.sql`, re-run it, then log in with
e.g. `ramesh@example.com` / `password123`. Or just sign up fresh through the app \u2014
that path works correctly regardless.

The seeded admin account is `admin@example.com` (same password once you fix the hash).
Admin accounts can't be created through the public signup form \u2014 only via direct
database insert, intentionally, since admin access shouldn't be self-service.

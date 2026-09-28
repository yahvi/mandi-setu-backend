const OpenAI = require("openai");
require("dotenv").config();

let client = null;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

module.exports = { getOpenAI };

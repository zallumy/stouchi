/*
 * ============================================================
 *  DASHBOARD SETTINGS  (this file plays the role of a ".env" file)
 * ============================================================
 *
 *  1. Make a copy of this file and name the copy  config.js
 *     (same folder as index.html).
 *  2. Fill in your own values in config.js.
 *  3. Never share config.js — it contains your secret key.
 *
 *  Why a .js file and not a .env file?
 *  A web page running in the browser cannot read .env files on its own
 *  (that needs a build tool like Vite). A small config.js file loaded by
 *  index.html does exactly the same job with zero tools to install.
 */
window.APP_CONFIG = {
  // ---- Connection to n8n ------------------------------------------------
  // The PRODUCTION URL of your "Expense Dashboard API" webhook in n8n.
  // It looks like: https://YOUR-N8N-DOMAIN/webhook/expenses-dashboard
  // (NOT the /webhook-test/ URL — that one only works while you click "Listen".)
  webhookUrl: "https://YOUR-N8N-DOMAIN/webhook/expenses-dashboard",

  // The secret you typed in n8n's "Header Auth" credential (the Value field).
  // Leave it empty ("") if you prefer to type the key in the dashboard itself
  // (recommended if you put the dashboard online — see README, step 8).
  apiKey: "PASTE-YOUR-SECRET-KEY-HERE",

  // The header name. Must match the "Name" field of the Header Auth credential.
  apiKeyHeader: "x-api-key",

  // ---- Your data --------------------------------------------------------
  timezone: "Africa/Tunis",
  currency: "TND",

  // 1 = weeks start on Monday, 0 = weeks start on Sunday.
  weekStartsOn: 1,

  // Amounts in another currency are converted to TND with these rates.
  // Example: { EUR: 3.40, USD: 3.10 }   (1 EUR = 3.40 TND)
  // If a currency has no rate here, its amount is counted as-is and the
  // dashboard shows a warning.
  exchangeRates: {},

  // ---- Optional: monthly budget per category (in TND) -------------------
  // Remove a line or set it to 0 to have no budget for that category.
  budgets: {
    Food: 400,
    Transport: 150,
    Tobacco: 120,
    Groceries: 350,
    Bills: 250,
    Shopping: 200,
    Health: 100,
    Entertainment: 100,
    Personal: 100,
    Other: 100,
  },

  // ---- Testing -----------------------------------------------------------
  // true = show fake sample data instead of calling n8n (handy to see the
  // dashboard before n8n is ready). Set back to false to use your real data.
  demoMode: false,
};

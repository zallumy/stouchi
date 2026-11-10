/*
 * data.js — gets the rows from n8n and cleans them up.
 *
 * Google Sheets data can be messy (amounts typed as text, empty cells,
 * dates in another format...). Every row goes through normalizeRows(),
 * which turns it into a clean "expense" object or skips it with a reason.
 */

const CATEGORIES = ["Food", "Transport", "Tobacco", "Groceries", "Bills", "Shopping", "Health", "Entertainment", "Personal", "Other"];

/** A custom error that remembers what kind of problem happened. */
class LoadError extends Error {
  constructor(kind, message, details) {
    super(message);
    this.kind = kind;       // "network" | "auth" | "notfound" | "http" | "format" | "timeout"
    this.details = details; // extra text shown under "Technical details"
  }
}

/* =========================================================
   1. Download the rows from the n8n webhook
   ========================================================= */
async function fetchExpenseRows(config, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000); // give up after 20 seconds

  let response;
  try {
    response = await fetch(config.webhookUrl, {
      method: "GET",
      headers: { [config.apiKeyHeader]: apiKey, Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new LoadError("timeout", "n8n took more than 20 seconds to answer.");
    // The browser hides the real reason here: it is usually CORS, a wrong URL,
    // n8n being offline, or no internet.
    throw new LoadError("network", "Could not reach n8n.", String(err && err.message));
  }
  clearTimeout(timer);

  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new LoadError("auth", `n8n refused the API key (HTTP ${response.status}).`, text.slice(0, 300));
  }
  if (response.status === 404) {
    throw new LoadError("notfound", "n8n says this webhook does not exist (HTTP 404).", text.slice(0, 300));
  }
  if (!response.ok) {
    throw new LoadError("http", `n8n answered with an error (HTTP ${response.status}).`, text.slice(0, 500));
  }

  if (!text.trim()) return []; // empty answer = no rows
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new LoadError("format", "n8n answered, but not with JSON.", text.slice(0, 300));
  }
  return extractRowArray(json);
}

/** Accepts the different shapes n8n can send back and returns a plain array. */
function extractRowArray(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    for (const key of ["data", "rows", "items", "expenses"]) {
      if (Array.isArray(json[key])) return json[key];
    }
    if ("Amount" in json || "amount" in json || "Date" in json) return [json]; // a single row
    if (Object.keys(json).length === 0) return [];
    if (json.message) throw new LoadError("format", "n8n answered with a message instead of rows.", json.message);
  }
  throw new LoadError("format", "n8n answered, but the data is not a list of rows.", JSON.stringify(json).slice(0, 300));
}

/* =========================================================
   2. Clean every row
   ========================================================= */

// "Telegram User" → "telegramuser", "row_number" → "rownumber"
function simplifyKey(key) { return String(key).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function pickFields(raw) {
  const row = raw && typeof raw === "object" && raw.json && typeof raw.json === "object" ? raw.json : raw;
  const out = {};
  if (!row || typeof row !== "object") return out;
  for (const [k, v] of Object.entries(row)) out[simplifyKey(k)] = v;
  return out;
}

/**
 * Reads a date in many possible forms and returns a day number (or null):
 *   "2026-11-09", "2026-11-09T21:30:00.000Z", "2026/11/09",
 *   "09/11/2026", "9-11-2026", "09.11.2026"  (day first, like in Tunisia),
 *   46335 (a Google Sheets "serial number" date).
 */
function parseDateValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d{5}(\.\d+)?$/.test(String(value).trim())) {
    const serial = Number(value);
    if (serial > 20000 && serial < 80000) return Math.floor(serial) - 25569; // Sheets day 0 = 30 Dec 1899
    return null;
  }
  const s = String(value).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s); // year first
  if (m && isValidDateParts(+m[1], +m[2], +m[3])) return dayFromParts(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s); // day first
  if (m) {
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // clearly month/day order
    if (isValidDateParts(+m[3], mo, d)) return dayFromParts(+m[3], mo, d);
  }
  return null;
}

/** "21:30", "21:30:00", "9:05 PM", 0.8958 (Sheets time) → "21:30". Unknown → "" */
function parseTimeValue(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440);
    return `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`;
  }
  const s = String(value).trim();
  const m = /(\d{1,2})[:h.](\d{2})(?::\d{2})?\s*(am|pm)?/i.exec(s);
  if (!m) return "";
  let h = +m[1];
  const min = +m[2];
  if (m[3]) {
    const pm = m[3].toLowerCase() === "pm";
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return "";
  return `${pad2(h)}:${pad2(min)}`;
}

/**
 * Turns an amount into a number. Handles text like "7", "7.5", "7,500",
 * "12 TND", "1 234,50", "1,234.50". Returns null if there is no number.
 * Note: a single comma is read as a decimal point ("7,500" = 7.5 dinars),
 * which is how amounts are usually written in Tunisia.
 */
function parseAmountValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  let s = String(value).replace(/[\s  ]/g, "").replace(/[^0-9.,-]/g, "");
  if (!/\d/.test(s)) return null;
  const negative = s.startsWith("-");
  s = s.replace(/-/g, "");
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // both appear: the last one is the decimal separator
    const dec = lastComma > lastDot ? "," : ".";
    const thou = dec === "," ? "." : ",";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    s = (s.match(/,/g).length > 1) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0 && s.match(/\./g).length > 1) {
    s = s.replace(/\./g, ""); // "1.234.567" → thousands separators
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function normalizeCategory(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return { category: "Other", unknown: false };
  const match = CATEGORIES.find((c) => c.toLowerCase() === s.toLowerCase());
  return match ? { category: match, unknown: false } : { category: "Other", unknown: true, original: s };
}

/**
 * Turns raw sheet rows into clean expense objects.
 * Returns { expenses, skipped, warnings }.
 */
function normalizeRows(rawRows, config) {
  const expenses = [];
  const skipped = [];
  const warnings = { unconvertedCurrencies: {}, unknownCategories: {} };
  const baseCurrency = config.currency;
  const rates = config.exchangeRates || {};

  rawRows.forEach((raw, index) => {
    const f = pickFields(raw);
    const rowNumber = f.rownumber || index + 2; // +2: row 1 is the header row
    const isBlank = Object.keys(f).filter((k) => k !== "rownumber").every((k) => f[k] === "" || f[k] == null);
    if (isBlank) return; // completely empty row: ignore silently

    const day = parseDateValue(f.date);
    if (day == null) {
      skipped.push({ rowNumber, reason: `date "${f.date ?? ""}" is missing or not understood`, raw: f });
      return;
    }
    const amount = parseAmountValue(f.amount);
    if (amount == null || amount === 0) {
      skipped.push({ rowNumber, reason: `amount "${f.amount ?? ""}" is missing or not a number`, raw: f });
      return;
    }

    const currency = String(f.currency || "").trim().toUpperCase() || baseCurrency;
    let amountBase = amount;
    let unconverted = false;
    if (currency !== baseCurrency) {
      const rate = Number(rates[currency]);
      if (rate > 0) amountBase = amount * rate;
      else {
        unconverted = true;
        warnings.unconvertedCurrencies[currency] = (warnings.unconvertedCurrencies[currency] || 0) + 1;
      }
    }

    const cat = normalizeCategory(f.category);
    if (cat.unknown) warnings.unknownCategories[cat.original] = (warnings.unknownCategories[cat.original] || 0) + 1;

    const time = parseTimeValue(f.time);
    const description = String(f.description ?? "").trim() || String(f.originalmessage ?? "").trim() || "(no description)";

    expenses.push({
      id: `${rowNumber}-${index}`,
      rowNumber,
      day,
      date: dayToISO(day),
      time,
      user: String(f.telegramuser ?? "").trim(),
      message: String(f.originalmessage ?? "").trim(),
      description,
      descriptionKey: description.toLowerCase().replace(/\s+/g, " "),
      category: cat.category,
      originalCategory: cat.unknown ? cat.original : "",
      amount: amountBase,          // always in TND — used for every total
      originalAmount: amount,
      currency,
      unconverted,
      // sort key: newest first = biggest number
      sortKey: day * 1440 + (time ? (+time.slice(0, 2)) * 60 + (+time.slice(3)) : 0) + index / 1e6,
    });
  });

  expenses.sort((a, b) => b.sortKey - a.sortKey);
  return { expenses, skipped, warnings };
}

/* =========================================================
   3. Demo data (only used when demoMode is on or you click "Use demo data")
   ========================================================= */
function generateDemoRows(today) {
  // A tiny random generator with a fixed seed, so demo data looks the same every time.
  let seed = 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const items = {
    Food: [["coffee", 2, 4], ["lunch", 9, 18], ["sandwich", 4, 8], ["pizza", 14, 28], ["lablabi", 3, 5]],
    Transport: [["taxi", 6, 15], ["louage", 8, 20], ["fuel", 40, 70], ["metro", 1, 2]],
    Tobacco: [["tobacco", 7, 7], ["cigarettes", 7.5, 9]],
    Groceries: [["groceries", 25, 90], ["bread and milk", 3, 6], ["vegetables", 8, 20]],
    Bills: [["electricity bill", 60, 110], ["internet", 45, 45], ["phone recharge", 10, 20]],
    Shopping: [["t-shirt", 25, 60], ["shoes", 80, 160], ["headphones", 50, 120]],
    Health: [["pharmacy", 10, 45], ["doctor", 50, 70]],
    Entertainment: [["cinema", 12, 18], ["football match", 15, 30], ["streaming", 20, 20]],
    Personal: [["haircut", 10, 20], ["gift", 30, 80]],
    Other: [["misc", 5, 25]],
  };
  const weights = [["Food", 30], ["Transport", 14], ["Tobacco", 16], ["Groceries", 10], ["Bills", 3], ["Shopping", 4], ["Health", 3], ["Entertainment", 5], ["Personal", 3], ["Other", 2]];
  const totalWeight = weights.reduce((s, w) => s + w[1], 0);
  const pickCategory = () => {
    let r = rand() * totalWeight;
    for (const [c, w] of weights) { if ((r -= w) <= 0) return c; }
    return "Other";
  };

  const rows = [];
  const start = monthStartDay(monthIndexOfDay(today) - 5);
  for (let day = start; day <= today; day++) {
    const count = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      const category = pickCategory();
      const [desc, min, max] = pick(items[category]);
      let amount = Math.round((min + rand() * (max - min)) * 2) / 2;
      const hour = 7 + Math.floor(rand() * 15);
      const minute = Math.floor(rand() * 60);
      rows.push({
        Date: dayToISO(day),
        Time: `${pad2(hour)}:${pad2(minute)}`,
        "Telegram User": "Hamza",
        "Original Message": `${amount} dt ${desc}`,
        Amount: rand() < 0.15 ? String(amount).replace(".", ",") : amount, // some amounts stored as text
        Currency: "TND",
        Description: desc,
        Category: category,
      });
    }
  }
  return rows;
}

/*
 * utils.js — small helpers used everywhere: dates, money, text.
 *
 * About dates: every date is stored as a "day number" (number of days since
 * 1 Jan 1970). This avoids time-zone surprises: 2026-11-09 is always the same
 * day number, whatever the time zone of the phone or computer.
 */

const DAY_MS = 86400000;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ---------- Day numbers ---------- */
function dayFromParts(y, m, d) {
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function partsFromDay(day) {
  const dt = new Date(day * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}

function isValidDateParts(y, m, d) {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const p = partsFromDay(dayFromParts(y, m, d));
  return p.y === y && p.m === m && p.d === d; // rejects 31 Feb etc.
}

function pad2(n) { return String(n).padStart(2, "0"); }

function dayToISO(day) {
  const p = partsFromDay(day);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}

function isoToDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  return isValidDateParts(y, mo, d) ? dayFromParts(y, mo, d) : null;
}

/** Today's day number in the configured time zone (e.g. Africa/Tunis). */
function todayInTimezone(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(new Date());
    const get = (t) => +parts.find((p) => p.type === t).value;
    return dayFromParts(get("year"), get("month"), get("day"));
  } catch (e) {
    const n = new Date(); // unknown time zone → use the device's own date
    return dayFromParts(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }
}

/** Current time "HH:mm" in the configured time zone. */
function nowTimeInTimezone(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  } catch (e) {
    const n = new Date();
    return `${pad2(n.getHours())}:${pad2(n.getMinutes())}`;
  }
}

/* ---------- Months & weeks ---------- */
// A "month index" is one number per month: year * 12 + (month - 1).
function monthIndexOfDay(day) { const p = partsFromDay(day); return p.y * 12 + (p.m - 1); }
function monthStartDay(mi) { return dayFromParts(Math.floor(mi / 12), (mi % 12) + 1, 1); }
function monthEndDay(mi) { return monthStartDay(mi + 1) - 1; }
function daysInMonth(mi) { return monthEndDay(mi) - monthStartDay(mi) + 1; }
function monthLabel(mi, long) {
  const y = Math.floor(mi / 12), m = mi % 12;
  return long ? `${MONTH_NAMES_LONG[m]} ${y}` : `${MONTH_NAMES[m]} ${String(y).slice(2)}`;
}

function weekStartDay(day, weekStartsOn) {
  const dow = partsFromDay(day).dow;
  return day - ((dow - weekStartsOn + 7) % 7);
}

/* ---------- Text formatting ---------- */
const moneyFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234.5 → "1,234.50 TND" */
function formatMoney(n, currency) {
  const value = Number.isFinite(n) ? n : 0;
  return `${moneyFormatter.format(value)} ${currency || APP.currency}`;
}

/** 1234.5 → "1,234.50" (number only) */
function formatNumber(n) { return moneyFormatter.format(Number.isFinite(n) ? n : 0); }

/** HTML for a KPI value: big number + small "TND". */
function moneyHTML(n) {
  return `${formatNumber(n)}<span class="unit">${escapeHtml(APP.currency)}</span>`;
}

/** day number → "9 Nov 2026" */
function formatDay(day, withYear = true) {
  const p = partsFromDay(day);
  return withYear ? `${p.d} ${MONTH_NAMES[p.m - 1]} ${p.y}` : `${p.d} ${MONTH_NAMES[p.m - 1]}`;
}

function formatRange(from, to) {
  if (from === to) return formatDay(from);
  const a = partsFromDay(from), b = partsFromDay(to);
  return a.y === b.y ? `${formatDay(from, false)} – ${formatDay(to)}` : `${formatDay(from)} – ${formatDay(to)}`;
}

function pctText(change) {
  return `${Math.abs(Math.round(change * 100))}%`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function plural(n, word, many) { return `${n} ${n === 1 ? word : (many || word + "s")}`; }

/** Reads a CSS variable, e.g. cssVar("--c-food") → "#2a78d6" */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

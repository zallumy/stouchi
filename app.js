/*
 * app.js — the "conductor": loads the data, reacts to buttons and filters,
 * and fills the page using the helpers from the other files.
 */

/* =========================================================
   Settings (from config.js, with safe defaults)
   ========================================================= */
const CONFIG_FOUND = typeof window.APP_CONFIG === "object" && window.APP_CONFIG !== null;
const APP = Object.assign({
  webhookUrl: "",
  apiKey: "",
  apiKeyHeader: "x-api-key",
  timezone: "Africa/Tunis",
  currency: "TND",
  weekStartsOn: 1,
  exchangeRates: {},
  budgets: {},
  demoMode: false,
}, window.APP_CONFIG || {});
APP.weekStartsOn = Number(APP.weekStartsOn) === 0 ? 0 : 1;

const KEY_STORAGE = "expenseDashboard.apiKey";
const PAGE_SIZE = 50;

/* =========================================================
   State: everything the page currently knows
   ========================================================= */
const state = {
  all: [],            // every clean expense, newest first
  skipped: [],        // rows that could not be read
  warnings: null,
  hasData: false,     // true after at least one successful load
  loading: false,
  demo: false,
  loadedAt: null,
  error: null,
  preset: "month",
  customFrom: null,
  customTo: null,
  category: "",
  search: "",
  tableLimit: PAGE_SIZE,
  tableRows: [],      // what the table currently shows (used by CSV export)
};

const $ = (id) => document.getElementById(id);

/* =========================================================
   API key: saved key on this device > key in config.js
   ========================================================= */
function isPlaceholder(value) {
  return !value || /PASTE-YOUR|YOUR-SECRET|CHANGE-ME/i.test(value);
}

function readSavedKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ""; } catch (e) { return ""; }
}

function getApiKey() {
  const saved = readSavedKey();
  if (saved) return saved;
  return isPlaceholder(APP.apiKey) ? "" : APP.apiKey;
}

function saveKey(value) {
  try { localStorage.setItem(KEY_STORAGE, value); return true; } catch (e) { return false; }
}

/* =========================================================
   Loading the data
   ========================================================= */
async function loadData() {
  if (state.loading) return;

  if (state.demo || APP.demoMode) {
    state.demo = true;
    applyRows(generateDemoRows(todayInTimezone(APP.timezone)));
    return;
  }
  if (!CONFIG_FOUND) return showSetupProblem("noconfig");
  if (!APP.webhookUrl || /YOUR-N8N-DOMAIN/i.test(APP.webhookUrl)) return showSetupProblem("nourl");
  const apiKey = getApiKey();
  if (!apiKey) { $("key-card").hidden = false; return showSetupProblem("nokey"); }

  setLoading(true);
  try {
    const rows = await fetchExpenseRows(APP, apiKey);
    state.error = null;
    applyRows(rows);
  } catch (err) {
    console.error("Loading expenses failed:", err);
    state.error = err instanceof LoadError ? err : new LoadError("http", String(err && err.message || err));
    renderNotices();
  } finally {
    setLoading(false);
  }
}

function applyRows(rows) {
  const result = normalizeRows(rows, APP);
  state.all = result.expenses;
  state.skipped = result.skipped;
  state.warnings = result.warnings;
  state.hasData = true;
  state.loadedAt = new Date();
  state.error = null;
  if (result.skipped.length) console.warn("Skipped rows:", result.skipped);
  render();
}

function setLoading(on) {
  state.loading = on;
  const btn = $("btn-refresh");
  btn.disabled = on;
  btn.classList.toggle("loading", on);
  btn.querySelector("span").textContent = on ? "Loading…" : "Refresh";
  $("kpis").classList.toggle("loading-state", on && !state.hasData);
  if (on) $("last-updated").textContent = "Loading from n8n…";
  else updateLastUpdated();
}

function updateLastUpdated() {
  const el = $("last-updated");
  if (state.demo) el.textContent = `Demo data · ${plural(state.all.length, "expense")}`;
  else if (state.loadedAt) {
    const t = state.loadedAt;
    el.textContent = `Updated ${pad2(t.getHours())}:${pad2(t.getMinutes())} · ${plural(state.all.length, "expense")}`;
  } else el.textContent = "Not loaded yet";
}

/* =========================================================
   Messages at the top of the page
   ========================================================= */
let setupProblem = null;

function showSetupProblem(kind) {
  setupProblem = kind;
  renderNotices();
}

function noticeHTML(type, title, bodyHTML, actions = "") {
  return `<div class="notice ${type}" role="${type === "error" ? "alert" : "status"}">
    <h2>${title}</h2>${bodyHTML}${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;
}

const DEMO_BTN = `<button class="btn" type="button" data-action="demo">Try with demo data</button>`;
const RETRY_BTN = `<button class="btn primary" type="button" data-action="retry">Try again</button>`;
const KEY_BTN = `<button class="btn" type="button" data-action="key">Enter API key</button>`;

function errorNotice(err) {
  const url = `<code>${escapeHtml(APP.webhookUrl)}</code>`;
  const tech = `<details><summary>Technical details</summary><p>URL: ${url}</p>${err.details ? `<p><code>${escapeHtml(err.details)}</code></p>` : ""}</details>`;
  const stale = state.hasData ? `<p class="muted small">The numbers below are from the last successful load.</p>` : "";

  switch (err.kind) {
    case "auth":
      return noticeHTML("error", "n8n rejected the API key",
        `<p>The webhook is reachable, but the key does not match. Check that:</p>
         <ol><li>The key in <code>config.js</code> (or the one you typed here) is exactly the <b>Value</b> of the Header Auth credential in n8n — no extra spaces.</li>
         <li>The header name is <code>${escapeHtml(APP.apiKeyHeader)}</code> in both places (the credential's <b>Name</b> field).</li>
         <li>If you saved a key on this device earlier, it overrides config.js — use “Enter API key” to replace or forget it.</li></ol>${stale}${tech}`,
        RETRY_BTN + KEY_BTN);
    case "notfound":
      return noticeHTML("error", "This webhook is not active in n8n",
        `<ol><li>Open the workflow in n8n and click <b>Publish</b> (the production URL only works on a published workflow).</li>
         <li>Use the <b>Production URL</b> (with <code>/webhook/</code>), not the Test URL (<code>/webhook-test/</code>).</li>
         <li>Check the path at the end of the URL matches the Webhook node's <b>Path</b>.</li></ol>${stale}${tech}`,
        RETRY_BTN + DEMO_BTN);
    case "timeout":
      return noticeHTML("error", "n8n is too slow to answer",
        `<p>n8n did not answer within 20 seconds. Your n8n server may be asleep or overloaded, or Google Sheets is slow. Wait a moment and try again.</p>${stale}${tech}`,
        RETRY_BTN);
    case "format":
      return noticeHTML("error", "n8n answered, but not with the expense rows",
        `<p>Check the <b>Respond to Webhook</b> node: <b>Respond With</b> must be <b>All Incoming Items</b>. Then open n8n → <b>Executions</b> to see what was sent.</p>${stale}${tech}`,
        RETRY_BTN);
    case "network":
      return noticeHTML("error", "Can't reach n8n",
        `<p>The browser could not get an answer. The most common reasons:</p>
         <ol><li><b>Wrong URL</b> in <code>config.js</code> — copy the Production URL again from the Webhook node.</li>
         <li><b>CORS</b> — press F12 → Console. If you see “blocked by CORS policy”, open the Webhook node → Options → <b>Allowed Origins (CORS)</b> and set it to <code>*</code>, then Publish again.</li>
         <li><b>n8n is offline</b> or you have no internet. Open the URL in a new tab: if you see “Authorization data is wrong!”, n8n is up and the URL is right.</li></ol>${stale}${tech}`,
        RETRY_BTN + DEMO_BTN);
    default:
      return noticeHTML("error", "n8n returned an error",
        `<p>Open n8n → <b>Executions</b> and click the failed run to see which node failed. Often it is the Google Sheets credential (log in again) or the sheet/tab name.</p>${stale}${tech}`,
        RETRY_BTN + DEMO_BTN);
  }
}

function renderNotices() {
  const parts = [];

  if (setupProblem === "noconfig" && !state.demo) {
    parts.push(noticeHTML("error", "Settings file not found",
      `<p>The dashboard could not find <code>config.js</code>. In the project folder, copy <code>config.example.js</code>, rename the copy to <code>config.js</code>, and fill in your webhook URL and key. Then reload this page.</p>`, DEMO_BTN));
  } else if (setupProblem === "nourl" && !state.demo) {
    parts.push(noticeHTML("info", "Almost there: add your n8n webhook URL",
      `<p>Open <code>config.js</code> and replace <code>https://YOUR-N8N-DOMAIN/webhook/expenses-dashboard</code> with the <b>Production URL</b> of your Webhook node. Save the file and reload this page.</p>`, DEMO_BTN));
  } else if (setupProblem === "nokey" && !state.demo) {
    parts.push(noticeHTML("info", "Add your API key",
      `<p>Type your key below, or put it in <code>apiKey</code> inside <code>config.js</code>.</p>`, DEMO_BTN));
  }

  if (state.error) parts.push(errorNotice(state.error));

  if (state.demo) {
    parts.push(noticeHTML("info", "You are looking at demo data",
      `<p>These expenses are fake. To see your real data, set <code>demoMode: false</code> in <code>config.js</code> and reload the page.</p>`,
      CONFIG_FOUND && !APP.demoMode ? `<button class="btn" type="button" data-action="real">Load my real data</button>` : ""));
  }

  if (state.hasData && !state.error) {
    if (!state.all.length && !state.skipped.length) {
      parts.push(noticeHTML("info", "No expenses yet",
        `<p>n8n answered correctly, but the sheet has no expense rows. Send an expense to your Telegram bot, then press Refresh. If the sheet does have rows, check the Google Sheets node points to the right document and tab.</p>`));
    }
    if (state.skipped.length) {
      const list = state.skipped.slice(0, 8).map((s) => `<li>Row ${escapeHtml(s.rowNumber)}: ${escapeHtml(s.reason)}</li>`).join("");
      parts.push(noticeHTML("warn", `${plural(state.skipped.length, "row")} could not be read and ${state.skipped.length === 1 ? "was" : "were"} left out`,
        `<details><summary>Show which rows</summary><ul>${list}</ul>${state.skipped.length > 8 ? `<p>…and ${state.skipped.length - 8} more (see the browser console, F12).</p>` : ""}
         <p>Fix them in the Google Sheet (dates as YYYY-MM-DD, amounts as numbers), then press Refresh.</p></details>`));
    }
    const cur = Object.entries(state.warnings?.unconvertedCurrencies || {});
    if (cur.length) {
      parts.push(noticeHTML("warn", "Some expenses are in another currency",
        `<p>${cur.map(([c, n]) => `${plural(n, "expense")} in ${escapeHtml(c)}`).join(", ")} ${cur.length > 1 || cur[0][1] > 1 ? "are" : "is"} counted as if ${APP.currency}. Add a rate in <code>exchangeRates</code> in <code>config.js</code> (e.g. <code>{ EUR: 3.40 }</code>) to convert them.</p>`));
    }
    const cats = Object.entries(state.warnings?.unknownCategories || {});
    if (cats.length) {
      parts.push(noticeHTML("warn", "Unknown categories were counted as “Other”",
        `<p>${cats.map(([c, n]) => `“${escapeHtml(c)}” (${n})`).join(", ")}</p>`));
    }
  }

  $("notices").innerHTML = parts.join("");
}

/* =========================================================
   Drawing everything
   ========================================================= */
function render() {
  const today = todayInTimezone(APP.timezone);
  const catFiltered = state.category ? state.all.filter((e) => e.category === state.category) : state.all;
  const range = resolveRange(state.preset, today, APP.weekStartsOn, { from: state.customFrom, to: state.customTo }, catFiltered);
  const filtered = catFiltered.filter((e) => e.day >= range.from && e.day <= range.to);
  const filteredTotal = sumAmounts(filtered);

  $("filter-summary").textContent =
    `${formatRange(range.from, range.to)} · ${state.category || "All categories"} · ${plural(filtered.length, "expense")} · ${formatMoney(filteredTotal)}`;

  renderNotices();
  updateLastUpdated();
  renderKpis(catFiltered, today);
  renderInsights(computeInsights(state.all, today));

  // Charts
  renderCategoryChart(totalsByCategory(filtered), filteredTotal);
  const rangeDays = range.to - range.from + 1;
  if (rangeDays > 62) renderTrendChart(totalsByWeek(filtered, range.from, range.to, APP.weekStartsOn), "week");
  else renderTrendChart(totalsByDay(filtered, range.from, range.to), "day");

  let fromMonth = monthIndexOfDay(range.from);
  const toMonth = monthIndexOfDay(range.to);
  let note = "";
  if (toMonth - fromMonth < 1) { fromMonth = toMonth - 5; note = "Last 6 months, for comparison"; }
  else if (toMonth - fromMonth > 23) { fromMonth = toMonth - 23; note = "Last 24 months"; }
  $("monthly-note").textContent = note ? `${note} · * = so far` : "* = so far";
  const monthlySource = catFiltered.filter((e) => e.day >= monthStartDay(fromMonth) && e.day <= range.to);
  renderMonthlyChart(totalsByMonth(monthlySource, fromMonth, toMonth), monthIndexOfDay(today));
  renderWeekdayChart(totalsByWeekday(filtered, APP.weekStartsOn));

  renderBudgets(today);
  renderTable(filtered);
  $("btn-export").disabled = !state.hasData;
}

function setText(id, html) { $(id).innerHTML = html; }

function renderKpis(list, today) {
  if (!state.hasData) return; // keep the "—" placeholders until data arrives
  const k = computeKpis(list, today, APP.weekStartsOn);
  const mi = monthIndexOfDay(today);
  setText("kpi-month", moneyHTML(k.monthTotal));
  setText("kpi-month-sub", escapeHtml(formatRange(monthStartDay(mi), today)));
  setText("kpi-today", moneyHTML(k.todayTotal));
  setText("kpi-today-sub", `${plural(k.todayCount, "expense")} · ${escapeHtml(formatDay(today, false))}`);
  setText("kpi-week", moneyHTML(k.weekTotal));
  setText("kpi-week-sub", `Since ${WEEKDAY_NAMES[partsFromDay(weekStartDay(today, APP.weekStartsOn)).dow].slice(0, 3)} ${escapeHtml(formatDay(weekStartDay(today, APP.weekStartsOn), false))}`);
  setText("kpi-avg", moneyHTML(k.avgDaily));
  setText("kpi-avg-sub", `Over ${plural(k.daysElapsed, "day")}`);
  setText("kpi-count", String(k.monthCount));
  setText("kpi-count-sub", k.monthCount ? `Avg ${escapeHtml(formatMoney(k.monthTotal / k.monthCount))} each` : "None yet");
  if (k.topCategory) {
    setText("kpi-top", `<span class="dot" style="background:${categoryColor(k.topCategory.category)};margin-right:6px"></span>${escapeHtml(k.topCategory.category)}`);
    setText("kpi-top-sub", `${escapeHtml(formatMoney(k.topCategory.total))} · ${Math.round(k.topShare * 100)}% of month`);
  } else {
    setText("kpi-top", "—");
    setText("kpi-top-sub", "No expenses yet");
  }
  $("kpi-note").textContent = state.category
    ? `Cards show ${state.category} only. They always cover today, this week and this month; the Period filter changes the charts and the table.`
    : "Cards always cover today, this week and this month. The Period filter changes the charts and the table; the Category filter changes everything.";
}

function changeHTML(now, before, nounMore = "more", nounLess = "less") {
  if (before <= 0) return "";
  const change = (now - before) / before;
  if (Math.abs(change) < 0.005) return `<span>the same as</span>`;
  return change > 0
    ? `<span class="up">▲ ${pctText(change)} ${nounMore}</span> than`
    : `<span class="down">▼ ${pctText(change)} ${nounLess}</span> than`;
}

function renderInsights(ins) {
  const items = [];
  const m = (n) => `<b>${escapeHtml(formatMoney(n))}</b>`;
  const lastMonthName = MONTH_NAMES_LONG[(ins.monthIndex - 1 + 12) % 12];
  const sameDay = formatDay(ins.prevSamePointEnd, false);

  // 1. vs previous month
  if (ins.thisTotal === 0 && ins.prevSameTotal === 0) {
    items.push(["📊", `No spending recorded so far this month, and none for the same days last month.`]);
  } else if (ins.prevSameTotal > 0) {
    items.push(["📊", `So far this month you spent ${m(ins.thisTotal)}, ${changeHTML(ins.thisTotal, ins.prevSameTotal)} by ${escapeHtml(sameDay)} last month (${escapeHtml(formatMoney(ins.prevSameTotal))}).`]);
  } else {
    items.push(["📊", `So far this month you spent ${m(ins.thisTotal)}. Nothing was recorded for the same days in ${lastMonthName}, so there is nothing to compare with.`]);
  }

  // 2. Category with biggest increase
  if (ins.biggestIncrease) {
    const b = ins.biggestIncrease;
    items.push(["📈", `<b>${escapeHtml(b.category)}</b> went up the most: <span class="up">+${escapeHtml(formatMoney(b.diff))}</span> compared to the same days last month (${escapeHtml(formatNumber(b.before))} → ${escapeHtml(formatNumber(b.now))}).`]);
  } else if (ins.thisCount) {
    items.push(["📈", `No category went up compared to the same days last month.`]);
  }

  // 3. Biggest expense
  if (ins.biggest) {
    const e = ins.biggest;
    items.push(["💸", `Biggest expense this month: ${m(e.amount)} for “${escapeHtml(e.description)}” (${escapeHtml(e.category)}) on ${escapeHtml(formatDay(e.day, false))}.`]);
  }

  // 4. Most frequent
  if (ins.mostFrequent) {
    const f = ins.mostFrequent;
    items.push(["🔁", f.count > 1
      ? `Most frequent expense this month: “${escapeHtml(f.label)}”, ${f.count} times (${escapeHtml(formatMoney(f.total))} in total).`
      : `No expense has repeated yet this month.`]);
  }

  // 5. Projection
  if (ins.thisTotal > 0) {
    const cmp = ins.prevFullTotal > 0 ? ` — ${changeHTML(ins.projected, ins.prevFullTotal)} ${lastMonthName}'s ${escapeHtml(formatMoney(ins.prevFullTotal))}` : "";
    items.push(["🔮", `At your current pace (${escapeHtml(formatMoney(ins.avgDaily))} a day), you will spend about ${m(ins.projected)} this month${cmp}.`]);
  }

  // 6. Tobacco
  if (ins.tobaccoNow > 0) {
    const cmp = ins.tobaccoPrevSame > 0 ? `, ${changeHTML(ins.tobaccoNow, ins.tobaccoPrevSame)} by this date last month` : "";
    items.push(["🚬", `Tobacco: ${m(ins.tobaccoNow)} so far this month${cmp}. On this pace, about ${escapeHtml(formatMoney(ins.tobaccoProjected))} for the month.`]);
  } else {
    const before = ins.tobaccoMonths.slice(0, -1).some((x) => x.total > 0);
    items.push(["🚬", before ? `No tobacco spending recorded this month so far. 👏` : `No tobacco spending recorded in the last 6 months.`]);
  }

  $("insight-list").innerHTML = items.map(([icon, html]) =>
    `<li><span class="insight-icon" aria-hidden="true">${icon}</span><p>${html}</p></li>`).join("");
  renderTobaccoChart(ins.tobaccoMonths, ins.monthIndex);
}

function renderBudgets(today) {
  const rows = computeBudgets(state.all, today, APP.budgets);
  $("budgets-card").hidden = !rows.length;
  if (!rows.length) return;
  $("budget-list").innerHTML = rows.map((b) => {
    const pct = Math.floor(b.ratio * 100); // floor: 99.6% shows "99%", not a misleading "100%"
    let status;
    if (b.status === "over") status = `<span class="status over">⛔ Over budget by ${escapeHtml(formatMoney(b.used - b.budget))}</span>`;
    else if (b.status === "warn") status = `<span class="status warn">⚠ ${pct}% used — close to the limit</span>`;
    else status = `<span class="status">${pct}% used · ${escapeHtml(formatMoney(b.budget - b.used))} left</span>`;
    return `<li class="budget-row">
      <div class="top"><b><span class="dot" style="background:${categoryColor(b.category)}"></span> ${escapeHtml(b.category)}</b>
        <span>${escapeHtml(formatNumber(b.used))} / ${escapeHtml(formatMoney(b.budget))}</span></div>
      <div class="bar ${b.status}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(pct, 100)}" aria-label="${escapeHtml(b.category)} budget used">
        <span style="width:${Math.min(pct, 100)}%"></span></div>
      ${status}</li>`;
  }).join("");
}

function renderTable(filtered) {
  const q = state.search.trim().toLowerCase();
  const rows = q
    ? filtered.filter((e) => e.description.toLowerCase().includes(q) || e.message.toLowerCase().includes(q))
    : filtered;
  state.tableRows = rows;
  const shown = rows.slice(0, state.tableLimit);

  const total = sumAmounts(rows);
  $("table-count").textContent = rows.length
    ? `Showing ${shown.length} of ${plural(rows.length, "expense")} · ${formatMoney(total)} in total`
    : (q ? `Nothing matches “${state.search}” in this period.` : "No expenses in this period.");

  $("table-body").innerHTML = shown.map((e) => {
    const sub = [e.message && e.message !== e.description ? `“${escapeHtml(e.message)}”` : "", escapeHtml(e.user)].filter(Boolean).join(" · ");
    const flags = [
      e.unconverted ? `<span class="flag">⚠ ${escapeHtml(e.currency)} counted as ${escapeHtml(APP.currency)}</span>` : "",
      e.originalCategory ? `<span class="flag">“${escapeHtml(e.originalCategory)}” → Other</span>` : "",
    ].join("");
    const dot = `<span class="dot" style="background:${categoryColor(e.category)}"></span>`;
    const foreign = e.currency !== APP.currency ? `<span class="sub">${escapeHtml(formatNumber(e.originalAmount))} ${escapeHtml(e.currency)}</span>` : "";
    return `<tr>
      <td class="date">${escapeHtml(formatDay(e.day))}<span class="sub">${escapeHtml(e.time || "")}</span></td>
      <td>${escapeHtml(e.description)}${sub ? `<span class="sub">${sub}</span>` : ""}<span class="mobile-cat cat-pill">${dot}${escapeHtml(e.category)}</span>${flags}</td>
      <td><span class="cat-pill">${dot}${escapeHtml(e.category)}</span></td>
      <td class="num">${escapeHtml(formatMoney(e.amount))}${foreign}</td>
    </tr>`;
  }).join("");

  const more = $("btn-more");
  more.hidden = rows.length <= shown.length;
  more.textContent = `Show more (${rows.length - shown.length} left)`;
}

/* =========================================================
   CSV export (what the table shows: filters + search)
   ========================================================= */
function csvCell(value) {
  let s = String(value == null ? "" : value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== "number") s = "'" + s; // stops spreadsheet formulas
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const header = ["Date", "Time", "Telegram User", "Original Message", "Amount", "Currency", "Description", "Category", `Amount (${APP.currency})`];
  const lines = [header.map(csvCell).join(",")];
  for (const e of state.tableRows) {
    lines.push([e.date, e.time, e.user, e.message, e.originalAmount.toFixed(2), e.currency, e.description, e.category, e.amount.toFixed(2)].map(csvCell).join(","));
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }); // ﻿ = Excel reads accents correctly
  const today = todayInTimezone(APP.timezone);
  const range = resolveRange(state.preset, today, APP.weekStartsOn, { from: state.customFrom, to: state.customTo }, state.all);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `expenses_${dayToISO(range.from)}_to_${dayToISO(range.to)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* =========================================================
   Buttons & filters
   ========================================================= */
function setupEvents() {
  $("btn-refresh").addEventListener("click", () => {
    if (state.demo && !APP.demoMode) state.demo = false;
    setupProblem = null;
    loadData();
  });
  $("btn-export").addEventListener("click", exportCsv);
  $("btn-key").addEventListener("click", () => {
    const card = $("key-card");
    card.hidden = !card.hidden;
    if (!card.hidden) $("key-input").focus();
  });
  $("key-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const value = $("key-input").value.trim();
    if (!value) return;
    if (!saveKey(value)) APP.apiKey = value; // storage blocked: keep it for this visit only
    $("key-input").value = "";
    $("key-card").hidden = true;
    setupProblem = null;
    state.demo = false;
    loadData();
  });
  $("key-forget").addEventListener("click", () => {
    try { localStorage.removeItem(KEY_STORAGE); } catch (e) { /* ignore */ }
    $("key-forget").textContent = "Saved key removed from this device.";
  });

  $("notices").addEventListener("click", (ev) => {
    const action = ev.target.closest("[data-action]")?.dataset.action;
    if (action === "retry") { setupProblem = null; loadData(); }
    if (action === "demo") { state.demo = true; state.error = null; loadData(); }
    if (action === "real") { state.demo = false; state.hasData = false; state.all = []; setupProblem = null; loadData(); render(); }
    if (action === "key") { $("key-card").hidden = false; $("key-input").focus(); }
  });

  $("filter-range").addEventListener("change", (ev) => {
    state.preset = ev.target.value;
    const custom = state.preset === "custom";
    document.querySelectorAll(".custom-date").forEach((el) => { el.hidden = !custom; });
    if (custom && state.customFrom == null) {
      const today = todayInTimezone(APP.timezone);
      state.customFrom = monthStartDay(monthIndexOfDay(today));
      state.customTo = today;
      $("filter-from").value = dayToISO(state.customFrom);
      $("filter-to").value = dayToISO(state.customTo);
    }
    state.tableLimit = PAGE_SIZE;
    render();
  });
  $("filter-from").addEventListener("change", (ev) => { state.customFrom = isoToDay(ev.target.value); render(); });
  $("filter-to").addEventListener("change", (ev) => { state.customTo = isoToDay(ev.target.value); render(); });
  $("filter-category").addEventListener("change", (ev) => { state.category = ev.target.value; state.tableLimit = PAGE_SIZE; render(); });

  let searchTimer;
  $("table-search").addEventListener("input", (ev) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = ev.target.value; state.tableLimit = PAGE_SIZE; render(); }, 150);
  });
  $("btn-more").addEventListener("click", () => { state.tableLimit += PAGE_SIZE; render(); });

  // Light/dark mode switch → redraw charts with the right colors
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => { applyChartDefaults(); render(); });

  // Coming back to the tab after 5+ minutes → refresh automatically
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.loadedAt && !state.demo && Date.now() - state.loadedAt > 5 * 60000) loadData();
  });
}

function fillCategorySelect() {
  const sel = $("filter-category");
  for (const c of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }
}

/* =========================================================
   Start
   ========================================================= */
function start() {
  fillCategorySelect();
  applyChartDefaults();
  setupEvents();
  if (new URLSearchParams(location.search).has("demo")) state.demo = true;
  render();          // draw the empty page first
  loadData();        // then fetch the real data
}

start();

/*
 * charts.js — draws the charts with Chart.js (https://www.chartjs.org).
 * Each function receives ready-made numbers from stats.js and draws them.
 */

const CATEGORY_COLOR_VARS = {
  Food: "--c-food", Transport: "--c-transport", Groceries: "--c-groceries", Bills: "--c-bills",
  Shopping: "--c-shopping", Health: "--c-health", Entertainment: "--c-entertainment",
  Tobacco: "--c-tobacco", Personal: "--c-personal", Other: "--c-other",
};

function categoryColor(category) {
  return cssVar(CATEGORY_COLOR_VARS[category] || "--c-other");
}

const chartInstances = {}; // canvas id → Chart object, so we can redraw cleanly

function chartsAvailable() { return typeof window.Chart === "function"; }

function applyChartDefaults() {
  if (!chartsAvailable()) return;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = cssVar("--text-2");
  Chart.defaults.borderColor = cssVar("--grid");
  Chart.defaults.animation.duration = 350;
  Chart.defaults.plugins.legend.display = false;
  const tt = Chart.defaults.plugins.tooltip;
  tt.backgroundColor = cssVar("--text");
  tt.titleColor = cssVar("--surface");
  tt.bodyColor = cssVar("--surface");
  tt.padding = 10;
  tt.cornerRadius = 8;
  tt.displayColors = false;
}

/** Draws (or redraws) a chart in the given canvas. */
function drawChart(canvasId, config, emptyMessage) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrap = canvas.parentElement;
  if (chartInstances[canvasId]) { chartInstances[canvasId].destroy(); delete chartInstances[canvasId]; }
  wrap.querySelector(".empty-chart")?.remove();

  if (!chartsAvailable()) {
    showChartMessage(wrap, "Charts could not load (no internet to reach the Chart.js CDN?).");
    return;
  }
  if (emptyMessage) {
    canvas.style.visibility = "hidden";
    showChartMessage(wrap, emptyMessage);
    return;
  }
  canvas.style.visibility = "visible";
  chartInstances[canvasId] = new Chart(canvas, config);
}

function showChartMessage(wrap, text) {
  const div = document.createElement("div");
  div.className = "empty-chart";
  div.textContent = text;
  wrap.appendChild(div);
}

/* Shared settings for bar charts */
function barOptions(tooltipTitle, tooltipLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: cssVar("--grid") },
        ticks: { maxTicksLimit: 5, callback: (v) => formatNumber(v).replace(/\.00$/, "") },
      },
    },
    plugins: { tooltip: { callbacks: { title: tooltipTitle, label: tooltipLabel } } },
  };
}

function barDataset(values, color) {
  return {
    data: values,
    backgroundColor: color,
    hoverBackgroundColor: color,
    borderRadius: 4,
    borderSkipped: "start",
    maxBarThickness: 28,
    categoryPercentage: 0.85,
    barPercentage: 0.9,
  };
}

/* ---------- 1. Spending by category (donut) ---------- */
function renderCategoryChart(byCategory, total) {
  document.getElementById("donut-total").textContent = formatMoney(total);
  const legend = document.getElementById("category-legend");
  legend.innerHTML = byCategory.map((c) => `
    <li>
      <span class="dot" style="background:${categoryColor(c.category)}"></span>
      <span class="name">${escapeHtml(c.category)} <span class="muted">· ${c.count}</span></span>
      <span>${formatMoney(c.total)}</span>
      <span class="pct">${total > 0 ? Math.round((c.total / total) * 100) : 0}%</span>
    </li>`).join("");

  drawChart("chart-category", {
    type: "doughnut",
    data: {
      labels: byCategory.map((c) => c.category),
      datasets: [{
        data: byCategory.map((c) => c.total),
        backgroundColor: byCategory.map((c) => categoryColor(c.category)),
        borderColor: cssVar("--surface"),
        borderWidth: 2,
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "66%",
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${formatMoney(ctx.parsed)} (${total > 0 ? Math.round((ctx.parsed / total) * 100) : 0}%)`,
          },
        },
      },
    },
  }, byCategory.length ? null : "No expenses in this period");
  document.querySelector(".donut-center").hidden = !byCategory.length;
}

/* ---------- 2. Spending over time (daily or weekly bars) ---------- */
function renderTrendChart(points, mode) {
  const weekly = mode === "week";
  document.getElementById("trend-title").textContent = weekly ? "Weekly spending" : "Daily spending";
  const hasData = points.some((p) => p.total !== 0);
  drawChart("chart-trend", {
    type: "bar",
    data: {
      labels: points.map((p) => formatDay(p.day, false)),
      datasets: [barDataset(points.map((p) => p.total), cssVar("--c-bar"))],
    },
    options: barOptions(
      (items) => {
        const p = points[items[0].dataIndex];
        return weekly ? `Week of ${formatDay(p.day)}` : `${WEEKDAY_NAMES[partsFromDay(p.day).dow]} ${formatDay(p.day)}`;
      },
      (ctx) => formatMoney(ctx.parsed.y),
    ),
  }, hasData ? null : "No expenses in this period");
}

/* ---------- 3. Monthly totals ---------- */
function renderMonthlyChart(months, currentMonth) {
  const hasData = months.some((m) => m.total !== 0);
  drawChart("chart-monthly", {
    type: "bar",
    data: {
      labels: months.map((m) => monthLabel(m.month) + (m.month === currentMonth ? "*" : "")),
      datasets: [barDataset(months.map((m) => m.total), cssVar("--c-bar"))],
    },
    options: barOptions(
      (items) => {
        const m = months[items[0].dataIndex];
        return monthLabel(m.month, true) + (m.month === currentMonth ? " (so far)" : "");
      },
      (ctx) => formatMoney(ctx.parsed.y),
    ),
  }, hasData ? null : "No expenses to compare yet");
}

/* ---------- 4. Day of week ---------- */
function renderWeekdayChart(weekdays) {
  const hasData = weekdays.some((w) => w.count > 0);
  drawChart("chart-weekday", {
    type: "bar",
    data: {
      labels: weekdays.map((w) => WEEKDAY_NAMES[w.dow].slice(0, 3)),
      datasets: [barDataset(weekdays.map((w) => w.total), cssVar("--c-bar"))],
    },
    options: barOptions(
      (items) => WEEKDAY_NAMES[weekdays[items[0].dataIndex].dow],
      (ctx) => {
        const w = weekdays[ctx.dataIndex];
        return [`Total: ${formatMoney(w.total)}`, `${plural(w.count, "expense")}`];
      },
    ),
  }, hasData ? null : "No expenses in this period");
}

/* ---------- 5. Tobacco mini chart (in Insights) ---------- */
function renderTobaccoChart(months, currentMonth) {
  const hasData = months.some((m) => m.total !== 0);
  const options = barOptions(
    (items) => {
      const m = months[items[0].dataIndex];
      return monthLabel(m.month, true) + (m.month === currentMonth ? " (so far)" : "");
    },
    (ctx) => formatMoney(ctx.parsed.y),
  );
  options.scales.y.ticks.maxTicksLimit = 3;
  drawChart("chart-tobacco", {
    type: "bar",
    data: {
      labels: months.map((m) => MONTH_NAMES[m.month % 12] + (m.month === currentMonth ? "*" : "")),
      datasets: [barDataset(months.map((m) => m.total), cssVar("--c-tobacco"))],
    },
    options,
  }, hasData ? null : "No tobacco expenses in the last 6 months");
}

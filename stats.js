/*
 * stats.js — all the calculations (totals, groupings, insights).
 * No HTML here: these functions take expenses in and give numbers out.
 */

function sumAmounts(list) {
  // Adding in "millimes" (×1000) avoids tiny rounding errors like 0.1 + 0.2.
  return list.reduce((s, e) => s + Math.round(e.amount * 1000), 0) / 1000;
}

function inDays(list, from, to) {
  return list.filter((e) => e.day >= from && e.day <= to);
}

/** Turns a period choice ("month", "week", ...) into { from, to } day numbers. */
function resolveRange(preset, today, weekStartsOn, custom, allExpenses) {
  const mi = monthIndexOfDay(today);
  switch (preset) {
    case "today": return { from: today, to: today };
    case "week": return { from: weekStartDay(today, weekStartsOn), to: today };
    case "month": return { from: monthStartDay(mi), to: today };
    case "lastmonth": return { from: monthStartDay(mi - 1), to: monthEndDay(mi - 1) };
    case "last3": return { from: monthStartDay(mi - 2), to: today };
    case "custom": {
      let from = custom.from ?? monthStartDay(mi);
      let to = custom.to ?? today;
      if (from > to) [from, to] = [to, from];
      return { from, to };
    }
    case "all":
    default: {
      if (!allExpenses.length) return { from: today, to: today };
      let min = Infinity, max = -Infinity;
      for (const e of allExpenses) { if (e.day < min) min = e.day; if (e.day > max) max = e.day; }
      return { from: min, to: Math.max(max, today) };
    }
  }
}

/** Total per category, biggest first: [{ category, total, count }] */
function totalsByCategory(list) {
  const map = new Map();
  for (const e of list) {
    const t = map.get(e.category) || { category: e.category, total: 0, count: 0 };
    t.total += e.amount;
    t.count += 1;
    map.set(e.category, t);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** Total per day for every day in the range (days with no spending = 0). */
function totalsByDay(list, from, to) {
  const totals = new Map();
  for (const e of list) totals.set(e.day, (totals.get(e.day) || 0) + e.amount);
  const out = [];
  for (let d = from; d <= to; d++) out.push({ day: d, total: totals.get(d) || 0 });
  return out;
}

/** Total per week (for long ranges, where one bar per day would be unreadable). */
function totalsByWeek(list, from, to, weekStartsOn) {
  const totals = new Map();
  for (const e of list) {
    const w = weekStartDay(e.day, weekStartsOn);
    totals.set(w, (totals.get(w) || 0) + e.amount);
  }
  const out = [];
  for (let w = weekStartDay(from, weekStartsOn); w <= to; w += 7) out.push({ day: w, total: totals.get(w) || 0 });
  return out;
}

/** Total per month between two month indexes. */
function totalsByMonth(list, fromMonth, toMonth) {
  const totals = new Map();
  for (const e of list) {
    const mi = monthIndexOfDay(e.day);
    totals.set(mi, (totals.get(mi) || 0) + e.amount);
  }
  const out = [];
  for (let mi = fromMonth; mi <= toMonth; mi++) out.push({ month: mi, total: totals.get(mi) || 0 });
  return out;
}

/** Total + count per weekday, in week order (Mon..Sun when weeks start on Monday). */
function totalsByWeekday(list, weekStartsOn) {
  const totals = Array.from({ length: 7 }, (_, dow) => ({ dow, total: 0, count: 0 }));
  for (const e of list) {
    const t = totals[partsFromDay(e.day).dow];
    t.total += e.amount;
    t.count += 1;
  }
  return [...totals.slice(weekStartsOn), ...totals.slice(0, weekStartsOn)];
}

/* =========================================================
   KPI cards — fixed periods (today / this week / this month),
   following the category filter.
   ========================================================= */
function computeKpis(list, today, weekStartsOn) {
  const mi = monthIndexOfDay(today);
  const monthStart = monthStartDay(mi);
  const month = inDays(list, monthStart, today);
  const daysElapsed = today - monthStart + 1;
  const monthTotal = sumAmounts(month);
  const byCat = totalsByCategory(month);
  const week = inDays(list, weekStartDay(today, weekStartsOn), today);
  const todays = inDays(list, today, today);

  return {
    monthTotal,
    monthCount: month.length,
    todayTotal: sumAmounts(todays),
    todayCount: todays.length,
    weekTotal: sumAmounts(week),
    weekCount: week.length,
    avgDaily: monthTotal / daysElapsed,
    daysElapsed,
    topCategory: byCat[0] || null,
    topShare: byCat[0] && monthTotal > 0 ? byCat[0].total / monthTotal : 0,
  };
}

/* =========================================================
   Insights — always on whole months and all categories.
   "Same point last month" = from the 1st to the same day number,
   so early in the month you still compare like with like.
   ========================================================= */
function computeInsights(all, today) {
  const mi = monthIndexOfDay(today);
  const monthStart = monthStartDay(mi);
  const dayOfMonth = today - monthStart + 1;
  const prevStart = monthStartDay(mi - 1);
  const prevSamePointEnd = Math.min(prevStart + dayOfMonth - 1, monthEndDay(mi - 1));

  const thisMonth = inDays(all, monthStart, today);
  const prevSamePoint = inDays(all, prevStart, prevSamePointEnd);
  const prevFull = inDays(all, prevStart, monthEndDay(mi - 1));

  const thisTotal = sumAmounts(thisMonth);
  const prevSameTotal = sumAmounts(prevSamePoint);
  const prevFullTotal = sumAmounts(prevFull);

  // Biggest category increase
  const nowByCat = new Map(totalsByCategory(thisMonth).map((c) => [c.category, c.total]));
  const prevByCat = new Map(totalsByCategory(prevSamePoint).map((c) => [c.category, c.total]));
  let biggestIncrease = null;
  for (const cat of new Set([...nowByCat.keys(), ...prevByCat.keys()])) {
    const diff = (nowByCat.get(cat) || 0) - (prevByCat.get(cat) || 0);
    if (diff > 0.005 && (!biggestIncrease || diff > biggestIncrease.diff)) {
      biggestIncrease = { category: cat, diff, now: nowByCat.get(cat) || 0, before: prevByCat.get(cat) || 0 };
    }
  }

  // Biggest single expense this month
  const biggest = thisMonth.reduce((best, e) => (!best || e.amount > best.amount ? e : best), null);

  // Most frequent description this month
  const freq = new Map();
  for (const e of thisMonth) {
    const f = freq.get(e.descriptionKey) || { label: e.description, count: 0, total: 0 };
    f.count += 1;
    f.total += e.amount;
    freq.set(e.descriptionKey, f);
  }
  const mostFrequent = [...freq.values()].sort((a, b) => b.count - a.count || b.total - a.total)[0] || null;

  // Projection for the whole month
  const avgDaily = thisTotal / dayOfMonth;
  const projected = avgDaily * daysInMonth(mi);

  // Tobacco
  const tobacco = all.filter((e) => e.category === "Tobacco");
  const tobaccoMonths = totalsByMonth(tobacco, mi - 5, mi);
  const tobaccoNow = sumAmounts(inDays(tobacco, monthStart, today));
  const tobaccoPrevSame = sumAmounts(inDays(tobacco, prevStart, prevSamePointEnd));
  const tobaccoProjected = (tobaccoNow / dayOfMonth) * daysInMonth(mi);

  return {
    monthIndex: mi, dayOfMonth, today,
    thisTotal, prevSameTotal, prevFullTotal, prevSamePointEnd,
    biggestIncrease, biggest, mostFrequent, avgDaily, projected,
    tobaccoMonths, tobaccoNow, tobaccoPrevSame, tobaccoProjected,
    thisCount: thisMonth.length,
  };
}

/* =========================================================
   Budgets — current month, all filters ignored.
   ========================================================= */
function computeBudgets(all, today, budgets) {
  const mi = monthIndexOfDay(today);
  const spent = new Map(totalsByCategory(inDays(all, monthStartDay(mi), today)).map((c) => [c.category, c.total]));
  return CATEGORIES
    .filter((c) => Number(budgets && budgets[c]) > 0)
    .map((c) => {
      const budget = Number(budgets[c]);
      const used = spent.get(c) || 0;
      const ratio = used / budget;
      return { category: c, budget, used, ratio, status: ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok" };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

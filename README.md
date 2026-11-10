# My Expenses — personal expense dashboard

A small web page that shows your Telegram expenses (saved by n8n into the Google Sheet **"Expenses"**) as KPI cards, charts, insights, budgets and a searchable table.

```
Telegram bot → n8n (AI) → Google Sheet "Expenses"
                                   ↑
Dashboard (this folder) → n8n webhook "Expense Dashboard API" → reads the sheet
```

---

## 0. Why this stack (plain HTML + JavaScript + Chart.js)

- **Nothing to install, nothing to build.** No Node.js, no React, no `npm install`. The files run as-is in any browser.
- **Chart.js** draws the charts and is loaded from a public CDN with one `<script>` line.
- **No database:** the Google Sheet stays your database; n8n is the "API" in front of it.
- Deploying = uploading a folder (Netlify Drop, drag and drop).

React/Vite would add a build step and hundreds of dependencies for no real gain here.

---

## 1. Project folder

```
expense-dashboard/
├── index.html                  ← the page (open this)
├── config.js                   ← YOUR settings: webhook URL + secret key (like a .env file)
├── config.example.js           ← clean copy of config.js, kept as a template
├── .gitignore                  ← keeps config.js out of GitHub
├── css/
│   └── styles.css              ← colors, layout, light/dark mode, phone layout
├── js/
│   ├── utils.js                ← date & money helpers
│   ├── data.js                 ← calls n8n, cleans messy rows, demo data
│   ├── stats.js                ← all calculations (totals, insights, budgets)
│   ├── charts.js               ← draws the 5 charts
│   └── app.js                  ← connects everything: filters, buttons, table, CSV
└── n8n/
    └── expense-dashboard-api.json   ← the n8n workflow to import
```

**Why `config.js` instead of `.env`?** A web page in the browser can't read `.env` files without a build tool. `config.js` does the same job: your URL and key live in one settings file, not inside the code.

---

## 2. What you need

| Thing | Why | Where |
|---|---|---|
| Your n8n (cloud or self-hosted) | serves the data | you already have it |
| Your Google Sheets credential in n8n | reads the sheet | you already have it (used by your Telegram workflow) |
| A code editor | to edit `config.js` | [VS Code](https://code.visualstudio.com/) (free) |
| A way to run a tiny local web server | to open the dashboard | see step 5 (VS Code "Live Server" extension is the easiest) |

---

## 3. Create the n8n workflow (the data webhook)

The workflow has 3 nodes:

```
Dashboard Webhook (GET, needs x-api-key)  →  Get Expense Rows (Google Sheets)  →  Send Rows to Dashboard (JSON array)
```

### 3.1 Choose your secret key

Make up a long random string, for example by opening any browser tab, pressing **F12 → Console**, typing `crypto.randomUUID()` and pressing Enter. You get something like `5f3c9a1e-7b2d-4e8f-9c61-2a4b8d0e7f13`. Copy it somewhere safe — this is your **API key**. Avoid spaces.

### 3.2 Import the workflow

1. Open n8n → **Workflows** → **Create workflow** (empty canvas).
2. Click the **⋯** menu (top right) → **Import from File…** → choose `n8n/expense-dashboard-api.json`.
   *(Alternative: open the JSON file in VS Code, copy everything, click on the empty canvas and press Ctrl+V / Cmd+V.)*
3. You now see 3 nodes. Some show a warning triangle — normal, you'll fix them next.

### 3.3 Set the secret header (Header Auth) on the Webhook

1. Double-click **Dashboard Webhook**.
2. Check: **HTTP Method = GET**, **Path = `expenses-dashboard`**, **Authentication = Header Auth**, **Respond = Using 'Respond to Webhook' Node**.
3. Under **Credential for Header Auth** → **Create new credential**:
   - **Name:** `x-api-key`
   - **Value:** your secret key from 3.1
   - Save, and give the credential a name like "Dashboard key".
4. Scroll to **Options** → you should see **Allowed Origins (CORS)** = `*`. Leave it (this lets the browser call the webhook; see section 7 to restrict it later).

n8n now refuses any call without the right key (it answers **403 – Authorization data is wrong!**; some older versions answer **401** when the header is missing).

### 3.4 Connect the Google Sheet

1. Double-click **Get Expense Rows**.
2. **Credential to connect with:** choose your existing Google Sheets credential (the one your Telegram workflow uses).
3. **Resource:** Sheet Within Document · **Operation:** Get Row(s).
4. **Document:** From list → pick **Expenses**.
5. **Sheet:** From list → pick the tab that holds your rows (the one with the headers `Date | Time | Telegram User | …`).
6. Leave **Filters** empty (we want all rows).
7. Click **Execute step**: you should see your rows on the right. ✅

> The node has the setting **Always Output Data** turned on, so an empty sheet still gives the dashboard a clean answer instead of an error.

### 3.5 The response node (CORS headers)

Double-click **Send Rows to Dashboard** and check:
- **Respond With:** All Incoming Items (= a JSON array with one object per row)
- **Options → Response Headers:** `Access-Control-Allow-Origin: *` and `Cache-Control: no-store`

Nothing to change.

### 3.6 Test it (test URL)

1. Click **Save** (or Ctrl+S).
2. Open **Dashboard Webhook** → copy the **Test URL** (it contains `/webhook-test/`).
3. Click **Execute workflow** (n8n now waits for one call).
4. In a terminal, run (replace URL and key):

   **Mac / Linux (Terminal):**
   ```bash
   curl -H "x-api-key: YOUR-KEY" "https://YOUR-N8N/webhook-test/expenses-dashboard"
   ```
   **Windows (PowerShell)** — type `curl.exe`, not `curl`:
   ```powershell
   curl.exe -H "x-api-key: YOUR-KEY" "https://YOUR-N8N/webhook-test/expenses-dashboard"
   ```

   You should see something like:
   ```json
   [{"row_number":2,"Date":"2026-11-09","Time":"21:30","Telegram User":"Hamza","Original Message":"7 dh tobacco","Amount":7,"Currency":"TND","Description":"tobacco","Category":"Tobacco"}, …]
   ```
5. Run it once more **without** the `-H …` part (click **Execute workflow** again first) → you should get `Authorization data is wrong!`. The protection works.

### 3.7 Publish it (production URL)

1. Click **Publish** (top right) → confirm.
   *(On older n8n 1.x there is no Publish button: switch the **Active** toggle on instead.)*
2. Open **Dashboard Webhook** → switch to **Production URL** → copy it. It looks like:
   `https://YOUR-N8N/webhook/expenses-dashboard` (note: `/webhook/`, not `/webhook-test/`).
3. Test it with the same curl command, using the production URL. You should get your rows.

> Every time you change the workflow later, click **Publish** again — the production URL only runs the published version.

---

## 4. Configure the dashboard

Open `config.js` in VS Code and change two lines:

```js
webhookUrl: "https://YOUR-N8N/webhook/expenses-dashboard",   // production URL from 3.7
apiKey: "5f3c9a1e-7b2d-4e8f-9c61-2a4b8d0e7f13",               // your key from 3.1
```

Everything else is optional:
- `budgets` — monthly budget per category in TND (set a category to `0` or delete it to hide it).
- `exchangeRates` — e.g. `{ EUR: 3.40 }` if some expenses are in euros.
- `weekStartsOn` — `1` = Monday (default), `0` = Sunday.
- `demoMode: true` — shows fake data without calling n8n.

---

## 5. Run it on your computer

**Quickest:** double-click `index.html`. With the workflow's default CORS setting (`*`) this works in Chrome, Edge and Firefox.

If that doesn't work (blank charts, "Can't reach n8n" while curl works), open it through a tiny local web server instead. Pick **one** option:

**Option A — VS Code (easiest, no terminal)**
1. In VS Code: **File → Open Folder…** → choose `expense-dashboard`.
2. Left sidebar → **Extensions** (four squares icon) → search **Live Server** (by Ritwick Dey) → **Install**.
3. Right-click `index.html` → **Open with Live Server**. Your browser opens `http://127.0.0.1:5500`.
4. Edit and save any file → the page reloads by itself.

**Option B — Python (if installed)**
```bash
cd path/to/expense-dashboard
python -m http.server 8000        # Windows: py -m http.server 8000
```
Then open <http://localhost:8000>. Stop with Ctrl+C.

**Option C — Node.js (if installed)**
```bash
cd path/to/expense-dashboard
npx serve .
```
Then open the address it prints.

**Not ready with n8n yet?** Open `http://localhost:8000/?demo` (add `?demo` to the address) to see the dashboard with fake data.

---

## 6. Test with your real data

1. Open the dashboard. The top line should say **"Updated HH:mm · N expenses"** where N = number of expense rows in your sheet.
2. **Check the totals:** choose **Period → All time**. The amount at the right of the filter bar should equal `=SUM(E2:E)` in your Google Sheet (column E = Amount).
3. **Check one day:** choose **Period → Today** and compare with today's rows in the sheet.
4. **Look at the yellow messages** (if any): they list rows that couldn't be read (bad date, empty amount), unknown categories, and other currencies. Fix those rows in the sheet and press **Refresh**.
5. **Live test:** send an expense to your Telegram bot (e.g. `5 dt coffee`), wait for it to appear in the sheet, press **Refresh** — it should be first in the table and counted in "Spent today".
6. **Try the filters:** Period, Category, Custom dates, the search box, and **Export CSV** (downloads exactly what the table shows).

### What the dashboard understands

| Column | Accepted | Notes |
|---|---|---|
| Date | `2026-11-09`, `09/11/2026`, `9-11-2026`, Sheets date numbers | day/month order (Tunisian style) |
| Time | `21:30`, `21:30:00`, `9:30 PM` | empty is fine |
| Amount | `7`, `7.5`, `"7,500"`, `"12 TND"`, `"1 234,50"` | a single comma is a decimal point (`7,500` = 7.5 TND) |
| Currency | `TND` or empty (= TND) | others converted with `exchangeRates`, or counted as TND with a warning |
| Category | your 10 categories, any upper/lower case | unknown → "Other" with a warning |

### How the numbers are calculated
- **KPI cards** always cover today / this week (from Monday) / this month, in **Africa/Tunis** time. They follow the **Category** filter.
- **Charts and table** follow both filters (Period + Category). Daily bars switch to weekly bars for periods longer than ~2 months. If the period is shorter than 2 months, "Monthly totals" shows the last 6 months so there's something to compare.
- **Insights** always use whole months and all categories. "Compared to last month" means **the same days** (1st → today's date) so the comparison is fair early in the month.
- **Budgets** always show the current month.

---

## 7. Common errors and how to fix them

| What you see | Cause | Fix |
|---|---|---|
| **"Settings file not found"** | `config.js` is missing | Copy `config.example.js` → rename to `config.js` (same folder as `index.html`). |
| **"Can't reach n8n"** + console (F12) says *blocked by CORS policy* | CORS | In **Dashboard Webhook → Options → Allowed Origins (CORS)** put `*` (or your dashboard address). Make sure **Send Rows to Dashboard** has the `Access-Control-Allow-Origin` header. **Publish** again. |
| **"Can't reach n8n"** without CORS message | wrong URL, n8n offline, no internet | Paste the URL into a normal browser tab: if you see *Authorization data is wrong!*, n8n is up and the URL is right → the problem is elsewhere (CORS, see above). If the tab can't load at all, the URL is wrong or n8n is offline. |
| **"Can't reach n8n"** only on the online version | *Mixed content*: dashboard is `https://` but your n8n is `http://` | Browsers block this. Your n8n must be reachable over **https** (n8n Cloud already is). |
| **"n8n rejected the API key"** (401 / 403) | key or header name doesn't match | Check `apiKeyHeader` is `x-api-key`, the same as the credential **Name**, and that the key equals the credential **Value** exactly (copy it again, no spaces). A key typed in the dashboard (🔑 button) overrides `config.js` — use the 🔑 button to replace or forget it. |
| **"This webhook is not active"** (404) | workflow not published, or test URL used | Click **Publish**. Use the **Production URL** with `/webhook/`. |
| **"n8n returned an error"** (500) | a node failed | n8n → **Executions** → open the red run. Usually the Google credential expired (reconnect it) or the sheet/tab was renamed (re-select it). |
| **"No expenses yet"** | sheet is empty, or the node points to the wrong tab | Re-select Document + Sheet in **Get Expense Rows**, click **Execute step**, check you see rows, Publish. |
| **"N rows could not be read"** | a date or amount the dashboard can't understand | Click *Show which rows*, fix them in the sheet (date as `YYYY-MM-DD`, amount as a number), Refresh. |
| Dates look shifted or wrong | the sheet turned dates into another format | Format the Date column as **Plain text** (Format → Number → Plain text) or as `yyyy-mm-dd`. If n8n sends odd values, open **Get Expense Rows → Add option → Output Formatting** and choose formatted values / formatted text dates. |
| Charts empty with "Charts could not load" | Chart.js CDN not reachable | Check your internet; the CDN line is at the bottom of `index.html`. |
| A change in n8n has no effect | production still runs the old version | Click **Publish** after every change. |

---

## 8. Optional: open it from your phone (deploy to Netlify, free)

**Before uploading — protect your key.** Anything you put online can be read by anyone who opens the page's source code. So for the online copy:

1. In `config.js` set `apiKey: ""` (empty). Keep `webhookUrl` filled in.
2. Go to <https://app.netlify.com/drop> (create a free account) and **drag the whole `expense-dashboard` folder** onto the page.
3. Netlify gives you an address like `https://random-name-123.netlify.app`. Open it on your phone.
4. The dashboard asks for your API key once → type it → it's saved **only on that phone**.
5. On your phone's browser menu choose **Add to Home Screen** to get an app-like icon.
6. Extra safety (recommended): in n8n, set **Allowed Origins (CORS)** to your Netlify address (e.g. `https://random-name-123.netlify.app`) and Publish. Then other websites can't call your webhook from a browser.

**To update later:** Netlify → your site → **Deploys** → drag the folder again.

> If you prefer **GitHub Pages**: `config.js` is ignored by Git (see `.gitignore`), so the online site would have no settings. Remove `config.js` from `.gitignore`, make sure `apiKey` is `""` inside it, then push the folder and enable **Settings → Pages** on the repository.

**About security, honestly:** the key protects the webhook from random visitors, but anyone who has both the URL and the key can read your expenses. Don't share them, and if you think the key leaked, change the **Value** in the n8n Header Auth credential and enter the new key in the dashboard.

---

## 9. Changing things later

- **Colors:** `css/styles.css`, at the top (`--c-food`, `--c-tobacco`, …).
- **Budgets:** `config.js` → `budgets`.
- **Add a category:** add it to `CATEGORIES` in `js/data.js`, give it a color variable in `css/styles.css` and in `CATEGORY_COLOR_VARS` in `js/charts.js`.
- **How many table rows per page:** `PAGE_SIZE` in `js/app.js`.

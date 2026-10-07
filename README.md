# Burger Town Analytics Dashboard

Web dashboard over a 300,000-row line-item sales dataset (110,478 orders, 6 outlets, Jun 2025 – Jun 2026).

**Live URL:** `<paste your deployed URL here>`  ·  **Repo:** `<paste GitHub URL here>`

## Run locally
```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python backend/etl.py                                  # xlsx -> SQLite (~45 s, one-time)
cd frontend && npm install && npm run build && cd ..
uvicorn backend.app:app --port 8000                    # open http://localhost:8000
```
Dev mode with hot reload: run `uvicorn backend.app:app --reload` and, in `frontend/`, `npm run dev` (http://localhost:5173).

## Architecture
`data.xlsx → ETL (pandas) → SQLite (indexed fact table) → FastAPI (aggregation + cache) → React + Recharts`
One deployable service: FastAPI serves the JSON API and the built React app.

| Decision | Why / trade-off |
|---|---|
| **Database: SQLite** | 300K rows is small. SQLite is zero-ops, read-only at runtime, and ships inside the container. Postgres would add cost and a network hop for no gain here; it becomes the right choice with concurrent writes or ~10M+ rows. |
| **ETL, not reading Excel at runtime** | Parsing the xlsx takes ~40 s. Doing it once at build time makes every request a millisecond-scale query. Dates are parsed (DD-MM-YYYY), duplicates and nulls dropped (none found), and derived columns added: `rev = Price × Quantity`, `hr`, `dow`, `d`. |
| **Indexes + `first` flag** | Single-column indexes on filter columns. `first` marks each order's first line, so order counts use a cheap `SUM(first)` instead of `COUNT(DISTINCT BillNo)` wherever the dimension is order-level (outlet, type, settlement, date, hour). |
| **Server-side aggregation** | The browser never receives raw rows, only a ~10 KB JSON per view, gzip-compressed. |
| **Parallel queries + LRU cache** | Nine aggregates per view run on a thread pool (SQLite releases the GIL). Results are cached per filter combination; the default view is pre-warmed at startup. |
| **Streaming CSV export** | Filtered raw rows stream in 20K-row chunks; memory stays flat. |

**Measured (local):** default view ≈ 4 ms (cached), cold filtered views ≈ 0.3–0.8 s, repeat views ≈ 4 ms.

## Features
KPIs (revenue, orders, AOV, line items, units, items/order) · revenue trend (daily ≤ 92 days, else monthly) · weekday×hour order heatmap · revenue by outlet (bar) · category / order type / settlement (donuts) · top 10 items · filters: date range + presets, outlet, category, order type, settlement (multi-select) · filtered CSV export · auto-generated insights · responsive layout · debounced requests with cancellation.

## Assumptions & trade-offs
- Revenue = `Price × Quantity`. 8,611 lines have price 0 (free/complimentary items); kept, since they count as units sold.
- "Orders" = distinct `BillNo`. With a **category filter**, orders = orders containing that category; revenue is only that category's lines, so AOV then means revenue per matching order.
- Category and item breakdowns show **order lines**, not distinct orders (a DISTINCT per group was ~10× slower).
- "Insights" are rule-based text computed from the aggregates, not an LLM. No external API key is required.
- No authentication: the data is read-only and anonymized. The dataset's latest date (16 Jun 2026) is treated as "today" for the presets.
- The partial first/last months (Jun 2025, Jun 2026) show lower monthly totals; the insight skips the final incomplete period.

## Deploy (Render, free tier)
1. Push this repo to GitHub (`data/data.xlsx` is included; `data/app.db` is git-ignored).
2. Render → New → **Blueprint** → select the repo. `render.yaml` and the `Dockerfile` do the rest: build the React app, run the ETL, start uvicorn.
3. The free tier sleeps after inactivity, so the first hit can take ~30–60 s to wake.

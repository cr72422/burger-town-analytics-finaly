"""ETL: data.xlsx/csv -> indexed SQLite fact table. Usage: python backend/etl.py [file]"""
import sys, os, sqlite3, pandas as pd
src = sys.argv[1] if len(sys.argv) > 1 else "data/data.xlsx"
out = os.environ.get("DB_PATH", "data/app.db")
df = pd.read_excel(src) if src.endswith("xlsx") else pd.read_csv(src)
df["Order_Datetime"] = pd.to_datetime(df["Order_Datetime"], dayfirst=True)
df = df.drop_duplicates().dropna()
t = df["Order_Datetime"]
f = pd.DataFrame({"bill": df.BillNo, "outlet": df.Outlet_Name.str.strip(), "ts": t.dt.strftime("%Y-%m-%d %H:%M:%S"),
    "d": t.dt.strftime("%Y-%m-%d"), "hr": t.dt.hour, "dow": t.dt.dayofweek, "grp": df.Group, "otype": df.Order_Type,
    "item": df.Item, "price": df.Price, "qty": df.Quantity, "settle": df.Settlement, "rev": df.Price * df.Quantity})
f["first"] = (~f.bill.duplicated()).astype(int)  # 1 on each order's first line -> cheap order counts
if os.path.exists(out): os.remove(out)
c = sqlite3.connect(out)
f.to_sql("items", c, index=False, chunksize=50000)
for col in ["d", "outlet", "grp", "otype", "settle", "bill"]: c.execute(f"create index ix_{col} on items({col})")
c.execute("create index ix_d_outlet on items(d, outlet)"); c.execute("analyze"); c.commit(); c.close()
print(f"Loaded {len(f):,} rows, {f.bill.nunique():,} orders -> {out}")

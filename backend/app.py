import sqlite3, csv, io, os
from datetime import date
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.environ.get("DB_PATH", os.path.join(ROOT, "data", "app.db"))
app = FastAPI(title="Burger Town Analytics")
app.add_middleware(GZipMiddleware, minimum_size=1000)

def q(sql, args=()):
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    c.execute("pragma mmap_size=400000000")
    try: return c.execute(sql, args).fetchall()
    finally: c.close()

@lru_cache(maxsize=1)
def bounds(): return q("select min(d), max(d) from items")[0]

def parse(start, end, outlet, group, otype, settle):
    sp = lambda s: tuple(sorted(x for x in (s or "").split(",") if x))
    lo, hi = bounds()
    return (start or lo, end or hi, sp(outlet), sp(group), sp(otype), sp(settle))

def where(f):
    w, a = ["+d between ? and ?"], [f[0], f[1]]
    for col, vals in zip(("outlet", "grp", "otype", "settle"), f[2:]):
        if vals: w.append(f"{col} in ({','.join('?' * len(vals))})"); a += vals
    return " where " + " and ".join(w), a

POOL = ThreadPoolExecutor(8)
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

@lru_cache(maxsize=512)  # identical filter combos are served from memory
def compute(f, gran):
    w, a = where(f)
    cheap = not f[3]  # no category filter -> every order has exactly one 'first' line in scope
    def agg(expr, tail=""):
        # category/item breakdowns report order *lines* (DISTINCT per group is ~10x slower); order-level dims use the cheap flag
        oc = "count(*)" if expr in ("grp", "item") else ("sum(first)" if cheap else "count(distinct bill)")
        fut = POOL.submit(q, f"select {expr} k, sum(rev), {oc}, sum(qty) from items{w} group by k {tail}", a)
        return lambda: [dict(k=r[0], revenue=r[1], orders=r[2], units=r[3]) for r in fut.result()]
    oo = "sum(first)" if cheap else "count(distinct bill)"
    kf = POOL.submit(q, f"select coalesce(sum(rev),0), {oo}, count(*), coalesce(sum(qty),0) from items{w}", a)
    hf = POOL.submit(q, f"select dow, hr, {oo} from items{w} group by dow, hr", a)
    T, OU, G, OT, ST, IT = (agg("d" if gran == "day" else "substr(d,1,7)", "order by k"), agg("outlet", "order by 2 desc"),
        agg("grp", "order by 2 desc"), agg("otype", "order by 2 desc"), agg("settle", "order by 2 desc"), agg("item", "order by 2 desc limit 10"))
    r, o, n, u = kf.result()[0]
    kpi = dict(revenue=r, orders=o, lines=n, units=u, aov=r / o if o else 0, items_per_order=n / o if o else 0)
    trend, outlets, groups, otypes, settles, items = T(), OU(), G(), OT(), ST(), IT()
    heat = [dict(dow=x[0], hr=x[1], orders=x[2]) for x in hf.result()]
    ins = []
    if o:
        tot = lambda L: sum(x["revenue"] for x in L) or 1
        ins.append(f"{outlets[0]['k']} leads with {outlets[0]['revenue'] / tot(outlets):.0%} of revenue.")
        ins.append(f"{groups[0]['k']} is the top category ({groups[0]['revenue'] / tot(groups):.0%} of revenue).")
        peak = max(heat, key=lambda x: x["orders"])
        ins.append(f"Busiest slot: {DAYS[peak['dow']]} at {peak['hr']}:00 ({peak['orders']:,} orders).")
        dl = next((x for x in otypes if x["k"] == "Delivery"), None)
        if dl: ins.append(f"Delivery is {dl['revenue'] / tot(otypes):.0%} of revenue; Zomato/Swiggy payments cover "
                          f"{sum(x['revenue'] for x in settles if 'Pay' in x['k']) / tot(settles):.0%}.")
        ins.append(f"Best seller by revenue: {items[0]['k']} ({items[0]['units']:,} units).")
        if len(trend) > 2:
            a1, a2 = trend[-2]["revenue"], trend[-3]["revenue"]
            ins.append(f"Last full period ({trend[-2]['k']}) revenue moved {(a1 - a2) / a2:+.1%} vs the one before.")
    return dict(kpi=kpi, trend=trend, gran=gran, outlets=outlets, groups=groups, otypes=otypes,
                settles=settles, items=items, heat=heat, insights=ins)

@app.on_event("startup")
def warm(): compute(parse("", "", "", "", "", ""), "month")

@app.get("/api/meta")
def meta():
    lo, hi = bounds()
    col = lambda c: [x[0] for x in q(f"select distinct {c} from items order by 1")]
    return dict(min=lo, max=hi, outlets=col("outlet"), groups=col("grp"), otypes=col("otype"), settles=col("settle"),
                rows=q("select count(*) from items")[0][0])

@app.get("/api/dashboard")
def dashboard(start: str = "", end: str = "", outlet: str = "", group: str = "", otype: str = "", settle: str = ""):
    f = parse(start, end, outlet, group, otype, settle)
    span = (date.fromisoformat(f[1]) - date.fromisoformat(f[0])).days
    return compute(f, "day" if span <= 92 else "month")

@app.get("/api/export.csv")
def export(start: str = "", end: str = "", outlet: str = "", group: str = "", otype: str = "", settle: str = ""):
    w, a = where(parse(start, end, outlet, group, otype, settle))
    def gen():
        c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        cur = c.execute(f"select bill, outlet, ts, grp, otype, item, price, qty, rev, settle from items{w} order by ts", a)
        buf = io.StringIO(); wr = csv.writer(buf)
        wr.writerow(["BillNo", "Outlet", "Datetime", "Group", "OrderType", "Item", "Price", "Qty", "Revenue", "Settlement"])
        while True:
            rows = cur.fetchmany(20000)
            if not rows: break
            wr.writerows(rows); yield buf.getvalue(); buf.seek(0); buf.truncate()
        c.close()
    return StreamingResponse(gen(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=burger_town_filtered.csv"})

dist = os.path.join(ROOT, "frontend", "dist")
if os.path.isdir(dist): app.mount("/", StaticFiles(directory=dist, html=True), name="web")

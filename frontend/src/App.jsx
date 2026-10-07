import {useEffect,useState} from "react";
import {AreaChart,Area,BarChart,Bar,PieChart,Pie,Cell,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from "recharts";
const C=["#1F4D3A","#E0A526","#C2412D","#6B8F71","#2F6F8F","#8A7F72","#B9C4B5"];
const fmt=n=>n>=1e7?(n/1e7).toFixed(2)+" Cr":n>=1e5?(n/1e5).toFixed(2)+" L":Math.round(n).toLocaleString("en-IN");
const rs=n=>"₹"+fmt(n);
const DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const empty={outlet:[],group:[],otype:[],settle:[]};

function Chips({label,opts,val,set}){
  const tog=o=>set(val.includes(o)?val.filter(x=>x!==o):[...val,o]);
  return <fieldset><legend>{label}</legend><div className="chips">{opts.map(o=>
    <button key={o} className={val.includes(o)?"chip on":"chip"} onClick={()=>tog(o)}>{o}</button>)}</div></fieldset>;
}
const Card=({title,sub,children,cls=""})=><section className={"card "+cls}><h3>{title}</h3>{sub&&<p className="sub">{sub}</p>}{children}</section>;
const tip={formatter:v=>rs(v),contentStyle:{borderRadius:6,border:"1px solid #d8ddd6"}};

function Donut({data}){
  return <div className="donut"><ResponsiveContainer width="50%" height={190}><PieChart><Pie data={data} dataKey="revenue" nameKey="k" innerRadius={48} outerRadius={80} paddingAngle={2}>
    {data.map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}</Pie><Tooltip {...tip}/></PieChart></ResponsiveContainer>
    <ul>{data.map((d,i)=><li key={d.k}><i style={{background:C[i%C.length]}}/>{d.k}<b>{rs(d.revenue)}</b></li>)}</ul></div>;
}
function Heat({heat}){
  const hrs=[...Array(13)].map((_,i)=>i+11), m=Math.max(1,...heat.map(h=>h.orders)), g={};
  heat.forEach(h=>g[h.dow+"-"+h.hr]=h.orders);
  return <div className="heat" style={{gridTemplateColumns:`34px repeat(${hrs.length},1fr)`}}>
    <span/>{hrs.map(h=><span key={h} className="hl">{h}</span>)}
    {DAYS.map((d,di)=>[<span key={d} className="hl">{d}</span>,...hrs.map(h=>{const v=g[di+"-"+h]||0;
      return <span key={d+h} className="cell" title={`${d} ${h}:00 — ${v.toLocaleString()} orders`} style={{background:`rgba(31,77,58,${0.06+0.94*v/m})`}}/>})])}
  </div>;
}

export default function App(){
  const [meta,setMeta]=useState(null),[f,setF]=useState(empty),[range,setRange]=useState({start:"",end:""}),[d,setD]=useState(null),[busy,setBusy]=useState(false),[ms,setMs]=useState(null);
  useEffect(()=>{fetch("/api/meta").then(r=>r.json()).then(m=>{setMeta(m);setRange({start:m.min,end:m.max})})},[]);
  const qs=()=>new URLSearchParams({start:range.start,end:range.end,outlet:f.outlet.join(),group:f.group.join(),otype:f.otype.join(),settle:f.settle.join()}).toString();
  useEffect(()=>{ if(!meta||!range.start) return; const ac=new AbortController(), t0=performance.now(); setBusy(true);
    const id=setTimeout(()=>fetch("/api/dashboard?"+qs(),{signal:ac.signal}).then(r=>r.json()).then(x=>{setD(x);setMs(Math.round(performance.now()-t0));setBusy(false)}).catch(()=>{}),180);
    return ()=>{clearTimeout(id);ac.abort()}},[meta,f,range]);
  if(!meta) return <p className="boot">Loading Burger Town…</p>;
  const preset=n=>{const e=new Date(meta.max);const s=new Date(e);s.setDate(s.getDate()-n);setRange({start:n?s.toISOString().slice(0,10):meta.min,end:meta.max})};
  const k=d?.kpi;
  return <div className="app">
    <aside>
      <h1>Burger Town<small>Sales analytics</small></h1>
      <fieldset><legend>Date range</legend><div className="dates">
        <input type="date" min={meta.min} max={meta.max} value={range.start} onChange={e=>setRange({...range,start:e.target.value})}/>
        <input type="date" min={meta.min} max={meta.max} value={range.end} onChange={e=>setRange({...range,end:e.target.value})}/></div>
        <div className="presets"><button onClick={()=>preset(30)}>30 days</button><button onClick={()=>preset(90)}>90 days</button><button onClick={()=>preset(0)}>Full year</button></div></fieldset>
      <Chips label="Outlet" opts={meta.outlets} val={f.outlet} set={v=>setF({...f,outlet:v})}/>
      <Chips label="Category" opts={meta.groups} val={f.group} set={v=>setF({...f,group:v})}/>
      <Chips label="Order type" opts={meta.otypes} val={f.otype} set={v=>setF({...f,otype:v})}/>
      <Chips label="Settlement" opts={meta.settles} val={f.settle} set={v=>setF({...f,settle:v})}/>
      <div className="actions"><button onClick={()=>setF(empty)}>Reset filters</button><a href={"/api/export.csv?"+qs()}>Export filtered CSV</a></div>
      <p className="foot">{meta.rows.toLocaleString()} line items in SQLite{ms!=null&&` · last query ${ms} ms`}</p>
    </aside>
    <main className={busy?"busy":""}>
      {!d?<p className="boot">Crunching 300K rows…</p>:<>
      <div className="kpis">{[["Revenue",rs(k.revenue)],["Orders",k.orders.toLocaleString("en-IN")],["Avg order value","₹"+k.aov.toFixed(0)],["Line items",k.lines.toLocaleString("en-IN")],["Units sold",k.units.toLocaleString("en-IN")],["Items / order",k.items_per_order.toFixed(2)]]
        .map(([a,b])=><div key={a}><span>{a}</span><strong>{b}</strong></div>)}</div>
      {d.insights.length>0&&<ul className="insights">{d.insights.map((t,i)=><li key={i}>{t}</li>)}</ul>}
      <Card title="Revenue trend" sub={d.gran==="day"?"Daily":"Monthly"} cls="wide"><ResponsiveContainer width="100%" height={260}>
        <AreaChart data={d.trend}><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1F4D3A" stopOpacity=".35"/><stop offset="1" stopColor="#1F4D3A" stopOpacity="0"/></linearGradient></defs>
          <CartesianGrid stroke="#e3e7e0" vertical={false}/><XAxis dataKey="k" tick={{fontSize:11}} minTickGap={30}/><YAxis tickFormatter={fmt} tick={{fontSize:11}} width={52}/><Tooltip {...tip}/>
          <Area dataKey="revenue" stroke="#1F4D3A" strokeWidth={2} fill="url(#g)"/></AreaChart></ResponsiveContainer></Card>
      <Card title="When the rush hits" sub="Orders by weekday and hour" cls="wide"><Heat heat={d.heat}/></Card>
      <Card title="Revenue by outlet"><ResponsiveContainer width="100%" height={240}><BarChart data={d.outlets} layout="vertical" margin={{left:20}}>
        <XAxis type="number" tickFormatter={fmt} tick={{fontSize:11}}/><YAxis type="category" dataKey="k" width={90} tick={{fontSize:12}}/><Tooltip {...tip}/><Bar dataKey="revenue" fill="#1F4D3A" radius={[0,4,4,0]}/></BarChart></ResponsiveContainer></Card>
      <Card title="Revenue by category"><Donut data={d.groups}/></Card>
      <Card title="Order type"><Donut data={d.otypes}/></Card>
      <Card title="Settlement channel" cls="wide"><Donut data={d.settles}/></Card>
      <Card title="Top 10 items by revenue" cls="wide"><table><thead><tr><th>Item</th><th>Units</th><th>Order lines</th><th>Revenue</th></tr></thead><tbody>
        {d.items.map(i=><tr key={i.k}><td>{i.k}</td><td>{i.units.toLocaleString()}</td><td>{i.orders.toLocaleString()}</td><td>{rs(i.revenue)}</td></tr>)}</tbody></table></Card></>}
    </main></div>;
}

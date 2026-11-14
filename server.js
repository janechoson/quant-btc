import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const files = { forecasts: path.join(dataDir, 'forecasts.json'), datasets: path.join(dataDir, 'datasets.json') };
const periods = { '1H': 3600000, '4H': 14400000, '1D': 86400000 };
await mkdir(dataDir, { recursive: true });
async function load(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return []; } }
async function save(file, value) { await writeFile(file, JSON.stringify(value, null, 2)); }
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(value)); };
async function body(req) { let s = ''; for await (const chunk of req) s += chunk; return s ? JSON.parse(s) : {}; }
function normalized(candles, window = 24) {
  if (candles.length < window) throw new Error(`Cần ít nhất ${window} nến đã đóng.`);
  const recent = candles.slice(-window), base = recent.at(-1).close;
  return recent.map(c => [(c.close / c.open - 1), (c.high - Math.max(c.open,c.close))/c.open, (Math.min(c.open,c.close)-c.low)/c.open, c.volume / Math.max(1, recent.reduce((s,x)=>s+x.volume,0)/recent.length), c.close / base - 1]);
}
async function binance(symbol, interval, limit=500, startTime, endTime) {
  const u = new URL('https://api.binance.com/api/v3/klines');
  u.searchParams.set('symbol', symbol); u.searchParams.set('interval', ({'1H':'1h','4H':'4h','1D':'1d'})[interval]||interval); u.searchParams.set('limit', String(Math.min(limit,1000)));
  if (startTime) u.searchParams.set('startTime', String(startTime)); if (endTime) u.searchParams.set('endTime', String(endTime));
  const response = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Binance trả HTTP ${response.status}`);
  return (await response.json()).map(k => ({ time: Math.floor(k[0]/1000), openTime:k[0], open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5], closeTime:k[6], closed:k[6] < Date.now() }));
}
function makeForecast(candles, horizon, timeframe, examples=[]) {
  const last = candles.at(-1), step = periods[timeframe], returns = candles.slice(-24).map(c => Math.log(c.close/c.open));
  const drift = returns.reduce((a,b)=>a+b,0)/returns.length, vol = Math.sqrt(returns.reduce((a,b)=>a+(b-drift)**2,0)/Math.max(1,returns.length-1));
  const matched = examples.map(e => ({e, d: e.features.reduce((s,row,i)=>s+row.reduce((t,x,j)=>t+(x-(normalized(candles).at(i)?.[j]??0))**2,0),0)})).sort((a,b)=>a.d-b.d).slice(0,Math.min(8,examples.length));
  const paths = matched.flatMap(m=>m.e.outcomes||[]); const meanMove = paths.length ? paths.reduce((s,x)=>s+x,0)/paths.length : drift;
  let prev=last.close;
  const predictedCandles=Array.from({length:horizon},(_,i)=>{ const r=(drift*.35+meanMove*.65)*(i===0?1:.7**i), open=prev, close=Math.max(.01,open*Math.exp(r)); const spread=Math.max(vol*.7,.001); const c={time:last.time+(i+1)*step/1000,open,close,high:Math.max(open,close)*Math.exp(spread*.6),low:Math.min(open,close)*Math.exp(-spread*.6)}; prev=close; return c; });
  const move=predictedCandles.at(-1).close/last.close-1, signal=move>vol*Math.sqrt(horizon)*.65?'LONG':move < -vol*Math.sqrt(horizon)*.65?'SHORT':'NO TRADE';
  const range=last.close*vol*Math.sqrt(horizon); const entry={low:last.close*(1-vol*.4),high:last.close*(1+vol*.4)};
  return { predictedCandles, uncertainty:predictedCandles.map((c,i)=>({time:c.time,low:c.close-range*Math.sqrt((i+1)/horizon),high:c.close+range*Math.sqrt((i+1)/horizon)})), signal, entry:signal==='NO TRADE'?null:entry, takeProfit:signal==='LONG'?last.close+range:signal==='SHORT'?last.close-range:null, stopLoss:signal==='LONG'?last.close-range*.65:signal==='SHORT'?last.close+range*.65:null, metadata:{provider:'PatternForecastProvider',version:'pattern-knn-v1',neighbors:matched.length,confidenceLabel:matched.length?'Mẫu lịch sử gần nhất':'Thống kê biến động',featureHash:createHash('sha256').update(JSON.stringify(normalized(candles))).digest('hex'),volatility:vol} };
}
async function monitor() {
  const all=await load(files.forecasts); let changed=false;
  for (const f of all.filter(x=>!['COMPLETED','FAILED','CANCELLED'].includes(x.status))) {
    try { const rows=await binance(f.symbol,f.timeframe,f.horizon+5,f.forecastStart*1000,Date.now());
      const oldStatus=f.status;
      const byTime=new Map(rows.filter(x=>x.closed).map(x=>[x.time,x]));
      for (const p of f.predictedCandles) { const a=byTime.get(p.time); if(a&&!f.actualCandles.some(x=>x.time===a.time)){f.actualCandles.push(a); changed=true;} }
      f.actualCandles.sort((a,b)=>a.time-b.time); f.progress=f.actualCandles.length; f.status=f.progress===f.horizon?'COMPLETED':f.progress?'PARTIALLY_EVALUATED':'MONITORING';
      if(f.progress) f.evaluation=evaluate(f);
      if(f.status!==oldStatus)changed=true;
    } catch { if(f.status!=='DATA_DELAYED'){f.status='DATA_DELAYED';changed=true;} }
  }
  if(changed) await save(files.forecasts,all);
}
function evaluate(f) {
 const actual=f.actualCandles, n=actual.length, predicted=f.predictedCandles.slice(0,n); if(!n)return null;
 const start=f.startPrice, p=predicted.at(-1).close, a=actual.at(-1).close, direction=Math.sign(p-start)===Math.sign(a-start)?'CORRECT':'INCORRECT';
 const errors=predicted.map((x,i)=>Math.abs(x.close-actual[i].close)/start); const pathError=errors.reduce((s,x)=>s+x,0)/n;
 return { progress:n, predictedFinal:p, actualFinal:a, direction, priceError:Math.abs(p-a), pathError, pathScore:Math.max(0,100*(1-pathError*100)), completed:n===f.horizon, tradeOutcome:f.signal==='NO TRADE'?'NO TRADE':'PENDING' };
}
async function handle(req,res) {
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,idempotency-key'});return res.end();}
  const u=new URL(req.url,'http://localhost');
  try {
    if(u.pathname==='/api/market/candles') {const tf=u.searchParams.get('timeframe')||'1H'; if(!periods[tf])return json(res,400,{error:'Timeframe không hợp lệ'}); const candles=await binance('BTCUSDT',tf,u.searchParams.get('limit')||500); return json(res,200,{candles:candles.filter(x=>x.closed),source:'Binance public REST'});}
    if(u.pathname==='/api/market/status')return json(res,200,{exchange:'Binance',market:'SPOT',symbol:'BTC/USDT',checkedAt:new Date().toISOString()});
    if(u.pathname==='/api/learning/datasets'&&req.method==='POST') {const b=await body(req),tf=b.timeframe||'1H'; if(!periods[tf])return json(res,400,{error:'Timeframe không hợp lệ'}); const start=Date.parse(b.start),end=Date.parse(b.end)+86400000-1; if(!start||!end||start>=end)return json(res,400,{error:'Khoảng ngày không hợp lệ'}); let rows=[]; for(let from=start;from<end;){const batch=await binance('BTCUSDT',tf,1000,from,end); if(!batch.length)break; rows.push(...batch.filter(x=>x.closed)); from=batch.at(-1).openTime+periods[tf]; if(batch.length<1000)break;}
      const window=24,horizon=10,examples=[]; for(let i=window;i+horizon<rows.length;i++){const hist=rows.slice(i-window,i), future=rows.slice(i,i+horizon); examples.push({time:hist.at(-1).time,features:normalized(hist,window),outcomes:future.map((c,j)=>Math.log(c.close/(j?future[j-1].close:hist.at(-1).close))) });}
      const dataset={id:randomUUID(),symbol:'BTC/USDT',timeframe:tf,start:b.start,end:b.end,candleCount:rows.length,exampleCount:examples.length,window,horizon,createdAt:new Date().toISOString(),examples}; const list=await load(files.datasets);list.push(dataset);await save(files.datasets,list);return json(res,201,{...dataset,examples:undefined}); }
    if(u.pathname==='/api/learning/datasets'&&req.method==='GET'){const list=await load(files.datasets);return json(res,200,list.map(({examples,...x})=>x));}
    if(u.pathname==='/api/forecasts'&&req.method==='POST'){const b=await body(req),tf=b.timeframe||'1H',horizon=Math.min(30,Math.max(5,Number(b.horizon)||10));if(!periods[tf])return json(res,400,{error:'Timeframe không hợp lệ'});const idem=req.headers['idempotency-key'];const all=await load(files.forecasts);if(idem&&all.some(x=>x.idempotencyKey===idem))return json(res,200,all.find(x=>x.idempotencyKey===idem));const candles=(await binance('BTCUSDT',tf,150)).filter(x=>x.closed);if(!candles.length)return json(res,502,{error:'Không có nến đã đóng'});const datasets=await load(files.datasets),examples=datasets.filter(d=>d.timeframe===tf).flatMap(d=>d.examples||[]);const result=makeForecast(candles,horizon,tf,examples);const f={id:randomUUID(),idempotencyKey:idem||null,symbol:'BTCUSDT',exchange:'Binance',marketType:'SPOT',timeframe:tf,horizon,createdAt:new Date().toISOString(),lastConfirmedCandle:candles.at(-1).time,forecastStart:candles.at(-1).time+periods[tf]/1000,forecastEnd:candles.at(-1).time+(horizon+1)*periods[tf]/1000,startPrice:candles.at(-1).close,inputCandles:candles.slice(-60),actualCandles:[],progress:0,status:'MONITORING',...result};all.push(f);await save(files.forecasts,all);return json(res,201,f);}
    if(u.pathname==='/api/forecasts'&&req.method==='GET'||u.pathname==='/api/prediction-history'){const all=await load(files.forecasts);return json(res,200,all.map(({inputCandles,predictedCandles,actualCandles,uncertainty,...f})=>({...f,predictedFinal:predictedCandles?.at(-1)?.close,actualFinal:actualCandles?.at(-1)?.close,progress:actualCandles?.length||0})).reverse());}
    const detail=u.pathname.match(/^\/api\/(?:forecasts|prediction-history)\/([^/]+)$/);if(detail){const f=(await load(files.forecasts)).find(x=>x.id===detail[1]);return f?json(res,200,f):json(res,404,{error:'Không tìm thấy dự báo'});}
    if(u.pathname==='/api/prediction-history/summary'){const all=await load(files.forecasts),done=all.filter(x=>x.status==='COMPLETED'&&x.evaluation);return json(res,200,{total:all.length,completed:done.length,monitoring:all.length-done.length,directionalCorrect:done.filter(x=>x.evaluation.direction==='CORRECT').length});}
    const staticPath=u.pathname==='/'?'/index.html':u.pathname;const safe=path.resolve(root,'.'+staticPath);if(safe!==root&&!safe.startsWith(root+path.sep))return json(res,403,{error:'Forbidden'});const content=await readFile(safe);const type=safe.endsWith('.html')?'text/html; charset=utf-8':safe.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';res.writeHead(200,{'content-type':type});res.end(content);
  }catch(e){json(res,500,{error:e.message||'Lỗi máy chủ'});}
}
const server=http.createServer(handle);const port=Number(process.env.PORT)||4173;server.listen(port,()=>console.log(`BTC Pattern Terminal: http://localhost:${port}`));
monitor().catch(()=>{});setInterval(()=>monitor().catch(()=>{}),60000).unref();

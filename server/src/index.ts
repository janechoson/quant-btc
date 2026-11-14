import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase, projectRoot, run, transaction } from './database/connection.js';
import { migrateLegacyJson } from './migrate-json.js';
import { fetchCandles, validTimeframe, type Timeframe } from './services/binance.js';
import { createDataset, datasetCandles, datasetExamples, deleteDataset, getDataset, listDatasets } from './services/chart-learning.js';
import { createForecast, forecastDetail, forecastSummary, listForecasts, monitorForecasts } from './services/pattern-forecast.js';

const prodRoot=path.join(projectRoot,'dist/client'),port=Number(process.env.PORT)||4173;
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const send=(res:http.ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
async function readBody(req:http.IncomingMessage){let text='';for await(const c of req){text+=c;if(text.length>1_000_000)throw new Error('Request body quá lớn');}return text?JSON.parse(text):{};}
async function api(req:http.IncomingMessage,res:http.ServerResponse,u:URL){
  const m=req.method||'GET';
  if(u.pathname==='/api/market/status')return send(res,200,{exchange:'Binance',market:'SPOT',symbol:'BTC/USDT',checkedAt:new Date().toISOString()});
  if(u.pathname==='/api/market/candles'&&m==='GET'){
    const tf=u.searchParams.get('timeframe')||'1H',limit=Math.min(1000,Math.max(1,Number(u.searchParams.get('limit'))||500));if(!validTimeframe(tf))return send(res,400,{error:'Timeframe không hợp lệ'});
    const candles=(await fetchCandles('BTCUSDT',tf as Timeframe,limit)).filter(c=>c.closed);
    await transaction(()=>{for(const c of candles)run('INSERT OR IGNORE INTO market_candles(exchange,symbol,timeframe,open_time,close_time,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?,?,?,?)',['Binance','BTC/USDT',tf,c.time,Math.floor(c.closeTime/1000),c.open,c.high,c.low,c.close,c.volume]);});
    return send(res,200,{candles:candles.map(({openTime,closeTime,closed,...c})=>c),source:'Binance public REST'});
  }
  if(u.pathname==='/api/learning/datasets'&&m==='POST'){
    const body=await readBody(req);if(!validTimeframe(body.timeframe)||typeof body.start!=='string'||typeof body.end!=='string')return send(res,400,{error:'timeframe, start và end là bắt buộc'});
    const result=await createDataset({timeframe:body.timeframe,start:body.start,end:body.end,name:typeof body.name==='string'?body.name.slice(0,120):undefined});return send(res,result.duplicate?200:201,result);
  }
  if(u.pathname==='/api/learning/datasets'&&m==='GET'){
    const page=Math.max(1,Number(u.searchParams.get('page'))||1),limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit'))||20));return send(res,200,listDatasets(page,limit));
  }
  const ds=u.pathname.match(/^\/api\/learning\/datasets\/([^/]+)(?:\/(candles|examples))?$/);
  if(ds){const id=decodeURIComponent(ds[1]!);if(m==='DELETE'&&!ds[2]){if(!getDataset(id))return send(res,404,{error:'Không tìm thấy dataset'});await deleteDataset(id);return send(res,200,{deleted:true,id});}
    const dataset=getDataset(id);if(!dataset)return send(res,404,{error:'Không tìm thấy dataset'});
    if(ds[2]==='candles')return send(res,200,{dataset,candles:datasetCandles(id)});
    if(ds[2]==='examples'){const page=Math.max(1,Number(u.searchParams.get('page'))||1),limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit'))||50));return send(res,200,{dataset,...datasetExamples(id,page,limit)});}
    if(m==='GET')return send(res,200,dataset);
  }
  if(u.pathname==='/api/forecasts'&&m==='POST'){
    const body=await readBody(req),tf=body.timeframe||'1H',horizon=Number(body.horizon)||10;if(!validTimeframe(tf)||![5,10,20,30].includes(horizon))return send(res,400,{error:'Khung thời gian không hợp lệ; horizon phải là 5, 10, 20 hoặc 30 nến'});
    const key=String(req.headers['idempotency-key']||'').slice(0,200)||undefined;
    try{return send(res,201,await createForecast(tf as Timeframe,horizon,key));}
    catch(error){if(error instanceof Error&&error.message.startsWith('Chưa đủ'))return send(res,422,{error:error.message});throw error;}
  }
  if(u.pathname==='/api/forecasts'&&m==='GET'||u.pathname==='/api/prediction-history'&&m==='GET')return send(res,200,listForecasts());
  if(u.pathname==='/api/prediction-history/summary'&&m==='GET')return send(res,200,forecastSummary());
  const detail=u.pathname.match(/^\/api\/(?:forecasts|prediction-history)\/([^/]+)$/);if(detail&&m==='GET'){const f=forecastDetail(decodeURIComponent(detail[1]!));return f?send(res,200,f):send(res,404,{error:'Không tìm thấy dự báo'});}
  return send(res,404,{error:'API endpoint không tồn tại'});
}
async function handle(req:http.IncomingMessage,res:http.ServerResponse){
  res.setHeader('x-content-type-options','nosniff');res.setHeader('x-frame-options','DENY');res.setHeader('referrer-policy','same-origin');
  const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  try{if(u.pathname.startsWith('/api/'))return await api(req,res,u);
    const decoded=decodeURIComponent(u.pathname),candidate=path.resolve(prodRoot,`.${decoded}`);if(candidate!==prodRoot&&!candidate.startsWith(prodRoot+path.sep))return send(res,403,{error:'Forbidden'});
    let file=candidate;try{if(!(await stat(file)).isFile())throw new Error('not file');}catch{if(path.extname(decoded))return send(res,404,{error:'Not found'});file=path.join(prodRoot,'index.html');}
    const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':path.basename(file)==='index.html'?'no-cache':'public, max-age=31536000, immutable'});res.end(bytes);
  }catch(error){console.error(error);send(res,500,{error:error instanceof Error?error.message:'Lỗi máy chủ'});}
}

await openDatabase();
const migration=await migrateLegacyJson();if(!migration.skipped&&(migration.datasets||migration.forecasts||migration.malformed.length))console.log('JSON migration:',migration);
const server=http.createServer((req,res)=>void handle(req,res));server.listen(port,()=>console.log(`Quant BTC API: http://localhost:${port}`));
void monitorForecasts().catch(error=>console.error('monitor startup:',error));setInterval(()=>void monitorForecasts().catch(error=>console.error('monitor:',error)),60_000).unref();

import { randomUUID } from 'node:crypto';
import { all, get, run, transaction } from '../database/connection.js';
import { fetchCandles, timeframeMs, type Candle, type Timeframe } from './binance.js';
import { evaluateForecast, insertEvaluation, readCandles } from './evaluation.js';
import { buildHistoricalExamples, forecastPath } from './forecast-engine.js';
export function forecastDetail(id:string) {
  const f=get<Record<string,any>>('SELECT * FROM forecasts WHERE id=?',[id]);if(!f)return null;
  const predictedCandles=readCandles('forecast_candles',id),actualCandles=readCandles('forecast_actual_candles',id),levels=JSON.parse(String(f.signal_levels)),metadata=JSON.parse(String(f.metadata)),evaluation=f.evaluation?JSON.parse(String(f.evaluation)):null;
  return {...f,createdAt:f.created_at,lastConfirmedCandle:f.last_confirmed_candle,forecastStart:f.forecast_start,forecastEnd:f.forecast_end,startPrice:f.start_price,algorithmVersion:f.algorithm_version,idempotencyKey:f.idempotency_key,inputCandles:JSON.parse(String(f.input_snapshot)),predictedCandles,actualCandles,uncertainty:metadata.uncertainty||[],metadata,entry:levels.entry,takeProfit:levels.takeProfit,stopLoss:levels.stopLoss,evaluation};
}
export async function deleteForecast(id:string):Promise<boolean>{
  return transaction(()=>run('DELETE FROM forecasts WHERE id=?',[id])===1);
}
export async function createForecast(tf:Timeframe,horizon:number,idempotencyKey?:string) {
  if(![5,10,20,30].includes(horizon))throw new Error('Chọn horizon 5, 10, 20 hoặc 30 nến.');
  if(idempotencyKey){const existing=get<{id:string}>('SELECT id FROM forecasts WHERE idempotency_key=?',[idempotencyKey]);if(existing)return forecastDetail(existing.id);}
  const candles=(await fetchCandles('BTCUSDT',tf,150)).filter(c=>c.closed);if(candles.length<24)throw new Error('Không đủ nến đã đóng để dự báo');
  const last=candles.at(-1)!,history=all<Record<string,unknown>>(`SELECT DISTINCT c.open_time time,c.open,c.high,c.low,c.close,c.volume
    FROM market_candles c JOIN learning_datasets d ON d.symbol=c.symbol AND d.timeframe=c.timeframe
      AND c.open_time>=d.start_time AND c.open_time<=d.end_time AND d.status='READY'
    WHERE c.symbol='BTC/USDT' AND c.timeframe=? AND c.open_time<? ORDER BY c.open_time DESC LIMIT 30000`,[tf,last.time]).reverse().map(row=>({time:Number(row.time),open:Number(row.open),high:Number(row.high),low:Number(row.low),close:Number(row.close),volume:Number(row.volume)}));
  const examples=buildHistoricalExamples(history,last.time,tf,horizon);
  const result=forecastPath(candles,horizon,tf,examples),id=randomUUID(),step=timeframeMs(tf),createdAt=new Date().toISOString(),start=last.time+step/1000,end=last.time+horizon*step/1000;
  const metadata={...result.metadata,uncertainty:result.uncertainty};
  const savedId=await transaction(()=>{
    if(idempotencyKey){const existing=get<{id:string}>('SELECT id FROM forecasts WHERE idempotency_key=?',[idempotencyKey]);if(existing)return existing.id;}
    run('INSERT INTO forecasts(id,idempotency_key,symbol,timeframe,horizon,created_at,last_confirmed_candle,forecast_start,forecast_end,start_price,status,progress,signal,algorithm_version,input_snapshot,metadata,signal_levels) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,idempotencyKey||null,'BTCUSDT',tf,horizon,createdAt,last.time,start,end,last.close,'MONITORING',0,result.signal,result.metadata.version,JSON.stringify(candles.slice(-60)),JSON.stringify(metadata),JSON.stringify(result.levels)]);
    for(const c of result.predictedCandles)run('INSERT INTO forecast_candles(forecast_id,candle_time,open,high,low,close) VALUES(?,?,?,?,?,?)',[id,c.time,c.open,c.high,c.low,c.close]);
    return id;
  });
  return forecastDetail(savedId);
}
export async function monitorForecasts(){
  const pending=all<Record<string,any>>("SELECT * FROM forecasts WHERE status NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY forecast_start");
  const groups=new Map<string,Record<string,any>[]>();for(const f of pending){const key=`${f.symbol}:${f.timeframe}`;groups.set(key,[...(groups.get(key)||[]),f]);}
  for(const group of groups.values()){
    const now=Date.now(),active=group.filter(f=>Number(f.forecast_start)*1000<=now);if(!active.length)continue;
    const first=active.reduce((min,f)=>Math.min(min,Number(f.forecast_start)),Infinity),sample=active[0]!;
    try{
      const rows=await fetchCandles(String(sample.symbol),sample.timeframe as Timeframe,1000,first*1000,Date.now()),byTime=new Map(rows.filter(c=>c.closed).map(c=>[c.time,c]));
      for(const f of active){
        const predicted=readCandles('forecast_candles',String(f.id)),existing=readCandles('forecast_actual_candles',String(f.id)),known=new Set(existing.map(c=>c.time));
        const fresh=predicted.map(p=>byTime.get(p.time)).filter((x):x is NonNullable<typeof x>=>!!x&&!known.has(x.time));
        const currentStatus=existing.length+fresh.length===Number(f.horizon)?'COMPLETED':existing.length+fresh.length?'PARTIALLY_EVALUATED':'MONITORING';if(!fresh.length&&f.status===currentStatus)continue;
        await transaction(()=>{
          for(const c of fresh)run('INSERT OR IGNORE INTO forecast_actual_candles(forecast_id,candle_time,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?)',[f.id,c.time,c.open,c.high,c.low,c.close,c.volume||0]);
          const actual=readCandles('forecast_actual_candles',String(f.id)),evaluation=evaluateForecast(f,predicted,actual),status=actual.length===Number(f.horizon)?'COMPLETED':actual.length?'PARTIALLY_EVALUATED':'MONITORING';
          run('UPDATE forecasts SET progress=?,status=?,evaluation=? WHERE id=?',[actual.length,status,evaluation?JSON.stringify(evaluation):null,f.id]);if(fresh.length)insertEvaluation(String(f.id),evaluation);
        });
      }
    }catch(error){await transaction(()=>{for(const f of active)run("UPDATE forecasts SET status='DATA_DELAYED' WHERE id=?",[f.id]);});console.error(`monitor ${sample.symbol}/${sample.timeframe}:`,error);}
  }
}
export function listForecasts(){return all<Record<string,any>>(`SELECT f.*,
 (SELECT close FROM forecast_candles c WHERE c.forecast_id=f.id ORDER BY candle_time DESC LIMIT 1) predictedFinal,
 (SELECT close FROM forecast_actual_candles a WHERE a.forecast_id=f.id ORDER BY candle_time DESC LIMIT 1) actualFinal
 FROM forecasts f ORDER BY created_at DESC LIMIT 500`).map((f):Record<string,any>=>({...f,createdAt:f.created_at,startPrice:f.start_price,forecastStart:f.forecast_start,forecastEnd:f.forecast_end,lastConfirmedCandle:f.last_confirmed_candle,metadata:JSON.parse(String(f.metadata)),evaluation:f.evaluation?JSON.parse(String(f.evaluation)):null}));}
export function forecastSummary(){const counts=get<Record<string,any>>("SELECT COUNT(*) total,SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) completed,SUM(CASE WHEN status NOT IN ('COMPLETED','FAILED','CANCELLED') THEN 1 ELSE 0 END) monitoring FROM forecasts");const done=all<{evaluation:string|null}>("SELECT evaluation FROM forecasts WHERE status='COMPLETED' AND evaluation IS NOT NULL");return {total:Number(counts?.total||0),completed:Number(counts?.completed||0),monitoring:Number(counts?.monitoring||0),directionalCorrect:done.filter(f=>{try{return JSON.parse(String(f.evaluation)).direction==='CORRECT'}catch{return false;}}).length};}

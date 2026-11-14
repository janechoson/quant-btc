import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { all, openDatabase, projectRoot, run, transaction } from './database/connection.js';

const legacyDir=path.resolve(process.env.QUANT_BTC_LEGACY_DATA_DIR||path.join(projectRoot,'data'));
const safeRead = async (name: string) => {
  try { const text=await readFile(path.join(legacyDir,name),'utf8'); return JSON.parse(text) as unknown; }
  catch (error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return null; throw error; }
};
const iso=(v:unknown)=>typeof v==='string'?v:new Date(typeof v==='number'&&v<1e12?v*1000:Number(v)||Date.now()).toISOString();

export async function migrateLegacyJson() {
  await openDatabase();
  const previous=all<{version:number}>('SELECT version FROM schema_migrations WHERE version=2').length>0;
  if(previous) return { skipped:true, datasets:0, forecasts:0, malformed:[] as string[] };
  for(const file of ['datasets.json','forecasts.json']) {
    const p=path.join(legacyDir,file);
    try { await copyFile(p,`${p}.backup-${Date.now()}`); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  }
  const datasets=await safeRead('datasets.json'), forecasts=await safeRead('forecasts.json');
  const malformed:string[]=[];let importedDatasets=0,importedForecasts=0;
  const asArray=(value:unknown,name:string)=>{if(value==null)return [];if(Array.isArray(value))return value;if(typeof value==='object')return [value];malformed.push(`${name}: root is not an array/object`);return [];};
  await transaction(()=>{
    for(const [index,raw] of asArray(datasets,'datasets.json').entries()) {
      try {
        const d=raw as Record<string,any>; if(!d.id||!['1H','4H','1D'].includes(d.timeframe)||!Array.isArray(d.examples))throw Error('missing id/timeframe/examples');
        const start=Date.parse(d.start)||Number(d.start)*1000,end=Date.parse(d.end)||Number(d.end)*1000;
        run(`INSERT OR IGNORE INTO learning_datasets(id,name,symbol,timeframe,start_time,end_time,candle_count,example_count,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[String(d.id),String(d.name||`${d.symbol||'BTC/USDT'} ${d.timeframe} ${d.start}–${d.end}`),String(d.symbol||'BTC/USDT'),d.timeframe,Math.floor(start/1000),Math.floor(end/1000),Number(d.candleCount)||0,Number(d.exampleCount)||d.examples.length,'READY',iso(d.createdAt),iso(d.createdAt)]);
        const step=({ '1H':3600,'4H':14400,'1D':86400 } as Record<string,number>)[d.timeframe];for(const ex of d.examples){const t=Number(ex.time);if(!Number.isFinite(t)||!Array.isArray(ex.features)||!Array.isArray(ex.outcomes))continue;run('INSERT OR IGNORE INTO learning_examples(dataset_id,input_start_time,input_end_time,target_end_time,input_features,target_returns,created_at) VALUES(?,?,?,?,?,?,?)',[String(d.id),t-23*step,t,t+10*step,JSON.stringify(ex.features),JSON.stringify(ex.outcomes),iso(d.createdAt)]);}
        importedDatasets++;
      }catch(error){malformed.push(`datasets.json[${index}]: ${(error as Error).message}`);}
    }
    for(const [index,raw] of asArray(forecasts,'forecasts.json').entries()) {
      try {
        const f=raw as Record<string,any>;if(!f.id||!Array.isArray(f.predictedCandles)||!['1H','4H','1D'].includes(f.timeframe))throw Error('missing id/timeframe/predictedCandles');
        const levels={entry:f.entry??null,takeProfit:f.takeProfit??null,stopLoss:f.stopLoss??null};const metadata={...(f.metadata||{}),uncertainty:f.uncertainty||f.metadata?.uncertainty||[]};
        run(`INSERT OR IGNORE INTO forecasts(id,idempotency_key,symbol,timeframe,horizon,created_at,last_confirmed_candle,forecast_start,forecast_end,start_price,status,progress,signal,algorithm_version,input_snapshot,metadata,signal_levels,evaluation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[String(f.id),f.idempotencyKey||null,String(f.symbol||'BTCUSDT'),f.timeframe,Number(f.horizon)||f.predictedCandles.length,iso(f.createdAt),Number(f.lastConfirmedCandle)||0,Number(f.forecastStart)||0,Number(f.forecastEnd)||0,Number(f.startPrice)||0,String(f.status||'MONITORING'),Number(f.progress)||0,String(f.signal||'NO TRADE'),String(f.metadata?.version||'pattern-knn-v1'),JSON.stringify(f.inputCandles||[]),JSON.stringify(metadata),JSON.stringify(levels),f.evaluation?JSON.stringify(f.evaluation):null]);
        for(const c of f.predictedCandles)run('INSERT OR IGNORE INTO forecast_candles(forecast_id,candle_time,open,high,low,close) VALUES(?,?,?,?,?,?)',[String(f.id),Number(c.time),Number(c.open),Number(c.high),Number(c.low),Number(c.close)]);
        for(const c of f.actualCandles||[])run('INSERT OR IGNORE INTO forecast_actual_candles(forecast_id,candle_time,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?)',[String(f.id),Number(c.time),Number(c.open),Number(c.high),Number(c.low),Number(c.close),Number(c.volume)||0]);
        if(f.evaluation)run('INSERT INTO forecast_evaluations(forecast_id,evaluated_at,progress,direction,price_error,path_error,path_score,metrics) VALUES(?,?,?,?,?,?,?,?)',[String(f.id),iso(f.createdAt),Number(f.progress)||0,f.evaluation.direction||null,Number(f.evaluation.priceError)||null,Number(f.evaluation.pathError)||null,Number(f.evaluation.pathScore)||null,JSON.stringify(f.evaluation)]);
        importedForecasts++;
      }catch(error){malformed.push(`forecasts.json[${index}]: ${(error as Error).message}`);}
    }
    run('INSERT OR REPLACE INTO schema_migrations(version,applied_at) VALUES(2,?)',[new Date().toISOString()]);
    run('INSERT OR REPLACE INTO migration_reports(version,completed_at,report) VALUES(2,?,?)',[new Date().toISOString(),JSON.stringify({importedDatasets,importedForecasts,malformed})]);
  });
  return {skipped:false,datasets:importedDatasets,forecasts:importedForecasts,malformed};
}

if(process.argv[1]?.endsWith('migrate-json.ts')){
  migrateLegacyJson().then(result=>{console.log(JSON.stringify(result,null,2));}).catch(error=>{console.error('JSON migration failed; source files were retained.',error);process.exitCode=1;});
}

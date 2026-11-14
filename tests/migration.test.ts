import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';

let temp:string;let dbmod:typeof import('../server/src/database/connection.js');let migrated:typeof import('../server/src/migrate-json.js');let evaluator:typeof import('../server/src/services/evaluation.js');
beforeAll(async()=>{
  temp=await mkdtemp(path.join(os.tmpdir(),'quant-btc-sqlite-'));process.env.QUANT_BTC_DATA_DIR=path.join(temp,'db');process.env.QUANT_BTC_LEGACY_DATA_DIR=path.join(temp,'legacy');await mkdir(process.env.QUANT_BTC_LEGACY_DATA_DIR,{recursive:true});
  dbmod=await import('../server/src/database/connection.js');migrated=await import('../server/src/migrate-json.js');evaluator=await import('../server/src/services/evaluation.js');await dbmod.openDatabase();
});
afterAll(async()=>{dbmod.getDatabase().close();await rm(temp,{recursive:true,force:true});delete process.env.QUANT_BTC_DATA_DIR;delete process.env.QUANT_BTC_LEGACY_DATA_DIR;});

describe('SQLite migration and repository invariants',()=>{
  it('imports JSON IDs, prediction candles, actual candles and evaluation idempotently',async()=>{
    const legacy=process.env.QUANT_BTC_LEGACY_DATA_DIR!,id='legacy-forecast-001',datasetId='legacy-dataset-001';
    await writeFile(path.join(legacy,'datasets.json'),JSON.stringify([{id:datasetId,symbol:'BTC/USDT',timeframe:'1H',start:'2024-01-01',end:'2024-01-02',candleCount:35,exampleCount:1,createdAt:'2024-01-03T00:00:00Z',examples:[{time:1704153600,features:[[.01,0,0,1,0]],outcomes:[.02]}]}]));
    await writeFile(path.join(legacy,'forecasts.json'),JSON.stringify([{id,symbol:'BTCUSDT',timeframe:'1H',horizon:1,createdAt:'2024-01-04T00:00:00Z',lastConfirmedCandle:1704153600,forecastStart:1704157200,forecastEnd:1704160800,startPrice:42000,status:'COMPLETED',progress:1,signal:'LONG',metadata:{version:'old-v1'},inputCandles:[],predictedCandles:[{time:1704157200,open:42000,high:42500,low:41900,close:42400}],actualCandles:[{time:1704157200,open:42000,high:42600,low:41900,close:42500,volume:4}],evaluation:{direction:'CORRECT',priceError:100,pathError:.002,pathScore:80}}]));
    const first=await migrated.migrateLegacyJson();expect(first).toMatchObject({datasets:1,forecasts:1,skipped:false});
    const second=await migrated.migrateLegacyJson();expect(second.skipped).toBe(true);
    expect(dbmod.get('SELECT id FROM learning_datasets WHERE id=?',[datasetId])?.id).toBe(datasetId);
    expect(Number(dbmod.get('SELECT COUNT(*) n FROM forecast_candles WHERE forecast_id=?',[id])?.n)).toBe(1);
    expect(Number(dbmod.get('SELECT COUNT(*) n FROM forecast_actual_candles WHERE forecast_id=?',[id])?.n)).toBe(1);
    expect(JSON.parse(String(dbmod.get('SELECT evaluation FROM forecasts WHERE id=?',[id])?.evaluation)).direction).toBe('CORRECT');
    expect((await readFile(path.join(legacy,'forecasts.json'),'utf8')).length).toBeGreaterThan(20);
    const files=await (await import('node:fs/promises')).readdir(legacy);expect(files.some(name=>/^forecasts\.json\.backup-/.test(name))).toBe(true);
  });
  it('stores 100 independent datasets and deduplicates overlapping market candles',async()=>{
    await dbmod.transaction(()=>{for(let i=0;i<100;i++)dbmod.run('INSERT INTO learning_datasets(id,name,symbol,timeframe,start_time,end_time,candle_count,example_count,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[`ds-${i}`,`Dataset ${i}`,'BTC/USDT','4H',i*1000,i*1000+999,10,0,'READY','2024-01-01','2024-01-01']);dbmod.run('INSERT OR IGNORE INTO market_candles(exchange,symbol,timeframe,open_time,close_time,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?,?,?,?)',['Binance','BTC/USDT','4H',0,1,10,11,9,10,2]);dbmod.run('INSERT OR IGNORE INTO market_candles(exchange,symbol,timeframe,open_time,close_time,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?,?,?,?)',['Binance','BTC/USDT','4H',0,1,10,11,9,10,2]);});
    expect(Number(dbmod.get('SELECT COUNT(*) n FROM learning_datasets')?.n)).toBe(101);
    expect(Number(dbmod.get("SELECT COUNT(*) n FROM market_candles WHERE symbol='BTC/USDT' AND timeframe='4H'")?.n)).toBe(1);
  });
  it('keeps predicted snapshots immutable and dataset deletion preserves shared candles',async()=>{
    const reference={exampleId:'1H:100:200:5',datasetId:'delete-test',timeframe:'1H',referenceStartTime:100,referenceEndTime:500,matchDistance:0,matchWeight:.25,inputCandles:[{time:100,open:10,high:11,low:9,close:10,volume:1}],continuationCandles:[{time:200,open:10,high:12,low:9,close:11,volume:2}]};
    await dbmod.transaction(()=>{
      dbmod.run('INSERT INTO forecasts(id,symbol,timeframe,horizon,created_at,last_confirmed_candle,forecast_start,forecast_end,start_price,status,progress,signal,algorithm_version,input_snapshot,metadata,signal_levels,reference_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',['immutable-test','BTCUSDT','1H',1,'2024-01-01',1,2,3,10,'MONITORING',0,'NO TRADE','test-v1','[]','{}','{}',JSON.stringify(reference)]);
      dbmod.run('INSERT INTO forecasts(id,symbol,timeframe,horizon,created_at,last_confirmed_candle,forecast_start,forecast_end,start_price,status,progress,signal,algorithm_version,input_snapshot,metadata,signal_levels) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',['legacy-no-reference','BTCUSDT','1H',1,'2024-01-01',1,2,3,10,'MONITORING',0,'NO TRADE','test-v1','[]','{}','{}']);
      dbmod.run('INSERT INTO forecast_candles(forecast_id,candle_time,open,high,low,close) VALUES(?,?,?,?,?,?)',['immutable-test',2,10,11,9,10.5]);
    });
    expect(()=>dbmod.run("UPDATE forecasts SET start_price=999 WHERE id='immutable-test'")).toThrow(/immutable/);
    expect(()=>dbmod.run("UPDATE forecasts SET reference_snapshot='{}' WHERE id='immutable-test'")).toThrow(/immutable/);
    expect(()=>dbmod.run("UPDATE forecast_candles SET close=999 WHERE forecast_id='immutable-test'")).toThrow(/immutable/);
    await dbmod.transaction(()=>{dbmod.run('INSERT INTO learning_datasets(id,name,symbol,timeframe,start_time,end_time,candle_count,example_count,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',['delete-test','Delete test','BTC/USDT','1D',20,30,1,0,'READY','2024-01-01','2024-01-01']);dbmod.run('INSERT INTO learning_examples(dataset_id,input_start_time,input_end_time,target_end_time,input_features,target_returns,created_at) VALUES(?,?,?,?,?,?,?)',['delete-test',1,2,3,'[]','[]','2024-01-01']);});
    await (await import('../server/src/services/chart-learning.js')).deleteDataset('delete-test');
    const forecastService=await import('../server/src/services/pattern-forecast.js');
    expect(forecastService.forecastDetail('immutable-test')?.referenceChart).toEqual(reference);
    expect(forecastService.forecastDetail('legacy-no-reference')?.referenceChart).toBeNull();
    expect(Number(dbmod.get("SELECT COUNT(*) n FROM learning_examples WHERE dataset_id='delete-test'")?.n)).toBe(0);
    expect(Number(dbmod.get("SELECT COUNT(*) n FROM market_candles WHERE timeframe='4H'")?.n)).toBe(1);
  });
  it('calculates direction and path metrics from stored forecast candles',()=>{
    const result=evaluator.evaluateForecast({start_price:100,horizon:2,signal:'LONG'},[{time:1,open:100,high:111,low:99,close:110},{time:2,open:110,high:121,low:109,close:120}],[{time:1,open:100,high:106,low:99,close:105},{time:2,open:105,high:111,low:104,close:110}]);
    expect(result).toMatchObject({progress:2,direction:'CORRECT',completed:true,predictedFinal:120,actualFinal:110});
  });
  it('captures the actual top historical contributor and keeps its snapshot after dataset deletion',async()=>{
    const timeframe='1H',step=3600,base=Math.floor(Date.now()/(step*1000))*step-270*step,historyCount=120,datasetId='reference-integration';let close=40_000;
    const rows=Array.from({length:historyCount},(_,i)=>{const open=close;close=open*(1+Math.sin(i*.41)*.002+(i%11===0?-.003:.0005));return {time:base+i*step,open,high:Math.max(open,close)*1.001,low:Math.min(open,close)*.999,close,volume:10+i%7};});
    const liveRows=Array.from({length:150},(_,i)=>{const time=base+(historyCount+i)*step,open=close;close=open*(1+Math.sin((historyCount+i)*.41)*.002+(i%11===0?-.003:.0005));const high=Math.max(open,close)*1.001,low=Math.min(open,close)*.999;return [time*1000,String(open),String(high),String(low),String(close),'15',(time+step)*1000-1,'0','10','5','1','0'];});
    await dbmod.transaction(()=>{dbmod.run('INSERT INTO learning_datasets(id,name,symbol,timeframe,start_time,end_time,candle_count,example_count,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[datasetId,'Reference source','BTC/USDT',timeframe,rows[0]!.time,rows.at(-1)!.time,rows.length,rows.length-24-10+1,'READY','2024-01-01','2024-01-01']);for(const candle of rows)dbmod.run('INSERT INTO market_candles(exchange,symbol,timeframe,open_time,close_time,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?,?,?,?)',['Binance','BTC/USDT',timeframe,candle.time,(candle.time+step)*1000-1,candle.open,candle.high,candle.low,candle.close,candle.volume]);});
    const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify(liveRows),{status:200,headers:{'content-type':'application/json'}});
    let forecast:any;try{forecast=await (await import('../server/src/services/pattern-forecast.js')).createForecast('1H',5,'reference-snapshot-integration');}finally{globalThis.fetch=originalFetch;}
    expect(forecast.referenceChart).toMatchObject({datasetId,matchWeight:expect.any(Number),matchDistance:expect.any(Number)});expect(forecast.referenceChart.inputCandles).toHaveLength(24);expect(forecast.referenceChart.continuationCandles).toHaveLength(5);
    const saved=structuredClone(forecast.referenceChart);await (await import('../server/src/services/chart-learning.js')).deleteDataset(datasetId);expect((await import('../server/src/services/pattern-forecast.js')).forecastDetail(forecast.id)?.referenceChart).toEqual(saved);
  });
});

export type Timeframe='1H'|'4H'|'1D';
export interface Candle {time:number;openTime:number;closeTime:number;open:number;high:number;low:number;close:number;volume:number;closed:boolean}
const intervals:Record<Timeframe,{ms:number;api:string}>={'1H':{ms:3600000,api:'1h'},'4H':{ms:14400000,api:'4h'},'1D':{ms:86400000,api:'1d'}};
export const timeframeMs=(tf:Timeframe)=>intervals[tf].ms;
export function validTimeframe(value:string):value is Timeframe{return value in intervals;}
export async function fetchCandles(symbol:string,tf:Timeframe,limit=500,startTime?:number,endTime?:number):Promise<Candle[]> {
  const u=new URL('https://api.binance.com/api/v3/klines');u.searchParams.set('symbol',symbol);u.searchParams.set('interval',intervals[tf].api);u.searchParams.set('limit',String(Math.max(1,Math.min(1000,Math.floor(limit)))));
  if(startTime)u.searchParams.set('startTime',String(startTime));if(endTime)u.searchParams.set('endTime',String(endTime));
  const response=await fetch(u,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Binance trả HTTP ${response.status}`);
  const rows=await response.json() as (string|number)[][];
  return rows.map(k=>({time:Math.floor(Number(k[0])/1000),openTime:Number(k[0]),closeTime:Number(k[6]),open:Number(k[1]),high:Number(k[2]),low:Number(k[3]),close:Number(k[4]),volume:Number(k[5]),closed:Number(k[6])<Date.now()}));
}

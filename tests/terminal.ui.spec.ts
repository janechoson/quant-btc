import {test,expect} from '@playwright/test';

const base=Date.UTC(2024,2,18)/1000;
const candles=Array.from({length:72},(_,i)=>{const close=62500+i*18+Math.sin(i/3)*220,open=close+(i%2?65:-48);return {time:base+i*3600,open,high:Math.max(open,close)+120,low:Math.min(open,close)-105,close,volume:22+i%11};});
const forecastCandles=Array.from({length:10},(_,i)=>{const open=63800+i*105,close=open+78;return {time:candles.at(-1)!.time+(i+1)*3600,open,high:close+75,low:open-61,close};});

async function installMarketFixtures(page:any){
  await page.route('**/api/market/candles**',route=>route.fulfill({json:{candles,source:'Playwright deterministic UI fixture'}}));
  await page.route('**/api/forecasts',route=>route.request().method()==='POST'?route.fulfill({json:{id:'pw-forecast',timeframe:'1H',horizon:10,created_at:'2024-03-23T00:00:00Z',createdAt:'2024-03-23T00:00:00Z',forecastStart:candles.at(-1)!.time+3600,start_price:candles.at(-1)!.close,signal:'LONG',status:'MONITORING',progress:0,inputCandles:candles.slice(-60),predictedCandles:forecastCandles,actualCandles:[],uncertainty:forecastCandles.map(c=>({time:c.time,low:c.close-350,high:c.close+350})),metadata:{provider:'PatternForecastProvider',version:'pattern-knn-v1',neighbors:5,confidenceLabel:'5 mẫu tương đồng'},entry:{low:63700,high:63900},takeProfit:65000,stopLoss:62800}}):route.fulfill({json:[]}));
  await page.route('**/api/prediction-history/summary',route=>route.fulfill({json:{total:1,completed:0,monitoring:1,directionalCorrect:0}}));
  await page.route('**/api/prediction-history',route=>route.fulfill({json:[]}));
}

test('Trading Terminal desktop layout, chart and forecast overlay',async({page})=>{
  await installMarketFixtures(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByText('BTC/USDT',{exact:true}).first()).toBeVisible();await expect(page.locator('.chart-host canvas').first()).toBeVisible();
  await page.getByRole('button',{name:/Dự đoán/}).click();await expect(page.locator('.chart-heading .data-source')).toContainText('LONG');await expect(page.getByRole('button',{name:/Dự đoán/})).toBeEnabled();
  const layout=await page.evaluate(()=>Object.fromEntries(['.sidebar','.topbar','.toolbar','.chart-card','.chart-host'].map(s=>{const r=document.querySelector(s)!.getBoundingClientRect();return[s,{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}]})));
  console.log('PLAYWRIGHT_LAYOUT',JSON.stringify(layout));if(process.env.PW_SCREENSHOT_PATH)await page.screenshot({path:process.env.PW_SCREENSHOT_PATH,fullPage:true});
  expect(errors).toEqual([]);expect(layout['.sidebar']!.width).toBe(241);expect(layout['.topbar']!.height).toBe(76);expect(layout['.toolbar']!.height).toBe(78);expect(layout['.chart-card']!.y).toBe(154);expect(layout['.chart-card']!.height).toBe(669);await expect(page.locator('.chart-host canvas').first()).toBeVisible();
});

test('Sidebar routes open the learning and history views',async({page})=>{
  await installMarketFixtures(page);await page.route('**/api/learning/datasets**',route=>route.fulfill({json:{items:[],total:0,page:1,limit:20,pages:0}}));await page.goto('/');
  await page.getByRole('link',{name:/Chart Learning/}).first().click();await expect(page).toHaveURL(/\/learning$/);await expect(page.getByRole('heading',{name:'Chart Learning'})).toBeVisible();
  await page.getByRole('link',{name:/Lịch sử dự đoán/}).click();await expect(page).toHaveURL(/prediction-history/);await expect(page.getByRole('heading',{name:'Lịch sử dự đoán'})).toBeVisible();
});

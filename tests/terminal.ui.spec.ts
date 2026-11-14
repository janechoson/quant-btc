import {test,expect} from '@playwright/test';

const base=Date.UTC(2024,2,18)/1000;
const candles=Array.from({length:72},(_,i)=>{const close=62500+i*18+Math.sin(i/3)*220,open=close+(i%2?65:-48);return {time:base+i*3600,open,high:Math.max(open,close)+120,low:Math.min(open,close)-105,close,volume:22+i%11};});
const forecastCandles=Array.from({length:10},(_,i)=>{const open=63800+i*105,close=open+78;return {time:candles.at(-1)!.time+(i+1)*3600,open,high:close+75,low:open-61,close};});
const actualCandles=forecastCandles.slice(0,4).map(c=>({...c,close:c.close-95,high:c.high+35,low:c.low-50,volume:18}));
const forecastFixture=()=>({id:'pw-forecast',timeframe:'1H',horizon:10,created_at:'2024-03-23T00:00:00Z',createdAt:'2024-03-23T00:00:00Z',forecastStart:candles.at(-1)!.time+3600,start_price:candles.at(-1)!.close,signal:'LONG',status:'PARTIALLY_EVALUATED',progress:4,inputCandles:candles.slice(-60),predictedCandles:forecastCandles,actualCandles,uncertainty:forecastCandles.map(c=>({time:c.time,low:c.close-350,median:c.close,high:c.close+350})),metadata:{provider:'PatternForecastProvider',version:'pattern-knn-v1',neighbors:5,confidenceLabel:'Mẫu lịch sử gần nhất'},entry:{low:63700,high:63900},takeProfit:65000,stopLoss:62800});

async function installMarketFixtures(page:any){
  await page.route('**/api/market/candles**',route=>route.fulfill({json:{candles,source:'Playwright deterministic UI fixture'}}));
  await page.route('**/api/forecasts',route=>route.request().method()==='POST'?route.fulfill({json:{...forecastFixture(),status:'MONITORING',progress:0,actualCandles:[]}}):route.fulfill({json:[]}));
  await page.route('**/api/prediction-history/summary',route=>route.fulfill({json:{total:1,completed:0,monitoring:1,directionalCorrect:0}}));
  await page.route('**/api/prediction-history',route=>route.fulfill({json:[]}));
}

test('Trading Terminal desktop layout, chart and forecast overlay',async({page})=>{
  await installMarketFixtures(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByText('BTC/USDT',{exact:true}).first()).toBeVisible();await expect(page.locator('.chart-host canvas').first()).toBeVisible();
  await page.getByRole('button',{name:/Dự đoán/}).click();await expect(page.locator('.chart-heading .data-source')).toContainText('LONG');await expect(page.getByRole('button',{name:/Dự đoán/})).toBeEnabled();
  await expect(page.getByText('Bắt đầu dự báo')).toBeVisible();await expect(page.locator('.forecast-overlay rect')).toBeVisible();await expect(page.locator('.forecast-overlay path')).toBeVisible();await expect(page.getByText('Giá cuối dự báo')).toBeVisible();await expect(page.getByText(/72%|Xác suất/)).toHaveCount(0);
  const host=page.locator('.chart-host');const timeRangeBefore=await host.getAttribute('data-visible-logical-range');const priceRangeBefore=await host.getAttribute('data-price-scale-range');await page.getByRole('button',{name:/Ẩn vùng bất định/}).click();await expect(page.locator('.forecast-overlay path')).toHaveCount(0);await page.getByRole('button',{name:/Hiện vùng bất định/}).click();await expect(page.locator('.forecast-overlay path')).toBeVisible();await expect(host).toHaveAttribute('data-visible-logical-range',timeRangeBefore!);await expect(host).toHaveAttribute('data-price-scale-range',priceRangeBefore!);
  const box=await host.boundingBox();expect(box).not.toBeNull();await page.mouse.move(box!.x+box!.width*.55,box!.y+box!.height*.45);await page.mouse.wheel(0,-260);await page.mouse.move(5,5);await expect.poll(()=>host.getAttribute('data-visible-logical-range')).not.toBe(timeRangeBefore);
  const zoomedRange=await host.getAttribute('data-visible-logical-range');const refreshResponse=page.waitForResponse(response=>response.url().includes('/api/market/candles')&&response.ok());await page.locator('[title="Tải lại"]').click();await refreshResponse;await expect(host).toHaveAttribute('data-visible-logical-range',zoomedRange!);
  const layout=await page.evaluate(()=>Object.fromEntries(['.sidebar','.topbar','.toolbar','.chart-card','.chart-host'].map(s=>{const r=document.querySelector(s)!.getBoundingClientRect();return[s,{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}]})));
  console.log('PLAYWRIGHT_LAYOUT',JSON.stringify(layout));if(process.env.PW_SCREENSHOT_PATH)await page.screenshot({path:process.env.PW_SCREENSHOT_PATH,fullPage:true});
  expect(errors).toEqual([]);expect(layout['.sidebar']!.width).toBe(241);expect(layout['.topbar']!.height).toBe(76);expect(layout['.toolbar']!.height).toBe(78);expect(layout['.chart-card']!.y).toBe(154);expect(layout['.chart-card']!.height).toBe(669);await expect(page.locator('.chart-host canvas').first()).toBeVisible();
  await page.getByRole('button',{name:'4H'}).click();await expect(page.locator('.chart-heading b')).toContainText('4H');await expect(page.locator('.chart-host canvas').first()).toBeVisible();
});

test('Sidebar routes open the learning and history views',async({page})=>{
  await installMarketFixtures(page);await page.route('**/api/learning/datasets**',route=>route.fulfill({json:{items:[],total:0,page:1,limit:20,pages:0}}));await page.route('**/api/prediction-history',route=>route.fulfill({json:[{...forecastFixture(),predictedFinal:forecastCandles.at(-1)!.close,actualFinal:actualCandles.at(-1)!.close}]}));await page.route('**/api/prediction-history/pw-forecast',route=>route.fulfill({json:forecastFixture()}));await page.goto('/');
  await page.getByRole('link',{name:/Chart Learning/}).first().click();await expect(page).toHaveURL(/\/learning$/);await expect(page.getByRole('heading',{name:'Chart Learning'})).toBeVisible();
  await page.getByRole('link',{name:/Lịch sử dự đoán/}).click();await expect(page).toHaveURL(/prediction-history/);await expect(page.getByRole('heading',{name:'Lịch sử dự đoán'})).toBeVisible();await page.getByRole('row').filter({hasText:'LONG'}).click();await expect(page.getByText('SO SÁNH DỰ BÁO')).toBeVisible();const replay=page.getByRole('slider',{name:/Phát lại nến thực/});await expect(replay).toHaveValue('4');await replay.fill('1');await expect(page.locator('.replay-control').getByText('1 / 10')).toBeVisible();await replay.fill('4');await expect(page.locator('.replay-control').getByText('4 / 10')).toBeVisible();await expect(page.locator('.comparison-chart canvas').first()).toBeVisible();
});

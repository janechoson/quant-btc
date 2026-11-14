import {test,expect} from '@playwright/test';

const base=Date.UTC(2024,2,18)/1000;
const candles=Array.from({length:72},(_,i)=>{const close=62500+i*18+Math.sin(i/3)*220,open=close+(i%2?65:-48);return {time:base+i*3600,open,high:Math.max(open,close)+120,low:Math.min(open,close)-105,close,volume:22+i%11};});
const forecastCandles=Array.from({length:10},(_,i)=>{const open=63800+i*105,close=open+78;return {time:candles.at(-1)!.time+(i+1)*3600,open,high:close+75,low:open-61,close};});
const actualCandles=forecastCandles.slice(0,4).map(c=>({...c,close:c.close-95,high:c.high+35,low:c.low-50,volume:18}));
const historicalReference=candles.slice(0,34);
const forecastFixture=(includeReference=true)=>({id:'pw-forecast',timeframe:'1H',horizon:10,created_at:'2024-03-23T00:00:00Z',createdAt:'2024-03-23T00:00:00Z',forecastStart:candles.at(-1)!.time+3600,start_price:candles.at(-1)!.close,signal:'LONG',status:'PARTIALLY_EVALUATED',progress:4,inputCandles:candles.slice(-60),predictedCandles:forecastCandles,actualCandles,uncertainty:forecastCandles.map(c=>({time:c.time,low:c.close-350,median:c.close,high:c.close+350})),referenceChart:includeReference?{exampleId:'pw-reference',datasetId:'pw-dataset',timeframe:'1H',referenceStartTime:historicalReference[0]!.time,referenceEndTime:historicalReference.at(-1)!.time,matchDistance:.08,matchWeight:.17,inputCandles:historicalReference.slice(0,24),continuationCandles:historicalReference.slice(24)}:null,metadata:{provider:'PatternForecastProvider',version:'pattern-knn-v1',neighbors:5,inputWindow:24,confidenceLabel:'Mẫu lịch sử gần nhất'},entry:{low:63700,high:63900},takeProfit:65000,stopLoss:62800});

async function installMarketFixtures(page:any){
  await page.route('**/api/market/candles**',route=>route.fulfill({json:{candles,source:'Playwright deterministic UI fixture'}}));
  await page.route('**/api/market/ticker',route=>route.fulfill({json:{symbol:'BTCUSDT',lastPrice:67376.01,priceChangePercent:.98,high24h:70214.31,low24h:66456,volume24h:22832.5,eventTime:Date.now()}}));
  let interval='1h',currentPrice='67376.01';const sockets:any[]=[];
  await page.routeWebSocket((url:URL)=>{if(url.hostname!=='stream.binance.com')return false;interval=url.searchParams.get('streams')?.match(/kline_(1h|4h|1d)/)?.[1]||'1h';return true;},ws=>{
    sockets.push(ws);setTimeout(()=>{
      ws.send(JSON.stringify({stream:'btcusdt@ticker',data:{e:'24hrTicker',E:Date.now(),s:'BTCUSDT',c:currentPrice,P:'0.98',h:'70214.31',l:'66456.00',v:'22832.5'}}));
      ws.send(JSON.stringify({stream:`btcusdt@kline_${interval}`,data:{e:'kline',E:Date.now(),s:'BTCUSDT',k:{t:(candles.at(-1)!.time+3600)*1000,o:'67300',h:'67400',l:'67200',c:'67376.01',v:'23.4',i:interval,x:false}}}));
    },20);
  });
  await page.route('**/api/forecasts',route=>route.request().method()==='POST'?route.fulfill({json:{...forecastFixture(),status:'MONITORING',progress:0,actualCandles:[]}}):route.fulfill({json:[]}));
  await page.route('**/api/prediction-history/summary',route=>route.fulfill({json:{total:1,completed:0,monitoring:1,directionalCorrect:0}}));
  await page.route('**/api/prediction-history',route=>route.fulfill({json:[]}));
  return {sendTicker:(price:string,eventTime=Date.now()+1000)=>{currentPrice=price;sockets.at(-1)?.send(JSON.stringify({stream:'btcusdt@ticker',data:{e:'24hrTicker',E:eventTime,s:'BTCUSDT',c:price,P:'1.11',h:'70214.31',l:'66456.00',v:'22833.5'}}))}};
}

test('Trading Terminal desktop layout, chart and forecast overlay',async({page})=>{
  await installMarketFixtures(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByText('BTC/USDT',{exact:true}).first()).toBeVisible();await expect(page.locator('.chart-host canvas').first()).toBeVisible();
  await page.getByRole('button',{name:/Dự đoán/}).click();await expect(page.locator('.chart-heading .data-source')).toContainText('LONG');await expect(page.getByRole('button',{name:/Dự đoán/})).toBeEnabled();
  await expect(page.getByText('Bắt đầu dự báo')).toBeVisible();await expect(page.locator('.forecast-overlay rect')).toBeVisible();await expect(page.locator('.forecast-overlay path')).toBeVisible();await expect(page.getByText('Giá cuối dự báo')).toBeVisible();await expect(page.getByText(/72%|Xác suất/)).toHaveCount(0);
  const host=page.locator('.chart-host');const timeRangeBefore=await host.getAttribute('data-visible-logical-range');const priceRangeBefore=await host.getAttribute('data-price-scale-range');await page.getByRole('button',{name:/Ẩn vùng bất định/}).click();await expect(page.locator('.forecast-overlay path')).toHaveCount(0);await page.getByRole('button',{name:/Hiện vùng bất định/}).click();await expect(page.locator('.forecast-overlay path')).toBeVisible();await expect(host).toHaveAttribute('data-visible-logical-range',timeRangeBefore!);await expect(host).toHaveAttribute('data-price-scale-range',priceRangeBefore!);
  const box=await host.boundingBox();expect(box).not.toBeNull();await page.mouse.move(box!.x+box!.width*.55,box!.y+box!.height*.45);await page.mouse.wheel(0,-260);await page.mouse.move(5,5);await expect.poll(()=>host.getAttribute('data-visible-logical-range')).not.toBe(timeRangeBefore);
  const zoomedRange=await host.getAttribute('data-visible-logical-range');const refreshResponse=page.waitForResponse(response=>response.url().includes('/api/market/candles')&&response.ok());await page.locator('[title="Tải lại"]').click();await refreshResponse;await expect(host).toHaveAttribute('data-visible-logical-range',zoomedRange!);
  const referenceButton=page.getByRole('button',{name:'📊 Chart tham chiếu'});await expect(referenceButton).toBeVisible();await referenceButton.click();
  const modal=page.getByRole('dialog',{name:'📊 Chart tham chiếu'});await expect(modal).toBeVisible();await expect(modal.locator('.reference-chart-section')).toHaveCount(2);await expect(modal.locator('.reference-segment-chart').nth(0).locator('canvas').first()).toBeVisible();await expect(modal.locator('.reference-segment-chart').nth(1).locator('canvas').first()).toBeVisible();await expect(modal.getByText('Đoạn tham chiếu (24 nến)')).toBeVisible();await expect(modal.getByText('Diễn biến thực tế (10 nến)')).toBeVisible();await expect(modal.getByText('Dữ liệu đầu vào (24 nến)')).toBeVisible();await expect(modal.getByText('Dự đoán (10 nến)')).toBeVisible();
  await page.setViewportSize({width:390,height:844});await expect(modal).toBeVisible();expect((await modal.boundingBox())!.width).toBeLessThanOrEqual(390);await page.setViewportSize({width:1672,height:941});
  await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await referenceButton.click();await expect(modal).toBeVisible();await modal.locator('.reference-modal-close').click();await expect(modal).toHaveCount(0);
  const layout=await page.evaluate(()=>Object.fromEntries(['.sidebar','.topbar','.toolbar','.chart-card','.chart-host'].map(s=>{const r=document.querySelector(s)!.getBoundingClientRect();return[s,{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}]})));
  console.log('PLAYWRIGHT_LAYOUT',JSON.stringify(layout));if(process.env.PW_SCREENSHOT_PATH)await page.screenshot({path:process.env.PW_SCREENSHOT_PATH,fullPage:true});
  expect(errors).toEqual([]);expect(layout['.sidebar']!.width).toBe(241);expect(layout['.topbar']!.height).toBe(76);expect(layout['.toolbar']!.height).toBe(78);expect(layout['.chart-card']!.y).toBe(154);expect(layout['.chart-card']!.height).toBe(669);await expect(page.locator('.chart-host canvas').first()).toBeVisible();
  await page.getByRole('button',{name:'4H'}).click();await expect(page.locator('.chart-heading b')).toContainText('4H');await expect(page.locator('.chart-host canvas').first()).toBeVisible();
});

test('Sidebar routes open the learning and history views',async({page})=>{
  await installMarketFixtures(page);await page.route('**/api/learning/datasets**',route=>route.fulfill({json:{items:[],total:0,page:1,limit:20,pages:0}}));await page.route('**/api/prediction-history',route=>route.fulfill({json:[{...forecastFixture(),predictedFinal:forecastCandles.at(-1)!.close,actualFinal:actualCandles.at(-1)!.close}]}));await page.route('**/api/prediction-history/pw-forecast',route=>route.fulfill({json:forecastFixture()}));await page.goto('/');
  await page.getByRole('link',{name:/Chart Learning/}).first().click();await expect(page).toHaveURL(/\/learning$/);await expect(page.getByRole('heading',{name:'Chart Learning'})).toBeVisible();
  await page.getByRole('link',{name:/Lịch sử dự đoán/}).click();await expect(page).toHaveURL(/prediction-history/);await expect(page.getByRole('heading',{name:'Lịch sử dự đoán'})).toBeVisible();await page.getByRole('row').filter({hasText:'LONG'}).click();await expect(page.getByText('SO SÁNH DỰ BÁO')).toBeVisible();const replay=page.getByRole('slider',{name:/Phát lại nến thực/});await expect(replay).toHaveValue('4');await replay.fill('1');await expect(page.locator('.replay-control').getByText('1 / 10')).toBeVisible();await replay.fill('4');await expect(page.locator('.replay-control').getByText('4 / 10')).toBeVisible();await expect(page.locator('.comparison-chart canvas').first()).toBeVisible();await page.getByRole('button',{name:'📊 Chart tham chiếu'}).click();const modal=page.getByRole('dialog',{name:'📊 Chart tham chiếu'});await expect(modal.locator('.reference-chart-section')).toHaveCount(2);await modal.locator('.reference-modal-close').click();
});

test('legacy forecast opens modal with an explicit missing-reference state',async({page})=>{
  await installMarketFixtures(page);await page.route('**/api/prediction-history/summary',route=>route.fulfill({json:{total:1,completed:0,monitoring:1,directionalCorrect:0}}));await page.route('**/api/prediction-history',route=>route.fulfill({json:[{...forecastFixture(false),predictedFinal:forecastCandles.at(-1)!.close}]}));await page.route('**/api/prediction-history/pw-forecast',route=>route.fulfill({json:forecastFixture(false)}));
  await page.goto('/prediction-history');await page.getByRole('row').filter({hasText:'LONG'}).click();await page.getByRole('button',{name:'📊 Chart tham chiếu'}).click();
  await expect(page.getByText('Không có dữ liệu chart tham chiếu cho dự đoán này.')).toBeVisible();await expect(page.locator('.reference-chart-section')).toHaveCount(2);
});

test('Realtime ticker stays current across chart timeframe switches',async({page})=>{
  const stream=await installMarketFixtures(page);await page.goto('/');
  await expect(page.locator('.price-block strong')).toHaveText('67,376.01');await expect(page.locator('.quote-status')).toContainText('LIVE');
  await expect(page.locator('.chart-heading .data-source')).toContainText('nến đang hình thành');
  stream.sendTicker('67455.20');await expect(page.locator('.price-block strong')).toHaveText('67,455.20');
  await page.getByRole('button',{name:'4H'}).click();await expect(page.locator('.chart-heading b')).toContainText('4H');
  await expect(page.locator('.price-block strong')).toHaveText('67,455.20');await expect(page.locator('.quote-status')).toContainText('LIVE');
  await expect(page.locator('.market-stat').nth(0)).toContainText('70,214.31');
});

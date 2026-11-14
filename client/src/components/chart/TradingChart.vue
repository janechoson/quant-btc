<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch, ref, nextTick } from 'vue';
import { createChart, LineStyle, type IChartApi, type ISeriesApi, type IPriceLine, type CandlestickData, type HistogramData, type Time } from 'lightweight-charts';
import type { Candle, Forecast } from '../../types';

const props = withDefaults(defineProps<{ candles: Candle[]; forecast: Forecast | null; timeframe: string; volumeVisible: boolean; uncertaintyVisible?: boolean }>(), { uncertaintyVisible: true });
const emit = defineEmits<{ ohlc: [candle: Candle | null] }>();
const host = ref<HTMLDivElement>();
const boundaryX = ref<number | null>(null);
const bandPath = ref('');
const stageHeight = ref(0);
const bandTooWide = ref(false);
const visibleRangeToken = ref('');
const priceRangeToken = ref('');
let chart: IChartApi | undefined;
let price: ISeriesApi<'Candlestick'> | undefined;
let volume: ISeriesApi<'Histogram'> | undefined;
let ma20: ISeriesApi<'Line'> | undefined;
let ma50: ISeriesApi<'Line'> | undefined;
let predicted: ISeriesApi<'Candlestick'> | undefined;
let priceLines: IPriceLine[] = [];
let observer: ResizeObserver | undefined;
let firstLayout = true;
let lastForecastId: string | null = null;
let lastTimeframe = '';

const average = (n: number) => props.candles.flatMap((c, i) => i < n - 1 ? [] : [{ time: c.time as Time, value: props.candles.slice(i - n + 1, i + 1).reduce((s, x) => s + x.close, 0) / n }]);

function syncOverlay() {
  if (!chart || !price || !host.value) return;
  stageHeight.value = host.value.clientHeight;
  const logicalRange = chart.timeScale().getVisibleLogicalRange();
  const priceTop = price.coordinateToPrice(0), priceBottom = price.coordinateToPrice(stageHeight.value);
  visibleRangeToken.value = logicalRange ? `${logicalRange.from.toFixed(2)}:${logicalRange.to.toFixed(2)}` : '';
  priceRangeToken.value = priceTop !== null && priceBottom !== null ? `${priceTop.toFixed(2)}:${priceBottom.toFixed(2)}` : '';
  if (!props.forecast?.predictedCandles.length) {
    boundaryX.value = null; bandPath.value = ''; bandTooWide.value = false; return;
  }
  const timeScale = chart.timeScale();
  const first = props.forecast.predictedCandles[0]!;
  const x = timeScale.timeToCoordinate(first.time as Time);
  boundaryX.value = x === null ? null : Number(x);
  if (!props.uncertaintyVisible || !props.forecast.uncertainty?.length) { bandPath.value = ''; bandTooWide.value = false; return; }
  const upper = props.forecast.uncertainty.map(point => ({ x: timeScale.timeToCoordinate(point.time as Time), y: price!.priceToCoordinate(point.high) }));
  const lower = props.forecast.uncertainty.map(point => ({ x: timeScale.timeToCoordinate(point.time as Time), y: price!.priceToCoordinate(point.low) }));
  const valid = [...upper, ...lower].every(point => point.x !== null && point.y !== null && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!valid) { bandPath.value = ''; bandTooWide.value = false; return; }
  bandPath.value = `M ${upper.map(point => `${point.x},${point.y}`).join(' L ')} L ${[...lower].reverse().map(point => `${point.x},${point.y}`).join(' L ')} Z`;
  const top = price.priceToCoordinate(Math.max(...props.forecast.uncertainty.map(point => point.high)));
  const bottom = price.priceToCoordinate(Math.min(...props.forecast.uncertainty.map(point => point.low)));
  bandTooWide.value = top !== null && bottom !== null && Math.abs(bottom - top) > stageHeight.value * 0.9;
}

function removeForecastSeries() {
  if (!chart || !price) return;
  if (predicted) chart.removeSeries(predicted);
  predicted = undefined;
  for (const line of priceLines) price.removePriceLine(line);
  priceLines = [];
}

function update() {
  if (!price || !volume || !chart) return;
  const priorRange = chart.timeScale().getVisibleLogicalRange();
  const candles = props.candles;
  price.setData(candles.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close } satisfies CandlestickData)));
  volume.setData(candles.map(c => ({ time: c.time as Time, value: c.volume, color: c.close >= c.open ? '#00d997' : '#ff5267' } satisfies HistogramData)));
  volume.applyOptions({ visible: props.volumeVisible });
  ma20?.setData(average(20)); ma50?.setData(average(50));
  const forecast = props.forecast;
  if (forecast) {
    for (const line of priceLines) price.removePriceLine(line);
    priceLines = [];
    predicted ??= chart.addCandlestickSeries({ upColor: 'rgba(0,217,151,.52)', downColor: 'rgba(255,82,103,.52)', borderUpColor: 'rgba(0,217,151,.78)', borderDownColor: 'rgba(255,82,103,.78)', wickUpColor: 'rgba(0,217,151,.82)', wickDownColor: 'rgba(255,82,103,.82)', priceLineVisible: false });
    predicted.setData(forecast.predictedCandles.map(c => ({ ...c, time: c.time as Time })));
    const addLevel = (value: number | undefined | null, title: string, color: string) => {
      if (value && Number.isFinite(value)) priceLines.push(price!.createPriceLine({ price: value, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title }));
    };
    addLevel(forecast.takeProfit, 'TP', '#00d997'); addLevel(forecast.stopLoss, 'SL', '#ff5267');
    if (forecast.entry) { addLevel(forecast.entry.low, 'Entry', '#00c48a'); if (forecast.entry.high !== forecast.entry.low) addLevel(forecast.entry.high, '', '#00c48a'); }
  } else removeForecastSeries();
  const forecastChanged = (forecast?.id ?? null) !== lastForecastId;
  const timeframeChanged = props.timeframe !== lastTimeframe;
  if (firstLayout || forecastChanged || timeframeChanged) {
    const historyCount = candles.length;
    const from = Math.max(0, historyCount - 80);
    const to = historyCount + (forecast?.predictedCandles.length ?? 0) + 4;
    if (historyCount) chart.timeScale().setVisibleLogicalRange({ from, to });
    firstLayout = false;
  } else if (priorRange) {
    try { chart.timeScale().setVisibleLogicalRange(priorRange); } catch { /* the rolling data window may have dropped the user's oldest visible bar */ }
  }
  lastForecastId = forecast?.id ?? null; lastTimeframe = props.timeframe;
  requestAnimationFrame(syncOverlay);
}

onMounted(async () => {
  if (!host.value) return;
  chart = createChart(host.value, { layout: { background: { color: '#0b1220' }, textColor: '#8795aa', fontFamily: 'DM Mono, monospace' }, grid: { vertLines: { color: '#1b2638' }, horzLines: { color: '#1b2638' } }, crosshair: { mode: 0 }, rightPriceScale: { borderColor: '#253144', scaleMargins: { top: 0.08, bottom: 0.12 } }, timeScale: { borderColor: '#253144', timeVisible: true, rightOffset: 4 }, handleScroll: true, handleScale: true });
  price = chart.addCandlestickSeries({ upColor: '#00d997', downColor: '#ff5267', borderVisible: false, wickUpColor: '#00d997', wickDownColor: '#ff5267' });
  volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
  ma20 = chart.addLineSeries({ color: '#ffbc22', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  ma50 = chart.addLineSeries({ color: '#d52bea', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
  chart.timeScale().subscribeVisibleLogicalRangeChange(syncOverlay);
  chart.subscribeCrosshairMove(param => {
    const candle = param.seriesData.get(price!) as CandlestickData | undefined;
    emit('ohlc', candle ? { time: Number(candle.time), open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: 0 } : null);
  });
  observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width) { chart?.applyOptions({ width }); requestAnimationFrame(syncOverlay); } });
  observer.observe(host.value);
  await nextTick(); update();
});

watch(() => [props.candles, props.forecast, props.volumeVisible, props.uncertaintyVisible, props.timeframe], update, { deep: false });
onBeforeUnmount(() => { observer?.disconnect(); chart?.timeScale().unsubscribeVisibleLogicalRangeChange(syncOverlay); chart?.remove(); chart = undefined; });
</script>

<template>
  <div class="chart-region">
    <div class="chart-tools" aria-label="Công cụ biểu đồ"><button title="Crosshair">✣</button><button title="Đường xu hướng">／</button><button title="Mức giá">☷</button><button title="Mẫu">♧</button><button title="Văn bản">T</button><button title="Thêm công cụ">⌄</button><span/><button title="Thước đo">♢</button><button title="Phóng to">⊕</button><button title="Nam châm">∩</button></div>
    <div ref="host" class="chart-host" :data-visible-logical-range="visibleRangeToken" :data-price-scale-range="priceRangeToken">
      <svg v-if="boundaryX!==null" class="forecast-overlay" :viewBox="`0 0 ${host?.clientWidth||1} ${stageHeight||1}`" preserveAspectRatio="none" aria-hidden="true">
        <rect :x="boundaryX" y="0" :width="Math.max(0,(host?.clientWidth||0)-boundaryX)" :height="Math.max(0,stageHeight-28)" fill="rgba(160,92,255,.055)"/>
        <path v-if="bandPath" :d="bandPath" fill="rgba(160,92,255,.18)" stroke="none"/>
        <line :x1="boundaryX" :x2="boundaryX" y1="0" :y2="Math.max(0,stageHeight-28)" stroke="rgba(232,237,246,.82)" stroke-width="1.5" stroke-dasharray="7 6"/>
      </svg>
      <span v-if="boundaryX!==null" class="forecast-start-label" :style="{left:`${Math.min(boundaryX+8,(host?.clientWidth||0)-115)}px`}">Bắt đầu dự báo</span>
      <span v-if="bandTooWide&&uncertaintyVisible" class="band-warning">Dải bất định rộng hơn vùng giá đang xem</span>
    </div>
  </div>
</template>

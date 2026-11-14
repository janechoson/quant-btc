<template>
  <div class="chart-region">
    <div
      ref="host"
      class="chart-host"
      :data-visible-logical-range="visibleRangeToken"
      :data-price-scale-range="priceRangeToken"
    >
      <svg
        v-if="boundaryX !== null"
        class="forecast-overlay"
        :viewBox="`0 0 ${host?.clientWidth || 1} ${stageHeight || 1}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          :x="boundaryX"
          y="0"
          :width="
            Math.max(0, (host?.clientWidth || 0) - boundaryX)
          "
          :height="Math.max(0, stageHeight - 28)"
          fill="rgba(139,32,32,.045)"
        />
        <path
          v-if="bandPath"
          :d="bandPath"
          fill="rgba(139,32,32,.12)"
          stroke="none"
        />
        <line
          :x1="boundaryX"
          :x2="boundaryX"
          y1="0"
          :y2="Math.max(0, stageHeight - 28)"
          stroke="rgba(43,41,36,.62)"
          stroke-width="1.5"
          stroke-dasharray="7 6"
        />
      </svg>
      <span
        v-if="boundaryX !== null"
        class="forecast-start-label"
        :style="{
          left: `${Math.min(boundaryX + 8, (host?.clientWidth || 0) - 115)}px`,
        }"
        >Bắt đầu dự báo</span
      >
      <span
        v-if="bandTooWide && uncertaintyVisible"
        class="band-warning"
        >Dải bất định rộng hơn vùng giá đang xem</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  onBeforeUnmount,
  onMounted,
  watch,
  ref,
  nextTick,
} from 'vue';
import {
  createChart,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type CandlestickData,
  type HistogramData,
  type Time,
} from 'lightweight-charts';
import type { Candle, Forecast } from '../../types';

const props = withDefaults(
  defineProps<{
    candles: Candle[];
    liveCandle?: Candle | null;
    forecast: Forecast | null;
    timeframe: string;
    volumeVisible: boolean;
    uncertaintyVisible?: boolean;
  }>(),
  { liveCandle: null, uncertaintyVisible: true },
);
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
let previousCandles: Candle[] = [];

const average = (n: number) =>
  props.candles.flatMap((c, i) =>
    i < n - 1
      ? []
      : [
          {
            time: c.time as Time,
            value:
              props.candles
                .slice(i - n + 1, i + 1)
                .reduce((s, x) => s + x.close, 0) / n,
          },
        ],
  );

function syncOverlay() {
  if (!chart || !price || !host.value) return;
  stageHeight.value = host.value.clientHeight;
  const logicalRange = chart
    .timeScale()
    .getVisibleLogicalRange();
  const priceTop = price.coordinateToPrice(0),
    priceBottom = price.coordinateToPrice(stageHeight.value);
  visibleRangeToken.value = logicalRange
    ? `${logicalRange.from.toFixed(2)}:${logicalRange.to.toFixed(2)}`
    : '';
  priceRangeToken.value =
    priceTop !== null && priceBottom !== null
      ? `${priceTop.toFixed(2)}:${priceBottom.toFixed(2)}`
      : '';
  if (!props.forecast?.predictedCandles.length) {
    boundaryX.value = null;
    bandPath.value = '';
    bandTooWide.value = false;
    return;
  }
  const timeScale = chart.timeScale();
  const first = props.forecast.predictedCandles[0]!;
  const x = timeScale.timeToCoordinate(first.time as Time);
  boundaryX.value = x === null ? null : Number(x);
  if (
    !props.uncertaintyVisible ||
    !props.forecast.uncertainty?.length
  ) {
    bandPath.value = '';
    bandTooWide.value = false;
    return;
  }
  const upper = props.forecast.uncertainty.map((point) => ({
    x: timeScale.timeToCoordinate(point.time as Time),
    y: price!.priceToCoordinate(point.high),
  }));
  const lower = props.forecast.uncertainty.map((point) => ({
    x: timeScale.timeToCoordinate(point.time as Time),
    y: price!.priceToCoordinate(point.low),
  }));
  const valid = [...upper, ...lower].every(
    (point) =>
      point.x !== null &&
      point.y !== null &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y),
  );
  if (!valid) {
    bandPath.value = '';
    bandTooWide.value = false;
    return;
  }
  bandPath.value = `M ${upper.map((point) => `${point.x},${point.y}`).join(' L ')} L ${[
    ...lower,
  ]
    .reverse()
    .map((point) => `${point.x},${point.y}`)
    .join(' L ')} Z`;
  const top = price.priceToCoordinate(
    Math.max(
      ...props.forecast.uncertainty.map((point) => point.high),
    ),
  );
  const bottom = price.priceToCoordinate(
    Math.min(
      ...props.forecast.uncertainty.map((point) => point.low),
    ),
  );
  bandTooWide.value =
    top !== null &&
    bottom !== null &&
    Math.abs(bottom - top) > stageHeight.value * 0.9;
}

function removeForecastSeries() {
  if (!chart || !price) return;
  if (predicted) chart.removeSeries(predicted);
  predicted = undefined;
  for (const line of priceLines) price.removePriceLine(line);
  priceLines = [];
}

function updateLiveCandle(candle: Candle | null) {
  if (!candle || !price || !volume || !chart) return;
  const liveColor =
    candle.close >= candle.open
      ? 'rgba(23,118,83,.58)'
      : 'rgba(164,60,52,.58)';
  price.update({
    time: candle.time as Time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    color: liveColor,
    borderColor: liveColor,
    wickColor: liveColor,
  });
  volume.update({
    time: candle.time as Time,
    value: candle.volume,
    color: liveColor,
  });
  for (const [period, series] of [
    [20, ma20],
    [50, ma50],
  ] as const) {
    const rows = [...props.candles, candle];
    if (rows.length >= period && series)
      series.update({
        time: candle.time as Time,
        value:
          rows
            .slice(-period)
            .reduce((sum, row) => sum + row.close, 0) / period,
      });
  }
  requestAnimationFrame(syncOverlay);
}

function update() {
  if (!price || !volume || !chart) return;
  const priorRange = chart.timeScale().getVisibleLogicalRange();
  const candles = props.candles;
  const samePrefix = (length: number) =>
    previousCandles
      .slice(0, length)
      .every((c, i) => candles[i]?.time === c.time);
  const appending =
    lastTimeframe === props.timeframe &&
    previousCandles.length > 0 &&
    candles.length === previousCandles.length + 1 &&
    samePrefix(previousCandles.length);
  const replacingLast =
    lastTimeframe === props.timeframe &&
    candles.length === previousCandles.length &&
    candles.length > 0 &&
    candles.at(-1)?.time === previousCandles.at(-1)?.time &&
    samePrefix(candles.length - 1);
  const latestChanged =
    replacingLast &&
    JSON.stringify(candles.at(-1)) !==
      JSON.stringify(previousCandles.at(-1));
  if (appending || latestChanged) {
    const candle = candles.at(-1)!;
    price.update({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
    volume.update({
      time: candle.time as Time,
      value: candle.volume,
      color:
        candle.close >= candle.open ? '#177653' : '#A43C34',
    });
  } else if (
    JSON.stringify(candles.map((c) => c.time)) !==
      JSON.stringify(previousCandles.map((c) => c.time)) ||
    !samePrefix(candles.length)
  ) {
    price.setData(
      candles.map(
        (c) =>
          ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }) satisfies CandlestickData,
      ),
    );
    volume.setData(
      candles.map(
        (c) =>
          ({
            time: c.time as Time,
            value: c.volume,
            color: c.close >= c.open ? '#177653' : '#A43C34',
          }) satisfies HistogramData,
      ),
    );
  }
  previousCandles = candles.slice();
  volume.applyOptions({ visible: props.volumeVisible });
  ma20?.setData(average(20));
  ma50?.setData(average(50));
  const forecast = props.forecast;
  if (forecast) {
    for (const line of priceLines) price.removePriceLine(line);
    priceLines = [];
    predicted ??= chart.addCandlestickSeries({
      upColor: 'rgba(23,118,83,.58)',
      downColor: 'rgba(164,60,52,.58)',
      borderUpColor: 'rgba(23,118,83,.82)',
      borderDownColor: 'rgba(164,60,52,.82)',
      wickUpColor: 'rgba(23,118,83,.9)',
      wickDownColor: 'rgba(164,60,52,.9)',
      priceLineVisible: false,
    });
    predicted.setData(
      forecast.predictedCandles.map((c) => ({
        ...c,
        time: c.time as Time,
      })),
    );
    const addLevel = (
      value: number | undefined | null,
      title: string,
      color: string,
    ) => {
      if (value && Number.isFinite(value))
        priceLines.push(
          price!.createPriceLine({
            price: value,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title,
          }),
        );
    };
    addLevel(forecast.takeProfit, 'TP', '#177653');
    addLevel(forecast.stopLoss, 'SL', '#A43C34');
    if (forecast.entry) {
      addLevel(forecast.entry.low, 'Entry', '#177653');
      if (forecast.entry.high !== forecast.entry.low)
        addLevel(forecast.entry.high, '', '#177653');
    }
  } else removeForecastSeries();
  const forecastChanged =
    (forecast?.id ?? null) !== lastForecastId;
  const timeframeChanged = props.timeframe !== lastTimeframe;
  if (firstLayout || forecastChanged || timeframeChanged) {
    const historyCount = candles.length;
    const from = Math.max(0, historyCount - 80);
    const to =
      historyCount +
      (forecast?.predictedCandles.length ?? 0) +
      4;
    if (historyCount)
      chart.timeScale().setVisibleLogicalRange({ from, to });
    firstLayout = false;
  } else if (priorRange) {
    try {
      chart.timeScale().setVisibleLogicalRange(priorRange);
    } catch {
      /* the rolling data window may have dropped the user's oldest visible bar */
    }
  }
  lastForecastId = forecast?.id ?? null;
  lastTimeframe = props.timeframe;
  requestAnimationFrame(syncOverlay);
}

onMounted(async () => {
  if (!host.value) return;
  chart = createChart(host.value, {
    layout: {
      background: { color: '#FBF8F0' },
      textColor: '#675E50',
      fontFamily: 'DM Mono, monospace',
    },
    grid: {
      vertLines: { color: '#E2D8C6' },
      horzLines: { color: '#E2D8C6' },
    },
    crosshair: { mode: 0 },
    rightPriceScale: {
      borderColor: '#CEC7B6',
      scaleMargins: { top: 0.08, bottom: 0.12 },
    },
    timeScale: {
      borderColor: '#CEC7B6',
      timeVisible: true,
      rightOffset: 4,
    },
    handleScroll: true,
    handleScale: true,
  });
  price = chart.addCandlestickSeries({
    upColor: '#177653',
    downColor: '#A43C34',
    borderVisible: false,
    wickUpColor: '#177653',
    wickDownColor: '#A43C34',
  });
  volume = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
  });
  ma20 = chart.addLineSeries({
    color: '#8B2020',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  ma50 = chart.addLineSeries({
    color: '#675E50',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
    visible: false,
  });
  chart
    .timeScale()
    .subscribeVisibleLogicalRangeChange(syncOverlay);
  chart.subscribeCrosshairMove((param) => {
    const candle = param.seriesData.get(price!) as
      | CandlestickData
      | undefined;
    emit(
      'ohlc',
      candle
        ? {
            time: Number(candle.time),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: 0,
          }
        : null,
    );
  });
  observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width;
    if (width) {
      chart?.applyOptions({ width });
      requestAnimationFrame(syncOverlay);
    }
  });
  observer.observe(host.value);
  await nextTick();
  update();
  updateLiveCandle(props.liveCandle);
});

watch(
  () => [
    props.candles,
    props.forecast,
    props.volumeVisible,
    props.uncertaintyVisible,
    props.timeframe,
  ],
  update,
  { deep: false },
);
watch(() => props.liveCandle, updateLiveCandle, {
  deep: false,
});
onBeforeUnmount(() => {
  observer?.disconnect();
  chart
    ?.timeScale()
    .unsubscribeVisibleLogicalRangeChange(syncOverlay);
  chart?.remove();
  chart = undefined;
});
</script>

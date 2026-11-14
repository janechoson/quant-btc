import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../services/api';
import {
  BinanceMarketStream,
  type LiveTicker,
  type StreamStatus,
} from '../services/binance-stream';
import type { Candle, Timeframe } from '../types';

export function applyKlineToState(
  confirmedCandles: Candle[],
  liveCandle: Candle | null,
  candle: Candle,
  closed: boolean,
) {
  const last = confirmedCandles.at(-1);
  if (last && candle.time < last.time)
    return { confirmedCandles, liveCandle };
  if (!closed) {
    if (liveCandle && candle.time < liveCandle.time)
      return { confirmedCandles, liveCandle };
    return { confirmedCandles, liveCandle: candle };
  }
  const byTime = new Map(
    confirmedCandles.map((item) => [item.time, item]),
  );
  byTime.set(candle.time, candle);
  return {
    confirmedCandles: [...byTime.values()]
      .sort((a, b) => a.time - b.time)
      .slice(-500),
    liveCandle:
      liveCandle?.time === candle.time ? null : liveCandle,
  };
}

export const useMarketStore = defineStore('market', () => {
  const timeframe = ref<Timeframe>('1H');
  const confirmedCandles = ref<Candle[]>([]);
  const liveCandle = ref<Candle | null>(null);
  const liveTicker = ref<LiveTicker | null>(null);
  const tickerSource = ref<'websocket' | 'rest' | null>(null);
  const lastUpdateAt = ref(0);
  const streamStatus = ref<StreamStatus>('DISCONNECTED');
  const loading = ref(false),
    error = ref('');
  const candles = computed(() => {
    const confirmed = confirmedCandles.value,
      live = liveCandle.value;
    if (!live) return confirmed;
    const last = confirmed.at(-1);
    return last?.time === live.time
      ? [...confirmed.slice(0, -1), live]
      : [...confirmed, live];
  });
  let stream: BinanceMarketStream | undefined;
  let loadSequence = 0;
  let lastKlineEventTime = 0;
  let fallbackTimer: ReturnType<typeof setInterval> | undefined;
  let reconciliationTimer:
    | ReturnType<typeof setInterval>
    | undefined;

  async function load() {
    const sequence = ++loadSequence,
      requestedTimeframe = timeframe.value;
    loading.value = true;
    error.value = '';
    try {
      const result = await api<{ candles: Candle[] }>(
        `/api/market/candles?timeframe=${requestedTimeframe}&limit=500`,
      );
      if (
        sequence !== loadSequence ||
        requestedTimeframe !== timeframe.value
      )
        return;
      const merged = new Map<number, Candle>();
      for (const candle of result.candles)
        merged.set(candle.time, candle);
      // Keep confirmed data already accepted from the stream if the REST response raced it.
      for (const candle of confirmedCandles.value)
        merged.set(candle.time, candle);
      confirmedCandles.value = [...merged.values()]
        .sort((a, b) => a.time - b.time)
        .slice(-500);
      const last = confirmedCandles.value.at(-1);
      if (
        liveCandle.value &&
        last &&
        liveCandle.value.time <= last.time
      )
        liveCandle.value = null;
    } catch (cause) {
      if (sequence === loadSequence)
        error.value =
          cause instanceof Error
            ? cause.message
            : 'Không tải được dữ liệu';
    } finally {
      if (sequence === loadSequence) loading.value = false;
    }
  }

  async function loadTickerFallback() {
    try {
      const ticker = await api<LiveTicker>(
        '/api/market/ticker',
      );
      // A fallback request may finish after the stream has already recovered.
      if (
        streamStatus.value === 'CONNECTED' &&
        tickerSource.value === 'websocket'
      )
        return;
      if (
        !Number.isFinite(ticker.lastPrice) ||
        ticker.lastPrice <= 0 ||
        ticker.eventTime < lastUpdateAt.value
      )
        return;
      liveTicker.value = ticker;
      tickerSource.value = 'rest';
      lastUpdateAt.value = ticker.eventTime;
    } catch {
      /* retain the last known quote and keep its disconnected/stale status visible */
    }
  }

  function start() {
    if (stream) return;
    stream = new BinanceMarketStream(
      timeframe.value,
      (event) => {
        lastUpdateAt.value = Math.max(
          lastUpdateAt.value,
          event.eventTime,
        );
        if (event.ticker) {
          liveTicker.value = event.ticker;
          tickerSource.value = 'websocket';
        }
        const candle = event.candle;
        if (!candle || event.eventTime <= lastKlineEventTime)
          return;
        lastKlineEventTime = event.eventTime;
        const next = applyKlineToState(
          confirmedCandles.value,
          liveCandle.value,
          candle,
          !!event.candleClosed,
        );
        confirmedCandles.value = next.confirmedCandles;
        liveCandle.value = next.liveCandle;
      },
      (status) => {
        const previous = streamStatus.value;
        streamStatus.value = status;
        if (
          status === 'CONNECTED' &&
          ['RECONNECTING', 'DISCONNECTED', 'STALE'].includes(
            previous,
          )
        )
          void load();
      },
    );
    stream.start();
    void loadTickerFallback();
    fallbackTimer = setInterval(() => {
      if (streamStatus.value !== 'CONNECTED')
        void loadTickerFallback();
    }, 15_000);
    reconciliationTimer = setInterval(() => {
      if (!document.hidden) void load();
    }, 120_000);
    const recover = () => {
      if (
        document.visibilityState === 'visible' &&
        (streamStatus.value !== 'CONNECTED' ||
          Date.now() - lastUpdateAt.value > 15_000)
      ) {
        stream?.reconnectNow();
        void load();
        void loadTickerFallback();
      }
    };
    window.addEventListener('online', recover);
    document.addEventListener('visibilitychange', recover);
    stopListeners = () => {
      window.removeEventListener('online', recover);
      document.removeEventListener('visibilitychange', recover);
    };
  }

  let stopListeners = () => {};
  function stop() {
    stream?.stop();
    stream = undefined;
    stopListeners();
    if (fallbackTimer) clearInterval(fallbackTimer);
    if (reconciliationTimer) clearInterval(reconciliationTimer);
    fallbackTimer = undefined;
    reconciliationTimer = undefined;
  }

  function setTimeframe(value: Timeframe) {
    if (timeframe.value === value) return;
    timeframe.value = value;
    loadSequence++;
    confirmedCandles.value = [];
    liveCandle.value = null;
    lastKlineEventTime = 0;
    void load();
    stream?.setTimeframe(value);
  }

  return {
    timeframe,
    confirmedCandles,
    liveCandle,
    liveTicker,
    tickerSource,
    lastUpdateAt,
    streamStatus,
    candles,
    loading,
    error,
    load,
    start,
    stop,
    setTimeframe,
  };
});

import { createHash } from 'node:crypto';
import { timeframeMs, type Candle, type Timeframe } from './binance.js';
type ForecastCandle = Pick<Candle, 'time' | 'open' | 'high' | 'low' | 'close' | 'volume'>;

export type HistoricalExample = {
  features: number[];
  returns: number[];
  upperWicks: number[];
  lowerWicks: number[];
};

const INPUT_WINDOW = 24;
const MIN_EXAMPLES = 8;
const NEIGHBOR_COUNT = 8;

/** Scale-free features: close return, body, upper/lower wick, relative volume,
 * rolling volatility and short trend. No absolute BTC prices enter matching. */
export function normalizedFeatures(candles: ForecastCandle[], window = INPUT_WINDOW): number[] {
  if (candles.length < window) throw new Error(`Cần ít nhất ${window} nến đã đóng.`);
  const recent = candles.slice(-window);
  const averageVolume = recent.reduce((sum, candle) => sum + Math.max(0, candle.volume), 0) / window;
  const returns: number[] = [];
  const result: number[] = [];
  for (let i = 0; i < recent.length; i++) {
    const candle = recent[i]!;
    const previousClose = i ? recent[i - 1]!.close : candle.open;
    const closeReturn = Math.log(candle.close / previousClose);
    returns.push(closeReturn);
    const local = returns.slice(-8);
    const mean = local.reduce((sum, value) => sum + value, 0) / local.length;
    const volatility = Math.sqrt(local.reduce((sum, value) => sum + (value - mean) ** 2, 0) / local.length);
    const trend = returns.slice(-5).reduce((sum, value) => sum + value, 0);
    result.push(
      closeReturn,
      Math.log(candle.close / candle.open),
      Math.log(Math.max(candle.open, candle.close, candle.high) / Math.max(candle.open, candle.close)),
      Math.log(Math.min(candle.open, candle.close) / Math.min(candle.open, candle.close, candle.low)),
      Math.log1p(Math.max(0, candle.volume) / Math.max(1e-12, averageVolume)),
      volatility,
      trend,
    );
  }
  return result;
}

/** Constructs examples separately for the requested horizon; target paths are
 * never padded or repeated to claim a longer learned forecast. */
export function buildHistoricalExamples(history: ForecastCandle[], beforeTime: number, timeframe: Timeframe, horizon: number, window = INPUT_WINDOW): HistoricalExample[] {
  const step = timeframeMs(timeframe) / 1000;
  const rows = [...new Map(history.filter(c => c.time < beforeTime).map(c => [c.time, c])).values()].sort((a, b) => a.time - b.time);
  const examples: HistoricalExample[] = [];
  for (let end = window; end + horizon <= rows.length; end++) {
    const input = rows.slice(end - window, end);
    const future = rows.slice(end, end + horizon);
    const sequence = [...input, ...future];
    if (sequence.some((c, i) => i > 0 && c.time - sequence[i - 1]!.time !== step)) continue;
    if (future.at(-1)!.time >= beforeTime) continue;
    let previousClose = input.at(-1)!.close;
    const returns: number[] = [];
    const upperWicks: number[] = [];
    const lowerWicks: number[] = [];
    for (const candle of future) {
      returns.push(Math.log(candle.close / previousClose));
      upperWicks.push(Math.log(Math.max(candle.high, candle.open, candle.close) / Math.max(candle.open, candle.close)));
      lowerWicks.push(Math.log(Math.min(candle.low, candle.open, candle.close) / Math.min(candle.open, candle.close)));
      previousClose = candle.close;
    }
    examples.push({ features: normalizedFeatures(input, window), returns, upperWicks, lowerWicks });
  }
  return examples;
}

function weightedQuantile(values: { value: number; weight: number }[], q: number): number {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= q * total) return item.value;
  }
  return sorted.at(-1)!.value;
}

function weightedMean(values: number[], weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return values.reduce((sum, value, i) => sum + value * weights[i]!, 0) / total;
}

export function forecastPath(candles: ForecastCandle[], horizon: number, timeframe: Timeframe, examples: HistoricalExample[]) {
  if (![5, 10, 20, 30].includes(horizon)) throw new Error('Chọn horizon 5, 10, 20 hoặc 30 nến.');
  if (examples.length < MIN_EXAMPLES) throw new Error(`Chưa đủ dữ liệu mẫu cho dự báo ${horizon} nến. Cần ít nhất ${MIN_EXAMPLES} đường đi lịch sử cùng khung và horizon; hiện có ${examples.length}.`);
  const last = candles.at(-1);
  if (!last || !Number.isFinite(last.close) || last.close <= 0) throw new Error('Nến BTC cuối cùng không hợp lệ.');
  const query = normalizedFeatures(candles);
  const dimensionCount = query.length;
  const scales = Array.from({ length: 7 }, (_, channel) => {
    const values = examples.flatMap(example => example.features.filter((_, i) => i % 7 === channel));
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    return Math.max(1e-6, Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length)));
  });
  const matches = examples
    .filter(example => example.returns.length === horizon && example.features.length === dimensionCount)
    .map(example => {
      let distance = 0;
      for (let i = 0; i < dimensionCount; i++) distance += ((example.features[i]! - query[i]!) / scales[i % 7]!) ** 2;
      distance /= dimensionCount;
      return { example, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEIGHBOR_COUNT);
  if (matches.length < MIN_EXAMPLES) throw new Error(`Chưa đủ ${MIN_EXAMPLES} mẫu cùng horizon ${horizon} sau khi kiểm tra feature.`);
  const weights = matches.map(match => Math.exp(-0.5 * Math.min(match.distance, 100)));
  let previousClose = last.close;
  let cumulativeReturns = matches.map(() => 0);
  const step = timeframeMs(timeframe) / 1000;
  const predictedCandles = [] as { time: number; open: number; high: number; low: number; close: number }[];
  const uncertainty = [] as { time: number; low: number; median: number; high: number }[];
  for (let i = 0; i < horizon; i++) {
    const expectedReturn = weightedMean(matches.map(match => match.example.returns[i]!), weights);
    // No-gap assumption: each forecast candle opens at the preceding close;
    // Binance candles can gap, but no separate gap model is estimated here.
    const open = previousClose;
    const close = open * Math.exp(expectedReturn);
    const upperWick = weightedQuantile(matches.map((match, j) => ({ value: match.example.upperWicks[i]!, weight: weights[j]! })), 0.5);
    const lowerWick = weightedQuantile(matches.map((match, j) => ({ value: match.example.lowerWicks[i]!, weight: weights[j]! })), 0.5);
    const high = Math.max(open, close) * Math.exp(Math.max(0, upperWick));
    const low = Math.min(open, close) * Math.exp(Math.min(0, lowerWick));
    const time = last.time + (i + 1) * step;
    if (![open, high, low, close, time].every(Number.isFinite) || low <= 0 || high < Math.max(open, close) || low > Math.min(open, close)) throw new Error('Forecast tạo ra OHLC không hợp lệ.');
    predictedCandles.push({ time, open, high, low, close });
    previousClose = close;
    cumulativeReturns = cumulativeReturns.map((value, j) => value + matches[j]!.example.returns[i]!);
    const distribution = cumulativeReturns.map((value, j) => ({ value: last.close * Math.exp(value), weight: weights[j]! }));
    const lower = weightedQuantile(distribution, 0.1);
    const median = weightedQuantile(distribution, 0.5);
    const upper = weightedQuantile(distribution, 0.9);
    uncertainty.push({ time, low: Math.min(lower, upper), median, high: Math.max(lower, upper) });
  }
  const finalBand = uncertainty.at(-1)!;
  const signal = finalBand.low > last.close ? 'LONG' : finalBand.high < last.close ? 'SHORT' : 'NO TRADE';
  const firstBand = uncertainty[0]!;
  const levels = signal === 'LONG'
    ? { entry: { low: last.close, high: last.close }, takeProfit: finalBand.high, stopLoss: Math.min(last.close, firstBand.low) }
    : signal === 'SHORT'
      ? { entry: { low: last.close, high: last.close }, takeProfit: finalBand.low, stopLoss: Math.max(last.close, firstBand.high) }
      : { entry: null, takeProfit: null, stopLoss: null };
  return {
    predictedCandles, uncertainty, signal, levels,
    metadata: {
      provider: 'PatternForecastProvider', version: 'pattern-knn-v2-path', neighbors: matches.length,
      historyExamples: examples.length, inputWindow: INPUT_WINDOW, horizon,
      quantiles: { method: 'weighted empirical nearest-rank', lower: 0.1, median: 0.5, upper: 0.9, sampleCount: matches.length, calibrated: false },
      featureHash: createHash('sha256').update(JSON.stringify(query)).digest('hex'),
    },
  };
}

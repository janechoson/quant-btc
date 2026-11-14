import { run, all } from '../database/connection.js';
export interface Ohlc {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
export function evaluateForecast(
  f: Record<string, any>,
  predicted: Ohlc[],
  actual: Ohlc[],
) {
  const n = actual.length;
  if (!n) return null;
  const p = predicted.slice(0, n),
    start = Number(f.start_price),
    predFinal = p.at(-1)!.close,
    actualFinal = actual.at(-1)!.close;
  const direction =
    Math.sign(predFinal - start) ===
    Math.sign(actualFinal - start)
      ? 'CORRECT'
      : 'INCORRECT';
  const errors = p.map(
    (c, i) =>
      Math.abs(c.close - actual[i]!.close) /
      Math.max(start, Number.EPSILON),
  );
  const pathError = errors.reduce((s, x) => s + x, 0) / n;
  return {
    progress: n,
    predictedFinal: predFinal,
    actualFinal,
    direction,
    priceError: Math.abs(predFinal - actualFinal),
    pathError,
    pathScore: Math.max(0, 100 * (1 - pathError * 100)),
    completed: n === Number(f.horizon),
    tradeOutcome:
      f.signal === 'NO TRADE' ? 'NO TRADE' : 'PENDING',
  };
}
export function insertEvaluation(
  forecastId: string,
  evaluation: ReturnType<typeof evaluateForecast>,
) {
  if (!evaluation) return;
  run(
    'INSERT INTO forecast_evaluations(forecast_id,evaluated_at,progress,direction,price_error,path_error,path_score,metrics) VALUES(?,?,?,?,?,?,?,?)',
    [
      forecastId,
      new Date().toISOString(),
      evaluation.progress,
      evaluation.direction,
      evaluation.priceError,
      evaluation.pathError,
      evaluation.pathScore,
      JSON.stringify(evaluation),
    ],
  );
}
export function readCandles(
  table: 'forecast_candles' | 'forecast_actual_candles',
  id: string,
): Ohlc[] {
  return all(
    `SELECT candle_time time,open,high,low,close${table === 'forecast_actual_candles' ? ',volume' : ''} FROM ${table} WHERE forecast_id=? ORDER BY candle_time`,
    [id],
  ) as unknown as Ohlc[];
}

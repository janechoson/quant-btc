import { randomUUID } from 'node:crypto';
import {
  all,
  get,
  run,
  transaction,
} from '../database/connection.js';
import {
  fetchCandles,
  timeframeMs,
  type Candle,
  type Timeframe,
} from './binance.js';

export function normalized(candles: Candle[], window = 24) {
  if (candles.length < window)
    throw new Error(`Cần ít nhất ${window} nến đã đóng.`);
  const recent = candles.slice(-window),
    base = recent.at(-1)!.close,
    avgVol =
      recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  return recent.map((c) => [
    c.close / c.open - 1,
    (c.high - Math.max(c.open, c.close)) / c.open,
    (Math.min(c.open, c.close) - c.low) / c.open,
    c.volume / Math.max(1, avgVol),
    c.close / base - 1,
  ]);
}
export async function createDataset(input: {
  timeframe: Timeframe;
  start: string;
  end: string;
  name?: string;
}) {
  const startMs = Date.parse(input.start),
    endMs = Date.parse(input.end) + 86400000 - 1;
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs >= endMs
  )
    throw new Error('Khoảng ngày không hợp lệ');
  const start = Math.floor(startMs / 1000),
    end = Math.floor(endMs / 1000);
  const duplicate = get<{ id: string }>(
    'SELECT id FROM learning_datasets WHERE symbol=? AND timeframe=? AND start_time=? AND end_time=?',
    ['BTC/USDT', input.timeframe, start, end],
  );
  if (duplicate)
    return {
      dataset: getDataset(duplicate.id),
      duplicate: true,
    };
  const step = timeframeMs(input.timeframe);
  let rows: Candle[] = [];
  for (let from = startMs; from < endMs; ) {
    const batch = await fetchCandles(
      'BTCUSDT',
      input.timeframe,
      1000,
      from,
      endMs,
    );
    if (!batch.length) break;
    rows.push(...batch.filter((c) => c.closed));
    const next = batch.at(-1)!.openTime + step;
    if (next <= from)
      throw new Error('Binance candle cursor did not advance');
    from = next;
    if (batch.length < 1000) break;
  }
  rows = rows
    .sort((a, b) => a.openTime - b.openTime)
    .filter(
      (c, i, a) => i === 0 || c.openTime !== a[i - 1]!.openTime,
    );
  for (let i = 1; i < rows.length; i++)
    if (rows[i]!.openTime - rows[i - 1]!.openTime !== step)
      throw new Error(
        `Phát hiện khoảng trống nến tại ${new Date(rows[i]!.openTime).toISOString()}`,
      );
  const window = 24,
    horizon = 10;
  if (rows.length < window + horizon)
    throw new Error(
      `Khoảng ngày chỉ có ${rows.length} nến hợp lệ; cần ít nhất ${window + horizon} nến.`,
    );
  const examples = [] as {
    time: number;
    features: number[][];
    outcomes: number[];
  }[];
  for (let i = window; i + horizon <= rows.length; i++) {
    const hist = rows.slice(i - window, i),
      future = rows.slice(i, i + horizon);
    examples.push({
      time: hist.at(-1)!.time,
      features: normalized(hist, window),
      outcomes: future.map((c, j) =>
        Math.log(
          c.close /
            (j ? future[j - 1]!.close : hist.at(-1)!.close),
        ),
      ),
    });
  }
  const id = randomUUID(),
    now = new Date().toISOString();
  const saved = await transaction(() => {
    const raced = get<{ id: string }>(
      'SELECT id FROM learning_datasets WHERE symbol=? AND timeframe=? AND start_time=? AND end_time=?',
      ['BTC/USDT', input.timeframe, start, end],
    );
    if (raced) return { id: raced.id, duplicate: true };
    for (const c of rows)
      run(
        'INSERT OR IGNORE INTO market_candles(exchange,symbol,timeframe,open_time,close_time,open,high,low,close,volume) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [
          'Binance',
          'BTC/USDT',
          input.timeframe,
          c.time,
          Math.floor(c.closeTime / 1000),
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume,
        ],
      );
    run(
      'INSERT INTO learning_datasets(id,name,symbol,timeframe,start_time,end_time,candle_count,example_count,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [
        id,
        input.name ||
          `${input.timeframe} ${input.start} – ${input.end}`,
        'BTC/USDT',
        input.timeframe,
        start,
        end,
        rows.length,
        examples.length,
        'READY',
        now,
        now,
      ],
    );
    for (const ex of examples)
      run(
        'INSERT INTO learning_examples(dataset_id,input_start_time,input_end_time,target_end_time,input_features,target_returns,created_at) VALUES(?,?,?,?,?,?,?)',
        [
          id,
          ex.time - (window - 1) * step,
          ex.time,
          ex.time + horizon * step,
          JSON.stringify(ex.features),
          JSON.stringify(ex.outcomes),
          now,
        ],
      );
    return { id, duplicate: false };
  });
  return {
    dataset: getDataset(saved.id),
    duplicate: saved.duplicate,
  };
}
export function listDatasets(page = 1, limit = 20) {
  const total = Number(
    get<{ n: number }>(
      'SELECT COUNT(*) n FROM learning_datasets',
    )?.n || 0,
  );
  const items = all(
    'SELECT id,name,symbol,timeframe,start_time,end_time,candle_count,example_count,status,created_at,updated_at FROM learning_datasets ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, (page - 1) * limit],
  );
  return {
    items,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}
export function getDataset(id: string) {
  return get(
    'SELECT id,name,symbol,timeframe,start_time,end_time,candle_count,example_count,status,created_at,updated_at FROM learning_datasets WHERE id=?',
    [id],
  );
}
export function datasetCandles(id: string) {
  const d = get<{
    symbol: string;
    timeframe: string;
    start_time: number;
    end_time: number;
  }>(
    'SELECT symbol,timeframe,start_time,end_time FROM learning_datasets WHERE id=?',
    [id],
  );
  if (!d) return null;
  return all(
    'SELECT open_time time,open,high,low,close,volume FROM market_candles WHERE symbol=? AND timeframe=? AND open_time>=? AND open_time<=? ORDER BY open_time',
    [d.symbol, d.timeframe, d.start_time, d.end_time],
  );
}
export function datasetExamples(
  id: string,
  page = 1,
  limit = 50,
) {
  const total = Number(
    get<{ n: number }>(
      'SELECT COUNT(*) n FROM learning_examples WHERE dataset_id=?',
      [id],
    )?.n || 0,
  );
  return {
    items: all(
      'SELECT input_start_time,input_end_time,target_end_time,input_features,target_returns FROM learning_examples WHERE dataset_id=? ORDER BY input_end_time LIMIT ? OFFSET ?',
      [id, limit, (page - 1) * limit],
    ).map((x) => ({
      ...x,
      input_features: JSON.parse(String(x.input_features)),
      target_returns: JSON.parse(String(x.target_returns)),
    })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}
export async function deleteDataset(id: string) {
  await transaction(() =>
    run('DELETE FROM learning_datasets WHERE id=?', [id]),
  );
}

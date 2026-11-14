export const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS market_candles (
  id INTEGER PRIMARY KEY, exchange TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
  open_time INTEGER NOT NULL, close_time INTEGER NOT NULL, open REAL NOT NULL, high REAL NOT NULL,
  low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL,
  UNIQUE(exchange,symbol,timeframe,open_time)
);
CREATE INDEX IF NOT EXISTS idx_market_candles_range ON market_candles(symbol,timeframe,open_time);
CREATE TABLE IF NOT EXISTS learning_datasets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
  start_time INTEGER NOT NULL, end_time INTEGER NOT NULL, candle_count INTEGER NOT NULL DEFAULT 0,
  example_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'READY', created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, UNIQUE(symbol,timeframe,start_time,end_time)
);
CREATE INDEX IF NOT EXISTS idx_learning_datasets_created ON learning_datasets(created_at DESC);
CREATE TABLE IF NOT EXISTS learning_examples (
  id INTEGER PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES learning_datasets(id) ON DELETE CASCADE,
  input_start_time INTEGER NOT NULL, input_end_time INTEGER NOT NULL, target_end_time INTEGER NOT NULL,
  input_features TEXT NOT NULL, target_returns TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(dataset_id,input_end_time)
);
CREATE INDEX IF NOT EXISTS idx_learning_examples_dataset ON learning_examples(dataset_id,input_end_time);
CREATE TABLE IF NOT EXISTS forecasts (
  id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
  horizon INTEGER NOT NULL, created_at TEXT NOT NULL, last_confirmed_candle INTEGER NOT NULL,
  forecast_start INTEGER NOT NULL, forecast_end INTEGER NOT NULL, start_price REAL NOT NULL,
  status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, signal TEXT NOT NULL,
  algorithm_version TEXT NOT NULL, input_snapshot TEXT NOT NULL, metadata TEXT NOT NULL,
  signal_levels TEXT NOT NULL, evaluation TEXT, reference_snapshot TEXT
);
CREATE INDEX IF NOT EXISTS idx_forecasts_status_start ON forecasts(status,forecast_start);
CREATE INDEX IF NOT EXISTS idx_forecasts_created ON forecasts(created_at DESC);
CREATE TRIGGER IF NOT EXISTS immutable_forecast_snapshot
BEFORE UPDATE OF id,idempotency_key,symbol,timeframe,horizon,created_at,last_confirmed_candle,forecast_start,forecast_end,start_price,signal,algorithm_version,input_snapshot,metadata,signal_levels,reference_snapshot ON forecasts
BEGIN SELECT RAISE(ABORT,'forecast snapshot is immutable'); END;
CREATE TABLE IF NOT EXISTS forecast_candles (
  forecast_id TEXT NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE, candle_time INTEGER NOT NULL,
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
  PRIMARY KEY(forecast_id,candle_time)
);
CREATE TRIGGER IF NOT EXISTS immutable_predicted_candle
BEFORE UPDATE ON forecast_candles
BEGIN SELECT RAISE(ABORT,'predicted candles are immutable'); END;
CREATE TABLE IF NOT EXISTS forecast_actual_candles (
  forecast_id TEXT NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE, candle_time INTEGER NOT NULL,
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL,
  PRIMARY KEY(forecast_id,candle_time)
);
CREATE TABLE IF NOT EXISTS forecast_evaluations (
  id INTEGER PRIMARY KEY, forecast_id TEXT NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
  evaluated_at TEXT NOT NULL, progress INTEGER NOT NULL, direction TEXT, price_error REAL,
  path_error REAL, path_score REAL, metrics TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forecast_eval_id ON forecast_evaluations(forecast_id,evaluated_at DESC);
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS migration_reports(version INTEGER PRIMARY KEY, completed_at TEXT NOT NULL, report TEXT NOT NULL);
`;

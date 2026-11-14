# Quant BTC

BTC/USDT Spot pattern forecast terminal. Frontend is Vue 3 + TypeScript + Vite + Pinia + Vue Router + Tailwind CSS; backend is a single Node.js/TypeScript HTTP application. Binance public REST supplies market candles. No order execution or external AI provider is used.

## Requirements and commands

- Node.js 20.19 or newer
- npm

```powershell
npm install
npm run dev
npm run build
npm start
npm test
```

`npm run dev` starts the API at `http://localhost:4173` and Vite at `http://localhost:5173`; Vite proxies `/api` requests to the API. Run `npm run build` before `npm start`. Production serves only `dist/client`; source, migration files, SQLite and JSON backups are not in the static root.

## Structure

```text
client/src/       Vue app, router, Pinia stores, chart components, views
server/src/       HTTP API, SQLite, repositories/services and JSON migration
tests/            SQLite migration and persistence regression tests
data/             Local quant-btc.db and preserved legacy JSON backups
dist/             Generated production client and server output
```

## SQLite and legacy import

The database is `data/quant-btc.db`. It contains `market_candles`, `learning_datasets`, `learning_examples`, `forecasts`, `forecast_candles`, `forecast_actual_candles`, `forecast_evaluations`, and migration metadata. Foreign keys and unique indexes protect dataset ownership, candle deduplication, idempotency keys, and timestamp alignment. Writes use SQL transactions and atomically replace the database file after commit.

`sql.js` runs SQLite/WASM without requiring a native compiler on Windows. This VFS does not support WAL, so the database is kept in-process and flushed atomically. Do not run multiple backend processes against the same database file.

On first startup, the server checks `data/datasets.json` and `data/forecasts.json`. If present, it creates timestamped `.backup-*` copies, imports valid records in an idempotent transaction, and records malformed rows in `migration_reports`. Original JSON files are never deleted. You can also run `npm run migrate:json` explicitly. If migration fails, retain the original files and inspect the error/report before retrying.

Learning datasets are independent and paginated (20 per page by default, up to 100 per request). Their normalized examples are fetched in bounded pages; shared OHLCV candles are deduplicated by exchange, symbol, timeframe and open timestamp. Dataset deletion cascades only to its examples and leaves shared market data and forecast history untouched.

## Preserved application behavior

- BTC/USDT H1/H4/D1 chart with volume and translucent future candles.
- Statistical `PatternForecastProvider` version `pattern-knn-v1`, using bounded historical example retrieval from SQLite.
- User-selected Chart Learning ranges and normalized rolling examples.
- Immutable prediction candle snapshots, idempotency keys and backend monitoring that resumes on restart.
- Actual candle storage, Prediction History comparison chart and progressive replay.
- Dataset view, candle chart preview, examples, pagination and deletion.

Current metric definitions and available evaluation fields remain intentionally modest; no confidence value is presented as a calibrated probability. Backtesting and Settings remain the same basic MVP surfaces. Kronos, external AI APIs and live trading are not included.

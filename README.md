# BTC AI Trader · Pattern Forecast Terminal

Local signal-only BTC/USDT terminal. Uses Binance public Spot candles and Lightweight Charts; no trading credentials or order execution are used.

## Run

Requires Node.js 20 or newer.

```powershell
npm start
```

Open `http://localhost:4173`. Forecast and learning records are stored under `data/` as JSON. The server checks unfinished forecasts once per minute and resumes them when restarted. The chart library and web fonts load from public CDNs.

## Current scope

- Trading terminal with Binance H1/H4/D1 candles, volume, forecast overlay and signal levels.
- User-selected historical ranges create rolling, timeframe-separated normalized learning examples.
- Statistical pattern forecast provider with immutable forecast snapshots and idempotency keys.
- Server-side reconciliation of closed candles, partial progress and a prediction history comparison view with replay.
- No live trading. Forecast signals and displayed scores are informational and are not calibrated probabilities.

The initial version does not yet include the full walk-forward backtest suite, configurable settings persistence, multi-stage forecast metric breakdown, or complete TP/SL ambiguity evaluator described in the supplied master prompt. The dashboard labels unavailable results rather than fabricating them.

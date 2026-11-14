import type { Candle, Timeframe } from '../types';

export interface LiveTicker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  eventTime: number;
}

export type StreamStatus =
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'STALE';
export interface MarketEvent {
  ticker?: LiveTicker;
  candle?: Candle;
  candleClosed?: boolean;
  eventTime: number;
}
type SocketLike = Pick<
  WebSocket,
  | 'readyState'
  | 'onopen'
  | 'onmessage'
  | 'onclose'
  | 'onerror'
  | 'close'
>;
type SocketFactory = (url: string) => SocketLike;

const intervals: Record<Timeframe, string> = {
  '15M': '15m',
  '1H': '1h',
  '4H': '4h',
  '1D': '1d',
};
const numeric = (value: unknown): number | null => {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : null;
};

export function parseMarketMessage(
  input: unknown,
  timeframe: Timeframe,
): MarketEvent | null {
  try {
    const outer =
      typeof input === 'string' ? JSON.parse(input) : input;
    if (!outer || typeof outer !== 'object') return null;
    const envelope = outer as Record<string, unknown>;
    const data = (
      envelope.data && typeof envelope.data === 'object'
        ? envelope.data
        : envelope
    ) as Record<string, unknown>;
    const eventTime = numeric(data.E);
    if (eventTime === null || eventTime <= 0) return null;
    const event: MarketEvent = { eventTime };
    if (data.e === '24hrTicker' && data.s === 'BTCUSDT') {
      const lastPrice = numeric(data.c),
        priceChangePercent = numeric(data.P),
        high24h = numeric(data.h),
        low24h = numeric(data.l),
        volume24h = numeric(data.v);
      if (
        [
          lastPrice,
          priceChangePercent,
          high24h,
          low24h,
          volume24h,
        ].some((value) => value === null) ||
        lastPrice! <= 0 ||
        low24h! <= 0 ||
        high24h! < lastPrice! ||
        low24h! > lastPrice! ||
        volume24h! < 0
      )
        return null;
      event.ticker = {
        symbol: 'BTCUSDT',
        lastPrice: lastPrice!,
        priceChangePercent: priceChangePercent!,
        high24h: high24h!,
        low24h: low24h!,
        volume24h: volume24h!,
        eventTime,
      };
    }
    if (
      data.e === 'kline' &&
      data.s === 'BTCUSDT' &&
      data.k &&
      typeof data.k === 'object'
    ) {
      const k = data.k as Record<string, unknown>;
      if (k.i !== intervals[timeframe]) return null;
      const openTimeMs = numeric(k.t),
        open = numeric(k.o),
        high = numeric(k.h),
        low = numeric(k.l),
        close = numeric(k.c),
        volume = numeric(k.v);
      if (
        [openTimeMs, open, high, low, close, volume].some(
          (value) => value === null,
        ) ||
        openTimeMs! <= 0 ||
        Math.min(open!, high!, low!, close!) <= 0 ||
        volume! < 0 ||
        high! < Math.max(open!, close!, low!) ||
        low! > Math.min(open!, close!, high!)
      )
        return null;
      event.candle = {
        time: Math.floor(openTimeMs! / 1000),
        open: open!,
        high: high!,
        low: low!,
        close: close!,
        volume: volume!,
      };
      event.candleClosed = k.x === true;
    }
    return event.ticker || event.candle ? event : null;
  } catch {
    return null;
  }
}

export class BinanceMarketStream {
  private socket: SocketLike | null = null;
  private stopped = true;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private staleTimer:
    | ReturnType<typeof setInterval>
    | undefined;
  private rotationTimer:
    | ReturnType<typeof setTimeout>
    | undefined;
  private stableTimer:
    | ReturnType<typeof setTimeout>
    | undefined;
  private attempt = 0;
  private lastEventAt = 0;
  private lastTickerEventAt = 0;
  private lastCandleEventAt = 0;
  private timeframe: Timeframe;
  private status: StreamStatus = 'DISCONNECTED';
  private socketGeneration = 0;

  constructor(
    timeframe: Timeframe,
    private readonly onEvent: (event: MarketEvent) => void,
    private readonly onStatus: (status: StreamStatus) => void,
    private readonly createSocket: SocketFactory = (url) =>
      new WebSocket(url),
    private readonly now = () => Date.now(),
    private readonly random = Math.random,
  ) {
    this.timeframe = timeframe;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }
  setTimeframe(timeframe: Timeframe) {
    if (timeframe === this.timeframe) return;
    this.timeframe = timeframe;
    if (!this.stopped) this.reconnectNow();
  }
  reconnectNow(resetBackoff = true) {
    this.clearTimers();
    this.socketGeneration++;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      /* already closed */
    }
    if (!this.stopped) {
      this.setStatus('RECONNECTING');
      if (resetBackoff) this.attempt = 0;
      this.connect();
    }
  }
  stop() {
    this.stopped = true;
    this.clearTimers();
    this.socketGeneration++;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      /* already closed */
    }
    this.setStatus('DISCONNECTED');
  }

  private setStatus(status: StreamStatus) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }
  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.retryTimer = undefined;
    this.staleTimer = undefined;
    this.rotationTimer = undefined;
    this.stableTimer = undefined;
  }
  private connect() {
    if (this.stopped) return;
    this.clearTimers();
    this.setStatus(
      this.attempt ? 'RECONNECTING' : 'CONNECTING',
    );
    const generation = ++this.socketGeneration;
    const url = `wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/btcusdt@kline_${intervals[this.timeframe]}`;
    let socket: SocketLike;
    try {
      socket = this.createSocket(url);
      this.socket = socket;
    } catch {
      this.scheduleRetry();
      return;
    }
    socket.onopen = () => {
      if (
        generation !== this.socketGeneration ||
        this.stopped
      ) {
        socket.close();
        return;
      }
      this.lastEventAt = this.now();
      this.staleTimer = setInterval(() => {
        const age = this.now() - this.lastEventAt;
        if (!this.stopped && age > 15_000)
          this.setStatus('STALE');
        if (!this.stopped && age > 30_000)
          this.reconnectNow(false);
      }, 3_000);
      // Binance closes individual connections after 24 hours; rotate early with jitter.
      this.rotationTimer = setTimeout(
        () => this.reconnectNow(),
        23 * 60 * 60 * 1000 +
          Math.floor(this.random() * 60 * 60 * 1000),
      );
    };
    socket.onmessage = (message) => {
      if (generation !== this.socketGeneration || this.stopped)
        return;
      const event = parseMarketMessage(
        message.data,
        this.timeframe,
      );
      if (!event) return;
      if (event.ticker) {
        if (event.ticker.eventTime <= this.lastTickerEventAt)
          return;
        this.lastTickerEventAt = event.ticker.eventTime;
      }
      if (event.candle) {
        if (event.eventTime <= this.lastCandleEventAt) return;
        this.lastCandleEventAt = event.eventTime;
      }
      this.lastEventAt = this.now();
      if (!this.stableTimer)
        this.stableTimer = setTimeout(() => {
          this.attempt = 0;
          this.stableTimer = undefined;
        }, 30_000);
      this.setStatus('CONNECTED');
      this.onEvent(event);
    };
    socket.onerror = () => {
      if (generation === this.socketGeneration) socket.close();
    };
    socket.onclose = () => {
      if (generation !== this.socketGeneration || this.stopped)
        return;
      this.socket = null;
      this.scheduleRetry();
    };
  }
  private scheduleRetry() {
    if (this.stopped || this.retryTimer) return;
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = undefined;
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = undefined;
    this.setStatus('RECONNECTING');
    const base = Math.min(
      30_000,
      1_000 * 2 ** Math.min(this.attempt++, 5),
    );
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        this.connect();
      },
      Math.floor(base * (0.75 + this.random() * 0.5)),
    );
  }
}

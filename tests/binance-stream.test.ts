import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BinanceMarketStream,
  parseMarketMessage,
} from '../client/src/services/binance-stream';
import { applyKlineToState } from '../client/src/stores/market';

const ticker = (eventTime: number, price = '67000') =>
  JSON.stringify({
    stream: 'btcusdt@ticker',
    data: {
      e: '24hrTicker',
      E: eventTime,
      s: 'BTCUSDT',
      c: price,
      P: '1.25',
      h: '68000',
      l: '65000',
      v: '123.4',
    },
  });
const kline = (
  eventTime: number,
  openTime: number,
  closed = false,
  interval = '1h',
) =>
  JSON.stringify({
    stream: `btcusdt@kline_${interval}`,
    data: {
      e: 'kline',
      E: eventTime,
      s: 'BTCUSDT',
      k: {
        t: openTime,
        o: '66000',
        h: '67100',
        l: '65900',
        c: '67000',
        v: '12.5',
        i: interval,
        x: closed,
      },
    },
  });

class FakeSocket {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  send(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
  close() {
    this.readyState = 3;
    this.closed = true;
    this.onclose?.({} as CloseEvent);
  }
}

afterEach(() => vi.useRealTimers());

describe('Binance public market stream', () => {
  it('parses ticker fields and uses them independently from chart timeframe', () => {
    const event = parseMarketMessage(
      ticker(1000, '67376.01'),
      '1D',
    );
    expect(event?.ticker).toMatchObject({
      symbol: 'BTCUSDT',
      lastPrice: 67376.01,
      priceChangePercent: 1.25,
      high24h: 68000,
      low24h: 65000,
      volume24h: 123.4,
      eventTime: 1000,
    });
  });

  it('rejects malformed, invalid and wrong-timeframe messages', () => {
    expect(parseMarketMessage('{bad', '1H')).toBeNull();
    expect(
      parseMarketMessage(ticker(1000, 'NaN'), '1H'),
    ).toBeNull();
    expect(
      parseMarketMessage(
        kline(1000, 3600000, false, '1h'),
        '4H',
      ),
    ).toBeNull();
  });

  it('parses unfinished and confirmed candles with unique open-time identity', () => {
    const live = parseMarketMessage(kline(2000, 3600000), '1H');
    const closed = parseMarketMessage(
      kline(3000, 3600000, true),
      '1H',
    );
    expect(live?.candle).toMatchObject({
      time: 3600,
      open: 66000,
      high: 67100,
      low: 65900,
      close: 67000,
      volume: 12.5,
    });
    expect(live?.candleClosed).toBe(false);
    expect(closed?.candleClosed).toBe(true);
  });

  it('parses Binance 15-minute live and confirmed candles', () => {
    const live = parseMarketMessage(
        kline(2000, 900000, false, '15m'),
        '15M',
      ),
      closed = parseMarketMessage(
        kline(3000, 900000, true, '15m'),
        '15M',
      );
    expect(live?.candle).toMatchObject({
      time: 900,
      close: 67000,
    });
    expect(live?.candleClosed).toBe(false);
    expect(closed?.candleClosed).toBe(true);
    expect(
      parseMarketMessage(
        kline(3000, 900000, true, '1h'),
        '15M',
      ),
    ).toBeNull();
  });

  it('rejects out-of-order events per stream', () => {
    const sockets: FakeSocket[] = [],
      received: number[] = [];
    const manager = new BinanceMarketStream(
      '1H',
      (event) => received.push(event.eventTime),
      () => {},
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    );
    manager.start();
    sockets[0]!.open();
    sockets[0]!.send(ticker(2000));
    sockets[0]!.send(ticker(1000));
    sockets[0]!.send(kline(4000, 3600000));
    sockets[0]!.send(kline(3000, 3600000));
    expect(received).toEqual([2000, 4000]);
    manager.stop();
  });

  it('switches kline interval by replacing the combined connection', () => {
    const urls: string[] = [],
      sockets: FakeSocket[] = [];
    const manager = new BinanceMarketStream(
      '1H',
      () => {},
      () => {},
      (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    );
    manager.start();
    sockets[0]!.open();
    manager.setTimeframe('4H');
    expect(sockets[0]!.closed).toBe(true);
    expect(urls[1]).toContain('btcusdt@kline_4h');
    expect(urls[1]).toContain('btcusdt@ticker');
    manager.stop();
  });

  it('switches to the 15-minute stream without dropping the ticker', () => {
    const urls: string[] = [],
      sockets: FakeSocket[] = [];
    const manager = new BinanceMarketStream(
      '1H',
      () => {},
      () => {},
      (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    );
    manager.start();
    sockets[0]!.open();
    manager.setTimeframe('15M');
    expect(sockets[0]!.closed).toBe(true);
    expect(urls[1]).toContain('btcusdt@kline_15m');
    expect(urls[1]).toContain('btcusdt@ticker');
    manager.stop();
  });

  it('backs off after disconnect and reconnects automatically', () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const manager = new BinanceMarketStream(
      '1H',
      () => {},
      () => {},
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      () => Date.now(),
      () => 0,
    );
    manager.start();
    sockets[0]!.open();
    sockets[0]!.close();
    vi.advanceTimersByTime(749);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    manager.stop();
  });

  it('increases retry delay after repeated connection failures', () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const manager = new BinanceMarketStream(
      '1H',
      () => {},
      () => {},
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      () => Date.now(),
      () => 0,
    );
    manager.start();
    sockets[0]!.close();
    vi.advanceTimersByTime(750);
    expect(sockets).toHaveLength(2);
    sockets[1]!.close();
    vi.advanceTimersByTime(1499);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    manager.stop();
  });

  it('marks the feed stale and replaces a socket that stops delivering data', () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [],
      states: string[] = [];
    const manager = new BinanceMarketStream(
      '1H',
      () => {},
      (status) => states.push(status),
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      () => Date.now(),
      () => 0,
    );
    manager.start();
    sockets[0]!.open();
    vi.advanceTimersByTime(18_000);
    expect(states).toContain('STALE');
    vi.advanceTimersByTime(15_000);
    expect(sockets).toHaveLength(2);
    manager.stop();
  });

  it('reports connected only after receiving valid market data', () => {
    const sockets: FakeSocket[] = [],
      states: string[] = [];
    const manager = new BinanceMarketStream(
      '1H',
      () => {},
      (status) => states.push(status),
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    );
    manager.start();
    sockets[0]!.open();
    expect(states).not.toContain('CONNECTED');
    sockets[0]!.send(ticker(2000));
    expect(states.at(-1)).toBe('CONNECTED');
    manager.stop();
  });
});

describe('confirmed and unfinished candle isolation', () => {
  const candle = (time: number, close: number) => ({
    time,
    open: close - 10,
    high: close + 10,
    low: close - 20,
    close,
    volume: 5,
  });
  it('keeps unfinished candles out of confirmed history until close', () => {
    const confirmed = [candle(3600, 66000)],
      live = candle(7200, 67000);
    const state = applyKlineToState(
      confirmed,
      null,
      live,
      false,
    );
    expect(state.confirmedCandles).toEqual(confirmed);
    expect(state.liveCandle).toEqual(live);
    expect([
      ...state.confirmedCandles,
      state.liveCandle,
    ]).toHaveLength(2);
  });
  it('finalizes exactly one candle and clears only its matching live version', () => {
    const live = candle(7200, 67000),
      closed = candle(7200, 67100);
    const state = applyKlineToState(
      [candle(3600, 66000)],
      live,
      closed,
      true,
    );
    expect(
      state.confirmedCandles.map((row) => row.time),
    ).toEqual([3600, 7200]);
    expect(state.confirmedCandles.at(-1)).toEqual(closed);
    expect(state.liveCandle).toBeNull();
    const duplicate = applyKlineToState(
      state.confirmedCandles,
      null,
      closed,
      true,
    );
    expect(duplicate.confirmedCandles).toHaveLength(2);
  });
  it('ignores stale candles and does not roll back a newer live candle', () => {
    const latest = candle(7200, 67000),
      older = candle(3600, 66000);
    expect(
      applyKlineToState([latest], null, older, false)
        .liveCandle,
    ).toBeNull();
    const newestLive = candle(10800, 68000);
    expect(
      applyKlineToState(
        [latest],
        newestLive,
        candle(7200, 67100),
        false,
      ).liveCandle,
    ).toEqual(newestLive);
  });
});

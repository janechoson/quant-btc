import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCandles,
  TIMEFRAME_CONFIG,
  timeframeMs,
  type Timeframe,
} from '../server/src/services/binance.js';
import { formatForecastDuration } from '../client/src/utils/forecast-duration.js';

afterEach(() => vi.unstubAllGlobals());

describe('timeframe definitions and Binance REST mapping', () => {
  it.each([
    ['15M', 900_000, '15m'],
    ['1H', 3_600_000, '1h'],
    ['4H', 14_400_000, '4h'],
    ['1D', 86_400_000, '1d'],
  ] as const)(
    'uses %s as %s milliseconds and Binance interval %s',
    async (timeframe, milliseconds, interval) => {
      expect(timeframeMs(timeframe)).toBe(milliseconds);
      expect(TIMEFRAME_CONFIG[timeframe].binanceInterval).toBe(
        interval,
      );

      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL) =>
          new Response(
            JSON.stringify([
              [
                900_000,
                '100',
                '102',
                '99',
                '101',
                '12',
                1_799_999,
              ],
            ]),
            { status: 200 },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);
      const candles = await fetchCandles(
        'BTCUSDT',
        timeframe as Timeframe,
        1,
      );
      const requestUrl = new URL(
        String(fetchMock.mock.calls[0]![0]),
      );
      expect(requestUrl.searchParams.get('interval')).toBe(
        interval,
      );
      expect(candles[0]).toMatchObject({
        time: 900,
        open: 100,
        close: 101,
        closed: true,
      });
    },
  );
});

describe('timeframe-aware Vietnamese forecast durations', () => {
  it.each([
    ['15M', 5, '1 giờ 15 phút'],
    ['15M', 10, '2 giờ 30 phút'],
    ['15M', 50, '12 giờ 30 phút'],
    ['1H', 10, '10 giờ'],
    ['1H', 50, '50 giờ'],
    ['4H', 10, '40 giờ'],
    ['4H', 50, '200 giờ'],
    ['1D', 10, '10 ngày'],
    ['1D', 50, '50 ngày'],
  ] as const)(
    '%s timeframe with %i candles displays %s',
    (timeframe, horizon, expected) => {
      expect(formatForecastDuration(timeframe, horizon)).toBe(
        expected,
      );
    },
  );
});

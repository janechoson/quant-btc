import { describe, expect, it } from 'vitest';
import {
  buildHistoricalExamples,
  forecastPath,
  normalizedFeatures,
  type HistoricalExample,
} from '../server/src/services/forecast-engine.js';
import type {
  Candle,
  Timeframe,
} from '../server/src/services/binance.js';

const step: Record<Timeframe, number> = {
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
};
function series(
  count = 120,
  timeframe: Timeframe = '1H',
  scale = 1,
): Candle[] {
  const interval = step[timeframe];
  let close = 100 * scale;
  return Array.from({ length: count }, (_, i) => {
    const change =
      (Math.sin(i * 0.41) * 0.008 +
        (i % 13 === 0 ? -0.006 : 0.001)) *
      scale;
    const open = close;
    close = Math.max(scale, close + change);
    const high =
      Math.max(open, close) * (1 + (0.001 + (i % 4) * 0.0002));
    const low =
      Math.min(open, close) * (1 - (0.001 + (i % 3) * 0.0003));
    return {
      time: 1_700_000_000 + i * interval,
      openTime: (1_700_000_000 + i * interval) * 1000,
      closeTime:
        (1_700_000_000 + (i + 1) * interval) * 1000 - 1,
      open,
      high,
      low,
      close,
      volume: 10 + (i % 7),
      closed: true,
    };
  });
}
function repeatedExamples(
  input: Candle[],
  horizon: number,
  count = 8,
  path = [0.004, -0.002, 0.006, -0.004, 0.001],
): HistoricalExample[] {
  const features = normalizedFeatures(input);
  return Array.from({ length: count }, (_, i) => ({
    features: features.map(
      (value) => value + (i === count - 1 ? 0.03 : 0),
    ),
    returns: Array.from(
      { length: horizon },
      (_, j) => path[j % path.length]!,
    ),
    upperWicks: Array.from(
      { length: horizon },
      (_, j) => 0.001 + j * 0.0002,
    ),
    lowerWicks: Array.from(
      { length: horizon },
      (_, j) => -0.001 - j * 0.0001,
    ),
  }));
}

describe('forecast feature matching and path generation', () => {
  it('normalizes price levels away while retaining candle and volume features', () => {
    const a = series(24, '1H', 1),
      b = series(24, '1H', 1000);
    expect(normalizedFeatures(a)).toHaveLength(24 * 7);
    normalizedFeatures(a).forEach((value, i) =>
      expect(value).toBeCloseTo(normalizedFeatures(b)[i]!, 9),
    );
  });

  it('builds only contiguous, timeframe-aligned history windows for the requested horizon', () => {
    const rows = series(100, '4H');
    const examples = buildHistoricalExamples(
      rows,
      rows.at(-1)!.time + step['4H'],
      '4H',
      20,
    );
    expect(examples).toHaveLength(100 - 24 - 20 + 1);
    const reference = examples[0]!.reference!;
    expect(reference.inputCandles).toEqual(
      rows
        .slice(0, 24)
        .map(({ time, open, high, low, close, volume }) => ({
          time,
          open,
          high,
          low,
          close,
          volume,
        })),
    );
    expect(reference.continuationCandles).toEqual(
      rows
        .slice(24, 44)
        .map(({ time, open, high, low, close, volume }) => ({
          time,
          open,
          high,
          low,
          close,
          volume,
        })),
    );
    expect(reference.referenceStartTime).toBe(rows[0]!.time);
    expect(reference.referenceEndTime).toBe(rows[43]!.time);
    expect(
      new Set(
        [
          ...reference.inputCandles,
          ...reference.continuationCandles,
        ].map((c) => c.time),
      ).size,
    ).toBe(44);
    const withGap = rows.map((row) => ({ ...row }));
    withGap[55]!.time += 1;
    expect(
      buildHistoricalExamples(
        withGap,
        rows.at(-1)!.time + step['4H'],
        '4H',
        20,
      ).length,
    ).toBeLessThan(57);
  });

  it('matches by normalized similarity and retains each future step in order', () => {
    const input = series(24),
      last = series(25).at(-1)!;
    const result = forecastPath(
      [...input, last],
      5,
      '1H',
      repeatedExamples(input, 5),
    );
    expect(result.metadata.neighbors).toBe(8);
    const returns = result.predictedCandles.map((c, i) =>
      Math.log(
        c.close /
          (i ? result.predictedCandles[i - 1]!.close : c.open),
      ),
    );
    expect(returns[0]).toBeGreaterThan(returns[1]!);
    expect(returns[1]).toBeLessThan(0);
    expect(returns[2]).toBeGreaterThan(returns[1]!);
  });

  it('selects the highest-weight historical match actually used by the forecast', () => {
    const input = series(25),
      examples = repeatedExamples(input, 5);
    examples.forEach((example, i) => {
      const reference = series(40).slice(i, i + 29);
      example.reference = {
        exampleId: `example-${String(i).padStart(2, '0')}`,
        datasetId: `dataset-${i}`,
        referenceStartTime: reference[0]!.time,
        referenceEndTime: reference.at(-1)!.time,
        inputCandles: reference
          .slice(0, 24)
          .map(({ time, open, high, low, close, volume }) => ({
            time,
            open,
            high,
            low,
            close,
            volume,
          })),
        continuationCandles: reference
          .slice(24)
          .map(({ time, open, high, low, close, volume }) => ({
            time,
            open,
            high,
            low,
            close,
            volume,
          })),
      };
      example.features = normalizedFeatures(input).map(
        (value) => value + (i === 7 ? 0.01 : 0.05 + i * 0.001),
      );
    });
    const ineligible = [
      { ...examples[0]!, returns: Array(6).fill(0) },
      { ...examples[1]!, features: [] },
    ];
    const result = forecastPath(input, 5, '1H', [
      ...examples,
      ...ineligible,
    ]);
    expect(result.referenceMatch?.exampleId).toBe('example-07');
    expect(result.referenceMatch?.datasetId).toBe('dataset-7');
    expect(
      result.referenceMatch?.matchDistance,
    ).toBeGreaterThan(0);
    expect(result.referenceMatch?.matchWeight).toBeGreaterThan(
      0,
    );
    expect(result.referenceMatch?.explanation).toMatchObject({
      totalCandidates: 10,
      eligibleCandidates: 8,
      selectedMatches: 8,
      referenceRank: 1,
      contributionRank: 1,
      algorithmVersion: result.metadata.version,
    });
    expect(
      result.referenceMatch?.explanation?.nextMatch,
    ).toMatchObject({ rank: 2 });
    const distanceParts =
      result.referenceMatch!.explanation!.featureBreakdown.map(
        (feature) => feature.distanceContribution,
      );
    expect(
      distanceParts.reduce((sum, value) => sum + value, 0),
    ).toBeCloseTo(result.referenceMatch!.matchDistance, 12);
    const withoutReferences = forecastPath(
      input,
      5,
      '1H',
      [...examples, ...ineligible].map((example) => ({
        ...example,
        reference: undefined,
      })),
    );
    expect(result.predictedCandles).toEqual(
      withoutReferences.predictedCandles,
    );
    expect(result.uncertainty).toEqual(
      withoutReferences.uncertainty,
    );
    expect(result.signal).toBe(withoutReferences.signal);
    expect(result.levels).toEqual(withoutReferences.levels);
  });

  it('emits continuous, finite OHLC with historical wick estimates', () => {
    const input = series(25),
      result = forecastPath(
        input,
        5,
        '1H',
        repeatedExamples(input, 5),
      );
    for (const [
      i,
      candle,
    ] of result.predictedCandles.entries()) {
      expect(candle.open).toBe(
        i
          ? result.predictedCandles[i - 1]!.close
          : input.at(-1)!.close,
      );
      expect(
        [
          candle.open,
          candle.high,
          candle.low,
          candle.close,
        ].every(Number.isFinite),
      ).toBe(true);
      expect(candle.low).toBeGreaterThan(0);
      expect(candle.high).toBeGreaterThanOrEqual(
        Math.max(candle.open, candle.close),
      );
      expect(candle.low).toBeLessThanOrEqual(
        Math.min(candle.open, candle.close),
      );
    }
  });

  it.each<Timeframe>(['1H', '4H', '1D'])(
    'aligns forecast timestamps on %s',
    (timeframe) => {
      const input = series(25, timeframe),
        result = forecastPath(
          input,
          5,
          timeframe,
          repeatedExamples(input, 5),
        );
      expect(
        result.predictedCandles.map((c) => c.time),
      ).toEqual(
        Array.from(
          { length: 5 },
          (_, i) =>
            input.at(-1)!.time + (i + 1) * step[timeframe],
        ),
      );
    },
  );

  it.each([5, 10, 20, 30])(
    'supports horizon %i using horizon-specific example paths',
    (horizon) => {
      const input = series(25),
        result = forecastPath(
          input,
          horizon,
          '1H',
          repeatedExamples(input, horizon),
        );
      expect(result.predictedCandles).toHaveLength(horizon);
      expect(result.uncertainty).toHaveLength(horizon);
      expect(result.metadata.quantiles?.sampleCount).toBe(8);
    },
  );

  it('rejects insufficient or unsupported training data instead of using a volatility baseline', () => {
    const input = series(25);
    expect(() =>
      forecastPath(
        input,
        20,
        '1H',
        repeatedExamples(input, 20, 7),
      ),
    ).toThrow(/ít nhất 8/);
    expect(() =>
      forecastPath(
        input,
        15,
        '1H',
        repeatedExamples(input, 15),
      ),
    ).toThrow(/horizon 5, 10, 20 hoặc 30/);
  });

  it('derives ordered empirical q10/q50/q90 bands from matched future paths', () => {
    const input = series(25),
      examples = repeatedExamples(input, 5);
    examples.forEach((example, i) => {
      example.returns = Array(5).fill((i - 3.5) * 0.002);
    });
    const result = forecastPath(input, 5, '1H', examples);
    expect(
      result.uncertainty.every(
        (point) =>
          point.low <= point.median &&
          point.median <= point.high,
      ),
    ).toBe(true);
    expect(result.metadata.quantiles).toMatchObject({
      lower: 0.1,
      median: 0.5,
      upper: 0.9,
      calibrated: false,
    });
    expect(result.metadata).not.toHaveProperty('probability');
  });

  it('keeps near-zero volatility finite without inventing candle movement', () => {
    const flat = series(25).map((c) => ({
      ...c,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 0,
    }));
    const examples = repeatedExamples(flat, 5).map(
      (example) => ({
        ...example,
        returns: Array(5).fill(0),
        upperWicks: Array(5).fill(0),
        lowerWicks: Array(5).fill(0),
      }),
    );
    const result = forecastPath(flat, 5, '1H', examples);
    expect(result.signal).toBe('NO TRADE');
    expect(
      result.predictedCandles.every(
        (c) =>
          c.open === c.close && c.high === 100 && c.low === 100,
      ),
    ).toBe(true);
    expect(result.levels).toEqual({
      entry: null,
      takeProfit: null,
      stopLoss: null,
    });
  });

  it('keeps extreme but finite historical paths valid and makes disagreement visible in the band', () => {
    const input = series(25),
      examples = repeatedExamples(input, 30).map(
        (example, i) => ({
          ...example,
          returns: Array(30).fill(i < 4 ? 0.35 : -0.25),
          upperWicks: Array(30).fill(0.12),
          lowerWicks: Array(30).fill(-0.12),
        }),
      );
    const result = forecastPath(input, 30, '1D', examples);
    expect(
      result.predictedCandles.every((c) =>
        [c.open, c.high, c.low, c.close].every(Number.isFinite),
      ),
    ).toBe(true);
    expect(
      result.uncertainty.at(-1)!.high -
        result.uncertainty.at(-1)!.low,
    ).toBeGreaterThan(0);
  });
});

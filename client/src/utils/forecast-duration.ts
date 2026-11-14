import type { Timeframe } from '../types';

const timeframeMinutes: Record<Timeframe, number> = {
  '15M': 15,
  '1H': 60,
  '4H': 240,
  '1D': 1440,
};

export function formatForecastDuration(
  timeframe: Timeframe,
  horizon: number,
): string {
  const totalMinutes = timeframeMinutes[timeframe] * horizon;
  if (timeframe === '1D') return `${totalMinutes / 1440} ngày`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!minutes) return `${hours} giờ`;
  if (!hours) return `${minutes} phút`;
  return `${hours} giờ ${minutes} phút`;
}

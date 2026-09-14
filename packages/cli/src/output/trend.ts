import { plot } from 'asciichart';

import { paint } from './colors.js';
import { safeTerminalText } from './safe-text.js';

/**
 * Historical score trend rendering.
 *
 * A chart is only meaningful over a real series, so this is used exclusively
 * for overall scores observed across runs of the same evaluation within the
 * session. Nothing is interpolated or predicted: every plotted point is a score
 * the backend actually returned.
 */

export type TrendPoint = {
  /** Short label for the run the score came from. */
  label: string;
  score: number;
};

const CHART_HEIGHT = 8;
const MIN_POINTS = 2;
const SCORE_MAX = 5;

/**
 * Returns an empty string when there is no series to plot, so callers can
 * concatenate the result unconditionally.
 */
export function renderScoreTrend(points: readonly TrendPoint[], title = 'Overall score'): string {
  if (points.length < MIN_POINTS) return '';
  const scores = points.map((point) => point.score);
  const chart = plot(scores, {
    height: CHART_HEIGHT,
    min: 0,
    max: SCORE_MAX,
    format: (value: number): string => paint.meta(value.toFixed(1).padStart(5)),
  });
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last && first ? last.score - first.score : 0;
  const rounded = Math.round(delta * 100) / 100;
  const direction =
    rounded > 0
      ? paint.pass(`+${rounded}`)
      : rounded < 0
        ? paint.fail(String(rounded))
        : paint.meta('0');

  return [
    paint.header(`${safeTerminalText(title).toUpperCase()} OVER ${points.length} RUNS`),
    chart,
    `${paint.meta('Runs:')} ${points.map((point) => safeTerminalText(point.label)).join(paint.meta(' → '))}`,
    `${paint.meta('Change:')} ${direction}`,
    '',
  ].join('\n');
}

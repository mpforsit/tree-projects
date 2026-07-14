/**
 * Progress color ramp (design handover §2, binding): continuous
 * gray → amber → teal, piecewise-linear RGB interpolation between
 * anchors. Used for bar fills AND percent numerals.
 */
const STOPS: [number, [number, number, number]][] = [
  [0, [161, 155, 143]],
  [45, [193, 138, 46]],
  [80, [31, 138, 110]],
  [100, [21, 118, 92]],
];

/** CSS color for a percentage; null (empty branch, "—") → var(--faint2). */
export function progressColor(percent: number | null): string {
  if (percent === null) return "var(--faint2)";
  const p = Math.max(0, Math.min(100, percent));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i]!;
    const [b, cb] = STOPS[i + 1]!;
    if (p <= b) {
      const t = (p - a) / (b - a);
      const rgb = ca.map((v, j) => Math.round(v + (cb[j]! - v) * t));
      return `rgb(${rgb.join(",")})`;
    }
  }
  return `rgb(${STOPS[STOPS.length - 1]![1].join(",")})`;
}

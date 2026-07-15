/**
 * M9 accessibility baseline: WCAG contrast of the progress ramp against
 * both themes' surfaces (handover §2 anchors are binding — this guards
 * against regressions, and documents the accepted 0 %-gray exception,
 * see DECISIONS).
 */
import { describe, expect, it } from "vitest";
import { progressColor } from "../../lib/progress.ts";

function parseRgb(value: string): [number, number, number] {
  const match = value.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!match) throw new Error(`not an rgb() color: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function parseHex(value: string): [number, number, number] {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const SURFACES = {
  light: parseHex("#ffffff"),
  dark: parseHex("#201e19"),
};

describe("progress ramp contrast (WCAG 1.4.11, ≥ 3:1 for graphics)", () => {
  // 45/80 must clear 3:1 on both themes' card surfaces; 100 % on light.
  for (const percent of [45, 80]) {
    for (const [theme, surface] of Object.entries(SURFACES)) {
      it(`${percent} % on ${theme} surface`, () => {
        const ratio = contrast(parseRgb(progressColor(percent)), surface);
        expect(ratio).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("100 % on light surface", () => {
    expect(contrast(parseRgb(progressColor(100)), SURFACES.light)).toBeGreaterThanOrEqual(3);
  });

  it("documents the accepted exceptions: 0 % gray, 100 % deep teal on dark", () => {
    // Ramp anchors are theme-independent (handover §2, binding). Two spots
    // sit below 3:1 and are accepted — recorded here so a palette change
    // that makes them WORSE gets noticed (see DECISIONS):
    //   0 % gray on light  ≈ 2.3:1 (reads as "barely started"; always
    //                        paired with numeral + track)
    //   100 % teal on dark ≈ 2.9:1 (glyph + chip + numeral redundancy)
    expect(contrast(parseRgb(progressColor(0)), SURFACES.light)).toBeGreaterThan(2);
    expect(contrast(parseRgb(progressColor(0)), SURFACES.dark)).toBeGreaterThan(4);
    expect(contrast(parseRgb(progressColor(100)), SURFACES.dark)).toBeGreaterThan(2.8);
  });
});

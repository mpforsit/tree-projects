import { describe, expect, it } from "vitest";
import { formatAgo, formatDateLong, formatDateShort } from "../../lib/format.ts";
import { progressColor } from "../../lib/progress.ts";
import { formatMinutes, parseDuration } from "../../lib/time.ts";

describe("progressColor (handover §2 ramp)", () => {
  it("hits the anchors exactly", () => {
    expect(progressColor(0)).toBe("rgb(161,155,143)");
    expect(progressColor(45)).toBe("rgb(193,138,46)");
    expect(progressColor(80)).toBe("rgb(31,138,110)");
    expect(progressColor(100)).toBe("rgb(21,118,92)");
  });
  it("interpolates linearly between anchors", () => {
    // midway 0→45: (161+193)/2=177, (155+138)/2≈147 (146.5 rounds to 147), (143+46)/2≈95 (94.5 → 95)
    expect(progressColor(22.5)).toBe("rgb(177,147,95)");
  });
  it("null renders the faint token", () => {
    expect(progressColor(null)).toBe("var(--faint2)");
  });
});

describe("parseDuration", () => {
  it("parses presets and free input", () => {
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("1,5h")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration(" 30 min ")).toBe(30);
  });
  it("rejects garbage and non-positive values", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("-2h")).toBeNull();
  });
});

describe("formatMinutes", () => {
  it("formats per convention", () => {
    expect(formatMinutes(885)).toBe("14 h 45 m");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(45)).toBe("45 m");
  });
});

describe("date formats", () => {
  const d = new Date(2026, 6, 5); // 5. Juli 2026
  it("DD.MM. and D. MMMM YYYY", () => {
    expect(formatDateShort(d)).toBe("05.07.");
    expect(formatDateLong(d)).toBe("5. Juli 2026");
  });
  it("relative ages", () => {
    const now = new Date(2026, 6, 14, 12);
    expect(formatAgo(new Date(2026, 6, 14, 8), now)).toBe("heute");
    expect(formatAgo(new Date(2026, 6, 13, 20), now)).toBe("gestern");
    expect(formatAgo(new Date(2026, 6, 5), now)).toBe("vor 9 Tagen");
    expect(formatAgo(new Date(2026, 5, 14), now)).toBe("vor 4 Wochen");
  });
});

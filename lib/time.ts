/**
 * Time entry parsing and duration formatting (handover §4 task view:
 * presets + free field parsing "45m" / "1,5h"; totals as "2 h 15 m").
 */

/** "45m" | "1,5h" | "1.5h" | "2h" | "90" (bare minutes) → minutes, or null. */
export function parseDuration(input: string): number | null {
  const raw = input.trim().toLowerCase().replace(/\s+/g, "");
  if (raw === "") return null;
  const match = raw.match(/^(\d+(?:[.,]\d+)?)(m|min|h|std)?$/);
  if (!match) return null;
  const value = Number(match[1]!.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2];
  const minutes = unit === "h" || unit === "std" ? value * 60 : value;
  const rounded = Math.round(minutes);
  return rounded > 0 ? rounded : null;
}

/** 885 → "14 h 45 m"; 120 → "2 h"; 45 → "45 m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}

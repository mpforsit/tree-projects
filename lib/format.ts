/**
 * German date and relative-age formatting (CLAUDE.md conventions:
 * DD.MM. short, D. MMMM YYYY long; branch rows show "⟳ vor N Tagen").
 */

const MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export function formatDateShort(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}.${m}.`;
}

export function formatDateLong(date: Date): string {
  return `${date.getDate()}. ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Relative age in German: "heute", "gestern", "vor N Tagen", "vor N Wochen". */
export function formatAgo(date: Date, now = new Date()): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000,
  );
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 14) return `vor ${days} Tagen`;
  return `vor ${Math.round(days / 7)} Wochen`;
}

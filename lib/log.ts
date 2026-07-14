/**
 * Thin logger — the only sanctioned console access (CLAUDE.md: never
 * console.log in committed code).
 */
export const log = {
  info(message: string, data?: Record<string, unknown>): void {
    process.stdout.write(format("info", message, data));
  },
  error(message: string, data?: Record<string, unknown>): void {
    process.stderr.write(format("error", message, data));
  },
};

function format(
  level: "info" | "error",
  message: string,
  data?: Record<string, unknown>,
): string {
  const entry = { time: new Date().toISOString(), level, message, ...data };
  return JSON.stringify(entry) + "\n";
}

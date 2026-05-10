/** YYYY-MM-DD for the current UTC instant. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** YYYY-MM-DD for `today + n` days (n may be negative). UTC-based. */
export function daysFromTodayISO(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

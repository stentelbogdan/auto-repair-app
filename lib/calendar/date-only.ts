// Date-only arithmetic: UTC is an internal calendar coordinate, never an appointment instant.
export function calendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  date.setUTCHours(12, 0, 0, 0);
  return y >= 1000 && y <= 9999 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}
export function dateKey(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function addDays(value: string, days: number): string {
  const date = calendarDate(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + days);
  const next = dateKey(date);
  return calendarDate(next) ? next : value;
}
export function moveMonth(value: string, delta: number): string {
  const date = calendarDate(value);
  if (!date) return value;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta);
  const end = new Date(date); end.setUTCMonth(end.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, end.getUTCDate()));
  const next = dateKey(date);
  return calendarDate(next) ? next : value;
}
export function monthCells(month: string): (string | null)[] {
  const first = calendarDate(`${month}-01`);
  if (!first) return [];
  const end = new Date(first); end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const offset = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let day = 1; day <= end.getUTCDate(); day++) cells.push(`${month}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function romanianDate(value: string, monthOnly = false): string {
  const date = calendarDate(value);
  return date ? new Intl.DateTimeFormat("ro-RO", { timeZone: "UTC", year: "numeric", month: "long", ...(monthOnly ? {} : { day: "numeric", weekday: "long" } as const) }).format(date) : "";
}

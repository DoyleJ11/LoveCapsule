/** Date fields are wall-clock fields, never UTC ISO slices. Server resolves DST. */
export function calendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function wallTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function validTimezone(zone: string): boolean {
  if (zone !== 'UTC' && !zone.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
    return !!zone.trim();
  } catch {
    return false;
  }
}
export function formatRevealInstant(instant: string, timezone: string): string {
  return `${new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(instant))} · ${timezone}`;
}
function dayNumber(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const field = (name: string) => Number(parts.find((p) => p.type === name)?.value);
  return Date.UTC(field('year'), field('month') - 1, field('day')) / 86400000;
}
export function calendarDaysUntil(instant: string, timeZone: string, serverNowMs: number): number {
  return Math.max(0, dayNumber(Date.parse(instant), timeZone) - dayNumber(serverNowMs, timeZone));
}
export const DST_RULE =
  'Times follow this timezone, even when you travel. When clocks repeat an hour, the later time is used. Recurring times skipped by a clock change move forward by that change. A one-time skipped time must be changed before saving.';

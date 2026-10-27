import {
  calendarDate,
  wallTime,
  calendarDaysUntil,
  validTimezone,
  formatRevealInstant,
} from '../time';
it('serializes selected wall fields without UTC date shifting', () => {
  const date = new Date(2026, 0, 1, 0, 5);
  expect(calendarDate(date)).toBe('2026-01-01');
  expect(wallTime(date)).toBe('00:05');
});
it('counts calendar days across DST, including the day before at night', () => {
  expect(
    calendarDaysUntil(
      '2026-03-09T07:00:00Z',
      'America/Los_Angeles',
      Date.parse('2026-03-08T07:55:00Z')
    )
  ).toBe(2);
  expect(
    calendarDaysUntil(
      '2026-03-09T07:00:00Z',
      'America/Los_Angeles',
      Date.parse('2026-03-09T06:55:00Z')
    )
  ).toBe(1);
});
it('handles New Year in the couple zone and uses the same instant when traveling', () => {
  const instant = '2027-01-01T08:00:00Z';
  expect(
    calendarDaysUntil(instant, 'America/Los_Angeles', Date.parse('2027-01-01T07:59:00Z'))
  ).toBe(1);
  expect(formatRevealInstant(instant, 'America/Los_Angeles')).toContain('Jan 1, 2027');
  expect(formatRevealInstant(instant, 'Pacific/Auckland')).toContain('Jan 1, 2027');
  expect(calendarDaysUntil(instant, 'UTC', Date.parse('2027-01-02T00:00:00Z'))).toBe(0);
});
it('validates names and rejects offset and unknown zones', () => {
  expect(validTimezone('America/Los_Angeles')).toBe(true);
  expect(validTimezone('Not/AZone')).toBe(false);
  expect(validTimezone('')).toBe(false);
});

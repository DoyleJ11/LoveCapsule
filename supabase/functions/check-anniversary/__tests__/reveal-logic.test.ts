import { decideReveal } from '../reveal-logic';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('decideReveal', () => {
  describe('missing or malformed anniversary', () => {
    it('returns no_anniversary when the date is null', () => {
      expect(decideReveal(null, null, at('2026-08-12'))).toEqual({ status: 'no_anniversary' });
    });

    it('returns no_anniversary when the date is an empty string', () => {
      expect(decideReveal('', null, at('2026-08-12'))).toEqual({ status: 'no_anniversary' });
    });

    it('returns no_anniversary when the date is malformed', () => {
      expect(decideReveal('not-a-date', null, at('2026-08-12'))).toEqual({
        status: 'no_anniversary',
      });
    });
  });

  describe('idempotency (the repeat-open case)', () => {
    it('reports already_revealed when this year is already revealed', () => {
      expect(decideReveal('2024-06-15', 2026, at('2026-08-12'))).toEqual({
        status: 'already_revealed',
        year: 2026,
      });
    });

    it('reports already_revealed on the anniversary day itself once opened', () => {
      expect(decideReveal('2024-06-15', 2026, at('2026-06-15'))).toEqual({
        status: 'already_revealed',
        year: 2026,
      });
    });

    it('reports already_revealed for a last_reveal_year in the future', () => {
      expect(decideReveal('2024-06-15', 2027, at('2026-08-12'))).toEqual({
        status: 'already_revealed',
        year: 2026,
      });
    });
  });

  describe('before the anniversary', () => {
    it('is not_reached the day before, and reports when it opens', () => {
      expect(decideReveal('2024-06-15', null, at('2026-06-14'))).toEqual({
        status: 'not_reached',
        year: 2026,
        readyOn: '2026-06-15',
      });
    });

    it('is not_reached even when a previous year was revealed', () => {
      expect(decideReveal('2024-06-15', 2025, at('2026-01-05'))).toEqual({
        status: 'not_reached',
        year: 2026,
        readyOn: '2026-06-15',
      });
    });
  });

  describe('on or after the anniversary', () => {
    it('is ready exactly on the anniversary', () => {
      expect(decideReveal('2024-06-15', null, at('2026-06-15'))).toEqual({
        status: 'ready',
        year: 2026,
      });
    });

    it('is ready after the anniversary when never revealed', () => {
      expect(decideReveal('2024-06-15', null, at('2026-08-12'))).toEqual({
        status: 'ready',
        year: 2026,
      });
    });

    it('is ready for a new year when the previous year was revealed', () => {
      expect(decideReveal('2024-06-15', 2025, at('2026-06-15'))).toEqual({
        status: 'ready',
        year: 2026,
      });
    });
  });

  describe('date edge cases', () => {
    it('treats a Feb 29 anniversary as Mar 1 in a non-leap year', () => {
      expect(decideReveal('2024-02-29', null, at('2027-02-28'))).toEqual({
        status: 'not_reached',
        year: 2027,
        readyOn: '2027-03-01',
      });
      expect(decideReveal('2024-02-29', null, at('2027-03-01'))).toEqual({
        status: 'ready',
        year: 2027,
      });
    });

    it('honours Feb 29 in a leap year', () => {
      expect(decideReveal('2024-02-29', null, at('2028-02-29'))).toEqual({
        status: 'ready',
        year: 2028,
      });
    });

    it('handles a Jan 1 anniversary', () => {
      expect(decideReveal('2024-01-01', null, at('2026-01-01'))).toEqual({
        status: 'ready',
        year: 2026,
      });
    });

    it('handles a Dec 31 anniversary', () => {
      expect(decideReveal('2024-12-31', null, at('2026-12-30'))).toEqual({
        status: 'not_reached',
        year: 2026,
        readyOn: '2026-12-31',
      });
      expect(decideReveal('2024-12-31', null, at('2026-12-31'))).toEqual({
        status: 'ready',
        year: 2026,
      });
    });

    it('compares by UTC day, not by time of day', () => {
      // Late in the UTC day, still the anniversary.
      expect(decideReveal('2024-06-15', null, new Date('2026-06-15T23:59:59Z'))).toEqual({
        status: 'ready',
        year: 2026,
      });
      // One second later it is the next day, still ready.
      expect(decideReveal('2024-06-15', null, new Date('2026-06-16T00:00:00Z'))).toEqual({
        status: 'ready',
        year: 2026,
      });
      // Just before midnight UTC on the eve, not yet.
      expect(decideReveal('2024-06-15', null, new Date('2026-06-14T23:59:59Z'))).toEqual({
        status: 'not_reached',
        year: 2026,
        readyOn: '2026-06-15',
      });
    });
  });
});

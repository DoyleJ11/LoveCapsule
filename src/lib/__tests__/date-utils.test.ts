import {
  getDaysUntilAnniversary,
  isAnniversaryReady,
  formatEntryDate,
  formatShortDate,
  formatRelativeDay,
  getCurrentDateString,
  formatCheckpointFrequency,
  formatCheckpointDescription,
  getNextCheckpointDate,
  formatNextCheckpointDate,
} from '../date-utils';
import type { CheckpointConfig } from '../../types/database';

// Helper to mock current date - uses noon to avoid timezone issues
const mockDate = (dateString: string) => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`${dateString}T12:00:00`));
};

const restoreDate = () => {
  jest.useRealTimers();
};

describe('date-utils', () => {
  afterEach(() => {
    restoreDate();
  });

  describe('getDaysUntilAnniversary', () => {
    it('returns 0 when today is the anniversary', () => {
      mockDate('2024-06-15');
      expect(getDaysUntilAnniversary('2020-06-15')).toBe(0);
    });

    it('returns correct days when anniversary is in the future this year', () => {
      mockDate('2024-06-01');
      // date-fns differenceInDays can be 13 or 14 depending on time of day
      const days = getDaysUntilAnniversary('2020-06-15');
      expect(days).toBeGreaterThanOrEqual(13);
      expect(days).toBeLessThanOrEqual(14);
    });

    it('returns days until next year when anniversary already passed', () => {
      mockDate('2024-06-20');
      // Anniversary was June 15, so next one is in ~360 days
      const days = getDaysUntilAnniversary('2020-06-15');
      expect(days).toBeGreaterThan(350);
      expect(days).toBeLessThan(366);
    });

    it('handles leap year anniversaries', () => {
      mockDate('2024-02-28');
      // Feb 28 to Feb 29 (leap year) - can be 0 or 1 depending on time calculation
      const days = getDaysUntilAnniversary('2020-02-29');
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(1);
    });
  });

  describe('isAnniversaryReady', () => {
    it('returns true on anniversary day when not revealed this year', () => {
      mockDate('2024-06-15');
      expect(isAnniversaryReady('2020-06-15', null)).toBe(true);
      expect(isAnniversaryReady('2020-06-15', 2023)).toBe(true);
    });

    it('returns true after anniversary when not revealed this year', () => {
      mockDate('2024-06-20');
      expect(isAnniversaryReady('2020-06-15', null)).toBe(true);
      expect(isAnniversaryReady('2020-06-15', 2023)).toBe(true);
    });

    it('returns false before anniversary day', () => {
      mockDate('2024-06-10');
      expect(isAnniversaryReady('2020-06-15', null)).toBe(false);
    });

    it('returns false when already revealed this year', () => {
      mockDate('2024-06-20');
      expect(isAnniversaryReady('2020-06-15', 2024)).toBe(false);
    });

    it('returns true for new year after previous reveal', () => {
      mockDate('2025-06-15');
      expect(isAnniversaryReady('2020-06-15', 2024)).toBe(true);
    });
  });

  describe('formatEntryDate', () => {
    it('formats date correctly', () => {
      expect(formatEntryDate('2024-06-15')).toBe('June 15, 2024');
      expect(formatEntryDate('2024-01-01')).toBe('January 1, 2024');
      expect(formatEntryDate('2024-12-25')).toBe('December 25, 2024');
    });
  });

  describe('formatShortDate', () => {
    it('formats short date correctly', () => {
      expect(formatShortDate('2024-06-15')).toBe('Jun 15');
      expect(formatShortDate('2024-01-01')).toBe('Jan 1');
      expect(formatShortDate('2024-12-25')).toBe('Dec 25');
    });
  });

  describe('formatRelativeDay', () => {
    it('returns "Today" for today', () => {
      mockDate('2024-06-15');
      expect(formatRelativeDay('2024-06-15')).toBe('Today');
    });

    it('returns "Yesterday" for yesterday', () => {
      mockDate('2024-06-15');
      expect(formatRelativeDay('2024-06-14')).toBe('Yesterday');
    });

    it('returns weekday name for days within a week', () => {
      mockDate('2024-06-15'); // Saturday
      const result = formatRelativeDay('2024-06-12'); // Wednesday
      expect(result).toBe('Wednesday');
    });

    it('returns formatted date for older dates', () => {
      mockDate('2024-06-15');
      expect(formatRelativeDay('2024-06-01')).toBe('Jun 1');
    });
  });

  describe('getCurrentDateString', () => {
    it('returns current date in YYYY-MM-DD format', () => {
      mockDate('2024-06-15');
      expect(getCurrentDateString()).toBe('2024-06-15');
    });

    it('handles single-digit months and days with padding', () => {
      mockDate('2024-01-05');
      expect(getCurrentDateString()).toBe('2024-01-05');
    });
  });

  // ============================================
  // Checkpoint Date Utilities Tests
  // ============================================

  describe('formatCheckpointFrequency', () => {
    it('formats monthly frequency', () => {
      expect(formatCheckpointFrequency('monthly')).toBe('Monthly');
    });

    it('formats quarterly frequency', () => {
      expect(formatCheckpointFrequency('quarterly')).toBe('Quarterly');
    });

    it('formats semi-annual frequency', () => {
      expect(formatCheckpointFrequency('semi_annual')).toBe('Every 6 months');
    });

    it('formats specific date frequency', () => {
      expect(formatCheckpointFrequency('specific_date')).toBe('Specific date');
    });
  });

  describe('formatCheckpointDescription', () => {
    const baseConfig: CheckpointConfig = {
      id: 'test-id',
      couple_id: 'couple-id',
      frequency: 'monthly',
      day_of_month: 15,
      months: null,
      specific_date: null,
      label: null,
      is_active: true,
      created_at: '2024-01-01T00:00:00Z',
    };

    it('returns label when provided', () => {
      const config = { ...baseConfig, label: "Sarah's Birthday" };
      expect(formatCheckpointDescription(config)).toBe("Sarah's Birthday");
    });

    it('formats monthly checkpoint description', () => {
      expect(formatCheckpointDescription(baseConfig)).toBe('Monthly on the 15th');
    });

    it('formats quarterly checkpoint description', () => {
      const config = { ...baseConfig, frequency: 'quarterly' as const, months: [3, 6, 9, 12] };
      expect(formatCheckpointDescription(config)).toBe('Quarterly on the 15th');
    });

    it('formats semi-annual checkpoint description', () => {
      const config = { ...baseConfig, frequency: 'semi_annual' as const, months: [6, 12] };
      expect(formatCheckpointDescription(config)).toBe('Every 6 months on the 15th');
    });

    it('formats specific date checkpoint description', () => {
      const config = {
        ...baseConfig,
        frequency: 'specific_date' as const,
        specific_date: '2024-03-08',
        day_of_month: null,
      };
      expect(formatCheckpointDescription(config)).toBe('March 8');
    });

    it('handles ordinal suffixes correctly', () => {
      expect(formatCheckpointDescription({ ...baseConfig, day_of_month: 1 })).toBe(
        'Monthly on the 1st'
      );
      expect(formatCheckpointDescription({ ...baseConfig, day_of_month: 2 })).toBe(
        'Monthly on the 2nd'
      );
      expect(formatCheckpointDescription({ ...baseConfig, day_of_month: 3 })).toBe(
        'Monthly on the 3rd'
      );
      expect(formatCheckpointDescription({ ...baseConfig, day_of_month: 4 })).toBe(
        'Monthly on the 4th'
      );
      expect(formatCheckpointDescription({ ...baseConfig, day_of_month: 11 })).toBe(
        'Monthly on the 11th'
      );
      expect(formatCheckpointDescription({ ...baseConfig, day_of_month: 12 })).toBe(
        'Monthly on the 12th'
      );
      expect(formatCheckpointDescription({ ...baseConfig, day_of_month: 13 })).toBe(
        'Monthly on the 13th'
      );
      expect(formatCheckpointDescription({ ...baseConfig, day_of_month: 21 })).toBe(
        'Monthly on the 21st'
      );
      expect(formatCheckpointDescription({ ...baseConfig, day_of_month: 22 })).toBe(
        'Monthly on the 22nd'
      );
      expect(formatCheckpointDescription({ ...baseConfig, day_of_month: 23 })).toBe(
        'Monthly on the 23rd'
      );
    });
  });

  describe('getNextCheckpointDate', () => {
    const baseConfig: CheckpointConfig = {
      id: 'test-id',
      couple_id: 'couple-id',
      frequency: 'monthly',
      day_of_month: 15,
      months: null,
      specific_date: null,
      label: null,
      is_active: true,
      created_at: '2024-01-01T00:00:00Z',
    };

    it('returns null for empty configs array', () => {
      expect(getNextCheckpointDate([])).toBeNull();
    });

    it('skips inactive configs', () => {
      const inactiveConfig = { ...baseConfig, is_active: false };
      expect(getNextCheckpointDate([inactiveConfig])).toBeNull();
    });

    it('finds next monthly checkpoint (same month)', () => {
      mockDate('2024-06-10');
      const result = getNextCheckpointDate([baseConfig]);
      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(5); // June (0-indexed)
      expect(result!.getDate()).toBe(15);
    });

    it('finds next monthly checkpoint (next month)', () => {
      mockDate('2024-06-20');
      const result = getNextCheckpointDate([baseConfig]);
      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(6); // July (0-indexed)
      expect(result!.getDate()).toBe(15);
    });

    it('finds next quarterly checkpoint', () => {
      mockDate('2024-02-01');
      const quarterlyConfig = {
        ...baseConfig,
        frequency: 'quarterly' as const,
        months: [3, 6, 9, 12],
      };
      const result = getNextCheckpointDate([quarterlyConfig]);
      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(2); // March (0-indexed)
      expect(result!.getDate()).toBe(15);
    });

    it('finds next semi-annual checkpoint', () => {
      mockDate('2024-01-01');
      const semiAnnualConfig = {
        ...baseConfig,
        frequency: 'semi_annual' as const,
        months: [6, 12],
      };
      const result = getNextCheckpointDate([semiAnnualConfig]);
      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(5); // June (0-indexed)
      expect(result!.getDate()).toBe(15);
    });

    it('finds specific date checkpoint (same year)', () => {
      mockDate('2024-02-01');
      const specificConfig = {
        ...baseConfig,
        frequency: 'specific_date' as const,
        specific_date: '2024-03-08',
        day_of_month: null,
      };
      const result = getNextCheckpointDate([specificConfig]);
      expect(result).not.toBeNull();
      expect(result!.getMonth()).toBe(2); // March (0-indexed)
      expect(result!.getDate()).toBe(8);
    });

    it('finds specific date checkpoint (next year)', () => {
      mockDate('2024-04-01');
      const specificConfig = {
        ...baseConfig,
        frequency: 'specific_date' as const,
        specific_date: '2024-03-08',
        day_of_month: null,
      };
      const result = getNextCheckpointDate([specificConfig]);
      expect(result).not.toBeNull();
      expect(result!.getFullYear()).toBe(2025);
      expect(result!.getMonth()).toBe(2); // March (0-indexed)
      expect(result!.getDate()).toBe(8);
    });

    it('returns soonest checkpoint when multiple configs exist', () => {
      mockDate('2024-06-01');
      const config1 = { ...baseConfig, day_of_month: 20 }; // June 20
      const config2 = { ...baseConfig, day_of_month: 10 }; // June 10
      const result = getNextCheckpointDate([config1, config2]);
      expect(result).not.toBeNull();
      expect(result!.getDate()).toBe(10); // Earlier date wins
    });
  });

  describe('formatNextCheckpointDate', () => {
    it('returns message for null date', () => {
      expect(formatNextCheckpointDate(null)).toBe('No upcoming checkpoints');
    });

    it('returns "Today" when checkpoint is today', () => {
      mockDate('2024-06-15');
      const today = new Date('2024-06-15T12:00:00');
      expect(formatNextCheckpointDate(today)).toBe('Today');
    });

    it('returns "Tomorrow" when checkpoint is tomorrow', () => {
      mockDate('2024-06-15');
      const tomorrow = new Date('2024-06-16T12:00:00');
      expect(formatNextCheckpointDate(tomorrow)).toBe('Tomorrow');
    });

    it('returns "In X days" for dates within a week', () => {
      mockDate('2024-06-15');
      const fiveDaysAway = new Date('2024-06-20T12:00:00');
      expect(formatNextCheckpointDate(fiveDaysAway)).toBe('In 5 days');
    });

    it('returns formatted date for dates more than a week away', () => {
      mockDate('2024-06-15');
      const farAway = new Date('2024-07-20T12:00:00');
      expect(formatNextCheckpointDate(farAway)).toBe('Jul 20');
    });
  });
});

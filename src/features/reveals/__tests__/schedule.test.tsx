import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AnnualScheduleEditor } from '../AnnualScheduleEditor';
let mockVersion = 1;
let mockAnniversary: string | null = '2020-06-01';
const mockSave = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../providers/CoupleProvider', () => ({
  useCouple: () => ({
    couple: {
      schedule_version: mockVersion,
      anniversary_date: mockAnniversary,
      reveal_time: '00:00',
      reveal_timezone: 'UTC',
    },
    saveAnnualSchedule: mockSave,
  }),
}));
jest.mock('../time', () => ({
  ...jest.requireActual('../time'),
  deviceTimezone: () => 'America/Los_Angeles',
}));
jest.mock('@react-native-community/datetimepicker', () => {
  const { Button } = require('react-native');
  return ({ mode, onChange }: { mode: string; onChange: (event: object, date: Date) => void }) => (
    <Button
      title={`Pick ${mode}`}
      onPress={() =>
        onChange({}, mode === 'date' ? new Date(2030, 0, 1) : new Date(2000, 0, 15, 19, 30))
      }
    />
  );
});
beforeEach(() => {
  jest.clearAllMocks();
  mockVersion = 1;
  mockAnniversary = '2020-06-01';
});
it('preserves legacy UTC until an explicit choice, stages date and exact time, and saves once', async () => {
  const screen = render(<AnnualScheduleEditor />);
  fireEvent.press(screen.getByText('Set anniversary date and time'));
  expect(screen.getByLabelText('Reveal timezone').props.accessibilityValue.text).toBe('UTC');
  fireEvent.press(screen.getByText('Pick date'));
  fireEvent.press(screen.getByLabelText('Choose exact time'));
  fireEvent.press(screen.getByText('Pick time'));
  fireEvent.press(screen.getByLabelText('Reveal timezone'));
  fireEvent.changeText(screen.getByLabelText('Search timezones'), 'Los Angeles');
  fireEvent.press(screen.getByLabelText('America/Los_Angeles'));
  expect(mockSave).not.toHaveBeenCalled();
  mockVersion = 2; // background refresh must not rebase unsaved form values
  screen.rerender(<AnnualScheduleEditor />);
  fireEvent.press(screen.getByRole('button', { name: 'Save anniversary schedule' }));
  await waitFor(() =>
    expect(mockSave).toHaveBeenCalledWith('2030-01-01', '19:30', 'America/Los_Angeles', 1)
  );
});
it('cancels staged changes without changing the couple schedule', () => {
  const screen = render(<AnnualScheduleEditor />);
  fireEvent.press(screen.getByText('Set anniversary date and time'));
  fireEvent.press(screen.getByText('Pick date'));
  fireEvent.press(screen.getByText('Cancel'));
  expect(mockSave).not.toHaveBeenCalled();
});

it('defaults a first anniversary to the device timezone and keeps edits staged', () => {
  mockAnniversary = null;
  const screen = render(<AnnualScheduleEditor />);
  fireEvent.press(screen.getByText('Set anniversary date and time'));
  expect(screen.getByLabelText('Reveal timezone').props.accessibilityValue.text).toBe(
    'America/Los_Angeles'
  );
  fireEvent.press(screen.getByText('Cancel'));
  expect(mockSave).not.toHaveBeenCalled();
});
it('keeps detailed timing rules collapsed until requested', () => {
  const screen = render(<AnnualScheduleEditor />);
  fireEvent.press(screen.getByText('Set anniversary date and time'));
  expect(screen.queryByText(/When clocks repeat/)).toBeNull();
  fireEvent.press(screen.getByText('How timing works'));
  expect(screen.getByText(/When clocks repeat/)).toBeTruthy();
});

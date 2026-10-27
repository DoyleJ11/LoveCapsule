import { act, renderHook } from '@testing-library/react-native';
import { useVoiceMemo } from '../useVoiceMemo';

const mockRecorder = {
  uri: 'cache/recording.m4a',
  stop: jest.fn(async () => {}),
  record: jest.fn(),
  prepareToRecordAsync: jest.fn(),
};
const mockState = { isRecording: true, durationMillis: 1234 };
const mockCopy = jest.fn();
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => mockRecorder,
  useAudioRecorderState: () => mockState,
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(async () => {}),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  createAudioPlayer: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  Paths: { document: 'document/' },
  File: jest.fn((_root, name) => ({
    uri: name ? `document/${name}` : 'cache/recording.m4a',
    exists: true,
    copy: mockCopy,
    delete: jest.fn(),
  })),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockState.isRecording = true;
});
it('keeps the recorder result durable before reporting completion and deduplicates stops', async () => {
  let finish!: (uri: string) => void;
  const keep = jest.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  const hook = renderHook(() => useVoiceMemo(keep));
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  act(() => {
    first = hook.result.current.stopRecording();
    second = hook.result.current.stopRecording();
  });
  expect(first).toBe(second);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(mockCopy).toHaveBeenCalled();
  expect(keep).toHaveBeenCalledWith(expect.stringContaining('document/'), 1234);
  expect(hook.result.current.isFinalizing).toBe(true);
  await act(async () => {
    finish('document/scoped/memo.m4a');
    await first;
  });
  expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  expect(hook.result.current.recordingUri).toBe('document/scoped/memo.m4a');
  expect(hook.result.current.isFinalizing).toBe(false);
  // Native polling can still report recording briefly after stop. Cleanup must
  // not finalize a second time and resurrect a just-cleared draft.
  hook.unmount();
  expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  expect(keep).toHaveBeenCalledTimes(1);
});
it('stops and preserves an active recording on unexpected unmount', async () => {
  const keep = jest.fn(async () => 'document/recovered.m4a');
  const hook = renderHook(() => useVoiceMemo(keep));
  await act(async () => {
    hook.unmount();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  expect(keep).toHaveBeenCalled();
});
it('enforces the five-minute native recording limit', async () => {
  mockState.isRecording = false;
  const hook = renderHook(() => useVoiceMemo(jest.fn(async () => 'document/kept.m4a')));
  await act(() => hook.result.current.startRecording());
  expect(mockRecorder.record).toHaveBeenCalledWith({ forDuration: 300 });
});

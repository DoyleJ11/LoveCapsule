import { errorMessage } from '../lib/errors';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  createAudioPlayer,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import type { AudioPlayer } from 'expo-audio';

export interface UseVoiceMemoReturn {
  // Recording
  isRecording: boolean;
  isFinalizing: boolean;
  recordingDurationSecs: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<boolean>;

  // Recorded/loaded audio
  recordingUri: string | null;
  durationMs: number;

  // Playback
  isPlaying: boolean;
  playbackPositionSecs: number;
  playbackDurationSecs: number;
  playAudio: (uri?: string) => void;
  pauseAudio: () => void;
  stopPlayback: () => void;

  // Reset
  resetRecording: () => void;
}

export function useVoiceMemo(
  onRecordingReady?: (uri: string, durationMs: number) => Promise<string | void>
): UseVoiceMemoReturn {
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPositionSecs, setPlaybackPositionSecs] = useState(0);
  const [playbackDurationSecs, setPlaybackDurationSecs] = useState(0);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 100);
  const recordingActive = useRef(recorderState.isRecording);
  const recorderStopped = useRef(false);
  const pendingRecording = useRef<{ uri: string; duration: number } | null>(null);
  const stateRef = useRef(recorderState);
  stateRef.current = recorderState;
  const readyRef = useRef(onRecordingReady);
  readyRef.current = onRecordingReady;
  const mounted = useRef(true);
  const stopping = useRef<Promise<boolean> | null>(null);
  const stopOnUnmount = useRef<() => Promise<boolean>>(async () => true);

  // Imperative player management via refs (avoids useAudioPlayer hook lifecycle issues)
  const playerRef = useRef<AudioPlayer | null>(null);
  const currentSourceRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up on unmount
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recordingActive.current) void stopOnUnmount.current();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (playerRef.current) {
        playerRef.current.pause();
        playerRef.current.release();
        playerRef.current = null;
      }
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Poll playback progress. Only stops when playback was active and then stops.
  const playbackStartedRef = useRef(false);

  const startPolling = useCallback(() => {
    stopPolling();
    playbackStartedRef.current = false;
    pollIntervalRef.current = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      if (p.playing) {
        playbackStartedRef.current = true;
        setIsPlaying(true);
        setPlaybackPositionSecs(p.currentTime);
        setPlaybackDurationSecs(p.duration);
      } else if (playbackStartedRef.current) {
        // Playback was active and has now stopped (finished)
        setIsPlaying(false);
        setPlaybackPositionSecs(0);
        stopPolling();
      }
    }, 100);
  }, [stopPolling]);

  const startRecording = useCallback(async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Microphone permission is required to record voice memos');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      if (recordingActive.current) return;
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: 300 });
      recordingActive.current = true;
      recorderStopped.current = false;
      pendingRecording.current = null;
    } catch (e: unknown) {
      Alert.alert('Error', errorMessage(e) || 'Failed to start recording');
    }
  }, [recorder]);

  const stopRecording = useCallback((): Promise<boolean> => {
    if (stopping.current) return stopping.current;
    if (!recordingActive.current) return Promise.resolve(true);
    if (mounted.current) setIsFinalizing(true);
    const finish = async () => {
      try {
        if (!pendingRecording.current) {
          const duration = Math.max(1, Math.round(stateRef.current.durationMillis));
          if (!recorderStopped.current) {
            await recorder.stop();
            recorderStopped.current = true;
          }
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
          if (!recorder.uri)
            throw new Error('Recording could not be recovered. Please keep the editor open.');
          // Keep a durable copy before leaving the recorder/cache lifecycle.
          const source = new File(recorder.uri);
          const destination = new File(Paths.document, `voicememo_${Date.now()}.m4a`);
          source.copy(destination);
          pendingRecording.current = { uri: destination.uri, duration };
        }
        const { uri, duration } = pendingRecording.current;
        const durableUri = await readyRef.current?.(uri, duration);
        if (mounted.current) {
          setRecordingUri(durableUri || uri);
          setDurationMs(duration);
        }
        recordingActive.current = false;
        pendingRecording.current = null;
        if (durableUri) {
          try {
            const temporary = new File(uri);
            if (temporary.exists) temporary.delete();
          } catch {
            /* Recovery is already durable; cleanup can be retried later. */
          }
        }
        return true;
      } catch (error) {
        if (mounted.current)
          Alert.alert(
            'Recording needs attention',
            error instanceof Error ? error.message : 'Could not keep this voice memo'
          );
        return false;
      } finally {
        stopping.current = null;
        if (mounted.current) setIsFinalizing(false);
      }
    };
    stopping.current = finish();
    return stopping.current;
  }, [recorder]);
  stopOnUnmount.current = stopRecording;
  useEffect(() => {
    if (recordingActive.current && recorderState.durationMillis >= 299900) {
      if (!recorderState.isRecording) recorderStopped.current = true;
      void stopRecording();
    }
  }, [recorderState.durationMillis, recorderState.isRecording, stopRecording]);

  const playAudio = useCallback(
    (uri?: string) => {
      const sourceUri = uri || recordingUri;
      if (!sourceUri) return;

      // If same source and player exists, just resume/replay
      if (currentSourceRef.current === sourceUri && playerRef.current) {
        const p = playerRef.current;
        if (p.currentTime >= p.duration && p.duration > 0) {
          p.seekTo(0);
        }
        p.play();
        setIsPlaying(true);
        startPolling();
        return;
      }

      // Release old player if switching sources
      if (playerRef.current) {
        playerRef.current.pause();
        playerRef.current.release();
        playerRef.current = null;
      }

      // Create new player
      currentSourceRef.current = sourceUri;
      const newPlayer = createAudioPlayer({ uri: sourceUri });
      playerRef.current = newPlayer;

      // Set audio mode and give the player a moment to load, then play.
      setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).then(() => {
        setTimeout(() => {
          const p = playerRef.current;
          if (!p || currentSourceRef.current !== sourceUri) return;
          p.play();
          setIsPlaying(true);
          startPolling();
        }, 150);
      });
    },
    [recordingUri, startPolling]
  );

  const pauseAudio = useCallback(() => {
    playerRef.current?.pause();
    setIsPlaying(false);
    stopPolling();
  }, [stopPolling]);

  const stopPlayback = useCallback(() => {
    playerRef.current?.pause();
    playerRef.current?.seekTo(0);
    setIsPlaying(false);
    setPlaybackPositionSecs(0);
    stopPolling();
  }, [stopPolling]);

  const resetRecording = useCallback(() => {
    // An active/unfinalized recording must go through the durable stop path.
    if (recordingActive.current) return;
    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current.release();
      playerRef.current = null;
    }
    currentSourceRef.current = null;
    stopPolling();
    setRecordingUri(null);
    setDurationMs(0);
    setIsPlaying(false);
    setPlaybackPositionSecs(0);
    setPlaybackDurationSecs(0);
  }, [stopPolling]);

  return {
    isRecording: recorderState.isRecording || recordingActive.current,
    isFinalizing,
    recordingDurationSecs: recorderState.durationMillis / 1000,
    startRecording,
    stopRecording,
    recordingUri,
    durationMs,
    isPlaying,
    playbackPositionSecs,
    playbackDurationSecs,
    playAudio,
    pauseAudio,
    stopPlayback,
    resetRecording,
  };
}

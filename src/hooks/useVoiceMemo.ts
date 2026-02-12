import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';

export interface UseVoiceMemoReturn {
  // Recording
  isRecording: boolean;
  recordingDurationSecs: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;

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

export function useVoiceMemo(): UseVoiceMemoReturn {
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackPositionSecs, setPlaybackPositionSecs] = useState(0);
  const [playbackDurationSecs, setPlaybackDurationSecs] = useState(0);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // useAudioRecorderState polls the recorder and returns reactive state
  // that triggers re-renders when isRecording / durationMillis change
  const recorderState = useAudioRecorderState(recorder, 100);

  const [playerSourceUri, setPlayerSourceUri] = useState<string | null>(null);
  const pendingPlayRef = useRef(false);
  const player = useAudioPlayer(playerSourceUri ?? undefined);

  // Auto-play when player is ready after a source change.
  // Uses a ref to avoid calling setState inside the effect.
  // The polling effect below detects player.playing and updates isPlaying.
  useEffect(() => {
    if (!pendingPlayRef.current || !player) return;
    pendingPlayRef.current = false;
    player.play();
  }, [player]);

  // Track playback state
  useEffect(() => {
    if (!player) return;

    const pollInterval = setInterval(() => {
      if (player.playing) {
        setIsPlaying(true);
        setPlaybackPositionSecs(player.currentTime);
        setPlaybackDurationSecs(player.duration);
      } else {
        if (isPlaying) {
          setIsPlaying(false);
        }
      }
    }, 100);

    return () => clearInterval(pollInterval);
  }, [player, isPlaying]);

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

      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to start recording');
    }
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    try {
      // Capture duration before stopping — recorder.currentTime resets after stop()
      const duration = Math.round(recorderState.durationMillis);
      await recorder.stop();
      const uri = recorder.uri;
      setRecordingUri(uri);
      setDurationMs(duration > 0 ? duration : 1);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to stop recording');
    }
  }, [recorder, recorderState.durationMillis]);

  const playAudio = useCallback(
    (uri?: string) => {
      const sourceUri = uri || recordingUri;
      if (!sourceUri) return;

      setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (playerSourceUri === sourceUri && player) {
        // Same source — just resume or replay
        if (player.currentTime >= player.duration && player.duration > 0) {
          player.seekTo(0);
        }
        player.play();
        setIsPlaying(true);
      } else {
        // New source — set URI and flag; useEffect will auto-play once player is ready
        pendingPlayRef.current = true;
        setPlayerSourceUri(sourceUri);
      }
    },
    [recordingUri, player, playerSourceUri]
  );

  const pauseAudio = useCallback(() => {
    player?.pause();
    setIsPlaying(false);
  }, [player]);

  const stopPlayback = useCallback(() => {
    player?.pause();
    player?.seekTo(0);
    setIsPlaying(false);
    setPlaybackPositionSecs(0);
  }, [player]);

  const resetRecording = useCallback(() => {
    if (recorderState.isRecording) {
      recorder.stop();
    }
    player?.pause();
    setRecordingUri(null);
    setDurationMs(0);
    setIsPlaying(false);
    setPlaybackPositionSecs(0);
    setPlaybackDurationSecs(0);
    setPlayerSourceUri(null);
  }, [recorder, recorderState.isRecording, player]);

  return {
    isRecording: recorderState.isRecording,
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

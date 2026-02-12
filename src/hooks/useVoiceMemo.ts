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
  const recorderState = useAudioRecorderState(recorder, 100);

  // Imperative player management via refs (avoids useAudioPlayer hook lifecycle issues)
  const playerRef = useRef<AudioPlayer | null>(null);
  const currentSourceRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
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

      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to start recording');
    }
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    try {
      const duration = Math.round(recorderState.durationMillis);
      await recorder.stop();

      // Switch audio session out of recording mode and wait for it to complete.
      // On iOS, the M4A file's moov atom (duration metadata) may not be fully
      // written until the audio session transitions out of recording mode.
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const originalUri = recorder.uri;

      // WORKAROUND: expo-audio's recorder on iOS (particularly in the simulator)
      // can write the M4A file with an incomplete moov atom, causing players to
      // read a near-zero duration (~22ms). Copying the file to a new path gives
      // the OS a chance to write a clean copy with correct metadata.
      let uri = originalUri;
      if (originalUri) {
        try {
          const sourceFile = new File(originalUri);
          const destFile = new File(Paths.cache, `voicememo_${Date.now()}.m4a`);
          sourceFile.copy(destFile);
          uri = destFile.uri;
        } catch (copyErr) {
          console.warn('[VoiceMemo] copy failed, using original:', copyErr);
          // Fall back to original URI if copy fails
        }
      }

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
    if (recorderState.isRecording) {
      recorder.stop();
    }
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
  }, [recorder, recorderState.isRecording, stopPolling]);

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

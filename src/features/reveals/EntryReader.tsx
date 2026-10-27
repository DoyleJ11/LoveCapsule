import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  Button,
  ActivityIndicator,
  useColorScheme,
  AppState,
  Linking,
} from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { supabase } from '../../lib/supabase';
import { getSignedUrl } from '../../lib/storage';
import { formatEntryDate, formatDuration } from '../../lib/date-utils';
import { Colors, Spacing } from '../../constants/theme';
import type { Entry, Media } from '../../types/database';

function AudioAttachment({ url, onFailure }: { url: string; onFailure: () => void }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState(false);
  const failed = error || status.playbackState === 'error';
  useEffect(() => {
    if (status.isLoaded) return;
    const timer = setTimeout(() => setError(true), 15000);
    return () => clearTimeout(timer);
  }, [status.isLoaded]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') player.pause();
    });
    return () => subscription.remove();
  }, [player]);
  return (
    <View>
      <Text style={{ color: colors.text }}>
        Voice memo · {formatDuration((status.currentTime || 0) * 1000)} /{' '}
        {formatDuration((status.duration || 0) * 1000)}
      </Text>
      <Button
        title={status.playing ? 'Pause voice memo' : 'Play voice memo'}
        onPress={async () => {
          try {
            if (status.playing) player.pause();
            else {
              await setAudioModeAsync({ playsInSilentMode: true });
              if (status.didJustFinish) await player.seekTo(0);
              player.play();
            }
          } catch {
            setError(true);
          }
        }}
      />
      {failed && <Button title="Reload voice memo" onPress={onFailure} />}
      {!failed && (!status.isLoaded || status.isBuffering) && (
        <ActivityIndicator accessibilityLabel="Loading voice memo" />
      )}
    </View>
  );
}
function Attachment({ media }: { media: Media }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setUrl(null);
    setError(null);
    setAttempt((a) => a + 1);
  }, []);
  useEffect(() => {
    let current = true;
    getSignedUrl(media.storage_path)
      .then((value) => {
        if (current) setUrl(value);
      })
      .catch(() => {
        if (current) setError('Attachment could not be loaded.');
      });
    // Renew before expiry. On an actual download failure retry explicitly,
    // avoiding an endless automatic loop when storage is unavailable.
    const timer = setTimeout(retry, 50 * 60 * 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry();
    });
    return () => {
      current = false;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [media.storage_path, attempt, retry]);
  return (
    <View style={{ marginVertical: Spacing.md }}>
      {error ? (
        <>
          <Text accessibilityRole="alert">{error}</Text>
          <Button title="Retry attachment" onPress={retry} />
        </>
      ) : !url ? (
        <ActivityIndicator accessibilityLabel="Loading attachment" />
      ) : media.media_type === 'image' ? (
        <Image
          accessibilityLabel="Attached photo"
          source={{ uri: url }}
          style={{ width: '100%', height: 300 }}
          resizeMode="contain"
          onError={() => setError('Photo could not be downloaded. Retry to refresh its link.')}
        />
      ) : media.media_type === 'audio' ? (
        <AudioAttachment key={`${url}:${attempt}`} url={url} onFailure={retry} />
      ) : (
        <Button
          title="Open attached video"
          onPress={() => Linking.openURL(url).catch(() => setError('Video could not be opened.'))}
        />
      )}
    </View>
  );
}
/** Shared by new checkpoints, annual libraries and both kinds of history. */
export function EntryReader({ entry }: { entry: Entry }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setMedia([]);
    setError(null);
    (async () => {
      try {
        const { data, error: failure } = await supabase
          .from('media')
          .select('*')
          .eq('entry_id', entry.id)
          .order('created_at');
        if (failure) throw failure;
        if (current) setMedia(data ?? []);
      } catch {
        if (current) setError('Attachments could not be loaded.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [entry.id, attempt]);
  return (
    <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
      <Text style={{ fontSize: 26, fontWeight: '700', color: colors.text }}>
        {entry.title || 'Untitled note'}
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        {formatEntryDate(entry.entry_date)}
        {entry.mood ? ` · ${entry.mood}` : ''}
      </Text>
      {entry.location_name && (
        <Text style={{ color: colors.textSecondary }}>{entry.location_name}</Text>
      )}
      <Text
        selectable
        style={{ fontSize: 18, lineHeight: 28, marginVertical: Spacing.lg, color: colors.text }}
      >
        {entry.content_plain}
      </Text>
      {loading && <ActivityIndicator accessibilityLabel="Loading attachments" />}
      {error && (
        <>
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </Text>
          <Button title="Retry attachments" onPress={() => setAttempt((a) => a + 1)} />
        </>
      )}
      {media.map((item) => (
        <Attachment key={`${item.id}:${item.storage_path}`} media={item} />
      ))}
    </ScrollView>
  );
}

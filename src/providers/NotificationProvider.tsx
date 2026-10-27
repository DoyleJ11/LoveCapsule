import { useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from './AuthProvider';
import { useCouple } from './CoupleProvider';
import {
  Notifications,
  notificationDestination,
  pushOptedIn,
  registerForPushNotifications,
} from '../lib/notifications';
export function NotificationProvider() {
  const { user, profile } = useAuth(),
    { couple, refresh } = useCouple(),
    router = useRouter();
  const seen = useRef(new Set<string>());
  const route = useCallback(
    (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (seen.current.has(id)) return;
      const target = notificationDestination(
        response.notification.request.content.data,
        couple?.id ?? null
      );
      if (user && target) {
        seen.current.add(id);
        router.push(target);
        void refresh();
      }
    },
    [user, couple?.id, router, refresh]
  );
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const allowed =
          !!user &&
          notification.request.content.data.couple_id === couple?.id &&
          (await pushOptedIn(user.id));
        return {
          shouldPlaySound: allowed,
          shouldSetBadge: false,
          shouldShowBanner: allowed,
          shouldShowList: allowed,
        };
      },
    });
    const response = Notifications.addNotificationResponseReceivedListener(route);
    const received = Notifications.addNotificationReceivedListener(() => {
      if (user) void refresh();
    });
    void Notifications.getLastNotificationResponseAsync()
      .then((value) => {
        if (value) route(value);
      })
      .catch(() => {});
    return () => {
      response.remove();
      received.remove();
    };
  }, [route, user, couple?.id, refresh]);
  useEffect(() => {
    if (!user || !profile?.notifications_enabled) return;
    const register = () => {
      void registerForPushNotifications(user.id).catch(() => {});
    };
    register();
    const listener = AppState.addEventListener('change', (s) => {
      if (s === 'active') register();
    });
    const tokens = Notifications.addPushTokenListener(() => {
      register();
    });
    return () => {
      listener.remove();
      tokens.remove();
    };
  }, [user, profile?.notifications_enabled]);
  return null;
}

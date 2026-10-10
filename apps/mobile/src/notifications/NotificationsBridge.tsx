import type { NotifySetting } from "@smarternews/client";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../api/AppProvider";
import { applyNotifySetting, startNotifications } from "./setup";

// While the app is on screen the list itself shows what is new: no banner on top of it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
});

interface NotificationData {
  articleId?: unknown;
  list?: unknown;
}

interface NotifyState {
  /** Null until the stored choice has been read and applied. */
  setting: NotifySetting | null;
  /** True when the user chose notifications and the device did not allow them. */
  refused: boolean;
  choose(next: NotifySetting): Promise<void>;
}

const NotifyContext = createContext<NotifyState | null>(null);

export function useNotify(): NotifyState {
  const value = useContext(NotifyContext);
  if (!value) throw new Error("useNotify needs a NotificationsBridge above it");
  return value;
}

/**
 * Connects notifications to the running app: keeps the periodic check registered as the stored choice says,
 * holds that choice for the settings screen, and goes to the article, or to the unread list, when the user
 * presses a notification. Rendered only while the app is connected.
 */
export function NotificationsBridge({ children }: { children: ReactNode }) {
  const { api } = useApp();
  const router = useRouter();
  const [setting, setSetting] = useState<NotifySetting | null>(null);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let alive = true;
    void startNotifications(api)
      .then((applied) => {
        if (alive) setSetting(applied.setting);
      })
      .catch(() => {
        if (alive) setSetting("off");
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const choose = useCallback(
    async (next: NotifySetting) => {
      const applied = await applyNotifySetting(next, api);
      setSetting(applied.setting);
      setRefused(applied.refused);
    },
    [api],
  );

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const data = (response?.notification.request.content.data ?? {}) as NotificationData;
      if (typeof data.articleId === "number") router.push({ pathname: "/article/[id]", params: { id: String(data.articleId), list: "unread" } });
      else if (data.list === "unread") router.navigate({ pathname: "/list/[key]", params: { key: "unread" } });
    };
    // A press that started the app arrives here once; it is cleared so that it is not acted on again.
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (!last) return;
      void Notifications.clearLastNotificationResponseAsync();
      open(last);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [router]);

  const value = useMemo(() => ({ setting, refused, choose }), [setting, refused, choose]);
  return <NotifyContext.Provider value={value}>{children}</NotifyContext.Provider>;
}

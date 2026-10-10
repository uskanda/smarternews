// What the device remembers about notifications: the user's choice, and how far it has looked.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_NOTIFY_SETTING, type NotifySetting } from "@smarternews/client";

const SETTING_KEY = "smarternews.notify.setting";
const CHECKED_KEY = "smarternews.notify.checkedAt";

/** The user's choice, or the default while none was made. */
export async function loadNotifySetting(): Promise<NotifySetting> {
  const stored = await AsyncStorage.getItem(SETTING_KEY);
  return stored === "important" || stored === "all" || stored === "off" ? stored : DEFAULT_NOTIFY_SETTING;
}

export async function saveNotifySetting(setting: NotifySetting): Promise<void> {
  await AsyncStorage.setItem(SETTING_KEY, setting);
}

/** True once a choice was stored, by the user or because the permission was refused. */
export async function hasNotifySetting(): Promise<boolean> {
  return (await AsyncStorage.getItem(SETTING_KEY)) !== null;
}

/** The update time of the newest article looked at so far, or null before the first look. */
export async function loadCheckedAt(): Promise<string | null> {
  return AsyncStorage.getItem(CHECKED_KEY);
}

export async function saveCheckedAt(checkedAt: string): Promise<void> {
  await AsyncStorage.setItem(CHECKED_KEY, checkedAt);
}

/** Moves the mark forward, never back: articles the user has seen in the app are not notified later. */
export async function advanceCheckedAt(seenUpTo: string): Promise<void> {
  const current = await loadCheckedAt();
  if (current === null || seenUpTo > current) await saveCheckedAt(seenUpTo);
}

export async function clearNotifyState(): Promise<void> {
  await AsyncStorage.multiRemove([SETTING_KEY, CHECKED_KEY]);
}

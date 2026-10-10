// Turning the periodic check on and off to match the user's choice, and asking for the permission it needs.
import type { Api, NotifySetting } from "@smarternews/client";
import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { CHANNEL, runCheck, setBaseline } from "./check";
import { hasNotifySetting, loadCheckedAt, loadNotifySetting, saveNotifySetting } from "./store";

export const CHECK_TASK = "smarternews-check";
/** Android runs the check no more often than this, and when it sees fit. */
const MINIMUM_INTERVAL_MINUTES = 15;

// Defined when this file is loaded, which the root layout does: Android starts the app's code without a screen
// to run the task, and the task has to be known by then.
TaskManager.defineTask(CHECK_TASK, async () => {
  const result = await runCheck();
  return result === "failed" ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
});

async function allowed(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export interface Applied {
  setting: NotifySetting;
  /** True when the user chose notifications and the device did not allow them: the setting is "off" then. */
  refused: boolean;
}

/** Stores the choice and makes the device follow it. */
export async function applyNotifySetting(next: NotifySetting, api: Api): Promise<Applied> {
  if (next === "off") {
    await BackgroundTask.unregisterTaskAsync(CHECK_TASK).catch(() => {});
    await saveNotifySetting("off");
    return { setting: "off", refused: false };
  }
  if (!(await allowed())) {
    await BackgroundTask.unregisterTaskAsync(CHECK_TASK).catch(() => {});
    await saveNotifySetting("off");
    return { setting: "off", refused: true };
  }
  const before = (await hasNotifySetting()) ? await loadNotifySetting() : "off";
  // Coming from "off", or looking for the first time: start from now.
  if (before === "off" || (await loadCheckedAt()) === null) await setBaseline(api);
  await Notifications.setNotificationChannelAsync(CHANNEL, { name: "新着の記事", importance: Notifications.AndroidImportance.DEFAULT });
  await BackgroundTask.registerTaskAsync(CHECK_TASK, { minimumInterval: MINIMUM_INTERVAL_MINUTES });
  await saveNotifySetting(next);
  return { setting: next, refused: false };
}

/**
 * Called once the app is connected. The first time, it applies the default, which asks for the permission;
 * afterwards it only makes sure the check is registered as the stored choice says.
 */
export async function startNotifications(api: Api): Promise<Applied> {
  if (!(await hasNotifySetting())) return applyNotifySetting(await loadNotifySetting(), api);
  const setting = await loadNotifySetting();
  if (setting === "off") return { setting, refused: false };
  if (!(await Notifications.getPermissionsAsync()).granted) return applyNotifySetting("off", api);
  await BackgroundTask.registerTaskAsync(CHECK_TASK, { minimumInterval: MINIMUM_INTERVAL_MINUTES });
  return { setting, refused: false };
}

/** Called when the user disconnects: nothing is checked for a server the app no longer knows. */
export async function stopNotifications(): Promise<void> {
  await BackgroundTask.unregisterTaskAsync(CHECK_TASK).catch(() => {});
}

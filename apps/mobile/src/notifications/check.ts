// One look at the server for new articles, run by Android from time to time while the app is closed. It talks
// to the connected server only, and shows what it finds as notifications made on the device itself.
import { baselineFrom, createApi, minImportanceFor, planNotifications, type Api } from "@smarternews/client";
import * as Notifications from "expo-notifications";
import { loadConnection } from "../connection/store";
import { environment } from "../env";
import { loadCheckedAt, loadNotifySetting, saveCheckedAt } from "./store";

export const CHANNEL = "articles";

/** Nothing that exists on the server now is notified later. */
export async function setBaseline(api: Api): Promise<void> {
  // Only generated articles are notified, so only they are looked at.
  const newest = await api.articles({ origin: "generated", limit: 1, includeEnded: "true" });
  await saveCheckedAt(baselineFrom(newest.items));
}

export type CheckResult = "notified" | "nothing" | "skipped" | "failed";

export async function runCheck(): Promise<CheckResult> {
  const [connection, setting] = await Promise.all([loadConnection(), loadNotifySetting()]);
  if (!connection || setting === "off") return "skipped";
  const api = createApi({ baseUrl: connection.url, fetchImpl: environment().fetchImpl, getToken: () => connection.token, onUnauthorized: () => {} });
  try {
    const checkedAt = await loadCheckedAt();
    if (checkedAt === null) {
      await setBaseline(api);
      return "nothing";
    }
    const [list, categories] = await Promise.all([api.articles({ origin: "generated", unread: "true", minImportance: minImportanceFor(setting), limit: 50 }), api.categories()]);
    const plan = planNotifications({ setting, articles: list.items, checkedAt, categories });
    for (const entry of plan.notifications) {
      await Notifications.scheduleNotificationAsync({
        // The same article replaces its own earlier notification instead of stacking up.
        identifier: entry.kind === "article" ? `article-${entry.articleId}` : "summary",
        content: {
          title: entry.title,
          body: entry.body,
          data: entry.kind === "article" ? { articleId: entry.articleId } : { list: "unread" },
        },
        trigger: { channelId: CHANNEL },
      });
    }
    // Only after everything was shown: a failure before this point leaves the mark where it was.
    await saveCheckedAt(plan.checkedAt);
    return plan.notifications.length > 0 ? "notified" : "nothing";
  } catch {
    return "failed";
  }
}

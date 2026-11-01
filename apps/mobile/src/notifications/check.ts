// One look at the server for new articles and a new digest, run by Android from time to time while the app is
// closed. It talks to the connected server only, and shows what it finds as notifications made on the device
// itself.
import { baselineFrom, createApi, minImportanceFor, planDigestNotification, planNotifications, type Api, type NotifySetting } from "@smarternews/client";
import * as Notifications from "expo-notifications";
import { loadConnection } from "../connection/store";
import { environment } from "../env";
import { loadCheckedAt, loadDigestNotifiedId, loadNotifySetting, saveCheckedAt, saveDigestNotifiedId } from "./store";

export const CHANNEL = "articles";

/** Nothing that exists on the server now is notified later: neither the articles nor the digests. */
export async function setBaseline(api: Api): Promise<void> {
  // Only generated articles are notified, so only they are looked at.
  const newest = await api.articles({ origin: "generated", limit: 1, includeEnded: "true" });
  await saveCheckedAt(baselineFrom(newest.items));
  try {
    const latest = await api.digests({ limit: 1 });
    await saveDigestNotifiedId(latest.items[0]?.id ?? 0);
  } catch {
    // Without a mark the next check records where the digests stand, still without notifying.
    await saveDigestNotifiedId(null);
  }
}

export type CheckResult = "notified" | "nothing" | "skipped" | "failed";

/** Shows the latest digest when it is newer than the one the device knows of. True when it did. */
async function checkDigest(api: Api, setting: NotifySetting): Promise<boolean> {
  const [list, notifiedId] = await Promise.all([api.digests({ limit: 1 }), loadDigestNotifiedId()]);
  const latest = list.items[0];
  const plan = planDigestNotification({ setting, latest: latest ? { id: latest.id, executiveSummary: latest.executiveSummary } : null, notifiedId });
  if (plan.notification) {
    await Notifications.scheduleNotificationAsync({
      // A newer digest replaces the notification of the one before.
      identifier: "digest",
      content: { title: plan.notification.title, body: plan.notification.body, data: { digestId: plan.notification.digestId } },
      trigger: { channelId: CHANNEL },
    });
  }
  await saveDigestNotifiedId(plan.notifiedId);
  return plan.notification !== null;
}

export async function runCheck(): Promise<CheckResult> {
  const [connection, setting] = await Promise.all([loadConnection(), loadNotifySetting()]);
  if (!connection || setting === "off") return "skipped";
  const api = createApi({ baseUrl: connection.url, fetchImpl: environment().fetchImpl, getToken: () => connection.token, onUnauthorized: () => {} });
  let articlesNotified: boolean;
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
    articlesNotified = plan.notifications.length > 0;
  } catch {
    return "failed";
  }
  // The digest is looked at after the articles' mark was saved: a failure here cannot bring those back.
  try {
    const digestNotified = await checkDigest(api, setting);
    return articlesNotified || digestNotified ? "notified" : "nothing";
  } catch {
    return articlesNotified ? "notified" : "failed";
  }
}

import { BEGINNING } from "@smarternews/client";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { prepareDevice, renderApp } from "../testing/app";
import { eventually, MINUTE, rowTitles } from "../testing/queries";
import { makeServer, type TestServer } from "../testing/server";
import { runCheck } from "./check";
import { CHECK_TASK } from "./setup";
import { loadCheckedAt, saveCheckedAt, saveNotifySetting } from "./store";

interface Shown {
  identifier: string;
  content: { title: string; body: string; data: Record<string, unknown> };
}
const notifications = () =>
  (jest.requireMock("expo-notifications") as { __state: { granted: boolean; asked: number; shown: Shown[]; channels: Array<{ id: string; name: string }>; listeners: Array<(r: unknown) => void>; last: unknown } }).__state;
const registered = () => (jest.requireMock("expo-background-task") as { __registered: Map<string, { minimumInterval?: number }> }).__registered;
const tasks = () => (jest.requireMock("expo-task-manager") as { __tasks: Map<string, () => Promise<unknown>> }).__tasks;
const radio = (name: string) => screen.getByRole("radio", { name });
const response = (data: Record<string, unknown>) => ({ notification: { request: { content: { data } } } });

/** A device that is connected, has notifications on, and has looked at the server as it is now. */
async function watching(server: TestServer, setting: "important" | "all" = "important", options: { offline?: () => boolean } = {}) {
  const device = await prepareDevice({ server, ...options });
  await saveNotifySetting(setting);
  await saveCheckedAt(BEGINNING); // nothing existed yet
  await runCheck();
  notifications().shown.length = 0;
  device.requests.length = 0;
  return device;
}

describe("the setting", () => {
  it("is importance 5 only until the user chooses, and asks for the permission once the app is connected", async () => {
    const server = await makeServer();
    await renderApp({ server, url: "/settings" });

    await waitFor(() => expect(radio("重要度5だけ")).toBeChecked());
    expect(radio("AI生成のすべての新着")).not.toBeChecked();
    expect(notifications().asked).toBe(1);
  });

  it("keeps the user's choice after the app is closed and opened", async () => {
    const server = await makeServer();
    const first = await renderApp({ server, url: "/settings" });
    await waitFor(() => expect(radio("重要度5だけ")).toBeChecked());

    await userEvent.setup().press(radio("AI生成のすべての新着"));
    await waitFor(() => expect(radio("AI生成のすべての新着")).toBeChecked());
    await first.unmount();
    await renderApp({ server, url: "/settings" });

    await waitFor(() => expect(radio("AI生成のすべての新着")).toBeChecked());
    expect(notifications().asked).toBe(1);
  });

  it("has the device check from time to time while notifications are on, on a channel named for what it brings", async () => {
    const server = await makeServer();
    await renderApp({ server, url: "/settings" });

    await waitFor(() => expect(registered().get(CHECK_TASK)).toEqual({ minimumInterval: 15 }));
    expect(notifications().channels).toContainEqual(expect.objectContaining({ id: "articles", name: "新着の記事" }));
  });

  it("stops the check when the user chooses none, and starts it again on another choice", async () => {
    const server = await makeServer();
    await renderApp({ server, url: "/settings" });
    await waitFor(() => expect(registered().has(CHECK_TASK)).toBe(true));
    const user = userEvent.setup();

    await user.press(radio("出さない"));
    await waitFor(() => expect(registered().has(CHECK_TASK)).toBe(false));
    await user.press(radio("AI生成のすべての新着"));

    await waitFor(() => expect(registered().has(CHECK_TASK)).toBe(true));
  });

  it("goes back to none and explains the permission when the device refuses it", async () => {
    const server = await makeServer();
    notifications().granted = false;
    await renderApp({ server, url: "/settings" });
    await waitFor(() => expect(radio("出さない")).toBeChecked());

    await userEvent.setup().press(radio("重要度5だけ"));

    expect(await screen.findByText(/通知を出すには、端末の許可が必要です/)).toBeOnTheScreen();
    expect(radio("出さない")).toBeChecked();
    expect(registered().has(CHECK_TASK)).toBe(false);
  });

  it("stops the check when the user disconnects", async () => {
    const server = await makeServer();
    await renderApp({ server, url: "/settings" });
    await waitFor(() => expect(registered().has(CHECK_TASK)).toBe(true));
    const user = userEvent.setup();

    await user.press(screen.getByRole("button", { name: "接続を解除する" }));
    await user.press(await screen.findByRole("button", { name: "解除する" }));

    await screen.findByRole("button", { name: "QRコードを読み取る" });
    expect(registered().has(CHECK_TASK)).toBe(false);
  });
});

describe("the periodic check", () => {
  it("is what Android runs as the registered task", async () => {
    const server = await makeServer();
    const category = await server.category("Security");
    await watching(server);
    await server.advance(MINUTE);
    await server.article(category.id, { title: "Zero-day", importance: 5 });

    await tasks().get(CHECK_TASK)!();

    expect(notifications().shown).toHaveLength(1);
  });

  it("notifies an article of importance 5 with its headline and category, and not one of importance 3", async () => {
    const server = await makeServer();
    const category = await server.category("Security");
    await watching(server);
    await server.advance(MINUTE);
    const urgent = await server.article(category.id, { title: "Zero-day", importance: 5 });
    await server.article(category.id, { title: "Routine", importance: 3 });

    expect(await runCheck()).toBe("notified");

    expect(notifications().shown.map((entry) => entry.content)).toEqual([{ title: "Zero-day", body: "Security", data: { articleId: urgent } }]);
  });

  it("notifies both when set to everything", async () => {
    const server = await makeServer();
    const category = await server.category();
    await watching(server, "all");
    await server.advance(MINUTE);
    await server.article(category.id, { title: "Zero-day", importance: 5 });
    await server.article(category.id, { title: "Routine", importance: 3 });

    await runCheck();

    expect(notifications().shown.map((entry) => entry.content.title).sort()).toEqual(["Routine", "Zero-day"]);
  });

  it("never notifies an article of a subscribed feed, even when set to everything", async () => {
    const server = await makeServer();
    const category = await server.category();
    const feed = await server.feed("Blog", category.id);
    const device = await watching(server, "all");
    await server.advance(MINUTE);
    const now = server.now().toISOString();
    for (let index = 0; index < 20; index += 1) await server.feedArticle(feed.id, { title: `Post ${index}`, at: now });
    await server.article(category.id, { title: "Written", importance: 2 });

    expect(await runCheck()).toBe("notified");

    expect(notifications().shown.map((entry) => entry.content.title)).toEqual(["Written"]);
    // The device does not even ask for feed articles.
    expect(device.requests.filter((request) => request.includes("/articles")).every((request) => request.includes("origin=generated"))).toBe(true);
  });

  it("still notifies a generated article after the user looked at a list of newer feed articles", async () => {
    const server = await makeServer();
    const category = await server.category();
    const feed = await server.feed("Blog");
    await watching(server, "all");
    await server.advance(MINUTE);
    await server.article(category.id, { title: "Written" });
    await server.advance(MINUTE);
    await server.feedArticle(feed.id, { title: "Later post", at: server.now().toISOString() });
    // The user allowed notifications earlier; without this the app would turn them off when it starts.
    notifications().asked = 1;
    const app = await renderApp({ server, url: `/list/feed-${feed.id}` });
    await screen.findByText("Later post");
    await app.unmount();

    await runCheck();

    expect(notifications().shown.map((entry) => entry.content.title)).toEqual(["Written"]);
  });

  it("does not notify an article that was read elsewhere before the check", async () => {
    const server = await makeServer();
    const category = await server.category();
    await watching(server);
    await server.advance(MINUTE);
    await server.core("setArticleFlags", await server.article(category.id, { importance: 5 }), { isRead: true }, "$now");

    expect(await runCheck()).toBe("nothing");
    expect(notifications().shown).toEqual([]);
  });

  it("does not notify the same article twice, and does notify it again after a follow-up updated it", async () => {
    const server = await makeServer();
    const category = await server.category();
    await watching(server);
    await server.advance(MINUTE);
    const id = await server.article(category.id, { title: "Zero-day", importance: 5 });

    await runCheck();
    await runCheck();
    expect(notifications().shown).toHaveLength(1);

    await server.advance(MINUTE);
    await server.sql("UPDATE articles SET revision = 1, updated_at = ?, is_read = 0 WHERE id = ?", server.now().toISOString(), id);
    await runCheck();

    expect(notifications().shown).toHaveLength(2);
    expect(notifications().shown[1]!.identifier).toBe(notifications().shown[0]!.identifier);
  });

  it("does not notify what was there before notifications were turned on", async () => {
    const server = await makeServer();
    const category = await server.category();
    for (const title of ["Old 1", "Old 2", "Old 3"]) await server.article(category.id, { title, importance: 5 });
    await renderApp({ server, url: "/settings" });
    const user = userEvent.setup();
    await waitFor(() => expect(radio("重要度5だけ")).toBeChecked());
    await user.press(radio("出さない"));
    await waitFor(() => expect(radio("出さない")).toBeChecked());
    await server.advance(MINUTE);
    await server.article(category.id, { title: "While off", importance: 5 });

    await user.press(radio("重要度5だけ"));
    await waitFor(() => expect(radio("重要度5だけ")).toBeChecked());
    await runCheck();
    expect(notifications().shown).toEqual([]);

    await server.advance(MINUTE);
    await server.article(category.id, { title: "After", importance: 5 });
    await runCheck();

    expect(notifications().shown.map((entry) => entry.content.title)).toEqual(["After"]);
  });

  it("gives three articles a notification each, and folds six into one with the count and the top headline", async () => {
    const server = await makeServer();
    const category = await server.category();
    await watching(server, "all");
    await server.advance(MINUTE);
    for (const title of ["A", "B", "C"]) await server.article(category.id, { title });
    await runCheck();
    expect(notifications().shown).toHaveLength(3);

    notifications().shown.length = 0;
    await server.advance(MINUTE);
    for (let index = 0; index < 5; index += 1) await server.article(category.id, { title: `More ${index}`, importance: 3 });
    await server.article(category.id, { title: "Critical", importance: 5 });
    await runCheck();

    expect(notifications().shown.map((entry) => entry.content)).toEqual([{ title: "新着の記事が6件あります", body: "Critical", data: { list: "unread" } }]);
  });

  it("shows nothing when the server cannot be reached, and catches up on the next check that gets through", async () => {
    const server = await makeServer();
    const category = await server.category();
    let down = false;
    await watching(server, "important", { offline: () => down });
    const before = await loadCheckedAt();
    await server.advance(MINUTE);
    await server.article(category.id, { title: "While away", importance: 5 });

    down = true;
    expect(await runCheck()).toBe("failed");
    expect(notifications().shown).toEqual([]);
    expect(await loadCheckedAt()).toBe(before);

    down = false;
    await runCheck();
    expect(notifications().shown.map((entry) => entry.content.title)).toEqual(["While away"]);
  });

  it("sends no request at all while notifications are off", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { importance: 5 });
    const device = await prepareDevice({ server });
    await saveNotifySetting("off");

    expect(await runCheck()).toBe("skipped");
    expect(device.requests).toEqual([]);
  });

  it("talks to the connected server only", async () => {
    const server = await makeServer();
    const category = await server.category();
    const device = await watching(server, "all");
    await server.advance(MINUTE);
    await server.article(category.id, { title: "Zero-day", importance: 5 });

    await runCheck();

    expect(notifications().shown).toHaveLength(1);
    expect(device.requests.length).toBeGreaterThan(0);
    // The address of the connected server was cut off when the request was recorded: nothing else may remain.
    for (const request of device.requests) expect(request).toMatch(/^GET \/api\/v1\//);
  });

  it("does not notify an article that the user already saw in the list of the app", async () => {
    const server = await makeServer();
    const category = await server.category();
    await watching(server, "all");
    await server.advance(MINUTE);
    await server.article(category.id, { title: "Seen in the app" });
    // The user allowed notifications earlier; without this the app would turn them off when it starts, and
    // the check below would show nothing for that reason alone.
    notifications().asked = 1;
    const app = await renderApp({ server });
    await waitFor(() => expect(rowTitles()).toEqual(["Seen in the app"]));
    await eventually(async () => expect(await loadCheckedAt()).not.toBe(BEGINNING));
    await app.unmount();

    expect(await runCheck()).toBe("nothing");

    expect(notifications().shown).toEqual([]);
  });
});

describe("pressing a notification", () => {
  it("opens the article it is about", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "Zero-day", importance: 5 });
    await renderApp({ server });
    await screen.findByText("Zero-day");
    await waitFor(() => expect(notifications().listeners.length).toBeGreaterThan(0));

    await act(async () => notifications().listeners.forEach((listener) => listener(response({ articleId: id }))));

    expect(await screen.findByRole("header", { name: "Zero-day" })).toBeOnTheScreen();
  });

  it("opens the unread list from a notification that stands for several articles", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "One of six" });
    await renderApp({ server, url: "/settings" });
    await screen.findByRole("header", { name: "設定" });
    await waitFor(() => expect(notifications().listeners.length).toBeGreaterThan(0));

    await act(async () => notifications().listeners.forEach((listener) => listener(response({ list: "unread" }))));

    expect(await screen.findByRole("header", { name: "未読" })).toBeOnTheScreen();
    expect(await screen.findByText("One of six")).toBeOnTheScreen();
  });

  it("opens the article when the press is what started the app", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "Zero-day", importance: 5 });
    notifications().last = response({ articleId: id });

    await renderApp({ server });

    expect(await screen.findByRole("header", { name: "Zero-day" })).toBeOnTheScreen();
  });
});

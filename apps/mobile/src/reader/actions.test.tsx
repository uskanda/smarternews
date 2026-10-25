import { act, fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { renderApp } from "../testing/app";
import { eventually, listData, MINUTE, rowTitles } from "../testing/queries";
import { makeServer, type ArticleOverrides, type TestServer } from "../testing/server";

async function articles(server: TestServer, categoryId: number, list: ArticleOverrides[]): Promise<number[]> {
  const ids: number[] = [];
  for (const overrides of list) {
    ids.push(await server.article(categoryId, overrides));
    await server.advance(MINUTE);
  }
  return ids;
}

const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
const article = (server: TestServer, id: number) => server.core<{ isRead: boolean; starred: boolean }>("getArticle", id);
const label = (name: RegExp) => String(screen.getByRole("button", { name }).props.accessibilityLabel);

describe("swiping a row", () => {
  it("marks an unread article as read without opening it", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "Skim" });
    await renderApp({ server });
    await screen.findByText("Skim");

    await fireEvent(screen.getByTestId(`row-${id}`), "swipeableOpen", "right");

    await eventually(async () => expect((await article(server, id)).isRead).toBe(true));
    expect(screen.queryByRole("header", { name: "Skim" })).toBeNull();
    await waitFor(() => expect(label(/Skim/)).toMatch(/既読$/));
  });

  it("puts a read article back to unread", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "Again" });
    await server.core("setArticleFlags", id, { isRead: true }, "$now");
    await renderApp({ server, url: "/list/all" });
    await screen.findByText("Again");

    await fireEvent(screen.getByTestId(`row-${id}`), "swipeableOpen", "right");

    await eventually(async () => expect((await article(server, id)).isRead).toBe(false));
  });

  it("offers the same change to people who cannot swipe, as an action of the row", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "Skim" });
    await renderApp({ server });
    const row = await screen.findByRole("button", { name: /Skim/ });

    expect(row.props.accessibilityActions).toEqual([{ name: "toggleRead", label: "既読にする" }]);
    await fireEvent(row, "accessibilityAction", { nativeEvent: { actionName: "toggleRead" } });

    await eventually(async () => expect((await article(server, id)).isRead).toBe(true));
  });
});

describe("pressing a row for long", () => {
  beforeEach(() => (WebBrowser.openBrowserAsync as jest.Mock).mockClear());

  it("offers the star, the read state and the source, and adds a star from there", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "Keep", refs: ["https://example.org/keep"] });
    await renderApp({ server });
    const user = userEvent.setup();

    await user.longPress(await screen.findByRole("button", { name: /Keep/ }));
    expect(await screen.findByRole("button", { name: "既読にする" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "出典を開く" })).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "スターを付ける" }));

    await eventually(async () => expect((await article(server, id)).starred).toBe(true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "スターを付ける" })).toBeNull());
    await press("項目を開く");
    await press("スター");
    await waitFor(() => expect(rowTitles()).toEqual(["Keep"]));
  });

  it("opens the source from there", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "Keep", refs: ["https://example.org/keep"] });
    await renderApp({ server });
    const user = userEvent.setup();

    await user.longPress(await screen.findByRole("button", { name: /Keep/ }));
    await user.press(await screen.findByRole("button", { name: "出典を開く" }));

    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://example.org/keep");
  });
});

// The undo is offered for ten seconds. The test watches the timers that are set and runs that one by hand,
// while every other timer, and the socket to the server, stays real.
let timeouts: jest.SpyInstance<ReturnType<typeof setTimeout>, Parameters<typeof setTimeout>>;
const LONG = 5_000;
const toastDelays = () => timeouts.mock.calls.map(([, delay]) => delay).filter((delay) => typeof delay === "number" && delay >= LONG);
const runToastTimers = () =>
  timeouts.mock.calls.filter(([, delay]) => typeof delay === "number" && delay >= LONG && delay < 60_000).forEach(([callback]) => (callback as () => void)());

describe("marking everything as read", () => {
  beforeEach(() => {
    timeouts = jest.spyOn(globalThis, "setTimeout");
  });
  afterEach(() => timeouts.mockRestore());

  it("marks what the list showed, but not an article that arrived after the list was loaded", async () => {
    const server = await makeServer();
    const category = await server.category();
    const listed = await articles(server, category.id, [{ title: "One" }, { title: "Two" }]);
    await renderApp({ server });
    await screen.findByText("Two");
    const late = await server.article(category.id, { title: "Arrived later" });

    await press("すべて既読にする");

    await eventually(async () => expect(await Promise.all(listed.map(async (id) => (await article(server, id)).isRead))).toEqual([true, true]));
    expect((await article(server, late)).isRead).toBe(false);
    expect(await screen.findByText("2件を既読にしました")).toBeOnTheScreen();
  });

  it("marks only what the importance filter shows", async () => {
    const server = await makeServer();
    const [low, high] = await articles(server, (await server.category()).id, [{ title: "Routine", importance: 3 }, { title: "Urgent", importance: 5 }]);
    await renderApp({ server, url: "/list/unread?min=4" });
    await waitFor(() => expect(rowTitles()).toEqual(["Urgent"]));

    await press("すべて既読にする");

    await eventually(async () => expect((await article(server, high!)).isRead).toBe(true));
    expect((await article(server, low!)).isRead).toBe(false);
  });

  it("is undone on request: what it marked is unread again, what was read before stays read", async () => {
    const server = await makeServer();
    const category = await server.category();
    const before = await server.article(category.id, { title: "Read before" });
    await server.core("setArticleFlags", before, { isRead: true }, "$now");
    const ids = await articles(server, category.id, [{ title: "One" }, { title: "Two" }]);
    await renderApp({ server });
    await screen.findByText("Two");

    await press("すべて既読にする");
    await press("取り消す");

    await eventually(async () => expect(await Promise.all(ids.map(async (id) => (await article(server, id)).isRead))).toEqual([false, false]));
    expect((await article(server, before)).isRead).toBe(true);
    await waitFor(() => expect(rowTitles()).toEqual(["Two", "One"]));
  });

  it("offers the undo for ten seconds and no longer", async () => {
    const server = await makeServer();
    await articles(server, (await server.category()).id, [{ title: "One" }]);
    await renderApp({ server });
    await screen.findByText("One");

    await press("すべて既読にする");
    expect(await screen.findByRole("button", { name: "取り消す" })).toBeOnTheScreen();
    expect(toastDelays()).toContain(10_000);

    // The ten seconds pass at once: the timer that was set for them is run by hand.
    await act(async () => runToastTimers());
    expect(screen.queryByRole("button", { name: "取り消す" })).toBeNull();
  });

  it("takes the undo away when the user moves to another screen", async () => {
    const server = await makeServer();
    const category = await server.category();
    await articles(server, category.id, [{ title: "One" }]);
    await renderApp({ server });
    await screen.findByText("One");
    await press("すべて既読にする");
    await screen.findByRole("button", { name: "取り消す" });

    await press("項目を開く");
    await press("設定");

    await screen.findByRole("header", { name: "設定" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "取り消す" })).toBeNull());
  });

  it("is not offered where it would hide what the user came to see", async () => {
    const server = await makeServer();
    await articles(server, (await server.category()).id, [{ title: "One" }]);
    await renderApp({ server, url: "/list/all" });
    await screen.findByText("One");

    expect(screen.queryByRole("button", { name: "すべて既読にする" })).toBeNull();
  });
});

describe("events", () => {
  const HOUR = 60 * MINUTE;
  const event = (startsAt: string, endsAt: string, extra: Record<string, unknown> = {}) => ({
    name: "event",
    startsAt,
    endsAt,
    venue: null,
    fee: null,
    registration: "unknown",
    ...extra,
  });

  async function setup() {
    const server = await makeServer("2026-03-01T12:00:00.000Z");
    const category = await server.category("Local events", "event");
    await server.article(category.id, { kind: "event", title: "Ended yesterday", event: event("2026-02-28T10:00:00.000Z", "2026-02-28T12:00:00.000Z") });
    await server.article(category.id, { kind: "event", title: "In three days", event: event("2026-03-04T10:00:00.000Z", "2026-03-04T12:00:00.000Z") });
    await server.article(category.id, { kind: "event", title: "Tomorrow evening", event: event("2026-03-02T18:00:00.000Z", "2026-03-02T20:00:00.000Z") });
    await server.article(category.id, {
      kind: "event",
      title: "Tomorrow morning",
      event: event("2026-03-02T09:00:00.000Z", "2026-03-02T11:00:00.000Z", { venue: "Town hall", fee: "500円", registration: "required" }),
    });
    void HOUR;
    return server;
  }

  it("groups the events that have not ended by day, soonest first, and leaves out the ones that have ended", async () => {
    const server = await setup();
    await renderApp({ server, url: "/list/category-1" });

    await screen.findByText("Tomorrow morning");
    const order = screen.getAllByRole("button", { name: /Tomorrow|In three days|Ended/ }).map((node) => String(node.props.accessibilityLabel).split("。")[0]);
    expect(order).toEqual(["Tomorrow morning", "Tomorrow evening", "In three days"]);
    expect(screen.getByRole("header", { name: "3月2日 月曜日" })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "3月4日 水曜日" })).toBeOnTheScreen();
    expect(screen.queryByText("Ended yesterday")).toBeNull();
  });

  it("shows the time, the venue, the fee and whether to sign up on a row", async () => {
    const server = await setup();
    await renderApp({ server, url: "/list/category-1" });

    expect(await screen.findByRole("button", { name: "Tomorrow morning。09:00 から 11:00。Town hall。500円。要申込。未読" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Tomorrow evening。18:00 から 20:00。未読" })).toBeOnTheScreen();
  });

  it("opens an event like any article, with its date and venue above the body", async () => {
    const server = await setup();
    await renderApp({ server, url: "/list/category-1" });

    await press(/^Tomorrow morning/);

    expect(await screen.findByRole("header", { name: "Tomorrow morning" })).toBeOnTheScreen();
    expect(screen.getByLabelText("日時 3月2日 月曜日 09:00 から 11:00")).toBeOnTheScreen();
    expect(screen.getByLabelText("会場 Town hall")).toBeOnTheScreen();
    expect(screen.getByLabelText("申込 要申込")).toBeOnTheScreen();
  });

  it("offers neither the filters nor marking everything as read on the event list", async () => {
    const server = await setup();
    await renderApp({ server, url: "/list/category-1" });
    await screen.findByText("Tomorrow morning");

    expect(screen.queryByRole("switch", { name: "重要度4以上だけ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "すべて既読にする" })).toBeNull();
  });
});

describe("moving on after marking all as read", () => {
  /** A holds an article and the feeds X and Y; B has nothing unread; C holds an article. */
  async function seeded(advance: boolean) {
    const server = await makeServer();
    await server.core("updateSettings", { advanceAfterMarkAll: advance });
    const a = await server.category("A");
    await server.category("B");
    const c = await server.category("C");
    await server.article(a.id, { title: "About A" });
    await server.article(c.id, { title: "About C" });
    const x = await server.feed("X", a.id);
    const y = await server.feed("Y", a.id);
    await server.feedArticle(x.id, { title: "From X" });
    await server.feedArticle(y.id, { title: "From Y" });
    // The list is read a moment after the last article is stored, as it is on a server: marking it all covers them all.
    await server.advance(1);
    return { server, a, c, x, y };
  }

  it("opens the next category below that has unread articles", async () => {
    const { server, a } = await seeded(true);
    await renderApp({ server, url: `/list/category-${a.id}` });
    await screen.findByText("From X");

    await press("すべて既読にする");

    expect(await screen.findByRole("header", { name: "C" })).toBeOnTheScreen();
    expect(await screen.findByText("About C")).toBeOnTheScreen();
  });

  it("opens the next feed below, and can still be undone", async () => {
    const { server, x } = await seeded(true);
    await renderApp({ server, url: `/list/feed-${x.id}` });
    await screen.findByText("From X");

    await press("すべて既読にする");
    expect(await screen.findByRole("header", { name: "Y" })).toBeOnTheScreen();

    await press("取り消す");
    await eventually(async () => expect((await server.core<{ unread: number }>("getCounts", server.now().toISOString())).unread).toBe(4));
  });

  it("stays when the setting is off, and on the views at the top", async () => {
    const off = await seeded(false);
    const first = await renderApp({ server: off.server, url: `/list/category-${off.a.id}` });
    await screen.findByText("From X");
    await press("すべて既読にする");
    expect(await screen.findByText("3件を既読にしました")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "A" })).toBeOnTheScreen();
    first.unmount();

    const on = await seeded(true);
    await renderApp({ server: on.server });
    await screen.findByText("From X");
    await press("すべて既読にする");
    expect(await screen.findByText("4件を既読にしました")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "未読" })).toBeOnTheScreen();
  });
});

describe("putting back to unread in the recently read articles", () => {
  /** Three articles of Tools read at 10:00 by mark all as read. */
  async function readMistakenly() {
    const server = await makeServer("2026-03-02T08:00:00.000Z");
    const tools = await server.category("Tools");
    const ids = await articles(server, tools.id, [{ title: "Tools 1" }, { title: "Tools 2" }, { title: "Tools 3" }]);
    await server.advance(117 * MINUTE);
    await server.core("markArticlesRead", { categoryId: tools.id, before: server.now().toISOString() }, "$now");
    await renderApp({ server, url: "/list/recently-read" });
    await screen.findByText("Tools 2");
    return { server, ids };
  }
  const isUnread = (name: RegExp) => expect(label(name)).toMatch(/未読$/);
  const pull = async () => {
    const { refreshControl } = screen.getByTestId("article-list").props as { refreshControl: { props: { onRefresh: () => void } } };
    await act(async () => refreshControl.props.onRefresh());
  };
  async function keptThenDropped(server: TestServer, id: number) {
    await eventually(async () => expect((await article(server, id)).isRead).toBe(false));
    await waitFor(() => isUnread(/Tools 2/));
    expect(rowTitles()).toEqual(["Tools 3", "Tools 2", "Tools 1"]);
    expect(label(/Tools 2/)).toContain("。10:00。");

    await pull();
    await waitFor(() => expect(rowTitles()).toEqual(["Tools 3", "Tools 1"]));
  }

  it("keeps a row swiped back to unread where it was until the list is pulled", async () => {
    const { server, ids } = await readMistakenly();
    await fireEvent(screen.getByTestId(`row-${ids[1]}`), "swipeableOpen", "right");
    await keptThenDropped(server, ids[1]!);
  });

  it("keeps a row put back to unread from the long press menu", async () => {
    const { server, ids } = await readMistakenly();
    const user = userEvent.setup();
    await user.longPress(screen.getByRole("button", { name: /Tools 2/ }));
    await user.press(await screen.findByRole("button", { name: "未読に戻す" }));
    await keptThenDropped(server, ids[1]!);
  });

  it("keeps a row put back to unread on the article screen", async () => {
    const { server, ids } = await readMistakenly();
    await press(/Tools 2/);
    await screen.findByRole("header", { name: "Tools 2" });
    await press("未読に戻す");
    await eventually(async () => expect((await article(server, ids[1]!)).isRead).toBe(false));
    await press("一覧へ戻る");
    await keptThenDropped(server, ids[1]!);
  });
});

describe("marking everything as read in a list oldest first", () => {
  it("marks all 120 articles of which 50 are loaded, and not one that came after", async () => {
    const server = await makeServer();
    const category = await server.category();
    for (let index = 0; index < 120; index += 1) {
      await server.article(category.id, { title: `Story ${index}` });
      await server.advance(MINUTE);
    }
    await server.core("updateListView", `category-${category.id}`, { sort: "oldest" });
    await renderApp({ server, url: `/list/category-${category.id}` });
    await waitFor(() => expect(rowTitles()[0]).toBe("Story 0"));
    expect(listData()).toHaveLength(50);
    await server.advance(MINUTE);
    const late = await server.article(category.id, { title: "Arrived late" });

    await press("すべて既読にする");

    expect(await screen.findByText("120件を既読にしました")).toBeOnTheScreen();
    expect((await server.core<{ unread: number }>("getCounts", server.now().toISOString())).unread).toBe(1);
    expect((await article(server, late)).isRead).toBe(false);
  });
});

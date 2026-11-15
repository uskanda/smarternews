import { createSavedSearch, listSavedSearches, setArticleFlags } from "@smarternews/core";
import { seedFeed, seedFeedArticle } from "@smarternews/core/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const MINUTE = 60_000;
const nav = () => screen.getByRole("navigation", { name: "項目" });
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const rowTitles = () => within(list()).queryAllByRole("listitem").map((item) => item.querySelector("[data-title]")?.textContent);
const named = (name: string) => new RegExp(`^${name}\\s*\\d*$`);
const entry = (name: string) => within(nav()).queryByRole("link", { name: named(name) });
const savedList = () => screen.getByRole("list", { name: "保存した検索" });
const savedNames = () => within(savedList()).getAllByRole("link").map((link) => link.textContent!.replace(/\d+$/, "").trim());
const q = (text: string) => encodeURIComponent(text);

/** Articles about batteries, one of them read, in category Alpha and a feed of it, and one about something else. */
function seeded(): { server: TestServer; feed: number; ids: Record<string, number> } {
  const server = makeServer();
  const alpha = server.category("Alpha");
  const ids: Record<string, number> = {};
  ids.old = server.article(alpha.id, { title: "電池の古い話", summary: "要約" });
  server.clock.advance(MINUTE);
  ids.read = server.article(alpha.id, { title: "電池の既読の話", summary: "要約" });
  setArticleFlags(server.db, ids.read, { isRead: true }, server.clock().toISOString());
  server.clock.advance(MINUTE);
  const feed = seedFeed(server.db, { categoryId: alpha.id, title: "Battery Feed" });
  ids.feed = seedFeedArticle(server.db, feed, { title: "新しい電池の工場", at: server.clock().toISOString() });
  server.clock.advance(MINUTE);
  ids.other = server.article(alpha.id, { title: "関係のない話", summary: "要約" });
  return { server, feed, ids };
}

const save = (server: TestServer, name: string, query: string, narrowing: { categoryId?: number; feedId?: number } = {}) =>
  createSavedSearch(server.db, { name, query, ...narrowing }, server.clock);

describe("saved searches in the left pane", () => {
  it("are listed under their heading between the views and the categories, with their unread counts", async () => {
    const { server } = seeded();
    save(server, "電池", "電池");
    save(server, "なし", "存在しない語");
    renderApp({ server });

    await waitFor(() => expect(entry("電池")).toHaveTextContent("2"));
    expect(savedNames()).toEqual(["電池", "なし"]);
    expect(entry("なし")).not.toHaveTextContent(/\d/);
    const heading = within(nav()).getByRole("heading", { name: "保存した検索" });
    const digests = within(nav()).getByRole("link", { name: "ダイジェスト" });
    const categories = within(nav()).getByRole("heading", { name: "カテゴリ" });
    expect(digests.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(categories) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leave out their heading when there are none", async () => {
    renderApp({ server: seeded().server });
    await within(nav()).findByRole("heading", { name: "カテゴリ" });
    expect(within(nav()).queryByRole("heading", { name: "保存した検索" })).not.toBeInTheDocument();
  });

  it("are hidden without unread articles while the read entries are hidden, but not the one that is open", async () => {
    window.localStorage.setItem("smarternews.nav.hideRead", "on");
    const { server } = seeded();
    save(server, "電池", "電池");
    const none = save(server, "なし", "存在しない語");
    const { user, path } = renderApp({ server, route: `/s/${none.id}` });

    await waitFor(() => expect(entry("電池")).toHaveTextContent("2"));
    expect(entry("なし")).toBeInTheDocument();
    await user.click(entry("電池")!);
    await waitFor(() => expect(path()).not.toBe(`/s/${none.id}`));
    await waitFor(() => expect(entry("なし")).not.toBeInTheDocument());
  });

  it("are passed through with Shift+J and Shift+K, between the views and the categories", async () => {
    const { server } = seeded();
    const first = save(server, "電池", "電池");
    const second = save(server, "工場", "工場");
    const { user, path } = renderApp({ server, route: "/annotations" });
    await waitFor(() => expect(entry("工場")).toBeInTheDocument());

    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toBe(`/s/${first.id}`));
    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toBe(`/s/${second.id}`));
    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toBe("/c/alpha"));
    await user.keyboard("{Shift>}K{/Shift}");
    await waitFor(() => expect(path()).toBe(`/s/${second.id}`));
  });
});

describe("the list of a saved search", () => {
  it("shows the unread results under the name of the search, and the read ones on request", async () => {
    const { server } = seeded();
    const saved = save(server, "電池の話題", "電池");
    const { user } = renderApp({ server, route: `/s/${saved.id}` });

    await screen.findByRole("heading", { level: 1, name: "電池の話題" });
    await waitFor(() => expect(rowTitles()).toEqual(["新しい電池の工場", "電池の古い話"]));
    expect(within(nav()).getByRole("link", { name: named("電池の話題") })).toHaveAttribute("aria-current", "page");

    await user.click(within(list()).getByRole("checkbox", { name: "既読も表示" }));
    await waitFor(() => expect(rowTitles()).toEqual(["新しい電池の工場", "電池の既読の話", "電池の古い話"]));
  });

  it("keeps to the feed it is narrowed to", async () => {
    const { server, feed } = seeded();
    const saved = save(server, "フィードの電池", "電池", { feedId: feed });
    renderApp({ server, route: `/s/${saved.id}` });
    await waitFor(() => expect(rowTitles()).toEqual(["新しい電池の工場"]));
  });

  it("offers no mark all as read, no importance toggle and no order menu", async () => {
    const { server } = seeded();
    const saved = save(server, "電池", "電池");
    renderApp({ server, route: `/s/${saved.id}` });
    await waitFor(() => expect(rowTitles()).toHaveLength(2));
    expect(within(list()).queryByRole("button", { name: "すべて既読にする" })).not.toBeInTheDocument();
    expect(within(list()).queryByRole("checkbox", { name: "重要度4以上だけ" })).not.toBeInTheDocument();
    expect(within(list()).queryByRole("button", { name: /並び順/ })).not.toBeInTheDocument();
  });

  it("says so when the saved search is gone", async () => {
    const { server } = seeded();
    renderApp({ server, route: "/s/999" });
    expect(await screen.findByText("この保存した検索はありません。")).toBeInTheDocument();
  });
});

describe("saving a search", () => {
  it("saves the words and the narrowing under the name given, the words by default, and not unread only", async () => {
    const { server, feed } = seeded();
    const { user } = renderApp({ server, route: `/search?q=${q("電池")}&feed=${feed}&unread=true` });
    await screen.findByRole("heading", { level: 1, name: "「電池」の検索結果" });

    await user.click(within(list()).getByRole("button", { name: "検索を保存" }));
    const dialog = await screen.findByRole("dialog", { name: "検索を保存" });
    expect(within(dialog).getByRole("textbox", { name: "名前" })).toHaveValue("電池");
    await user.click(within(dialog).getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(listSavedSearches(server.db)).toEqual([{ id: expect.any(Number), name: "電池", query: "電池", categoryId: null, feedId: feed }]));
    await waitFor(() => expect(entry("電池")).toHaveTextContent("1"));
    expect(screen.queryByRole("dialog", { name: "検索を保存" })).not.toBeInTheDocument();
  });

  it("takes another name", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server, route: `/search?q=${q("電池")}` });
    await screen.findByRole("heading", { level: 1, name: "「電池」の検索結果" });

    await user.click(within(list()).getByRole("button", { name: "検索を保存" }));
    const field = within(await screen.findByRole("dialog", { name: "検索を保存" })).getByRole("textbox", { name: "名前" });
    await user.clear(field);
    await user.type(field, "電池の話題{Enter}");

    await waitFor(() => expect(listSavedSearches(server.db).map((saved) => saved.name)).toEqual(["電池の話題"]));
  });

  it("cannot be done without words", async () => {
    renderApp({ server: seeded().server, route: "/search" });
    await screen.findByRole("heading", { level: 1, name: "検索" });
    expect(within(list()).getByRole("button", { name: "検索を保存" })).toBeDisabled();
  });
});

describe("the menu of a saved search", () => {
  const openMenu = async (name: string) => {
    fireEvent.contextMenu(entry(name)!);
    return screen.findByRole("menu");
  };

  it("offers renaming, moving and deleting", async () => {
    const { server } = seeded();
    save(server, "電池", "電池");
    save(server, "工場", "工場");
    renderApp({ server });
    await waitFor(() => expect(entry("電池")).toBeInTheDocument());
    const menu = await openMenu("電池");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["名前を変更", "上へ移動", "下へ移動", "削除"]);
    expect(within(menu).getByRole("menuitem", { name: "上へ移動" })).toHaveAttribute("data-disabled");
  });

  it("renames the saved search", async () => {
    const { server } = seeded();
    save(server, "電池", "電池");
    const { user } = renderApp({ server });
    await waitFor(() => expect(entry("電池")).toBeInTheDocument());

    await user.click(within(await openMenu("電池")).getByRole("menuitem", { name: "名前を変更" }));
    const field = within(await screen.findByRole("dialog", { name: "名前を変更" })).getByRole("textbox", { name: "名前" });
    expect(field).toHaveValue("電池");
    await user.clear(field);
    await user.type(field, "電池の話題{Enter}");

    await waitFor(() => expect(savedNames()).toEqual(["電池の話題"]));
    expect(listSavedSearches(server.db).map((saved) => saved.name)).toEqual(["電池の話題"]);
  });

  it("moves it down", async () => {
    const { server } = seeded();
    save(server, "電池", "電池");
    save(server, "工場", "工場");
    const { user } = renderApp({ server });
    await waitFor(() => expect(entry("工場")).toBeInTheDocument());

    await user.click(within(await openMenu("電池")).getByRole("menuitem", { name: "下へ移動" }));

    await waitFor(() => expect(savedNames()).toEqual(["工場", "電池"]));
    await waitFor(() => expect(listSavedSearches(server.db).map((saved) => saved.name)).toEqual(["工場", "電池"]));
  });

  it("deletes it once asked, and leaves its list when it was open", async () => {
    const { server } = seeded();
    const saved = save(server, "電池", "電池");
    const { user, path } = renderApp({ server, route: `/s/${saved.id}` });
    await screen.findByRole("heading", { level: 1, name: "電池" });

    await user.click(within(await openMenu("電池")).getByRole("menuitem", { name: "削除" }));
    const dialog = await screen.findByRole("alertdialog", { name: "保存した検索を削除しますか" });
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(listSavedSearches(server.db)).toEqual([]));
    await waitFor(() => expect(path()).toBe("/unread"));
    expect(within(nav()).queryByRole("heading", { name: "保存した検索" })).not.toBeInTheDocument();
  });
});

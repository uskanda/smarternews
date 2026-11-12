import { createTopic, insertFeed, recordFetchFailure, requestFetchAll, resolvePricing, setArticleFlags, updateCategory, updateFeed, updateSettings } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { API_TOKEN } from "@smarternews/server/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const nav = () => screen.getByRole("navigation", { name: "項目" });
const list = () => screen.getByRole("region", { name: "記事の一覧" });

describe("the token screen", () => {
  it("asks for the token on a first visit and shows no articles", async () => {
    const server = makeServer();
    server.article(server.category().id, { title: "Hidden story" });
    renderApp({ server, token: null });

    expect(await screen.findByLabelText("APIのトークン")).toBeInTheDocument();
    expect(screen.getByText(/token api/)).toBeInTheDocument();
    expect(screen.queryByText("Hidden story")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "項目" })).not.toBeInTheDocument();
  });

  it("opens the unread list after a correct token and keeps the token for the next visit", async () => {
    const server = makeServer();
    server.article(server.category().id, { title: "First story" });
    const first = renderApp({ server, token: null });

    await first.user.type(await screen.findByLabelText("APIのトークン"), API_TOKEN);
    await first.user.click(screen.getByRole("button", { name: "接続する" }));

    expect(await screen.findByText("First story")).toBeInTheDocument();
    expect(window.localStorage.getItem("smarternews.token")).toBe(API_TOKEN);

    first.unmount();
    window.localStorage.setItem("smarternews.token", API_TOKEN); // what the browser kept
    renderApp({ server, token: API_TOKEN });
    expect(await screen.findByText("First story")).toBeInTheDocument();
    expect(screen.queryByLabelText("APIのトークン")).not.toBeInTheDocument();
  });

  it("says that a wrong token is wrong and does not store it", async () => {
    const { user } = renderApp({ token: null });

    await user.type(await screen.findByLabelText("APIのトークン"), "not-the-token");
    await user.click(screen.getByRole("button", { name: "接続する" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("トークンが正しくありません");
    expect(window.localStorage.getItem("smarternews.token")).toBeNull();
  });

  it("returns to the token screen when the stored token has stopped working", async () => {
    renderApp({ token: "token-from-before-the-server-was-reset" });

    expect(await screen.findByLabelText("APIのトークン")).toBeInTheDocument();
    expect(window.localStorage.getItem("smarternews.token")).toBeNull();
  });
});

describe("the list of views and categories", () => {
  it("shows each enabled category with its unread count, and no number when there is nothing unread", async () => {
    const server = makeServer();
    const a = server.category("Security");
    const b = server.category("Tools");
    const hidden = server.category("Hidden");
    updateCategory(server.db, hidden.id, { enabled: false });
    server.article(a.id);
    server.article(a.id);
    setArticleFlags(server.db, server.article(b.id), { isRead: true }, server.clock().toISOString());
    renderApp({ server });

    const security = await within(nav()).findByRole("link", { name: /Security/ });
    await waitFor(() => expect(security).toHaveTextContent("2"));
    expect(within(nav()).getByRole("link", { name: /Tools/ })).not.toHaveTextContent(/\d/);
    expect(within(nav()).queryByRole("link", { name: /Hidden/ })).not.toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: /^未読/ })).toHaveTextContent("2");
  });

  it("lists the views in order, with 最近読んだ記事, 注釈 and ダイジェスト last and without a number", async () => {
    const server = makeServer();
    const a = server.category("Security");
    setArticleFlags(server.db, server.article(a.id), { isRead: true }, server.clock().toISOString());
    server.article(a.id);
    const { user, path } = renderApp({ server });

    const views = await within(nav()).findAllByRole("list");
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /^未読/ })).toHaveTextContent("1"));
    expect(within(views[0]!).getAllByRole("link").map((link) => link.textContent!.replace(/\d+$/, ""))).toEqual(["未読", "すべて", "スター", "AI生成", "最近読んだ記事", "注釈", "ダイジェスト"]);
    expect(within(nav()).getByRole("link", { name: "最近読んだ記事" })).toHaveTextContent(/^最近読んだ記事$/);
    expect(within(nav()).getByRole("link", { name: "注釈" })).toHaveTextContent(/^注釈$/);
    expect(within(nav()).getByRole("link", { name: "ダイジェスト" })).toHaveTextContent(/^ダイジェスト$/);

    await user.click(within(nav()).getByRole("link", { name: "最近読んだ記事" }));
    expect(path()).toBe("/recently-read");
    await user.click(within(nav()).getByRole("link", { name: "注釈" }));
    expect(path()).toBe("/annotations");
    await user.click(within(nav()).getByRole("link", { name: "ダイジェスト" }));
    expect(path()).toBe("/digests");
  });

  it("links to the settings and the run history", async () => {
    renderApp();
    expect(await within(nav()).findByRole("link", { name: "設定" })).toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: "実行履歴" })).toBeInTheDocument();
  });

  it("puts the number of attention items beside the run history, read out as such, and none when there are none", async () => {
    const server = makeServer();
    // Topics without an article for 14 days: one in each category.
    for (const name of ["Security", "Tools"]) {
      createTopic(server.db, server.category(name).id, { text: `${name} topic`, interpretation: { queries: ["q"], criteria: "c" } }, server.clock);
    }
    server.clock.advance(15 * 86_400_000);
    renderApp({ server });

    const marked = await within(nav()).findByRole("link", { name: "実行履歴、注意2件" });
    expect(within(marked).getByText("2")).toHaveClass("text-warning");
  });

  it("puts no number beside the run history when there is nothing to look at", async () => {
    const server = makeServer();
    server.category("Security");
    renderApp({ server });

    expect(await within(nav()).findByRole("link", { name: "実行履歴" })).toHaveTextContent(/^実行履歴$/);
  });
});

describe("panes by width", () => {
  function seeded() {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "A long story" });
    return { server, id };
  }

  it("shows the views, the list and the article side by side on a wide screen", async () => {
    const { server, id } = seeded();
    renderApp({ server, route: `/all/${id}`, width: 1280 });

    expect(await screen.findByRole("article", { name: "記事" })).toBeInTheDocument();
    expect(nav()).toBeInTheDocument();
    expect(list()).toBeInTheDocument();
  });

  it("shows the list and the article on a medium screen, with the views behind a button", async () => {
    const { server, id } = seeded();
    const { user } = renderApp({ server, route: `/all/${id}`, width: 900 });

    expect(await screen.findByRole("article", { name: "記事" })).toBeInTheDocument();
    expect(list()).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "項目" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "項目を開く" }));
    expect(await within(nav()).findByRole("link", { name: /^未読/ })).toBeInTheDocument();
  });

  it("shows only the list on a narrow screen until an article is chosen", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server, route: "/all", width: 390 });

    await user.click(await screen.findByRole("link", { name: /A long story/ }));

    expect(await screen.findByRole("article", { name: "記事" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "記事の一覧" })).not.toBeInTheDocument();
  });

  it("goes back from the article to the list on a narrow screen", async () => {
    const { server, id } = seeded();
    const { user } = renderApp({ server, route: `/all/${id}`, width: 390 });

    await user.click(await screen.findByRole("link", { name: "一覧へ戻る" }));

    expect(await screen.findByRole("region", { name: "記事の一覧" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "記事" })).not.toBeInTheDocument();
  });
});

describe("going back to the list on a narrow screen", () => {
  const ROW = 60;
  const VIEW = 120;
  const pane = () => list().querySelector<HTMLElement>("[data-list-scroll]")!;
  const rowLink = (title: string) => within(list()).getByRole("link", { name: new RegExp(`${title}(?!\\d)`) });
  const moves = () => screen.getByRole("navigation", { name: "記事の移動" });

  /** jsdom lays nothing out: the list shows 120px, and every row of it is 60px tall. */
  function layOut(): void {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const item = this.closest("[data-list-scroll] li");
      const index = item?.parentElement ? [...item.parentElement.children].indexOf(item) : -1;
      const scrolled = item?.closest<HTMLElement>("[data-list-scroll]")?.scrollTop ?? 0;
      const top = index === -1 ? 0 : index * ROW - scrolled;
      const height = index === -1 ? VIEW : ROW;
      return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) };
    });
    const height = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!;
    Object.defineProperty(Element.prototype, "clientHeight", {
      configurable: true,
      get(this: Element) {
        return this.hasAttribute("data-list-scroll") ? VIEW : 0;
      },
    });
    onTestFinished(() => {
      rect.mockRestore();
      Object.defineProperty(Element.prototype, "clientHeight", height);
    });
  }

  /** Eight articles, listed newest first as "Story 8" down to "Story 1". `ids[n]` is the id of "Story n". */
  function seeded() {
    const server = makeServer();
    const category = server.category();
    const ids: Record<number, number> = {};
    for (let index = 1; index <= 8; index += 1) {
      ids[index] = server.article(category.id, { title: `Story ${index}` });
      server.clock.advance(60_000);
    }
    return { server, ids };
  }

  /** Opens すべて on a narrow screen, scrolled down by three rows so that Story 5 and Story 4 show. */
  async function openScrolled(server: TestServer) {
    layOut();
    const rendered = renderApp({ server, route: "/all", width: 390 });
    await within(list()).findByRole("link", { name: /Story 1(?!\d)/ });
    pane().scrollTop = 3 * ROW;
    fireEvent.scroll(pane());
    return rendered;
  }

  it("shows the list where it was left, with the article read chosen and focused, after 一覧へ戻る", async () => {
    const { server } = seeded();
    const { user } = await openScrolled(server);

    await user.click(rowLink("Story 4"));
    await screen.findByRole("heading", { level: 2, name: "Story 4" });
    await user.click(screen.getByRole("link", { name: "一覧へ戻る" }));

    await screen.findByRole("region", { name: "記事の一覧" });
    expect(pane().scrollTop).toBe(3 * ROW);
    expect(rowLink("Story 4")).toHaveAttribute("aria-current", "true");
    expect(rowLink("Story 4")).toHaveFocus();
  });

  it("does the same after the browser's back button", async () => {
    const { server } = seeded();
    const { user, back } = await openScrolled(server);

    await user.click(rowLink("Story 5"));
    await screen.findByRole("heading", { level: 2, name: "Story 5" });
    await back();

    await screen.findByRole("region", { name: "記事の一覧" });
    expect(pane().scrollTop).toBe(3 * ROW);
    expect(rowLink("Story 5")).toHaveAttribute("aria-current", "true");
    expect(rowLink("Story 5")).toHaveFocus();
  });

  it("moves on with j from the article read", async () => {
    const { server, ids } = seeded();
    const { user, path } = await openScrolled(server);

    await user.click(rowLink("Story 4"));
    await screen.findByRole("heading", { level: 2, name: "Story 4" });
    await user.click(screen.getByRole("link", { name: "一覧へ戻る" }));
    await screen.findByRole("region", { name: "記事の一覧" });
    await user.keyboard("j");

    await screen.findByRole("heading", { level: 2, name: "Story 3" });
    expect(path()).toBe(`/all/${ids[3]}`);
  });

  it("offers the next and the previous article at the end of the body, by their headlines", async () => {
    const { server, ids } = seeded();
    const { user, path } = renderApp({ server, route: `/all/${ids[8]}`, width: 390 });
    await screen.findByRole("heading", { level: 2, name: "Story 8" });

    // The first article of the list has nothing before it.
    const next = await within(await screen.findByRole("navigation", { name: "記事の移動" })).findByRole("link", { name: /次の記事/ });
    expect(next).toHaveTextContent("Story 7");
    expect(within(moves()).queryByRole("link", { name: /前の記事/ })).not.toBeInTheDocument();
    await user.click(next);

    await screen.findByRole("heading", { level: 2, name: "Story 7" });
    expect(path()).toBe(`/all/${ids[7]}`);
    expect(await within(moves()).findByRole("link", { name: /前の記事/ })).toHaveTextContent("Story 8");
    await user.click(within(moves()).getByRole("link", { name: /前の記事/ }));
    await screen.findByRole("heading", { level: 2, name: "Story 8" });
  });

  it("leaves out the next article at the end of the list", async () => {
    const { server, ids } = seeded();
    renderApp({ server, route: `/all/${ids[1]}`, width: 390 });
    await screen.findByRole("heading", { level: 2, name: "Story 1" });

    const links = await screen.findByRole("navigation", { name: "記事の移動" });
    expect(within(links).getByRole("link", { name: /前の記事/ })).toHaveTextContent("Story 2");
    expect(within(moves()).queryByRole("link", { name: /次の記事/ })).not.toBeInTheDocument();
  });

  it("brings the last article read into view when the reader went on past the rows in view", async () => {
    const { server } = seeded();
    const { user } = await openScrolled(server);

    await user.click(rowLink("Story 5"));
    await screen.findByRole("heading", { level: 2, name: "Story 5" });
    await user.click(await within(moves()).findByRole("link", { name: /次の記事/ }));
    await screen.findByRole("heading", { level: 2, name: "Story 4" });
    await user.click(await within(moves()).findByRole("link", { name: /次の記事/ }));
    await screen.findByRole("heading", { level: 2, name: "Story 3" });
    await user.click(screen.getByRole("link", { name: "一覧へ戻る" }));

    await screen.findByRole("region", { name: "記事の一覧" });
    // Story 3 is the sixth row: from 300px to 360px. The list goes down just far enough to show all of it.
    expect(pane().scrollTop).toBe(6 * ROW - VIEW);
    expect(rowLink("Story 3")).toHaveAttribute("aria-current", "true");
    expect(rowLink("Story 3")).toHaveFocus();
  });

  it("offers no next or previous article on a wide screen, where the list is beside the article", async () => {
    const { server, ids } = seeded();
    renderApp({ server, route: `/all/${ids[5]}`, width: 1280 });
    await screen.findByRole("heading", { level: 2, name: "Story 5" });

    expect(screen.queryByRole("navigation", { name: "記事の移動" })).not.toBeInTheDocument();
  });
});

describe("getting around without a pointer", () => {
  it("offers a first link that skips the list of views and puts the focus on the content", async () => {
    const server = makeServer();
    server.article(server.category().id, { title: "A story" });
    const { user } = renderApp({ server, route: "/all" });
    await screen.findByRole("link", { name: /A story/ });

    await user.tab();
    expect(document.activeElement).toHaveTextContent("内容へ移動");
    await user.keyboard("{Enter}");

    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("gives the article pane a page heading and the focus when it replaces the list on a narrow screen", async () => {
    const server = makeServer();
    server.article(server.category().id, { title: "A story" });
    const { user } = renderApp({ server, route: "/all", width: 390 });

    await user.click(await screen.findByRole("link", { name: /A story/ }));

    const title = await screen.findByRole("heading", { level: 2, name: "A story" });
    expect(screen.getByRole("heading", { level: 1, name: "すべて" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it("leaves the focus in the list on a wide screen, so that the next article is one key away", async () => {
    const server = makeServer();
    server.article(server.category().id, { title: "A story" });
    const { user } = renderApp({ server, route: "/all", width: 1280 });

    const link = await screen.findByRole("link", { name: /A story/ });
    await user.click(link);
    await screen.findByRole("heading", { level: 2, name: "A story" });

    expect(document.activeElement).toBe(link);
  });
});

describe("keyboard", () => {
  function seeded() {
    const server = makeServer();
    const category = server.category();
    const older = server.article(category.id, { title: "Older story" });
    server.clock.advance(60_000);
    const newer = server.article(category.id, { title: "Newer story", refs: ["https://example.org/newer"] });
    return { server, older, newer };
  }

  it("moves to the next and the previous article with j and k", async () => {
    const { server, newer, older } = seeded();
    const { user, path } = renderApp({ server, route: `/all/${newer}` });
    await screen.findByRole("heading", { level: 2, name: "Newer story" });

    await user.keyboard("j");
    expect(await screen.findByRole("heading", { level: 2, name: "Older story" })).toBeInTheDocument();
    expect(path()).toBe(`/all/${older}`);

    await user.keyboard("k");
    expect(await screen.findByRole("heading", { level: 2, name: "Newer story" })).toBeInTheDocument();
  });

  /** jsdom lays nothing out: the list is 100px tall and every row is 60px. */
  function layOut(): HTMLElement {
    const pane = screen.getByRole("region", { name: "記事の一覧" }).querySelector<HTMLElement>("[data-list-scroll]")!;
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const row = this.closest("li");
      const index = row?.parentElement ? [...row.parentElement.children].indexOf(row) : -1;
      const top = index === -1 ? 0 : index * 60 - pane.scrollTop;
      const height = index === -1 ? 100 : 60;
      return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) };
    });
    onTestFinished(() => spy.mockRestore());
    return pane;
  }

  it("moves the list by a screen when j and k leave the rows in view", async () => {
    const { server, newer } = seeded();
    const { user } = renderApp({ server, route: `/all/${newer}` });
    await screen.findByRole("heading", { level: 2, name: "Newer story" });
    const pane = layOut();

    await user.keyboard("j");
    await screen.findByRole("heading", { level: 2, name: "Older story" });
    await waitFor(() => expect(pane.scrollTop).toBe(60));

    await user.keyboard("k");
    await screen.findByRole("heading", { level: 2, name: "Newer story" });
    await waitFor(() => expect(pane.scrollTop).toBe(0));
  });

  it("leaves the list alone when an article is chosen with a click", async () => {
    const { server, newer } = seeded();
    const { user } = renderApp({ server, route: `/all/${newer}` });
    await screen.findByRole("heading", { level: 2, name: "Newer story" });
    const pane = layOut();

    await user.click(screen.getByRole("link", { name: /Older story/ }));
    await screen.findByRole("heading", { level: 2, name: "Older story" });

    expect(pane.scrollTop).toBe(0);
  });

  it("names the tab after the unread count and the open article", async () => {
    const { server, newer } = seeded();
    const { user } = renderApp({ server, route: "/all" });
    await waitFor(() => expect(document.title).toBe("SmarterNews(2)"));

    await user.click(await screen.findByRole("link", { name: /Newer story/ }));
    await waitFor(() => expect(document.title).toBe("SmarterNews(1)-Newer story"));
    expect(newer).toBeGreaterThan(0);
  });

  it("selects the first article with j when none is selected", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server, route: "/all" });
    await screen.findByRole("link", { name: /Newer story/ });

    await user.keyboard("j");

    expect(await screen.findByRole("heading", { level: 2, name: "Newer story" })).toBeInTheDocument();
  });

  it("toggles the star with s and the read state with m", async () => {
    const { server, newer } = seeded();
    const { user } = renderApp({ server, route: `/all/${newer}` });
    await screen.findByRole("heading", { level: 2, name: "Newer story" });

    await user.keyboard("s");
    expect(await screen.findByRole("button", { name: "スターを外す" })).toBeInTheDocument();
    await user.keyboard("s");
    expect(await screen.findByRole("button", { name: "スターを付ける" })).toBeInTheDocument();

    await user.keyboard("m");
    expect(await screen.findByRole("button", { name: "既読にする" })).toBeInTheDocument();
  });

  it("opens the main source in a new tab with o", async () => {
    const { server, newer } = seeded();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { user } = renderApp({ server, route: `/all/${newer}` });
    await screen.findByRole("heading", { level: 2, name: "Newer story" });

    await user.keyboard("o");

    expect(open).toHaveBeenCalledWith("https://example.org/newer", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("lists the keys when ? is pressed", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server, route: "/all" });
    await screen.findByRole("link", { name: /Newer story/ });

    await user.keyboard("?");

    const dialog = await screen.findByRole("dialog", { name: "キー操作" });
    expect(within(dialog).getByText("次の記事")).toBeInTheDocument();
    expect(within(dialog).getByText("スターの切り替え")).toBeInTheDocument();
    const keys = within(dialog).getAllByRole("term").map((term) => term.textContent);
    for (const key of ["Shift+A", "Shift+J", "Shift+K", "Space", "Shift+Space", "r", "u", "x", "z", "g a", "g s", "g e", "g r"]) expect(keys).toContain(key);
    expect(within(dialog).getByText("生成記事の外れの印の切り替え。付けると既読にする")).toBeInTheDocument();
    expect(within(dialog).getByText("知らせの操作（取り消す、もう一度試すなど）")).toBeInTheDocument();
    expect(within(dialog).getByText("「最近読んだ記事」へ移る")).toBeInTheDocument();
  });

  it("leaves letters alone while the user types in a field", async () => {
    const server = makeServer();
    const category = server.category();
    renderApp({ server, route: `/settings/categories/${category.id}` });
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();

    const field = await screen.findByLabelText("新しいトピック");
    await user.type(field, "sjm?");

    expect(field).toHaveValue("sjm?");
    expect(screen.queryByRole("dialog", { name: "キー操作" })).not.toBeInTheDocument();
  });
});

describe("moving between the entries with keys", () => {
  const feedOf = (server: TestServer, title: string, categoryId: number | null) =>
    insertFeed(server.db, { url: `https://${title.toLowerCase()}.example.org/feed.xml`, title, categoryId }, server.clock);

  it("opens the next and the previous entry of the left pane with Shift+J and Shift+K", async () => {
    const server = makeServer();
    const alpha = server.category("Alpha");
    const beta = server.category("Beta");
    const { user, path } = renderApp({ server, route: `/c/${alpha.slug}` });
    await within(nav()).findByRole("link", { name: "Beta" });

    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toBe(`/c/${beta.slug}`));

    await user.keyboard("{Shift>}K{/Shift}");
    await waitFor(() => expect(path()).toBe(`/c/${alpha.slug}`));
    await user.keyboard("{Shift>}K{/Shift}");
    await waitFor(() => expect(path()).toBe("/annotations"));
    await user.keyboard("{Shift>}K{/Shift}");
    await waitFor(() => expect(path()).toBe("/recently-read"));
    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toBe("/annotations"));
  });

  it("takes only the keys that move between entries while the left pane is open over the article", async () => {
    const server = makeServer();
    const alpha = server.category("Alpha");
    const beta = server.category("Beta");
    server.article(alpha.id, { title: "Older story" });
    server.clock.advance(60_000);
    const newer = server.article(alpha.id, { title: "Newer story" });
    const { user, path } = renderApp({ server, route: `/c/${alpha.slug}/${newer}`, width: 900 });
    await screen.findByRole("heading", { level: 2, name: "Newer story" });

    await user.click(screen.getByRole("button", { name: "項目を開く" }));
    within(nav()).getByRole("link", { name: /^未読/ }).focus();
    await user.keyboard("s j ");

    expect(path()).toBe(`/c/${alpha.slug}/${newer}`);
    expect(screen.getByRole("button", { name: "スターを付ける", hidden: true })).toBeInTheDocument();

    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toMatch(new RegExp(`^/c/${beta.slug}`)));
  });

  it("goes into the entries below a category, and past them once it is folded", async () => {
    const server = makeServer();
    const alpha = server.category("Alpha");
    const beta = server.category("Beta");
    feedOf(server, "X", alpha.id);
    const { user, path } = renderApp({ server, route: `/c/${alpha.slug}` });
    await within(nav()).findByRole("link", { name: "X" });

    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toBe(`/c/${alpha.slug}/generated`));

    await user.click(within(nav()).getByRole("button", { name: "Alphaの下の項目" }));
    // The open entry is hidden below the folded category, which holds the place.
    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toBe(`/c/${beta.slug}`));
    await user.keyboard("{Shift>}K{/Shift}");
    await waitFor(() => expect(path()).toBe(`/c/${alpha.slug}`));
    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toBe(`/c/${beta.slug}`));
  });

  it("opens the first entry from the settings, and stays on the last one", async () => {
    const server = makeServer();
    const alpha = server.category("Alpha");
    const { user, path } = renderApp({ server, route: "/settings" });
    await within(nav()).findByRole("link", { name: "Alpha" });

    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toBe("/unread"));

    await user.click(within(nav()).getByRole("link", { name: "Alpha" }));
    await waitFor(() => expect(path()).toBe(`/c/${alpha.slug}`));
    await user.keyboard("{Shift>}J{/Shift}");
    expect(path()).toBe(`/c/${alpha.slug}`);
  });

  it("opens 未読, not すべて, with g a, スター with g s and 最近読んだ記事 with g r", async () => {
    const server = makeServer();
    const alpha = server.category("Alpha");
    server.article(alpha.id, { title: "A story" });
    const { user, path, requests } = renderApp({ server, route: `/c/${alpha.slug}` });
    await screen.findByRole("link", { name: /A story/ });

    await user.keyboard("ga");
    await waitFor(() => expect(path()).toBe("/unread"));
    await user.keyboard("gs");
    await waitFor(() => expect(path()).toBe("/starred"));

    const counted = () => requests.filter((request) => request.includes("/counts")).length;
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "スター" })).toBeInTheDocument());
    const before = counted();
    await user.keyboard("gr");
    await waitFor(() => expect(path()).toBe("/recently-read"));
    await screen.findByRole("heading", { level: 1, name: "最近読んだ記事" });
    // The r of the pair is no refresh, which would fetch the counts again.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(counted()).toBe(before);
  });

  it("goes round the event categories with g e, from wherever the reader is", async () => {
    const server = makeServer();
    server.category("Alpha");
    const fair = server.category("Fairs", "event");
    server.category("Beta");
    const talk = server.category("Talks", "event");
    const { user, path } = renderApp({ server, route: "/settings" });
    await within(nav()).findByRole("link", { name: "Talks" });

    await user.keyboard("ge");
    await waitFor(() => expect(path()).toBe(`/c/${fair.slug}`));
    await user.keyboard("ge");
    await waitFor(() => expect(path()).toBe(`/c/${talk.slug}`));
    await user.keyboard("ge");
    await waitFor(() => expect(path()).toBe(`/c/${fair.slug}`));
  });

  it("stays where it is with g e when there is no event category", async () => {
    const server = makeServer();
    const alpha = server.category("Alpha");
    const { user, path } = renderApp({ server, route: `/c/${alpha.slug}` });
    await within(nav()).findByRole("link", { name: "Alpha" });

    await user.keyboard("ge");

    expect(path()).toBe(`/c/${alpha.slug}`);
  });

  it("does nothing on g alone, and takes a key after a second for itself", async () => {
    const server = makeServer();
    const alpha = server.category("Alpha");
    const id = server.article(alpha.id, { title: "A story" });
    const { user, path } = renderApp({ server, route: `/c/${alpha.slug}/${id}` });
    await screen.findByRole("heading", { level: 2, name: "A story" });

    await user.keyboard("g");
    server.clock.advance(2_000);
    expect(path()).toBe(`/c/${alpha.slug}/${id}`);

    await user.keyboard("s");
    expect(await screen.findByRole("button", { name: "スターを外す" })).toBeInTheDocument();
    expect(path()).toBe(`/c/${alpha.slug}/${id}`);
  });

  it("uses up a key after g that names no list", async () => {
    const server = makeServer();
    const alpha = server.category("Alpha");
    const id = server.article(alpha.id, { title: "A story" });
    const { user } = renderApp({ server, route: `/c/${alpha.slug}/${id}` });
    await screen.findByRole("button", { name: "未読に戻す" });

    await user.keyboard("gm");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("button", { name: "未読に戻す" })).toBeInTheDocument();
  });

  it("leaves g and s to a field the user types in", async () => {
    const server = makeServer();
    const category = server.category();
    const { user, path } = renderApp({ server, route: `/settings/categories/${category.id}` });

    const field = await screen.findByLabelText("新しいトピック");
    await user.type(field, "gs");

    expect(field).toHaveValue("gs");
    expect(path()).toBe(`/settings/categories/${category.id}`);
  });
});

describe("refreshing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("picks up a new article and the new count after a minute, without moving the article being read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = makeServer();
    const category = server.category();
    const reading = server.article(category.id, { title: "Being read" });
    renderApp({ server, route: `/unread/${reading}` });
    await screen.findByRole("heading", { level: 2, name: "Being read" });

    server.clock.advance(30_000);
    server.article(category.id, { title: "Arrived later" });
    await vi.advanceTimersByTimeAsync(61_000);

    expect(await within(list()).findByRole("link", { name: /Arrived later/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Being read" })).toBeInTheDocument();
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /^未読/ })).toHaveTextContent("1"));
  });

  it("refreshes at once when the refresh button is pressed", async () => {
    const server = makeServer();
    const category = server.category();
    server.article(category.id, { title: "Already here" });
    const { user } = renderApp({ server, route: "/unread" });
    await screen.findByRole("link", { name: /Already here/ });

    server.article(category.id, { title: "Just arrived" });
    expect(screen.queryByRole("link", { name: /Just arrived/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "読み直す" }));

    expect(await screen.findByRole("link", { name: /Just arrived/ })).toBeInTheDocument();
  });
});

describe("failures", () => {
  it("says that the server cannot be reached and offers to try again", async () => {
    const server = makeServer();
    server.article(server.category().id, { title: "Back online" });
    let down = true;
    const { user } = renderApp({ server, route: "/unread", offline: () => down });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("サーバーに接続できません");

    down = false;
    await user.click(within(alert).getByRole("button", { name: "再試行" }));
    expect(await screen.findByRole("link", { name: /Back online/ })).toBeInTheDocument();
  });

  it("says so when the address names nothing", async () => {
    renderApp({ route: "/no/such/page/here" });
    expect(await screen.findByText("このページはありません。")).toBeInTheDocument();
  });
});

describe("times", () => {
  it("shows article times in the time zone of the settings", async () => {
    const server = makeServer("2026-03-01T20:00:00.000Z");
    updateSettings(server.db, { timeZone: "Asia/Tokyo" });
    server.article(server.category().id, { title: "Morning story" });
    server.clock.advance(3_600_000);
    renderApp({ server, route: "/unread" });

    const row = await screen.findByRole("link", { name: /Morning story/ });
    expect(row).toHaveTextContent("05:00");
  });
});

describe("the warning of the monthly budget", () => {
  function spent(cost: number) {
    const server = makeServer("2026-10-25T12:00:00.000Z", {
      pricing: resolvePricing("claude-sonnet-5-5")!,
      budget: { monthlyBudgetUsd: 100, warnRatio: 0.8, resetDay: 10 },
    });
    server.db
      .prepare("INSERT INTO llm_calls (task, provider, duration_ms, ok, created_at, cost_usd, billable) VALUES ('write', 'write', 1, 1, '2026-10-20T00:00:00.000Z', ?, 1)")
      .run(cost);
    return server;
  }
  const warning = () => screen.queryByRole("status", { name: "月の予算の警告" });

  it("shows on any screen once the period spent the warning share, and leads to the providers", async () => {
    const { user, path } = renderApp({ server: spent(85), width: 1280 });

    await waitFor(() => expect(warning()).toHaveTextContent("月の予算の85%を使いました"));
    await user.click(within(warning()!).getByRole("link", { name: "プロバイダーの設定" }));

    expect(path()).toMatch(/^\/settings/);
    expect(await screen.findByRole("region", { name: "プロバイダー" })).toBeInTheDocument();
  });

  it("does not show below the warning share", async () => {
    renderApp({ server: spent(50), width: 1280 });

    expect(await screen.findByRole("region", { name: "記事の一覧" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("navigation", { name: "項目" })).toBeInTheDocument());
    expect(warning()).not.toBeInTheDocument();
  });

  it("goes away when the next period starts and the screen reads the providers again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    onTestFinished(() => void vi.useRealTimers());
    const server = spent(85);
    renderApp({ server, width: 1280 });
    await waitFor(() => expect(warning()).toBeInTheDocument());

    server.clock.set("2026-11-10T00:00:00.000Z");
    await vi.advanceTimersByTimeAsync(61_000);

    await waitFor(() => expect(warning()).not.toBeInTheDocument());
  });
});

describe("the marks of a feed's state in the left pane", () => {
  const feedOf = (server: TestServer, title: string, categoryId: number | null) =>
    insertFeed(server.db, { url: `https://${title.toLowerCase()}.example.org/feed.xml`, title, categoryId }, server.clock);
  const link = (name: RegExp) => within(nav()).getByRole("link", { name });

  it("marks a failed, a stale and a paused feed by a named shape, and a healthy one not", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    const failed = feedOf(server, "Failing", tools.id);
    recordFetchFailure(server.db, failed.id, { now: server.clock().toISOString(), error: "timed out" });
    const stale = feedOf(server, "Quiet", tools.id);
    server.db
      .prepare("UPDATE feeds SET created_at = ?, last_new_item_at = ? WHERE id = ?")
      .run("2025-01-01T00:00:00.000Z", "2025-06-01T00:00:00.000Z", stale.id);
    updateFeed(server.db, feedOf(server, "Resting", tools.id).id, { enabled: false });
    feedOf(server, "Healthy", tools.id);
    renderApp({ server });

    await within(nav()).findByRole("link", { name: /Healthy/ });
    const mark = await within(link(/Failing/)).findByRole("img", { name: "取得に失敗" });
    expect(mark).toHaveAttribute("title", "取得に失敗");
    expect(within(link(/Quiet/)).getByRole("img", { name: "更新が止まっています" })).toBeInTheDocument();
    expect(within(link(/Resting/)).getByRole("img", { name: "一時停止中" })).toBeInTheDocument();
    expect(within(link(/Healthy/)).queryByRole("img")).not.toBeInTheDocument();
    // The name of the entry still comes first, and the mark is read out with it.
    expect(link(/Failing/)).toHaveAccessibleName(/^Failing、取得に失敗/);
  });

  it("marks a feed the site answers is gone by the shape of a failure, with its own name, and puts it first on a folded category", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    const failed = feedOf(server, "Failing", tools.id);
    recordFetchFailure(server.db, failed.id, { now: server.clock().toISOString(), error: "timed out" });
    const gone = feedOf(server, "Ended", tools.id);
    recordFetchFailure(server.db, gone.id, { now: server.clock().toISOString(), error: "HTTP status 410: x", gone: true });
    const { user } = renderApp({ server });

    const mark = await within(await within(nav()).findByRole("link", { name: /Ended/ })).findByRole("img", { name: "配信終了" });
    expect(mark).toHaveClass("text-error");
    expect(link(/Ended/)).toHaveAccessibleName(/^Ended、配信終了/);

    await user.click(within(nav()).getByRole("button", { name: "Toolsの下の項目" }));
    expect(within(link(/^Tools/)).getByRole("img", { name: "配信を終えた購読フィードがあります" })).toBeInTheDocument();
  });

  it("puts the strongest mark of the feeds below on a category only while it is folded", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    updateFeed(server.db, feedOf(server, "Resting", tools.id).id, { enabled: false });
    const failed = feedOf(server, "Failing", tools.id);
    recordFetchFailure(server.db, failed.id, { now: server.clock().toISOString(), error: "timed out" });
    const { user } = renderApp({ server });

    await within(nav()).findByRole("link", { name: /Failing/ });
    expect(within(link(/^Tools/)).queryByRole("img")).not.toBeInTheDocument();

    await user.click(within(nav()).getByRole("button", { name: "Toolsの下の項目" }));

    expect(within(link(/^Tools/)).getByRole("img", { name: "取得に失敗した購読フィードがあります" })).toBeInTheDocument();
  });
});

describe("fetching every feed from the list of entries", () => {
  const rss = (title: string, keys: string[]) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${keys
      .map((key) => `<item><title>${key}</title><guid>${key}</guid><link>https://blog.example.org/${key}</link><pubDate>Sun, 01 Mar 2026 11:00:00 GMT</pubDate></item>`)
      .join("")}</channel></rss>`;
  const feedOf = (server: TestServer, title: string) => insertFeed(server.db, { url: `https://${title.toLowerCase()}.example.org/feed.xml`, title }, server.clock);
  const button = () => within(nav()).findByRole("button", { name: "すべての購読フィードをいま取得" });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches the feeds, says so, and shows the new counts and articles without waiting for the minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = makeServer();
    server.site.set("https://blog.example.org/feed.xml", rss("Blog", ["First post", "Second post"]));
    feedOf(server, "Blog");
    const { user } = renderApp({ server, advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });

    const all = await button();
    expect(all).toHaveTextContent("いま取得");
    await user.click(all);
    await server.poller.idle();
    await vi.advanceTimersByTimeAsync(3_500);

    expect(await screen.findByText("すべての購読フィードを取得しました")).toBeInTheDocument();
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /^未読/ })).toHaveTextContent("2"));
    expect(await within(list()).findByRole("link", { name: /First post/ })).toBeInTheDocument();
    expect(all).toHaveTextContent("いま取得");
    expect(all).toBeEnabled();
  });

  it("shows 取得中… when the page opens while feeds still wait for a fetch of all", async () => {
    const server = makeServer();
    feedOf(server, "Blog");
    requestFetchAll(server.db, server.clock());
    renderApp({ server });

    const all = await button();
    await waitFor(() => expect(all).toHaveTextContent("取得中…"));
    expect(all).toBeDisabled();
  });

  it("says how many fetches failed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = makeServer();
    server.site.set("https://blog.example.org/feed.xml", rss("Blog", ["a"]));
    feedOf(server, "Blog");
    feedOf(server, "Down");
    const { user } = renderApp({ server, advanceTimers: (ms) => void vi.advanceTimersByTime(ms) });

    await user.click(await button());
    await server.poller.idle();
    await vi.advanceTimersByTimeAsync(3_500);

    expect(await screen.findByText("1件の取得に失敗しました")).toBeInTheDocument();
  });

  it("starts nothing and says so when every feed is paused", async () => {
    const server = makeServer();
    updateFeed(server.db, feedOf(server, "Blog").id, { enabled: false });
    const { user } = renderApp({ server });

    await user.click(await button());

    expect(await screen.findByText("取得する購読フィードはありません")).toBeInTheDocument();
    expect(server.site.requests).toHaveLength(0);
  });

  it("has no button while there is no feed", async () => {
    const server = makeServer();
    server.category("Tools");
    renderApp({ server });

    expect(await within(nav()).findByRole("link", { name: /^Tools/ })).toBeInTheDocument();
    expect(within(nav()).queryByRole("button", { name: "すべての購読フィードをいま取得" })).not.toBeInTheDocument();
  });
});

describe("hiding the entries without unread articles", () => {
  const feedOf = (server: TestServer, title: string, categoryId: number | null) =>
    insertFeed(server.db, { url: `https://${title.toLowerCase()}.example.org/feed.xml`, title, categoryId }, server.clock);
  const entry = (name: RegExp) => within(nav()).queryByRole("link", { name });

  // Tools: Busy and Late with an unread article each, Empty without one, Failing without one after a failed fetch.
  // Cars: nothing unread.
  function seeded() {
    const server = makeServer();
    const tools = server.category("Tools");
    const cars = server.category("Cars");
    const busy = feedOf(server, "Busy", tools.id);
    const empty = feedOf(server, "Empty", tools.id);
    const late = feedOf(server, "Late", tools.id);
    const failing = feedOf(server, "Failing", tools.id);
    recordFetchFailure(server.db, failing.id, { now: server.clock().toISOString(), error: "timed out" });
    seedFeedArticle(server.db, busy.id);
    seedFeedArticle(server.db, late.id);
    return { server, tools, cars, busy, empty, late };
  }

  it("shows every entry while the setting is off", async () => {
    const { server } = seeded();
    renderApp({ server });

    expect(await within(nav()).findByRole("link", { name: /^Empty/ })).toBeInTheDocument();
    expect(entry(/^Cars/)).toBeInTheDocument();
  });

  it("hides them once it is on, but keeps the views, a failed feed, and the entry that is open", async () => {
    window.localStorage.setItem("smarternews.nav.hideRead", "on");
    const { server, empty, busy } = seeded();
    const { user, path } = renderApp({ server, route: `/f/${empty.id}` });

    await waitFor(() => expect(entry(/^Busy/)).toHaveTextContent("1"));
    expect(entry(/^Empty/)).toBeInTheDocument();
    expect(entry(/^Failing/)).toBeInTheDocument();
    expect(entry(/^Cars/)).not.toBeInTheDocument();
    expect(within(nav()).getAllByRole("link", { name: /^AI生成/ })).toHaveLength(1);
    expect(entry(/^すべて/)).toBeInTheDocument();

    await user.click(entry(/^Busy/)!);
    await waitFor(() => expect(path()).toBe(`/f/${busy.id}`));
    // Once another list is open, the feed that was open goes too.
    await waitFor(() => expect(entry(/^Empty/)).not.toBeInTheDocument());
  });

  it("passes the hidden entries by with Shift+J and Shift+K", async () => {
    window.localStorage.setItem("smarternews.nav.hideRead", "on");
    const { server, busy, late } = seeded();
    const { user, path } = renderApp({ server, route: `/f/${busy.id}` });
    await waitFor(() => expect(entry(/^Late/)).toHaveTextContent("1"));

    await user.keyboard("{Shift>}J{/Shift}");
    await waitFor(() => expect(path()).toBe(`/f/${late.id}`));
    await user.keyboard("{Shift>}K{/Shift}");
    await waitFor(() => expect(path()).toBe(`/f/${busy.id}`));
  });
});

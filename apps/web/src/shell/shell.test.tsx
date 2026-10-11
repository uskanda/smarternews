import { setArticleFlags, updateCategory, updateSettings } from "@smarternews/core";
import { API_TOKEN } from "@smarternews/server/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { makeServer, renderApp } from "../testing/harness.tsx";

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
    setArticleFlags(server.db, server.article(b.id), { isRead: true });
    renderApp({ server });

    const security = await within(nav()).findByRole("link", { name: /Security/ });
    await waitFor(() => expect(security).toHaveTextContent("2"));
    expect(within(nav()).getByRole("link", { name: /Tools/ })).not.toHaveTextContent(/\d/);
    expect(within(nav()).queryByRole("link", { name: /Hidden/ })).not.toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: /^未読/ })).toHaveTextContent("2");
  });

  it("links to the settings and the run history", async () => {
    renderApp();
    expect(await within(nav()).findByRole("link", { name: "設定" })).toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: "実行履歴" })).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "更新" }));

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

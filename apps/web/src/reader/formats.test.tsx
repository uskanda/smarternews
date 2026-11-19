import { getArticle, listListViews, setArticleFlags, updateListView } from "@smarternews/core";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";
import { intersect } from "../testing/setup.ts";

const MINUTE = 60_000;
const nav = () => screen.getByRole("navigation", { name: "項目" });
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const formatButton = () => within(list()).getByRole("button", { name: /^表示/ });
const sortButton = () => within(list()).getByRole("button", { name: /^並び順/ });

/** Adds articles one minute apart, so the last one is the newest. */
function articles(server: TestServer, categoryId: number, specs: Array<Parameters<TestServer["article"]>[1]>): number[] {
  return specs.map((spec) => {
    const id = server.article(categoryId, spec);
    server.clock.advance(MINUTE);
    return id;
  });
}

describe("the menu of the format", () => {
  function seeded() {
    const server = makeServer();
    const tools = server.category("Tools");
    articles(server, tools.id, [{ title: "First" }, { title: "Second" }]);
    return { server, tools };
  }

  it("names the standard format beside the order, offers the three formats, and stores the one chosen", async () => {
    const { server, tools } = seeded();
    updateListView(server.db, `category-${tools.id}`, { sort: "oldest" });
    const { user } = renderApp({ server, route: "/c/tools" });
    await within(list()).findByRole("link", { name: /First/ });
    expect(formatButton()).toHaveAccessibleName("表示：標準");
    expect(sortButton().parentElement!.nextElementSibling).toContainElement(formatButton());

    await user.click(formatButton());
    const menu = screen.getByRole("menu", { name: "表示" });
    expect(within(menu).getAllByRole("menuitemradio").map((item) => [item.textContent, item.getAttribute("aria-checked")])).toEqual([
      ["✓標準", "true"],
      ["タイトルのみ", "false"],
      ["展開", "false"],
    ]);
    await user.click(within(menu).getByRole("menuitemradio", { name: "タイトルのみ" }));

    expect(formatButton()).toHaveAccessibleName("表示：タイトルのみ");
    // The order stays as it was.
    expect(sortButton()).toHaveAccessibleName("並び順：古い順");
    await waitFor(() => expect(listListViews(server.db).items).toEqual([{ key: `category-${tools.id}`, sort: "oldest", format: "compact" }]));
  });

  it("goes back to the format it had, and says so, when the format cannot be stored", async () => {
    const { server } = seeded();
    let offline = false;
    const { user } = renderApp({ server, route: "/c/tools", offline: () => offline });
    await within(list()).findByRole("link", { name: /First/ });

    offline = true;
    await user.click(formatButton());
    await user.click(within(screen.getByRole("menu", { name: "表示" })).getByRole("menuitemradio", { name: "展開" }));

    expect(await screen.findByText("表示を保存できませんでした。もう一度試してください。")).toBeInTheDocument();
    await waitFor(() => expect(formatButton()).toHaveAccessibleName("表示：標準"));
    expect(listListViews(server.db).items).toEqual([]);
  });

  it("is offered neither for an event category nor for the recently read articles", async () => {
    const server = makeServer("2026-03-10T12:00:00.000Z");
    const events = server.category("Local events", "event");
    server.article(events.id, {
      title: "Morning class",
      kind: "event",
      event: { key: "class", startsAt: "2026-03-11T10:00:00.000Z", endsAt: "2026-03-11T12:00:00.000Z", venue: null, fee: null, registration: "unknown" },
    });
    const read = server.article(server.category("Tools").id, { title: "Read one" });
    setArticleFlags(server.db, read, { isRead: true }, server.clock().toISOString());
    const { user } = renderApp({ server, route: "/c/local-events" });
    await screen.findByRole("link", { name: /Morning class/ });
    expect(screen.queryByRole("button", { name: /^表示/ })).not.toBeInTheDocument();

    await user.click(within(nav()).getByRole("link", { name: /最近読んだ記事/ }));
    await within(list()).findByRole("link", { name: /Read one/ });
    expect(screen.queryByRole("button", { name: /^表示/ })).not.toBeInTheDocument();
  });
});

describe("the format with titles only", () => {
  it("shows a row on one line: the title, then the name and the time, with the marks that choose a row, and no summary", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    const [plain, important, starred] = articles(server, tools.id, [
      { title: "Plain", summary: "The summary of plain" },
      { title: "Important", importance: 5, unconfirmed: true },
      { title: "Starred" },
    ]);
    setArticleFlags(server.db, starred!, { starred: true }, server.clock().toISOString());
    updateListView(server.db, `category-${tools.id}`, { format: "compact" });
    const { user } = renderApp({ server, route: "/c/tools" });

    const row = (await within(list()).findByRole("link", { name: /Plain/ })).closest("li")!;
    expect(row).toHaveAttribute("data-compact");
    expect(within(row).queryByText("The summary of plain")).not.toBeInTheDocument();
    expect(within(row).queryByText(/出典/)).not.toBeInTheDocument();
    expect(within(row).getByText("Tools")).toBeInTheDocument();
    const mark = within(list()).getByRole("link", { name: /Important/ }).closest("li")!;
    expect(mark).toHaveAttribute("data-importance", "5");
    expect(within(mark).getByText("未確認")).toBeInTheDocument();
    expect(within(within(list()).getByRole("link", { name: /Starred/ }).closest("li")!).getByRole("img", { name: "スター" })).toBeInTheDocument();

    // A row opens the article beside the list, as in the standard format.
    await user.click(within(list()).getByRole("link", { name: /Plain/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Plain" })).toBeInTheDocument();
    await waitFor(() => expect(getArticle(server.db, plain!).isRead).toBe(true));
    expect(getArticle(server.db, important!).isRead).toBe(false);
  });
});

describe("the expanded format", () => {
  const ROW = 300;
  const VIEW = 200;
  const pane = () => list().querySelector<HTMLElement>("[data-list-scroll]")!;
  const expandedRows = () => [...list().querySelectorAll<HTMLElement>("[data-expanded-article]")];
  const expandedRow = (id: number) => list().querySelector<HTMLElement>(`[data-expanded-article][data-article-id="${id}"]`)!;

  /** jsdom lays nothing out: the list shows 200px, and every article of it is 300px tall. */
  function layOut(): void {
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const item = this.closest("[data-expanded-article]");
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

  async function scrollTo(top: number): Promise<void> {
    pane().scrollTop = top;
    fireEvent.scroll(pane());
    await act(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
  }

  /** `total` unread articles in Tools, "Story 1" the oldest; the rows, newest first. */
  function seeded(total = 4) {
    const server = makeServer();
    const tools = server.category("Tools");
    const ids = articles(
      server,
      tools.id,
      Array.from({ length: total }, (_, index) => ({ title: `Story ${index + 1}`, body: `Body of story ${index + 1}` })),
    );
    updateListView(server.db, `category-${tools.id}`, { format: "expanded" });
    return { server, tools, rows: [...ids].reverse() };
  }

  async function open(server: TestServer) {
    layOut();
    const rendered = renderApp({ server, route: "/c/tools" });
    await waitFor(() => expect(expandedRows().length).toBeGreaterThan(0));
    return rendered;
  }

  /** Lets the article come into view, and waits for its body. */
  async function show(id: number, body: string) {
    act(() => intersect(expandedRow(id)));
    await within(expandedRow(id)).findByText(body);
  }

  it("closes the article pane and lists the articles one after another, each in full once it comes into view", async () => {
    const { server, rows } = seeded(3);
    await open(server);

    expect(screen.queryByText("記事を選ぶと、ここに本文が表示されます。")).not.toBeInTheDocument();
    expect(document.querySelector("[data-article-scroll]")).toBeNull();
    expect(expandedRows().map((row) => row.getAttribute("data-article-id"))).toEqual(rows.map(String));
    // Before it comes into view, an article shows its headline alone.
    expect(within(expandedRow(rows[0]!)).getByRole("heading", { level: 2, name: "Story 3" })).toBeInTheDocument();
    expect(within(list()).queryByText("Body of story 3")).not.toBeInTheDocument();

    await show(rows[0]!, "Body of story 3");
    expect(within(expandedRow(rows[0]!)).getByRole("group", { name: "記事の操作" })).toBeInTheDocument();
    expect(within(list()).queryByText("Body of story 2")).not.toBeInTheDocument();
    // Coming into view does not read an article.
    expect(getArticle(server.db, rows[0]!).isRead).toBe(false);
  });

  it("records the opening and asks for what an open article asks for only once the article comes into view", async () => {
    const { server, rows } = seeded(3);
    const { requests } = await open(server);
    const opens = () => requests.filter((request) => /^POST \/api\/v1\/articles\/\d+\/open$/.test(request));
    const details = () => requests.filter((request) => /^GET \/api\/v1\/articles\/\d+$/.test(request));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(details()).toEqual([]);
    expect(opens()).toEqual([]);

    await show(rows[1]!, "Body of story 2");
    await waitFor(() => expect(opens()).toEqual([`POST /api/v1/articles/${rows[1]}/open`]));
    expect(details()).toEqual([`GET /api/v1/articles/${rows[1]}`]);
    expect(getArticle(server.db, rows[1]!).openedAt).not.toBeNull();
    expect(getArticle(server.db, rows[0]!).openedAt).toBeNull();
  });

  it("loads ten articles at a time, and the next ten when the end comes near", async () => {
    const { server } = seeded(15);
    const { requests } = await open(server);

    expect(expandedRows()).toHaveLength(10);
    expect(requests.some((request) => request.startsWith("GET /api/v1/articles?") && request.includes("limit=10"))).toBe(true);
    act(() => intersect(list().querySelector("[data-load-more]")!));

    await waitFor(() => expect(expandedRows()).toHaveLength(15));
  });

  it("moves to the headline of the next and the previous article with j and k, and reads the article it moves to", async () => {
    const { server, rows } = seeded(4);
    const { user } = await open(server);
    await scrollTo(0);

    await user.keyboard("j");

    expect(pane().scrollTop).toBe(ROW);
    await waitFor(() => expect(getArticle(server.db, rows[1]!).isRead).toBe(true));
    expect(getArticle(server.db, rows[0]!).isRead).toBe(false);
    await waitFor(() => expect(expandedRow(rows[1]!).querySelector("[data-selected-mark]")).not.toBeNull());

    await user.keyboard("j");
    expect(pane().scrollTop).toBe(2 * ROW);
    await user.keyboard("k");
    expect(pane().scrollTop).toBe(ROW);
    await waitFor(() => expect(getArticle(server.db, rows[2]!).isRead).toBe(true));
  });

  it("sends the list down by a screen less a line with Space, and back with Shift+Space", async () => {
    const { server } = seeded(4);
    const { user } = await open(server);
    await scrollTo(0);

    await user.keyboard(" ");
    const by = pane().scrollTop;
    expect(by).toBeGreaterThan(0);
    expect(by).toBeLessThan(VIEW);
    await user.keyboard("{Shift>} {/Shift}");
    expect(pane().scrollTop).toBe(0);
  });

  it("works the keys on the article at the top of the view, which the mark at the right edge shows", async () => {
    const { server, rows } = seeded(4);
    const { user } = await open(server);
    await scrollTo(0);
    expect(expandedRow(rows[0]!).querySelector("[data-selected-mark]")).not.toBeNull();

    // The second article is at the top once the first is scrolled past.
    await scrollTo(ROW + 10);
    await waitFor(() => expect(expandedRow(rows[1]!).querySelector("[data-selected-mark]")).not.toBeNull());
    expect(expandedRow(rows[0]!).querySelector("[data-selected-mark]")).toBeNull();

    await user.keyboard("s");
    await waitFor(() => expect(getArticle(server.db, rows[1]!).starred).toBe(true));
    await user.keyboard("m");
    await waitFor(() => expect(getArticle(server.db, rows[1]!).isRead).toBe(true));
    expect(getArticle(server.db, rows[0]!).starred).toBe(false);
    expect(getArticle(server.db, rows[0]!).isRead).toBe(false);
  });

  it("reads the article whose headline is pressed, and brings it to the top", async () => {
    const { server, rows } = seeded(3);
    const { user } = await open(server);
    await scrollTo(0);

    await user.click(within(expandedRow(rows[2]!)).getByRole("button", { name: "Story 1" }));

    await waitFor(() => expect(getArticle(server.db, rows[2]!).isRead).toBe(true));
    expect(pane().scrollTop).toBe(2 * ROW);
    expect(getArticle(server.db, rows[0]!).isRead).toBe(false);
  });

  it("marks read the articles scrolled past where the reader chose so", async () => {
    window.localStorage.setItem("smarternews.scrollRead", "on");
    const { server, rows } = seeded(4);
    await open(server);
    await scrollTo(0);

    await scrollTo(ROW + 10);

    await waitFor(() => expect(getArticle(server.db, rows[0]!).isRead).toBe(true), { timeout: 3000 });
    expect(getArticle(server.db, rows[1]!).isRead).toBe(false);
  });

  it("opens an article reached by a link alone, with the way back to the list", async () => {
    const { server, rows } = seeded(2);
    renderApp({ server, route: `/c/tools/${rows[1]}` });

    expect(await screen.findByRole("heading", { level: 2, name: "Story 1" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "記事の一覧" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "一覧へ戻る" })).toHaveAttribute("href", "/c/tools");
  });
});

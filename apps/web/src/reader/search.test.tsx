import { getArticle, saveTranslatedTitle, setArticleFlags, updateListView } from "@smarternews/core";
import { seedFeed, seedFeedArticle } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const MINUTE = 60_000;
const nav = () => screen.getByRole("navigation", { name: "項目" });
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const article = () => screen.getByRole("article", { name: "記事" });
const box = () => screen.getByRole("searchbox", { name: "記事を検索" });
const rowTitles = () => within(list()).queryAllByRole("listitem").map((item) => item.querySelector("[data-title]")?.textContent);
const marks = (element: HTMLElement) => [...element.querySelectorAll("mark.search-match")].map((mark) => mark.textContent);
const q = (text: string) => encodeURIComponent(text);

/** Two categories with articles about batteries, one of them read, and a feed in category A. */
function seeded(): { server: TestServer; a: { id: number; slug: string }; feed: number; ids: Record<string, number> } {
  const server = makeServer();
  const a = server.category("Alpha");
  const b = server.category("Beta");
  const ids: Record<string, number> = {};
  ids.aOld = server.article(a.id, { title: "電池の古い話", summary: "要約" });
  server.clock.advance(MINUTE);
  ids.bRead = server.article(b.id, { title: "電池の既読の話", summary: "要約" });
  setArticleFlags(server.db, ids.bRead, { isRead: true }, server.clock().toISOString());
  server.clock.advance(MINUTE);
  const feed = seedFeed(server.db, { categoryId: a.id, title: "Battery Feed" });
  ids.feed = seedFeedArticle(server.db, feed, { title: "News of the day", body: `${"前置き。".repeat(30)}新しい電池の工場ができた。`, at: server.clock().toISOString() });
  server.clock.advance(MINUTE);
  ids.other = server.article(b.id, { title: "関係のない話", summary: "要約" });
  return { server, a: { id: a.id, slug: a.slug }, feed, ids };
}

describe("the search box", () => {
  it("sits above 未読 in the left pane", async () => {
    renderApp({ server: seeded().server });
    await within(nav()).findByRole("link", { name: /未読/ });
    const unread = within(nav()).getByRole("link", { name: /未読/ });
    expect(box().compareDocumentPosition(unread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sits above the entries in the pane a narrow screen switches to", async () => {
    const { user } = renderApp({ server: seeded().server, width: 390 });
    await user.click(await screen.findByRole("button", { name: "項目を開く" }));
    const dialog = await screen.findByRole("dialog", { name: "項目" });
    const search = within(dialog).getByRole("searchbox", { name: "記事を検索" });
    expect(search.compareDocumentPosition(within(dialog).getByRole("link", { name: /未読/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the results with Enter, from any list, over every article and read ones too", async () => {
    const { server, a } = seeded();
    const { user, path } = renderApp({ server, route: `/c/${a.slug}` });
    await screen.findByRole("heading", { level: 1, name: "Alpha" });

    await user.type(box(), "電池{Enter}");

    await screen.findByRole("heading", { level: 1, name: "「電池」の検索結果" });
    expect(path()).toBe(`/search?q=${q("電池")}`);
    await waitFor(() => expect(rowTitles()).toEqual(["News of the day", "電池の既読の話", "電池の古い話"]));
  });

  it("does nothing on Enter with spaces only", async () => {
    const { user, path } = renderApp({ server: seeded().server, route: "/all" });
    await screen.findByRole("heading", { level: 1, name: "すべて" });
    await user.type(box(), "  {Enter}");
    expect(path()).toBe("/all");
  });

  it("holds the words of the results that are shown, also when they are opened from their URL", async () => {
    renderApp({ server: seeded().server, route: `/search?q=${q("電池 工場")}` });
    await screen.findByRole("heading", { level: 1, name: "「電池 工場」の検索結果" });
    expect(box()).toHaveValue("電池 工場");
  });
});

describe("the / key", () => {
  it("puts the focus in the search box without typing the slash, while an article is open", async () => {
    const { server, ids } = seeded();
    const { user } = renderApp({ server, route: `/all/${ids.aOld}` });
    await within(await screen.findByRole("article", { name: "記事" })).findByRole("heading", { name: "電池の古い話" });

    await user.keyboard("/");

    expect(box()).toHaveFocus();
    expect(box()).toHaveValue("");
    await user.keyboard("電池");
    expect(box()).toHaveValue("電池");
  });

  it("opens the pane with the search box on a narrow screen, with the focus in the box", async () => {
    const { user } = renderApp({ server: seeded().server, route: "/all", width: 390 });
    await screen.findByRole("heading", { level: 1, name: "すべて" });
    await user.keyboard("/");
    const dialog = await screen.findByRole("dialog", { name: "項目" });
    await waitFor(() => expect(within(dialog).getByRole("searchbox", { name: "記事を検索" })).toHaveFocus());
  });

  it("is typed as a slash in a field", async () => {
    const { user } = renderApp({ server: seeded().server, route: "/all" });
    await screen.findByRole("heading", { level: 1, name: "すべて" });
    await user.type(box(), "a/b");
    expect(box()).toHaveValue("a/b");
  });

  it("is in the list of keys", async () => {
    const { user } = renderApp({ server: seeded().server, route: "/all" });
    await screen.findByRole("heading", { level: 1, name: "すべて" });
    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "キー操作" });
    expect(within(dialog).getByText("検索欄へ移る")).toBeInTheDocument();
  });
});

describe("the results", () => {
  it("narrow to a category and to a feed, keep the narrowing in the URL, and go back to everything", async () => {
    const { server, a, feed } = seeded();
    const { user, path } = renderApp({ server, route: `/search?q=${q("電池")}` });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));
    const narrowing = screen.getByRole("combobox", { name: "絞り込み" });

    await user.selectOptions(narrowing, "Alpha");
    await waitFor(() => expect(rowTitles()).toEqual(["News of the day", "電池の古い話"]));
    expect(path()).toBe(`/search?q=${q("電池")}&category=${a.slug}`);

    await user.selectOptions(narrowing, "Battery Feed");
    await waitFor(() => expect(rowTitles()).toEqual(["News of the day"]));
    expect(path()).toBe(`/search?q=${q("電池")}&feed=${feed}`);

    await user.selectOptions(narrowing, "すべて");
    await waitFor(() => expect(rowTitles()).toHaveLength(3));
  });

  it("include read articles until unread only is chosen", async () => {
    const { server } = seeded();
    const { user, path } = renderApp({ server, route: `/search?q=${q("電池")}` });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));
    const toggle = screen.getByRole("checkbox", { name: "未読だけ" });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    await waitFor(() => expect(rowTitles()).toEqual(["News of the day", "電池の古い話"]));
    expect(path()).toBe(`/search?q=${q("電池")}&unread=true`);
  });

  it("come back the same from their URL, as after a reload, with the article that was open", async () => {
    const { server, a, ids } = seeded();
    renderApp({ server, route: `/search/${ids.feed}?q=${q("電池")}&category=${a.slug}` });
    await waitFor(() => expect(rowTitles()).toEqual(["News of the day", "電池の古い話"]));
    await within(await screen.findByRole("article", { name: "記事" })).findByRole("heading", { name: "News of the day" });
    expect(screen.getByRole("combobox", { name: "絞り込み" })).toHaveDisplayValue("Alpha");
  });

  it("keep the words and the narrowing in the path of an opened article", async () => {
    const { server, a, ids } = seeded();
    const { user, path } = renderApp({ server, route: `/search?q=${q("電池")}&category=${a.slug}` });
    await user.click(await within(list()).findByRole("link", { name: /電池の古い話/ }));
    expect(path()).toBe(`/search/${ids.aOld}?q=${q("電池")}&category=${a.slug}`);
  });

  it("offer no way to mark them all as read, and leave them unread", async () => {
    const { server, ids } = seeded();
    const { user } = renderApp({ server, route: `/search?q=${q("電池")}` });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "すべて既読にする" })).not.toBeInTheDocument();
    // Keys that other lists may give to marking everything read do nothing here.
    await user.keyboard("A");
    await user.keyboard("{Shift>}a{/Shift}");
    expect(getArticle(server.db, ids.aOld!).isRead).toBe(false);
    expect(getArticle(server.db, ids.feed!).isRead).toBe(false);
  });

  it("show an excerpt in place of the summary when the match is in the text, and mark the matches", async () => {
    const { server } = seeded();
    renderApp({ server, route: `/search?q=${q("電池")}` });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));
    const feedRow = within(list()).getByRole("link", { name: /News of the day/ });
    const excerpt = feedRow.querySelector("[data-excerpt]")!;
    expect(excerpt.textContent).toMatch(/^…/);
    expect(excerpt.textContent).toContain("新しい電池の工場");
    expect(marks(feedRow)).toEqual(["電池"]);

    // Only the title matches: the usual summary, with the title marked.
    const titleRow = within(list()).getByRole("link", { name: /電池の古い話/ });
    expect(titleRow.querySelector("[data-excerpt]")).toBeNull();
    expect(titleRow).toHaveTextContent("要約");
    expect(marks(titleRow)).toEqual(["電池"]);
  });

  it("mark a match in the translated title that the list shows", async () => {
    const server = makeServer();
    const feed = seedFeed(server.db, { title: "Markets" });
    const id = seedFeedArticle(server.db, feed, { title: "Quarterly results", body: "Revenue rose." });
    saveTranslatedTitle(server.db, id, { original: "Quarterly results", title: "四半期の決算", sourceLanguage: "en" });
    renderApp({ server, route: `/search?q=${q("決算")}` });
    const row = await within(await screen.findByRole("region", { name: "記事の一覧" })).findByRole("link", { name: /四半期の決算/ });
    expect(marks(row)).toEqual(["決算"]);
  });

  it("mark a match in a headline of importance five apart from the importance mark", async () => {
    const server = makeServer();
    server.article(server.category().id, { title: "AI の大きな発表", importance: 5 });
    renderApp({ server, route: `/search?q=ai` });
    const row = await within(await screen.findByRole("region", { name: "記事の一覧" })).findByRole("link", { name: /AI の大きな発表/ });
    const title = row.querySelector("[data-title]")!;
    expect(title).toHaveClass("headline-mark");
    const mark = title.querySelector("mark.search-match")!;
    expect(mark.textContent).toBe("AI");
    expect(row).toHaveTextContent("重要度5。");
  });

  it("say that nothing matched and suggest fewer words", async () => {
    renderApp({ server: seeded().server, route: `/search?q=${q("存在しない語")}` });
    expect(await screen.findByText("「存在しない語」に一致する記事はありません。")).toBeInTheDocument();
    expect(screen.getByText("語を減らすと、見つかることがあります。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "絞り込みを外す" })).not.toBeInTheDocument();
  });

  it("offer to drop the narrowing when nothing matched within it", async () => {
    const { server, a } = seeded();
    const { user, path } = renderApp({ server, route: `/search?q=${q("関係のない")}&category=${a.slug}` });
    expect(await screen.findByText("「関係のない」に一致する記事はありません。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "絞り込みを外す" }));
    await waitFor(() => expect(rowTitles()).toEqual(["関係のない話"]));
    expect(path()).toBe(`/search?q=${q("関係のない")}`);
  });
});

describe("an article opened from the results", () => {
  it("has its headline and every match in its body marked", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "電池の話", body: "電池の工場。\n\n**電池**の値段と `電池` の型。" });
    renderApp({ server, route: `/search/${id}?q=${q("電池")}` });
    const heading = await within(await screen.findByRole("article", { name: "記事" })).findByRole("heading", { name: "電池の話" });
    expect(marks(heading)).toEqual(["電池"]);
    expect(marks(article().querySelector(".article-body") as HTMLElement)).toEqual(["電池", "電池", "電池"]);
  });

  it("is not marked when opened from a list", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "電池の話", body: "電池の工場。" });
    renderApp({ server, route: `/all/${id}` });
    await within(await screen.findByRole("article", { name: "記事" })).findByRole("heading", { name: "電池の話" });
    expect(article().querySelectorAll("mark")).toHaveLength(0);
  });

  it("shows HTML in the body as text while marking", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "話", body: "前 <b>電池</b> 後 <img src=x onerror=alert(1)>" });
    renderApp({ server, route: `/search/${id}?q=${q("電池")}` });
    await within(await screen.findByRole("article", { name: "記事" })).findByRole("heading", { name: "話" });
    const body = article().querySelector(".article-body") as HTMLElement;
    expect(body.querySelector("b")).toBeNull();
    expect(body.querySelector("img")).toBeNull();
  });
});

describe("the results and the order of a list", () => {
  it("are newest first, without the menu of the order, though the category open before is oldest first", async () => {
    const { server, a } = seeded();
    updateListView(server.db, `category-${a.id}`, { sort: "oldest" });
    const { user } = renderApp({ server, route: `/c/${a.slug}` });
    await waitFor(() => expect(rowTitles()).toEqual(["電池の古い話", "News of the day"]));
    expect(within(list()).getByRole("button", { name: "並び順：古い順" })).toBeInTheDocument();

    await user.type(box(), "電池{Enter}");

    await screen.findByRole("heading", { level: 1, name: "「電池」の検索結果" });
    await waitFor(() => expect(rowTitles()).toEqual(["News of the day", "電池の既読の話", "電池の古い話"]));
    expect(within(list()).queryByRole("button", { name: /^並び順/ })).not.toBeInTheDocument();
  });
});

import { addHighlight, insertFeed, listFilters, saveArticleTranslation, saveAutoSummary, saveFullContent, saveTranslatedTitle } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

// Making a hide filter from a selection in a feed article: the menu of the selection, the menu of a right click,
// the dialog with its defaults, and what follows saving.

const opened = () => screen.findByRole("article", { name: "記事" });
const toolbar = () => screen.queryByRole("toolbar", { name: "選んだ文字列" });
const buttonsOf = (element: HTMLElement) => within(element).getAllByRole("button").map((button) => button.textContent);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const MAKE = "隠すフィルターを作る…";

/** Selects the given occurrence of `text` among the characters under `root`, as a mouse would. */
function selectText(root: Element, text: string, occurrence = 0) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  const full = nodes.map((node) => node.data).join("");
  let at = -1;
  for (let count = 0; count <= occurrence; count += 1) at = full.indexOf(text, at + 1);
  if (at === -1) throw new Error(`no ${text}`);
  const point = (position: number, end: boolean): [Text, number] => {
    for (const node of nodes) {
      if (position < node.length || (end && position === node.length)) return [node, position];
      position -= node.length;
    }
    return [nodes.at(-1)!, nodes.at(-1)!.length];
  };
  const range = document.createRange();
  range.setStart(...point(at, false));
  range.setEnd(...point(at + text.length, true));
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** A feed "Shop" in the news category "Deals": the article to open, another sale, and one that is not. */
function shop(body = "春の特売を始めます。\n\n今週だけの値段です。") {
  const server = makeServer();
  const category = server.category("Deals");
  const feed = insertFeed(server.db, { url: "https://shop.example.org/feed.xml", title: "Shop", categoryId: category.id }, server.clock);
  insertFeed(server.db, { url: "https://other.example.org/feed.xml", title: "Other" }, server.clock);
  const id = seedFeedArticle(server.db, feed.id, { title: "特売のお知らせ", body, at: "2026-03-01T03:00:00.000Z" });
  seedFeedArticle(server.db, feed.id, { title: "夏の特売", at: "2026-03-01T02:00:00.000Z" });
  seedFeedArticle(server.db, feed.id, { title: "新製品", at: "2026-03-01T01:00:00.000Z" });
  return { server, feed, id };
}

const filters = (server: TestServer) => listFilters(server.db);

describe("making a hide filter from a selection", () => {
  it("offers it with the highlights for a feed article, opens the dialog with the defaults, counts, saves and undoes", async () => {
    const { server, feed, id } = shop();
    const { user } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    await within(article).findByText(/春の特売/);
    const list = screen.getByRole("region", { name: "記事の一覧" });
    await within(list).findByText("夏の特売");

    selectText(article.querySelector(".article-body")!, "特売");
    const menu = await screen.findByRole("toolbar", { name: "選んだ文字列" });
    expect(buttonsOf(menu)).toEqual(["ハイライト", "メモを書く", MAKE]);
    await user.click(within(menu).getByRole("button", { name: MAKE }));

    const dialog = await screen.findByRole("dialog", { name: "隠すフィルターを作る" });
    expect(within(dialog).getByRole("radio", { name: "隠すフィルター" })).toBeChecked();
    const scope = within(dialog).getByLabelText("範囲") as HTMLSelectElement;
    expect(scope).toHaveValue("all");
    // The feed of the article and its category come right after 全体.
    expect([...scope.options].map((option) => option.textContent)).toEqual(["全体", "購読フィード「Shop」", "カテゴリ「Deals」", "Other"]);
    expect(within(dialog).getByRole("checkbox", { name: "タイトル" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "内容" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "著者" })).not.toBeChecked();
    expect(within(dialog).getByLabelText("条件1の方法")).toHaveValue("contains");
    expect(within(dialog).getByLabelText("条件1の値")).toHaveValue("特売");

    await user.click(within(dialog).getByRole("button", { name: "隠れる件数を確かめる" }));
    expect(await within(dialog).findByText("保存すると、2件が隠れます。")).toBeInTheDocument();
    expect(filters(server)).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "フィルターを追加" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(filters(server)).toMatchObject([
      { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title", "content"], match: "contains", value: "特売" }] },
    ]);
    const notice = await screen.findByText("隠すフィルターを追加しました。2件を隠しています。");
    // The article stays open; the list no longer holds it.
    await waitFor(() => expect(within(list).queryByText("夏の特売")).toBeNull());
    expect(await opened()).toHaveTextContent("春の特売を始めます。");
    expect(document.getSelection()?.isCollapsed ?? true).toBe(true);

    await user.click(within(notice.closest<HTMLElement>("[role=status]")!).getByRole("button", { name: "取り消す" }));
    await waitFor(() => expect(filters(server)).toEqual([]));
    expect(await within(list).findByText("夏の特売")).toBeInTheDocument();
    expect(await screen.findByText(/フィルターを取り消しました。/)).toBeInTheDocument();
  });

  it("offers only the filter for the original title, a range over a highlight and what the feed delivered", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog" }, server.clock);
    const id = seedFeedArticle(server.db, feed.id, { title: "Battery plant", body: "配信された短い文。" });
    saveTranslatedTitle(server.db, id, { original: "Battery plant", title: "電池の工場", sourceLanguage: "en" });
    saveFullContent(server.db, id, { markdown: "全文の最初。\n\nハイライトした文。", text: "全文", now: server.clock().toISOString() });
    addHighlight(server.db, id, { quote: "ハイライトした文。", prefix: "", suffix: "", position: 0, note: null }, server.clock().toISOString());
    const { user } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    await waitFor(() => expect(article.querySelector("mark.annotation-mark")).not.toBeNull());

    // The original title, under the translated one.
    selectText(article.querySelector("[data-filter-source]")!, "Battery");
    expect(buttonsOf(await screen.findByRole("toolbar", { name: "選んだ文字列" }))).toEqual([MAKE]);
    // The translated title is not what the filter matches.
    selectText(within(article).getByRole("heading", { level: 2 }), "電池");
    await settle();
    expect(toolbar()).toBeNull();

    selectText(article.querySelector(".article-body")!, "ハイライト");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toEqual([MAKE]));

    await user.click(within(article).getByRole("button", { name: "配信された内容を表示" }));
    await within(article).findByRole("button", { name: "全文を表示" });
    selectText(article.querySelector(".article-body")!, "短い文");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toEqual([MAKE]));
    await user.click(within(toolbar()!).getByRole("button", { name: MAKE }));
    expect(within(await screen.findByRole("dialog", { name: "隠すフィルターを作る" })).getByLabelText("条件1の値")).toHaveValue("短い文");
  });

  it("is not offered for a generated article", async () => {
    const server = makeServer();
    const category = server.category("Alpha");
    const generated = server.article(category.id, { title: "電池の話", summary: "工場の要約", body: "生成記事の本文です。" });
    renderApp({ server, route: `/all/${generated}` });
    const article = await opened();
    await within(article).findByText("生成記事の本文です。");
    selectText(article.querySelector(".article-body")!, "本文");
    expect(buttonsOf(await screen.findByRole("toolbar", { name: "選んだ文字列" }))).toEqual(["ハイライト", "メモを書く"]);
    selectText(within(article).getByRole("heading", { level: 2 }), "電池");
    await settle();
    expect(toolbar()).toBeNull();
  });

  it("is not offered for a translation, a summary, a long selection or one across paragraphs", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog", translate: true }, server.clock);
    const long = "あ".repeat(201);
    const id = seedFeedArticle(server.db, feed.id, { title: "Post", body: `First part.\n\n${long}` });
    saveArticleTranslation(server.db, id, {
      segments: [
        { original: "First part.", translated: "最初の部分。" },
        { original: long, translated: null },
      ],
      method: "google",
      truncated: false,
      now: server.clock().toISOString(),
    });
    saveAutoSummary(server.db, id, { text: "要約の文。", source: "feed", now: server.clock().toISOString() });
    renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    await within(article).findByText("最初の部分。");
    const noFilter = async (select: () => void) => {
      select();
      await settle();
      const shown = toolbar();
      if (shown) expect(buttonsOf(shown)).not.toContain(MAKE);
    };
    await noFilter(() => selectText(article.querySelector(".segment > div:first-child")!, "最初の"));
    await noFilter(() => selectText(within(article).getByRole("region", { name: "AIによる要約" }), "要約の"));
    await noFilter(() => selectText(article.querySelector(".segment-alone")!, long));
    // From the end of one paragraph of the original to the start of the next.
    const across = document.createRange();
    across.setStart(article.querySelector(".segment-original")!.querySelector("p")!.firstChild!, 6);
    across.setEnd(article.querySelector(".segment-alone p")!.firstChild!, 2);
    await noFilter(() => {
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(across);
    });

    selectText(article.querySelector(".segment-original")!, "part");
    expect(buttonsOf(await screen.findByRole("toolbar", { name: "選んだ文字列" }))).toContain(MAKE);
  });
});

describe("the menu of a right click on the article", () => {
  it("opens over a selection with the actions and copying, and leaves the browser's menu alone without one", async () => {
    const { server, feed, id } = shop();
    const { user } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    const body = await within(article).findByText(/春の特売/);

    expect(fireEvent.contextMenu(body, { button: 2 })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();

    selectText(article.querySelector(".article-body")!, "特売");
    await screen.findByRole("toolbar", { name: "選んだ文字列" });
    // Outside the article, a right click keeps the browser's menu even over a selection.
    expect(fireEvent.contextMenu(screen.getByRole("searchbox", { name: "記事を検索" }), { button: 2 })).toBe(true);
    expect(fireEvent.contextMenu(body, { button: 2, clientX: 40, clientY: 50 })).toBe(false);
    const menu = await screen.findByRole("menu", { name: "選んだ文字列の操作" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["ハイライト", "メモを書く", MAKE, "コピー"]);
    await user.click(within(menu).getByRole("menuitem", { name: MAKE }));
    expect(within(await screen.findByRole("dialog", { name: "隠すフィルターを作る" })).getByLabelText("条件1の値")).toHaveValue("特売");
  });

  it("opens with Shift+F10 over a selection", async () => {
    const { server, feed, id } = shop();
    const { user } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    await within(article).findByText(/春の特売/);
    selectText(article.querySelector(".article-body")!, "特売");
    await screen.findByRole("toolbar", { name: "選んだ文字列" });
    fireEvent.keyDown(article, { key: "F10", shiftKey: true });
    const menu = await screen.findByRole("menu", { name: "選んだ文字列の操作" });
    await user.click(within(menu).getByRole("menuitem", { name: "ハイライト" }));
    await waitFor(() => expect(article.querySelector("mark.annotation-mark")).toHaveTextContent("特売"));
  });
});

describe("keys while the dialog for a hide filter is open", () => {
  it("does not move through the list behind it", async () => {
    const { server, feed, id } = shop();
    const { user, path } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    await within(article).findByText(/春の特売/);
    await within(screen.getByRole("region", { name: "記事の一覧" })).findByText("夏の特売");

    selectText(article.querySelector(".article-body")!, "特売");
    await user.click(within(await screen.findByRole("toolbar", { name: "選んだ文字列" })).getByRole("button", { name: MAKE }));
    const dialog = await screen.findByRole("dialog", { name: "隠すフィルターを作る" });
    within(dialog).getByRole("button", { name: "隠れる件数を確かめる" }).focus();
    await user.keyboard("j");
    await settle();

    expect(path()).toBe(`/f/${feed.id}/${id}`);
    expect(screen.getByRole("dialog", { name: "隠すフィルターを作る" })).toBeInTheDocument();
  });
});

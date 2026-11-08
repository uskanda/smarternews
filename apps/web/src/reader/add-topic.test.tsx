import { createTopic, deleteCategory, insertFeed, listTopics, replaceMentions, saveArticleTranslation, saveAutoSummary, updateCategory } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp } from "../testing/harness.tsx";

// Adding a topic while reading: from the list of the articles of a name, and from the menu of a selection. The
// dialog chooses a category and the text; adding starts no run.

const ADD = "トピックを足す…";
const MAKE_FILTER = "隠すフィルターを作る…";
const opened = () => screen.findByRole("article", { name: "記事" });
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const toolbar = () => screen.queryByRole("toolbar", { name: "選んだ文字列" });
const buttonsOf = (element: HTMLElement) => within(element).getAllByRole("button").map((button) => button.textContent);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const dialog = () => screen.findByRole("dialog", { name: "トピックを足す" });
const n = (name: string) => new URLSearchParams({ name }).toString();

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

/** Categories Alpha (news) and Beta (news), and in Beta an article with the name 日本銀行. */
function seeded() {
  const server = makeServer();
  const alpha = server.category("Alpha");
  const beta = server.category("Beta");
  const id = server.article(beta.id, { title: "利上げの記事", body: "日銀が利上げを決めた。" });
  replaceMentions(server.db, id, [{ name: "日本銀行", kind: "organization" }]);
  return { server, alpha, beta, id };
}

describe("adding a topic from the articles of a name", () => {
  it("opens with the name and the category of the article, adds the topic, and can open its editor", async () => {
    const { server, beta, id } = seeded();
    const { user, requests } = renderApp({ server, route: `/mentions/${id}?${n("日本銀行")}` });
    await within(await opened()).findByRole("heading", { name: "利上げの記事" });

    await user.click(await within(list()).findByRole("button", { name: ADD }));
    const form = await dialog();
    expect(within(form).getByLabelText("文章")).toHaveValue("日本銀行");
    await waitFor(() => expect(within(form).getByLabelText("カテゴリ")).toHaveDisplayValue("Beta"));
    expect(within(form).getAllByRole("option").map((option) => option.textContent)).toEqual(["Alpha", "Beta"]);

    await user.click(within(form).getByRole("button", { name: "追加する" }));
    await waitFor(() => expect(listTopics(server.db, beta.id).map((topic) => topic.text)).toEqual(["日本銀行"]));
    const notice = await screen.findByText("追加しました。次の実行で解釈されます。");
    expect(screen.queryByRole("dialog", { name: "トピックを足す" })).toBeNull();
    // The article and the list stay; no run starts.
    expect(within(await opened()).getByRole("heading", { name: "利上げの記事" })).toBeInTheDocument();
    expect(list()).toBeInTheDocument();
    expect(requests.filter((request) => request.startsWith("POST") && request.endsWith("/runs"))).toEqual([]);

    const topic = listTopics(server.db, beta.id)[0]!;
    await user.click(within(notice.closest<HTMLElement>("[role=status]")!).getByRole("button", { name: "編集する" }));
    const text = await screen.findByLabelText("トピックの文章");
    expect(text).toHaveValue("日本銀行");
    expect(text.closest("li")).toHaveAttribute("id", `topic-${topic.id}`);
  });

  it("is not offered without a news or event category", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog" }, server.clock);
    const id = seedFeedArticle(server.db, feed.id, { title: "記事", body: "日銀の話。" });
    replaceMentions(server.db, id, [{ name: "日本銀行", kind: "organization" }]);
    renderApp({ server, route: `/mentions/${id}?${n("日本銀行")}` });
    await within(list()).findByRole("heading", { name: "「日本銀行」を含む記事" });
    await settle();
    expect(within(list()).queryByRole("button", { name: ADD })).toBeNull();
  });

  it("stays open with the reason when adding fails", async () => {
    const { server, beta, id } = seeded();
    const { user } = renderApp({ server, route: `/mentions/${id}?${n("日本銀行")}` });
    await within(await opened()).findByRole("heading", { name: "利上げの記事" });
    await user.click(await within(list()).findByRole("button", { name: ADD }));
    const form = await dialog();
    await waitFor(() => expect(within(form).getByLabelText("カテゴリ")).toHaveDisplayValue("Beta"));
    deleteCategory(server.db, beta.id);

    await user.click(within(form).getByRole("button", { name: "追加する" }));
    expect(await within(form).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "トピックを足す" })).toBeInTheDocument();
    expect(screen.queryByText("追加しました。次の実行で解釈されます。")).toBeNull();
  });

  it("tells of a topic with the same text, links to it, and still adds", async () => {
    const { server, beta, id } = seeded();
    const same = createTopic(server.db, beta.id, { text: "Ｂａｎｋ ｏｆ Ｊａｐａｎ" }, server.clock);
    const { user } = renderApp({ server, route: `/mentions/${id}?${n("日本銀行")}` });
    await within(await opened()).findByRole("heading", { name: "利上げの記事" });
    await user.click(await within(list()).findByRole("button", { name: ADD }));
    const form = await dialog();
    await waitFor(() => expect(within(form).getByLabelText("カテゴリ")).toHaveDisplayValue("Beta"));
    expect(within(form).queryByText("同じ文章のトピックがあります。")).toBeNull();

    const field = within(form).getByLabelText("文章");
    await user.clear(field);
    await user.type(field, "  bank of japan ");
    expect(await within(form).findByText("同じ文章のトピックがあります。")).toBeInTheDocument();
    expect(within(form).getByRole("link", { name: "そのトピックを編集する" })).toHaveAttribute("href", `/settings/categories/${beta.id}#topic-${same.id}`);

    await user.click(within(form).getByRole("button", { name: "追加する" }));
    await waitFor(() => expect(listTopics(server.db, beta.id)).toHaveLength(2));
  });
});

describe("adding a topic from a selection", () => {
  it("is offered for the body of a generated article, after the highlights, and adds to its category", async () => {
    const { server, beta, id } = seeded();
    const { user } = renderApp({ server, route: `/all/${id}` });
    const article = await opened();
    await within(article).findByText("日銀が利上げを決めた。");

    selectText(article.querySelector(".article-body")!, "利上げ");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toEqual(["ハイライト", "メモを書く", ADD]));
    await user.click(within(toolbar()!).getByRole("button", { name: ADD }));
    const form = await dialog();
    expect(within(form).getByLabelText("文章")).toHaveValue("利上げ");
    await waitFor(() => expect(within(form).getByLabelText("カテゴリ")).toHaveDisplayValue("Beta"));
    await user.click(within(form).getByRole("button", { name: "追加する" }));
    await waitFor(() => expect(listTopics(server.db, beta.id).map((topic) => topic.text)).toEqual(["利上げ"]));
    expect(toolbar()).toBeNull();
  });

  it("is offered for the title of a generated article, and in the menu of a right click", async () => {
    const { server, id } = seeded();
    const { user } = renderApp({ server, route: `/all/${id}` });
    const article = await opened();
    await within(article).findByText("日銀が利上げを決めた。");

    const heading = within(article).getByRole("heading", { level: 2 });
    selectText(heading, "利上げ");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toEqual([ADD]));
    expect(fireEvent.contextMenu(heading, { button: 2, clientX: 40, clientY: 50 })).toBe(false);
    const menu = await screen.findByRole("menu", { name: "選んだ文字列の操作" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([ADD, "コピー"]);
    await user.click(within(menu).getByRole("menuitem", { name: ADD }));
    expect(within(await dialog()).getByLabelText("文章")).toHaveValue("利上げ");
  });

  it("puts a line break in the selection as a space in the draft", async () => {
    const server = makeServer();
    const category = server.category("Alpha");
    const id = server.article(category.id, { title: "記事", body: "日銀が\n利上げを決めた。" });
    const { user } = renderApp({ server, route: `/all/${id}` });
    const article = await opened();
    await within(article).findByText(/利上げを決めた/);

    selectText(article.querySelector(".article-body")!, "日銀が\n利上げ");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toContain(ADD));
    await user.click(within(toolbar()!).getByRole("button", { name: ADD }));
    expect(within(await dialog()).getByLabelText("文章")).toHaveValue("日銀が 利上げ");
  });

  it("is offered alone for a translation and a summary, with line breaks as spaces, and not for a long selection", async () => {
    const server = makeServer();
    server.category("Alpha");
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
    const { user } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    await within(article).findByText("最初の部分。");

    selectText(article.querySelector(".segment > div:first-child")!, "最初の");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toEqual([ADD]));
    selectText(within(article).getByRole("region", { name: "AIによる要約" }), "要約の");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toEqual([ADD]));
    // The original offers the highlights, the filter and the topic.
    selectText(article.querySelector(".segment-original")!, "part");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toEqual(["ハイライト", "メモを書く", MAKE_FILTER, ADD]));

    selectText(article.querySelector(".segment-alone")!, long);
    await settle();
    const shown = toolbar();
    if (shown) expect(buttonsOf(shown)).not.toContain(ADD);

    // A translation starts in the first category, as the feed belongs to none.
    selectText(article.querySelector(".segment > div:first-child")!, "部分");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toEqual([ADD]));
    await user.click(within(toolbar()!).getByRole("button", { name: ADD }));
    const form = await dialog();
    expect(within(form).getByLabelText("文章")).toHaveValue("部分");
    expect(within(form).getByLabelText("カテゴリ")).toHaveDisplayValue("Alpha");
  });

  it("starts in the first category of the left pane for an article without a category", async () => {
    const server = makeServer();
    const off = server.category("Off");
    updateCategory(server.db, off.id, { enabled: false });
    server.category("Events", "event");
    server.category("Gamma");
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog" }, server.clock);
    const id = seedFeedArticle(server.db, feed.id, { title: "Post", body: "配信された文。" });
    const { user } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    await within(article).findByText("配信された文。");

    selectText(article.querySelector(".article-body")!, "配信");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toContain(ADD));
    await user.click(within(toolbar()!).getByRole("button", { name: ADD }));
    const form = await dialog();
    expect(within(form).getAllByRole("option").map((option) => option.textContent)).toEqual(["Off", "Events", "Gamma"]);
    expect(within(form).getByLabelText("カテゴリ")).toHaveDisplayValue("Events");
  });

  it("is not offered without a news or event category", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog" }, server.clock);
    const id = seedFeedArticle(server.db, feed.id, { title: "Post", body: "配信された文。" });
    renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    await within(article).findByText("配信された文。");
    selectText(article.querySelector(".article-body")!, "配信");
    await waitFor(() => expect(buttonsOf(toolbar()!)).toEqual(["ハイライト", "メモを書く", MAKE_FILTER]));
  });
});

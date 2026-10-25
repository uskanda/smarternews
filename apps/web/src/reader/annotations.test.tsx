import { addHighlight, createFilter, insertFeed, saveArticleNote, saveArticleTranslation, saveAutoSummary, saveFullContent, saveTranslatedTitle } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { createTermMatcher } from "@smarternews/client";
import { ANNOTATION_SAMPLE_MARKDOWN, ANNOTATION_SAMPLE_TEXT, withoutSpaces } from "@smarternews/client/testing";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";
import { useBodyAnnotations } from "./Annotations.tsx";
import { SKIP_ATTRIBUTE } from "./highlight.tsx";
import { Markdown } from "./Markdown.tsx";

const BODY = "最初の段落です。\n\n電池の工場を新設すると発表した。\n\n最後の段落です。";
const QUOTE = "電池の工場を新設する";
const opened = () => screen.findByRole("article", { name: "記事" });
const pane = () => screen.getByRole("article", { name: "記事" });
const menu = () => screen.queryByRole("toolbar", { name: "選んだ文字列" });
const marks = (root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>("mark.annotation-mark")];
const marked = (root: ParentNode = document) => marks(root).map((mark) => mark.textContent);
const stored = (server: TestServer) => server.db.prepare("SELECT kind, quote, prefix, suffix, position, note FROM annotations ORDER BY id").all();
const anchor = (quote: string, note: string | null = null) => ({ quote, prefix: "", suffix: "", position: 0, note });

/** The text of the text nodes under `root`, without those of skipped elements. */
function drawnText(root: Element): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest(`[${SKIP_ATTRIBUTE}]`)) text += (node as Text).data;
  }
  return text;
}

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

function generated(server: TestServer, body = BODY) {
  const category = server.category("Alpha");
  return server.article(category.id, { title: "電池の話", summary: "工場の要約", body });
}

describe("the text a body is drawn from", () => {
  it("is the text of the tree, the same as the text of the page apart from descriptions of images", () => {
    let told = "";
    const { container } = render(<Markdown text={ANNOTATION_SAMPLE_MARKDOWN} images annotations={{ ranges: [], onText: (text) => (told = text) }} />);
    expect(withoutSpaces(told)).toBe(ANNOTATION_SAMPLE_TEXT);
    expect(withoutSpaces(drawnText(container))).toBe(ANNOTATION_SAMPLE_TEXT);
    // The description of an image without the relay is shown, and kept out of the text.
    expect(container).toHaveTextContent("工場の写真");
  });

  it("leaves out the description shown for an image that could not be loaded", () => {
    let told = "";
    const { container } = render(<Markdown text={"前の文。\n\n![図の説明](/api/v1/image-proxy/a/b)\n\n後の文。"} images annotations={{ ranges: [], onText: (text) => (told = text) }} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container).toHaveTextContent("図の説明");
    expect(withoutSpaces(drawnText(container))).toBe("前の文。後の文。");
    expect(withoutSpaces(told)).toBe("前の文。後の文。");
  });
});

describe("the marks of highlights in a body", () => {
  it("are outside the marks of terms and of the search, leave links as they were, and draw tags as characters", () => {
    const groups = createTermMatcher([{ id: 1, name: "電池", color: "green", terms: [{ id: 1, text: "電池" }] }]);
    const text = "[電池の工場](https://example.org/plant)を新設する <script>alert(1)</script>";
    let told = "";
    const probe = render(<Markdown text={text} annotations={{ ranges: [], onText: (found) => (told = found) }} />);
    probe.unmount();
    const start = told.indexOf("電池");
    const end = told.indexOf("</script>") + "</script>".length;
    const { container } = render(
      <Markdown
        text={text}
        highlight={["工場"]}
        groups={groups}
        annotations={{ ranges: [{ start, end, id: 7, note: true, first: true, last: true }] }}
      />,
    );
    const highlight = marks(container);
    expect(highlight.length).toBeGreaterThan(1);
    expect(highlight[0]!.querySelector("mark.term-match")).toHaveTextContent("電池");
    expect(highlight[0]!.querySelector("mark.search-match")).toHaveTextContent("工場");
    expect(highlight[0]).toHaveAttribute("tabindex", "0");
    expect(highlight[0]).toHaveAttribute("role", "button");
    expect(highlight[0]).toHaveAccessibleName("ハイライト、メモあり");
    expect(highlight.slice(1).every((mark) => !mark.hasAttribute("tabindex"))).toBe(true);
    expect(container.querySelector("a")).toHaveAttribute("href", "https://example.org/plant");
    expect(container.querySelector("script")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
    // The icon of the note follows the last part, and adds no characters.
    expect(highlight.at(-1)!.nextElementSibling).toHaveClass("annotation-note-icon");
    expect(container.querySelectorAll(".annotation-note-icon")).toHaveLength(1);
  });
});

describe("highlighting a selection", () => {
  it("offers the menu for a sentence of the body, highlights it, and lists it in the annotations", async () => {
    const server = makeServer();
    const id = generated(server);
    const { user, requests } = renderApp({ server, route: `/all/${id}` });
    const article = await opened();
    await within(article).findByText(/電池の工場/);

    selectText(article.querySelector(".article-body")!, QUOTE);
    const toolbar = await screen.findByRole("toolbar", { name: "選んだ文字列" });
    expect(within(toolbar).getAllByRole("button").map((button) => button.textContent)).toEqual(["ハイライト", "メモを書く"]);
    await user.click(within(toolbar).getByRole("button", { name: "ハイライト" }));

    await waitFor(() => expect(marked(article)).toEqual([QUOTE]));
    expect(stored(server)).toEqual([{ kind: "highlight", quote: QUOTE, prefix: "最初の段落です。", suffix: "と発表した。最後の段落です。", position: 8, note: null }]);
    expect(requests.filter((request) => request.startsWith("POST /api/v1/articles/"))).toContain(`POST /api/v1/articles/${id}/highlights`);

    await user.click(screen.getByRole("link", { name: "注釈" }));
    const list = await screen.findByRole("region", { name: "注釈の一覧" });
    expect(await within(list).findByText(QUOTE)).toBeInTheDocument();
  });

  it("writes a note with the menu, and marks the highlight as one with a note", async () => {
    const server = makeServer();
    const id = generated(server);
    const { user } = renderApp({ server, route: `/all/${id}` });
    const article = await opened();
    await within(article).findByText(/電池の工場/);

    selectText(article.querySelector(".article-body")!, QUOTE);
    await user.click(within(await screen.findByRole("toolbar", { name: "選んだ文字列" })).getByRole("button", { name: "メモを書く" }));
    const dialog = await screen.findByRole("dialog", { name: "メモを書いてハイライトする" });
    await user.type(within(dialog).getByLabelText("メモ"), "規模を確かめる");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(within(article).getByRole("button", { name: "ハイライト、メモあり" })).toHaveTextContent(QUOTE));
    expect(article.querySelectorAll(".annotation-note-icon")).toHaveLength(1);
    expect(stored(server)).toMatchObject([{ quote: QUOTE, note: "規模を確かめる" }]);
  });

  it("offers nothing, and h does nothing, for the summary, the title, a translation or a range over a highlight", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog", translate: true }, server.clock);
    const id = seedFeedArticle(server.db, feed.id, { title: "Battery plant", body: "The plant opens. It is new." });
    saveTranslatedTitle(server.db, id, { original: "Battery plant", title: "電池の工場", sourceLanguage: "en" });
    saveArticleTranslation(server.db, id, { segments: [{ original: "The plant opens. It is new.", translated: "工場が開く。新しい。" }], method: "google", truncated: false, now: server.clock().toISOString() });
    saveAutoSummary(server.db, id, { text: "要約の文。", source: "feed", now: server.clock().toISOString() });
    addHighlight(server.db, id, anchor("The plant opens."), server.clock().toISOString());
    const { user } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    await waitFor(() => expect(marked(article)).toEqual(["The plant opens."]));

    const tryKey = async (root: Element, text: string) => {
      selectText(root, text);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(menu()).toBeNull();
      await user.keyboard("h");
      expect(stored(server)).toHaveLength(1);
    };
    await tryKey(article.querySelector(".segment > div:first-child")!, "工場が開く");
    await tryKey(within(article).getByRole("region", { name: "AIによる要約" }), "要約の文");
    await tryKey(within(article).getByRole("heading", { level: 2 }), "電池の工場");
    await tryKey(article.querySelector(".segment-original")!, "opens. It is");
    // Across the original and its translation.
    const both = document.createRange();
    both.setStart(article.querySelector(".segment > div:first-child")!.firstChild!, 0);
    both.setEnd(article.querySelector(".segment-original")!, 1);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(both);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(menu()).toBeNull();

    // The original apart from the highlight can be highlighted, and only there.
    selectText(article.querySelector(".segment-original")!, "It is new.");
    expect(await screen.findByRole("toolbar", { name: "選んだ文字列" })).toBeInTheDocument();
    expect(article.querySelector(".segment > div:first-child mark.annotation-mark")).toBeNull();
  });

  it("highlights the selection with h, and does nothing with h without one or while typing", async () => {
    const server = makeServer();
    const id = generated(server);
    const { user } = renderApp({ server, route: `/all/${id}` });
    const article = await opened();
    await within(article).findByText(/電池の工場/);

    await user.keyboard("h");
    expect(stored(server)).toEqual([]);
    await user.click(screen.getByRole("searchbox", { name: "記事を検索" }));
    await user.keyboard("h");
    expect(stored(server)).toEqual([]);

    selectText(article.querySelector(".article-body")!, "最後の段落");
    await screen.findByRole("toolbar", { name: "選んだ文字列" });
    // Out of the search box, as a reader would after typing there.
    (document.activeElement as HTMLElement).blur();
    await user.keyboard("h");
    await waitFor(() => expect(marked(article)).toEqual(["最後の段落"]));
    expect(stored(server)).toMatchObject([{ quote: "最後の段落", note: null }]);
  });

  it("is listed among the keys", async () => {
    const { user } = renderApp({ route: "/all" });
    await screen.findByRole("region", { name: "記事の一覧" });
    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "キー操作" });
    expect(within(dialog).getByText("選んだ文字列をハイライトする")).toBeInTheDocument();
  });
});

describe("a highlight in the body", () => {
  it("is found again after a paragraph is put before it, and the body is drawn once more only when there are highlights", async () => {
    const server = makeServer();
    const id = generated(server, `前に足した段落。\n\n${BODY}`);
    const plain = generated(server, "ハイライトのない本文。");
    addHighlight(server.db, id, { ...anchor(QUOTE), prefix: "最初の段落です。", position: 8 }, server.clock().toISOString());
    renderApp({ server, route: `/all/${id}` });
    const article = await opened();
    await waitFor(() => expect(marked(article)).toEqual([QUOTE]));
    expect(marks(article)[0]!.closest("p")).toHaveTextContent("電池の工場を新設すると発表した。");
    void plain;
  });

  it("opens with Enter, takes a note, and gives the focus back to the highlight", async () => {
    const server = makeServer();
    const id = generated(server);
    addHighlight(server.db, id, anchor(QUOTE), server.clock().toISOString());
    const { user } = renderApp({ server, route: `/all/${id}` });
    const article = await opened();
    const highlight = await within(article).findByRole("button", { name: "ハイライト" });

    highlight.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "ハイライト" });
    expect(dialog).toHaveTextContent(QUOTE);
    await user.click(within(dialog).getByRole("button", { name: "メモを書く" }));
    await user.type(within(dialog).getByLabelText("メモ"), "数字を確かめる");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const noted = within(article).getByRole("button", { name: "ハイライト、メモあり" });
    expect(noted).toHaveFocus();
    expect(stored(server)).toMatchObject([{ note: "数字を確かめる" }]);
  });

  it("rewrites its note when pressed, and the row of the list follows without reading the list again", async () => {
    const server = makeServer();
    const id = generated(server);
    const highlight = addHighlight(server.db, id, anchor(QUOTE, "古いメモ"), server.clock().toISOString());
    const { user, requests } = renderApp({ server, route: `/annotations/${id}?annotation=${highlight.id}` });
    const list = await screen.findByRole("region", { name: "注釈の一覧" });
    await within(list).findByText("古いメモ");
    const article = await opened();
    await user.click(await within(article).findByRole("button", { name: "ハイライト、メモあり" }));
    const dialog = await screen.findByRole("dialog", { name: "ハイライト" });
    expect(within(dialog).getByRole("region", { name: "メモ" })).toHaveTextContent("古いメモ");
    await user.click(within(dialog).getByRole("button", { name: "メモを書き直す" }));
    const field = within(dialog).getByLabelText("メモ");
    await user.clear(field);
    await user.type(field, "新しいメモ");
    const before = requests.filter((request) => request.startsWith("GET /api/v1/annotations")).length;
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    expect(await within(list).findByText("新しいメモ")).toBeInTheDocument();
    expect(requests.filter((request) => request.startsWith("GET /api/v1/annotations"))).toHaveLength(before);
  });

  it("is removed at once without a note, and only after a question with one", async () => {
    const server = makeServer();
    const id = generated(server);
    addHighlight(server.db, id, anchor("最初の段落"), server.clock().toISOString());
    addHighlight(server.db, id, anchor("最後の段落", "残すメモ"), server.clock().toISOString());
    const { user } = renderApp({ server, route: `/all/${id}` });
    const article = await opened();

    await user.click(await within(article).findByRole("button", { name: "ハイライト" }));
    await user.click(within(await screen.findByRole("dialog", { name: "ハイライト" })).getByRole("button", { name: "ハイライトを消す" }));
    await waitFor(() => expect(marked(article)).toEqual(["最後の段落"]));
    expect(stored(server)).toHaveLength(1);

    await user.click(within(article).getByRole("button", { name: "ハイライト、メモあり" }));
    await user.click(within(await screen.findByRole("dialog", { name: "ハイライト" })).getByRole("button", { name: "ハイライトを消す" }));
    const question = await screen.findByRole("alertdialog", { name: "ハイライトを消しますか" });
    expect(question).toHaveTextContent("メモも一緒に消えます");
    expect(stored(server)).toHaveLength(1);
    await user.click(within(question).getByRole("button", { name: "消す" }));
    await waitFor(() => expect(marked(article)).toEqual([]));
    expect(stored(server)).toEqual([]);
  });

  it("is listed after the body when the body no longer holds it, and opens from there", async () => {
    const server = makeServer();
    const id = generated(server);
    const other = generated(server);
    addHighlight(server.db, id, anchor("書き換えで消えた文。", "そのメモ"), server.clock().toISOString());
    addHighlight(server.db, other, anchor(QUOTE), server.clock().toISOString());
    const { user } = renderApp({ server, route: `/all/${other}` });
    let article = await opened();
    await waitFor(() => expect(marked(article)).toEqual([QUOTE]));
    expect(within(article).queryByRole("region", { name: "元の本文にあった箇所" })).toBeNull();

    await user.click(screen.getAllByRole("link", { name: /電池の話/ }).find((link) => link.getAttribute("href")?.endsWith(`/${id}`))!);
    article = await opened();
    const section = await within(article).findByRole("region", { name: "元の本文にあった箇所" });
    expect(section).toHaveTextContent("書き換えで消えた文。");
    expect(section).toHaveTextContent("そのメモ");
    expect(section.querySelector("mark")).toBeNull();
    await user.click(within(section).getByRole("button", { name: /書き換えで消えた文。/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "ハイライト" })).getByRole("button", { name: "ハイライトを消す" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "消す" }));
    await waitFor(() => expect(within(article).queryByRole("region", { name: "元の本文にあった箇所" })).toBeNull());
  });

  it("is not shown, nor offered, while what the feed delivered is shown in place of the full content", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog" }, server.clock);
    const id = seedFeedArticle(server.db, feed.id, { title: "Post", body: "配信された短い文。" });
    saveFullContent(server.db, id, { markdown: "全文の最初。\n\n配信された短い文。\n\n全文の続き。", text: "全文", now: server.clock().toISOString() });
    addHighlight(server.db, id, anchor("配信された短い文。"), server.clock().toISOString());
    const { user } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    await waitFor(() => expect(marked(article)).toEqual(["配信された短い文。"]));

    await user.click(within(article).getByRole("button", { name: "配信された内容を表示" }));
    await within(article).findByRole("button", { name: "全文を表示" });
    expect(marked(article)).toEqual([]);
    expect(within(article).queryByRole("region", { name: "元の本文にあった箇所" })).toBeNull();
    selectText(article.querySelector(".article-body")!, "配信された");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(menu()).toBeNull();

    await user.click(within(article).getByRole("button", { name: "全文を表示" }));
    await waitFor(() => expect(marked(article)).toEqual(["配信された短い文。"]));
  });
});

describe("the note on a whole article", () => {
  it("is written with the button above the body, shown above it as written, and removed by saving it empty", async () => {
    const server = makeServer();
    const id = generated(server);
    const { user } = renderApp({ server, route: `/all/${id}` });
    const article = await opened();

    await user.click(await within(article).findByRole("button", { name: "メモを書く" }));
    const field = await within(article).findByLabelText("記事へのメモ");
    await user.type(field, "<script>alert(1)</script>{Enter}**二行目**");
    await user.click(within(article).getByRole("button", { name: "保存" }));

    const note = await within(article).findByRole("region", { name: "記事へのメモ" });
    expect(note.querySelector("p")!.textContent).toBe("<script>alert(1)</script>\n**二行目**");
    expect(note.querySelector("script, strong")).toBeNull();
    expect(note.compareDocumentPosition(article.querySelector(".article-body")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(within(article).getByRole("button", { name: "メモを書き直す" }));
    const again = within(article).getByLabelText("記事へのメモ");
    expect(again).toHaveValue("<script>alert(1)</script>\n**二行目**");
    await user.clear(again);
    await user.click(within(article).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(within(article).queryByRole("region", { name: "記事へのメモ" })).toBeNull());
    expect(stored(server)).toEqual([]);
  });

  it("is shown whichever content of a feed article is shown", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog" }, server.clock);
    const id = seedFeedArticle(server.db, feed.id, { title: "Post", body: "配信。" });
    saveFullContent(server.db, id, { markdown: "全文。", text: "全文。", now: server.clock().toISOString() });
    saveArticleNote(server.db, id, "あとで比べる", server.clock().toISOString());
    const { user } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const article = await opened();
    expect(await within(article).findByRole("region", { name: "記事へのメモ" })).toHaveTextContent("あとで比べる");
    await user.click(within(article).getByRole("button", { name: "配信された内容を表示" }));
    expect(within(article).getByRole("region", { name: "記事へのメモ" })).toHaveTextContent("あとで比べる");
  });
});

describe("the list of annotations", () => {
  it("says there are none and how to make one, without the controls of an article list", async () => {
    renderApp({ route: "/annotations" });
    const list = await screen.findByRole("region", { name: "注釈の一覧" });
    expect(await within(list).findByText("注釈はまだありません。")).toBeInTheDocument();
    expect(list).toHaveTextContent("本文の文字を選ぶと、ハイライトを付けたり、メモを書いたりできます。");
    expect(within(list).queryByRole("button", { name: "すべて既読にする" })).toBeNull();
    expect(within(list).queryByRole("checkbox")).toBeNull();
  });

  it("lists every annotation the last made first, with the article's title, the quote or that it is a note, and the note", async () => {
    const server = makeServer();
    const a = generated(server);
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog" }, server.clock);
    const b = seedFeedArticle(server.db, feed.id, { title: "Original title", body: "本文。" });
    saveTranslatedTitle(server.db, b, { original: "Original title", title: "訳したタイトル", sourceLanguage: "en" });
    const at = (minutes: number) => new Date(server.clock().getTime() - minutes * 60_000).toISOString();
    addHighlight(server.db, a, anchor("最初の段落"), at(24 * 60));
    saveArticleNote(server.db, b, "記事全体のメモ", at(60));
    addHighlight(server.db, a, anchor(QUOTE, "規模を確かめる"), at(10));
    renderApp({ server, route: "/annotations" });
    const list = await screen.findByRole("region", { name: "注釈の一覧" });
    await within(list).findByText(QUOTE);

    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("[data-title]")!.textContent)).toEqual(["電池の話", "訳したタイトル", "電池の話"]);
    expect(rows[0]!.querySelector("[data-quote]")).toHaveTextContent(QUOTE);
    expect(rows[0]!.querySelector("[data-note]")).toHaveTextContent("規模を確かめる");
    expect(rows[1]!.querySelector("[data-article-note]")).toHaveTextContent("記事へのメモ");
    expect(rows[1]!.querySelector("[data-note]")).toHaveTextContent("記事全体のメモ");
    expect(rows[2]!.querySelector("[data-note]")).toBeNull();
  });

  it("opens the article at the highlight chosen, moves with j and k, and shows the top for a note", async () => {
    const server = makeServer();
    const long = `${Array.from({ length: 30 }, (_, index) => `段落${index}。`).join("\n\n")}\n\n末尾近くの大事な文。`;
    const a = generated(server, long);
    const gone = generated(server);
    const b = generated(server);
    const at = (minutes: number) => new Date(server.clock().getTime() - minutes * 60_000).toISOString();
    const near = addHighlight(server.db, a, anchor("末尾近くの大事な文。"), at(30));
    const lost = addHighlight(server.db, gone, anchor("どこにもない文。"), at(20));
    saveArticleNote(server.db, b, "全体へのメモ", at(10));
    const { user, path } = renderApp({ server, route: "/annotations" });
    const list = await screen.findByRole("region", { name: "注釈の一覧" });
    await within(list).findByText("末尾近くの大事な文。");

    await user.click(within(list).getByText("末尾近くの大事な文。"));
    expect(path()).toBe(`/annotations/${a}?annotation=${near.id}`);
    const article = await opened();
    await waitFor(() => expect(within(article).getByRole("button", { name: "ハイライト" })).toHaveFocus());

    await user.keyboard("k");
    await waitFor(() => expect(path()).toBe(`/annotations/${gone}?annotation=${lost.id}`));
    await waitFor(() => expect(within(pane()).getByRole("button", { name: /元の本文にあった箇所：どこにもない文。/ })).toHaveFocus());

    await user.keyboard("k");
    await waitFor(() => expect(path()).toMatch(new RegExp(`^/annotations/${b}\\?annotation=\\d+$`)));
    expect(await within(pane()).findByRole("region", { name: "記事へのメモ" })).toHaveTextContent("全体へのメモ");
    await user.keyboard("j");
    await waitFor(() => expect(path()).toBe(`/annotations/${gone}?annotation=${lost.id}`));
  });
});

describe("an excerpt from a note in the search results", () => {
  it("says メモ before it, with the word marked", async () => {
    const server = makeServer();
    const id = generated(server);
    addHighlight(server.db, id, anchor(QUOTE, "前年と比較してから決める"), server.clock().toISOString());
    renderApp({ server, route: `/search?q=${encodeURIComponent("比較")}` });
    const list = await screen.findByRole("region", { name: "記事の一覧" });
    const excerpt = await waitFor(() => {
      const found = list.querySelector("[data-excerpt]");
      if (!found) throw new Error("no excerpt yet");
      return found;
    });
    expect(excerpt.querySelector("[data-excerpt-note]")).toHaveTextContent("メモ");
    expect(excerpt).toHaveTextContent(/^メモ前年と比較してから決める$/);
    expect(excerpt.querySelector("mark.search-match")).toHaveTextContent("比較");
  });
});

describe("drawing a body again for its highlights", () => {
  const highlight = { id: 1, articleId: 1, ...anchor("電池"), createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" };

  it("happens once when there are highlights, and never without", () => {
    let renders = 0;
    const count = (highlights: (typeof highlight)[]) =>
      renderHook(() => {
        renders += 1;
        return useBodyAnnotations(highlights, 1, true);
      });

    const without = count([]);
    act(() => without.result.current.marksFor(0)!.onText!("電池の話"));
    act(() => without.result.current.marksFor(0)!.onText!("電池の話"));
    expect(renders).toBe(1);
    expect(without.result.current.located).toBeNull();

    renders = 0;
    const withOne = count([highlight]);
    act(() => withOne.result.current.marksFor(0)!.onText!("電池の話"));
    act(() => withOne.result.current.marksFor(0)!.onText!("電池の話"));
    expect(renders).toBe(2);
    expect(withOne.result.current.marksFor(0)!.ranges).toEqual([{ start: 0, end: 2, id: 1, note: false, first: true, last: true }]);
  });
});

describe("an annotation on a feed article that filters hide", () => {
  it("brings it back to the list and the counts at once, and hides it again when the annotation goes", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog" }, server.clock);
    const id = seedFeedArticle(server.db, feed.id, { title: "特売の話", body: "特売の本文。" });
    createFilter(server.db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "特売" }] }, server.clock);
    const { user, requests } = renderApp({ server, route: `/all/${id}` });
    const article = await opened();
    const list = screen.getByRole("region", { name: "記事の一覧" });
    await within(list).findByText("記事はまだありません。カテゴリを実行すると、ここに並びます。");

    await user.click(await within(article).findByRole("button", { name: "メモを書く" }));
    await user.type(await within(article).findByLabelText("記事へのメモ"), "残す");
    const counted = requests.filter((request) => request === "GET /api/v1/counts").length;
    await user.click(within(article).getByRole("button", { name: "保存" }));
    expect(await within(list).findByText("特売の話")).toBeInTheDocument();
    await waitFor(() => expect(requests.filter((request) => request === "GET /api/v1/counts").length).toBeGreaterThan(counted));

    await user.click(within(article).getByRole("button", { name: "メモを書き直す" }));
    await user.clear(await within(article).findByLabelText("記事へのメモ"));
    await user.click(within(article).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(within(list).queryByText("特売の話")).toBeNull());
  });
});

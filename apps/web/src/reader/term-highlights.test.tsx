import { addHighlightTerm, createTermGroup, insertFeed, saveArticleTranslation, saveAutoSummary, saveTranslatedTitle, type TermColor } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const AT = "2026-03-01T11:00:00.000Z";
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const opened = () => screen.findByRole("article", { name: "記事" });

/** The coloured places of an element, as `text:colour`. */
const colored = (element: Element) => [...element.querySelectorAll("mark.term-match")].map((mark) => `${mark.textContent}:${mark.getAttribute("data-term")}`);
const badges = (row: Element) => [...row.querySelectorAll("[data-term-badge]")].map((badge) => `${badge.textContent}:${badge.getAttribute("data-term")}`);
const row = (title: string) => within(list()).getAllByRole("listitem").find((item) => item.querySelector("[data-title]")?.textContent === title)!;

function group(server: TestServer, name: string, color: TermColor, ...terms: string[]) {
  const created = createTermGroup(server.db, { name, color }, server.clock);
  for (const text of terms) addHighlightTerm(server.db, created.id, { text }, server.clock);
  return created;
}

function withFeed(options: { translate?: boolean } = {}) {
  const server = makeServer();
  const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog", ...options }, server.clock);
  return { server, feed };
}

describe("term highlights in the list", () => {
  it("colour the summary line of a generated article and the translated title of a feed article", async () => {
    const { server, feed } = withFeed();
    group(server, "規制", "green", "規制");
    const category = server.category("Alpha");
    server.article(category.id, { title: "半導体の話", summary: "新しい規制案が出た" });
    const delivered = seedFeedArticle(server.db, feed.id, { title: "New rules", at: AT });
    saveTranslatedTitle(server.db, delivered, { original: "New rules", title: "新しい規制", sourceLanguage: "en" });
    renderApp({ server, route: "/all" });

    // The list and the term groups arrive in two requests; under the load of the whole suite the second can take over a second.
    await waitFor(() => expect(colored(row("半導体の話"))).toEqual(["規制:green"]), { timeout: 3000 });
    expect(row("半導体の話").querySelector("[data-title] mark")).toBeNull();
    expect(colored(row("新しい規制").querySelector("[data-title]")!)).toEqual(["規制:green"]);
  });

  it("keep the importance mark of a headline of importance five", async () => {
    const server = makeServer();
    group(server, "A", "pink", "電池");
    const category = server.category("Alpha");
    server.article(category.id, { title: "電池の工場", importance: 5 });
    renderApp({ server, route: "/all" });

    await waitFor(() => expect(colored(row("電池の工場"))).toEqual(["電池:pink"]));
    expect(row("電池の工場").querySelector(".headline-mark")).toHaveTextContent("電池の工場");
    expect(row("電池の工場")).toHaveTextContent(/重要度5。/);
  });

  it("show the badges of the groups the row matches, in their order, and read them out with the row", async () => {
    const server = makeServer();
    group(server, "半導体", "green", "半導体");
    group(server, "通商", "orange", "関税");
    group(server, "天気", "purple", "台風");
    const category = server.category("Alpha");
    server.article(category.id, { title: "関税の話", summary: "半導体の輸出" });
    server.article(category.id, { title: "関係のない話", summary: "要約" });
    server.article(category.id, { title: "本文だけの話", summary: "要約", body: "半導体と台風の話" });
    renderApp({ server, route: "/all" });

    await waitFor(() => expect(badges(row("関税の話"))).toEqual(["半導体:green", "通商:orange"]));
    expect(badges(row("関係のない話"))).toEqual([]);
    expect(badges(row("本文だけの話"))).toEqual([]);
    expect(within(row("関税の話")).getByRole("link").textContent).toMatch(/関税の話.*半導体の輸出.*半導体通商$/);
  });
});

describe("term highlights in the article pane", () => {
  it("colour every place in the body of a generated article, and the headline", async () => {
    const server = makeServer();
    group(server, "規制", "green", "規制");
    const category = server.category("Alpha");
    const id = server.article(category.id, { title: "規制の話", body: "最初の規制。\n\n次の段落にも規制がある。" });
    renderApp({ server, route: `/all/${id}` });
    const pane = await opened();

    await waitFor(() => expect(colored(pane.querySelector(".article-body")!)).toEqual(["規制:green", "規制:green"]));
    expect(colored(within(pane).getByRole("heading", { level: 2 }))).toEqual(["規制:green"]);
  });

  it("colour a heading and a list item of delivered content as written, and leave the impact alone", async () => {
    const { server, feed } = withFeed();
    group(server, "A", "purple", "chip");
    const id = seedFeedArticle(server.db, feed.id, { title: "Weekly", body: "## Chip news\n\n- A Chip maker\n- Other", at: AT });
    renderApp({ server, route: `/f/${feed.id}/${id}` });
    const pane = await opened();

    await waitFor(() => expect(colored(pane.querySelector(".article-body")!)).toEqual(["Chip:purple", "Chip:purple"]));
    expect(pane.querySelector(".article-body h2 mark.term-match")).toHaveTextContent("Chip");
    expect(pane.querySelector(".article-body li mark.term-match")).toHaveTextContent("Chip");
  });

  it("does not colour the impact of a generated article", async () => {
    const server = makeServer();
    group(server, "A", "green", "規制");
    const category = server.category("Alpha");
    const id = server.article(category.id, { title: "話", body: "本文", impact: "規制で費用が増える" });
    renderApp({ server, route: `/all/${id}` });
    const pane = await opened();
    const impact = await within(pane).findByRole("region", { name: "読み手への影響" });
    expect(colored(impact)).toEqual([]);
  });

  it("colours the text of a link but never its address, and the link still opens in a new tab", async () => {
    const { server, feed } = withFeed();
    group(server, "A", "green", "campaign", "report");
    const id = seedFeedArticle(server.db, feed.id, {
      title: "Links",
      body: "See [the report](https://example.org/x?utm_campaign=1) and [this](https://example.org/campaign).",
      at: AT,
    });
    renderApp({ server, route: `/f/${feed.id}/${id}` });
    const pane = await opened();

    await waitFor(() => expect(colored(pane.querySelector(".article-body")!)).toEqual(["report:green"]));
    const link = within(pane).getByRole("link", { name: "the report" });
    expect(link).toHaveAttribute("href", "https://example.org/x?utm_campaign=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(pane).getByRole("link", { name: "this" })).toHaveAttribute("href", "https://example.org/campaign");
  });

  it("shows a tag as its characters when a term matches it", async () => {
    const { server, feed } = withFeed();
    group(server, "A", "green", "script");
    const id = seedFeedArticle(server.db, feed.id, { title: "Tags", body: "Text with <script>alert(1)</script> inside.", at: AT });
    renderApp({ server, route: `/f/${feed.id}/${id}` });
    const pane = await opened();

    await waitFor(() => expect(colored(pane.querySelector(".article-body")!)).toEqual(["script:green", "script:green"]));
    expect(pane.querySelector(".article-body script")).toBeNull();
    expect(pane.querySelector(".article-body")).toHaveTextContent("<script>alert(1)</script>");
  });

  it("colours the translation that has the term and not the original under it, and an English original that has one", async () => {
    const { server, feed } = withFeed({ translate: true });
    group(server, "規制", "green", "規制");
    group(server, "通商", "orange", "tariff");
    const id = seedFeedArticle(server.db, feed.id, { title: "New tariff rules", body: "New rules.\n\nA tariff.", at: AT });
    saveTranslatedTitle(server.db, id, { original: "New tariff rules", title: "新しい規制", sourceLanguage: "en" });
    saveArticleTranslation(server.db, id, {
      segments: [
        { original: "New rules.", translated: "新しい規制。" },
        { original: "A tariff.", translated: "関税。" },
      ],
      method: "google",
      truncated: false,
      now: AT,
    });
    renderApp({ server, route: `/f/${feed.id}/${id}` });
    const pane = await opened();

    await waitFor(() => expect(pane.querySelectorAll(".segment")).toHaveLength(2));
    const [first, second] = [...pane.querySelectorAll(".segment")];
    expect(colored(first!.firstElementChild!)).toEqual(["規制:green"]);
    expect(colored(first!.querySelector(".segment-original")!)).toEqual([]);
    expect(colored(second!.querySelector(".segment-original")!)).toEqual(["tariff:orange"]);
    const headline = within(pane).getByRole("heading", { level: 2 });
    expect(colored(headline)).toEqual(["規制:green"]);
    expect(colored(headline.nextElementSibling!)).toEqual(["tariff:orange"]);
  });

  it("colours the summary of a feed article", async () => {
    const { server, feed } = withFeed();
    group(server, "規制", "green", "規制");
    const id = seedFeedArticle(server.db, feed.id, { title: "Rules", body: "Text.", at: AT });
    saveAutoSummary(server.db, id, { text: "新しい規制の話。", source: "page", now: AT });
    renderApp({ server, route: `/f/${feed.id}/${id}` });
    const pane = await opened();
    const summary = await within(pane).findByRole("region", { name: "AIによる要約" });

    await waitFor(() => expect(colored(summary)).toEqual(["規制:green"]));
  });

  it("marks a search match inside a coloured place with both", async () => {
    const server = makeServer();
    group(server, "A", "green", "半導体");
    const category = server.category("Alpha");
    server.article(category.id, { title: "新しい半導体の工場", summary: "要約" });
    renderApp({ server, route: `/search?q=${encodeURIComponent("導体の工")}` });

    await waitFor(() => expect(within(list()).getAllByRole("listitem")).toHaveLength(1));
    const title = within(list()).getAllByRole("listitem")[0]!.querySelector("[data-title]")!;
    await waitFor(() => expect(colored(title)).toEqual(["半導体:green"]));
    expect([...title.querySelectorAll("mark.search-match")].map((mark) => mark.textContent)).toEqual(["導体", "の工"]);
    expect(title.querySelector("mark.term-match mark.search-match")).toHaveTextContent("導体");
  });
});

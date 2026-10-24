import { insertFeed, recordFullContentFailure, saveArticleTranslation, saveFullContent, saveTranslatedTitle } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp } from "../testing/harness.tsx";

const opened = () => screen.findByRole("article", { name: "記事" });
const article = () => screen.getByRole("article", { name: "記事" });
const AT = "2026-03-01T11:00:00.000Z";
const AFTER = "2026-03-01T12:01:00.000Z";
const FULL = "The whole story, from the page.\n\n![A chart](https://img.example.org/chart.png)\n\nThe end of the story.";
const EXCERPT = "Only an excerpt.";
const SHOWING_FULL = "元のページから取得した全文を表示しています。";
const SHOWING_DELIVERED = "配信された内容を表示しています。";
const FETCHING = "全文を取得しています。";
const LONG = "A sentence of the page that the full content is taken from. ".repeat(8);
const PAGE = `<html><head><title>a</title></head><body><article><h1>a</h1><p>${LONG}</p><p>${LONG}</p></article></body></html>`;

function seeded(options: { fetchFullContent?: boolean; translate?: boolean } = {}) {
  const server = makeServer();
  const feed = insertFeed(
    server.db,
    { url: "https://blog.example.org/feed.xml", title: "Blog", fetchFullContent: options.fetchFullContent, translate: options.translate },
    server.clock,
  );
  const id = seedFeedArticle(server.db, feed.id, { title: "Story", body: EXCERPT, at: AT, url: "https://blog.example.org/story" });
  const other = seedFeedArticle(server.db, feed.id, { title: "Another story", body: "Other words.", at: "2026-03-01T10:00:00.000Z" });
  const posts = (requests: string[]) => requests.filter((request) => request === `POST /api/v1/articles/${id}/full-content`);
  return { server, feed, id, other, route: `/f/${feed.id}/${id}`, posts };
}

/** A page whose answer the test lets through. */
function gatedPage() {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const answer = (async () => {
    await gate;
    return new Response(PAGE, { headers: { "content-type": "text/html" } });
  }) as unknown as () => Response;
  return { open, answer };
}

describe("a feed article with full content", () => {
  it("shows the full content in the place of the content, says where it comes from, and keeps images in the column", async () => {
    const { server, id, route } = seeded();
    saveFullContent(server.db, id, { markdown: FULL, text: FULL, now: AT });
    renderApp({ server, route });
    const pane = await opened();

    expect(await within(pane).findByText("The whole story, from the page.")).toBeInTheDocument();
    expect(within(pane).getByText(SHOWING_FULL)).toBeInTheDocument();
    expect(within(pane).queryByText(EXCERPT)).not.toBeInTheDocument();
    const image = within(pane).getByRole("img", { name: "A chart" });
    expect(image).toHaveClass("article-image");
    expect(image).toHaveAttribute("src", "https://img.example.org/chart.png");
  });

  it("switches to what the feed delivered and back, and shows the full content again when the article is chosen again", async () => {
    const { server, id, route } = seeded();
    saveFullContent(server.db, id, { markdown: FULL, text: FULL, now: AT });
    const { user } = renderApp({ server, route });
    const pane = await opened();
    await within(pane).findByText("The whole story, from the page.");

    await user.click(within(pane).getByRole("button", { name: "配信された内容を表示" }));
    expect(within(article()).getByText(EXCERPT)).toBeInTheDocument();
    expect(within(article()).getByText(SHOWING_DELIVERED)).toBeInTheDocument();
    expect(within(article()).queryByText("The whole story, from the page.")).not.toBeInTheDocument();

    await user.click(within(article()).getByRole("button", { name: "全文を表示" }));
    expect(within(article()).getByText("The whole story, from the page.")).toBeInTheDocument();

    await user.click(within(article()).getByRole("button", { name: "配信された内容を表示" }));
    await user.click(screen.getByRole("link", { name: /Another story/ }));
    await within(await opened()).findByText("Other words.");
    await user.click(screen.getByRole("link", { name: /Story/ }));
    expect(await within(await opened()).findByText("The whole story, from the page.")).toBeInTheDocument();
  });
});

describe("fetching the full content from the article", () => {
  it("is offered before the content of a feed article without full content, and shows the delivered content and that it is under way meanwhile", async () => {
    const { server, route, posts } = seeded();
    const page = gatedPage();
    server.site.set("https://blog.example.org/story", page.answer);
    const { user, requests } = renderApp({ server, route });
    const pane = await opened();

    await user.click(await within(pane).findByRole("button", { name: "全文を取得" }));

    expect(await within(article()).findByText(FETCHING)).toBeInTheDocument();
    expect(within(article()).getByText(EXCERPT)).toBeInTheDocument();
    expect(posts(requests)).toHaveLength(1);

    page.open();

    expect(await within(article()).findAllByText(/A sentence of the page/)).not.toHaveLength(0);
    expect(within(article()).getByText(SHOWING_FULL)).toBeInTheDocument();
    expect(within(article()).queryByText(FETCHING)).not.toBeInTheDocument();
    expect(posts(requests)).toHaveLength(1);
  });

  it("is not offered for a generated article", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    const id = server.article(tools.id, { title: "Generated", body: "Generated words." });
    const { requests, user } = renderApp({ server, route: `/c/tools/${id}` });
    const pane = await opened();
    await within(pane).findByText("Generated words.");
    expect(within(pane).queryByRole("button", { name: "全文を取得" })).not.toBeInTheDocument();
    expect(within(pane).queryByText(SHOWING_FULL)).not.toBeInTheDocument();

    await user.keyboard("w");
    expect(requests.filter((request) => request.endsWith("/full-content"))).toEqual([]);
  });

  it("says why it failed for an article whose fetch failed, shows the delivered content, and lets the reader try again", async () => {
    const { server, id, route, posts } = seeded();
    recordFullContentFailure(server.db, id, { reason: "robots", detail: null });
    const { user, requests } = renderApp({ server, route });
    const pane = await opened();

    expect(await within(pane).findByText("全文を取得できませんでした。サイトが取得を禁じています（robots.txt）。")).toBeInTheDocument();
    expect(within(pane).getByText(EXCERPT)).toBeInTheDocument();

    server.site.set("https://blog.example.org/story", () => new Response(PAGE, { headers: { "content-type": "text/html" } }));
    await user.click(within(pane).getByRole("button", { name: "全文を取得し直す" }));
    expect(await within(article()).findAllByText(/A sentence of the page/)).not.toHaveLength(0);
    expect(posts(requests)).toHaveLength(1);
  });

  it("says why it failed when the fetch the reader asked for fails, and keeps the delivered content", async () => {
    const { server, route } = seeded();
    const { user } = renderApp({ server, route });
    const pane = await opened();

    await user.click(await within(pane).findByRole("button", { name: "全文を取得" }));

    expect(await within(article()).findByText("全文を取得できませんでした。ページが見つかりませんでした（HTTP 404）。")).toBeInTheDocument();
    expect(within(article()).getByText(EXCERPT)).toBeInTheDocument();
    expect(within(article()).getByRole("button", { name: "全文を取得し直す" })).toBeInTheDocument();
  });

  it("is asked for when an article that waits for its full content is opened", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog", fetchFullContent: true }, server.clock);
    const id = seedFeedArticle(server.db, feed.id, { title: "Story", body: EXCERPT, at: AT, storedAt: AFTER, url: "https://blog.example.org/story" });
    const page = gatedPage();
    server.site.set("https://blog.example.org/story", page.answer);
    const { requests } = renderApp({ server, route: `/f/${feed.id}/${id}` });
    const pane = await opened();

    expect(await within(pane).findByText(FETCHING)).toBeInTheDocument();
    expect(requests.filter((request) => request === `POST /api/v1/articles/${id}/full-content`)).toHaveLength(1);
    page.open();
    expect(await within(article()).findAllByText(/A sentence of the page/)).not.toHaveLength(0);
  });
});

describe("full content and translation", () => {
  it("asks again for the translation once the full content arrives, and shows the delivered content without one", async () => {
    const { server, id, route } = seeded({ translate: true });
    saveTranslatedTitle(server.db, id, { original: "Story", title: "訳:Story", sourceLanguage: "en" });
    saveArticleTranslation(server.db, id, { segments: [{ original: EXCERPT, translated: "訳:抜粋。" }], method: "google", truncated: false, now: AT });
    server.site.set("https://blog.example.org/story", () => new Response(PAGE, { headers: { "content-type": "text/html" } }));
    const { user, requests } = renderApp({ server, route });
    const pane = await opened();
    await within(pane).findByText("訳:抜粋。");

    await user.click(within(pane).getByRole("button", { name: "全文を取得" }));

    await waitFor(() => expect(requests.filter((request) => request === `POST /api/v1/articles/${id}/translation`)).toHaveLength(1));
    expect(await within(article()).findAllByText(/^訳:A sentence of the page/)).not.toHaveLength(0);
    expect(within(article()).queryByText("訳:抜粋。")).not.toBeInTheDocument();

    await user.click(within(article()).getByRole("button", { name: "配信された内容を表示" }));
    expect(within(article()).getByText(EXCERPT)).toBeInTheDocument();
    expect(article().querySelector(".segment")).toBeNull();
  });
});

describe("the w key", () => {
  it("starts the fetch on an article without full content, ignores a second press while it is under way, then switches", async () => {
    const { server, route, posts } = seeded();
    const page = gatedPage();
    server.site.set("https://blog.example.org/story", page.answer);
    const { user, requests } = renderApp({ server, route });
    const pane = await opened();
    await within(pane).findByText(EXCERPT);

    await user.keyboard("w");
    expect(await within(article()).findByText(FETCHING)).toBeInTheDocument();
    await user.keyboard("w");
    expect(posts(requests)).toHaveLength(1);

    page.open();
    await within(article()).findByText(SHOWING_FULL);

    await user.keyboard("w");
    expect(within(article()).getByText(SHOWING_DELIVERED)).toBeInTheDocument();
    expect(within(article()).getByText(EXCERPT)).toBeInTheDocument();
    await user.keyboard("w");
    expect(within(article()).getByText(SHOWING_FULL)).toBeInTheDocument();
    expect(posts(requests)).toHaveLength(1);
  });

  it("does nothing while the reader types in a field", async () => {
    const { server, route, posts } = seeded();
    const { user, requests } = renderApp({ server, route });
    await within(await opened()).findByText(EXCERPT);
    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("w");
    expect(posts(requests)).toEqual([]);
  });

  it("is in the list of keys", async () => {
    const { server, route } = seeded();
    const { user } = renderApp({ server, route });
    await opened();
    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "キー操作" });
    expect(within(dialog).getByText("w")).toBeInTheDocument();
    expect(within(dialog).getByText("全文の取得と、配信された内容との切り替え")).toBeInTheDocument();
  });
});

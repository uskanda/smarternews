import { getArticle, insertFeed, replaceMentions, saveArticleTranslation, saveFullContent, type Mention } from "@smarternews/core";
import { seedFeed, seedFeedArticle } from "@smarternews/core/testing";
import { API_TOKEN } from "@smarternews/server/testing";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { App } from "../App.tsx";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const MINUTE = 60_000;
const BOJ: Mention = { name: "日本銀行", kind: "organization" };
const MOF: Mention = { name: "財務省", kind: "organization" };
const UEDA: Mention = { name: "植田和男", kind: "person" };

const nav = () => screen.getByRole("navigation", { name: "項目" });
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const article = () => screen.getByRole("article", { name: "記事" });
const names = () => within(article()).queryByRole("region", { name: "記事に出てくる名前" });
const rowTitles = () => within(list()).queryAllByRole("listitem").map((item) => item.querySelector("[data-title]")?.textContent);
const n = (name: string) => new URLSearchParams({ name }).toString();

/** Category A with article X, which has names, and a feed article and an older generated article with the same name. */
function seeded(): { server: TestServer; slug: string; ids: Record<string, number> } {
  const server = makeServer();
  const a = server.category("Alpha");
  const ids: Record<string, number> = {};
  ids.old = server.article(a.id, { title: "古い金融の話" });
  replaceMentions(server.db, ids.old, [BOJ]);
  server.clock.advance(MINUTE);
  const feed = seedFeed(server.db, { title: "Money Feed" });
  ids.feed = seedFeedArticle(server.db, feed, { title: "Feed on the bank", at: server.clock().toISOString(), isRead: true });
  replaceMentions(server.db, ids.feed, [BOJ, UEDA]);
  server.clock.advance(MINUTE);
  ids.x = server.article(a.id, { title: "利上げの記事", body: "日銀が利上げを決めた。" });
  replaceMentions(server.db, ids.x, [BOJ, UEDA, MOF]);
  ids.plain = server.article(a.id, { title: "名前のない記事" });
  return { server, slug: a.slug, ids };
}

/** Waits for the article pane to show the article, whichever element the pane holds by then. */
async function openArticle(title: string) {
  await waitFor(() => expect(within(article()).getByRole("heading", { name: title })).toBeInTheDocument());
}

describe("the names below the body", () => {
  it("are grouped by kind, people first, each kind in stored order, with no heading for a kind without names", async () => {
    const { server, slug, ids } = seeded();
    renderApp({ server, route: `/c/${slug}/${ids.x}` });
    await openArticle("利上げの記事");

    const region = await waitFor(() => names()!);
    expect(within(region).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["人", "組織"]);
    expect(within(region).getAllByRole("link").map((link) => link.textContent)).toEqual(["植田和男", "日本銀行", "財務省"]);
    expect(within(region).getByRole("link", { name: "日本銀行" })).toHaveAttribute("href", `/mentions/${ids.x}?${n("日本銀行")}`);
    // Below the body.
    const body = article().querySelector(".article-body")!;
    expect(body.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("are not there, nor their headings, for an article without names", async () => {
    const { server, slug, ids } = seeded();
    renderApp({ server, route: `/c/${slug}/${ids.plain}` });
    await openArticle("名前のない記事");
    expect(names()).toBeNull();
    expect(within(article()).queryByRole("heading", { name: "組織" })).toBeNull();
  });

  it("show a name with tags as text, and run no script", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "話" });
    replaceMentions(server.db, id, [{ name: "<script>alert(1)</script>**太字**", kind: "product" }]);
    renderApp({ server, route: `/all/${id}` });
    await openArticle("話");

    const region = await waitFor(() => names()!);
    expect(within(region).getByRole("link").textContent).toBe("<script>alert(1)</script>**太字**");
    expect(region.querySelector("script")).toBeNull();
    expect(region.querySelector("strong")).toBeNull();
  });

  function feedArticle(translated: boolean) {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog", translate: translated }, server.clock);
    const id = seedFeedArticle(server.db, feed.id, { title: "Bank news", body: "Delivered words.", at: server.clock().toISOString() });
    replaceMentions(server.db, id, [BOJ]);
    saveFullContent(server.db, id, { markdown: "Full words.", text: "Full words.", now: server.clock().toISOString() });
    if (translated) {
      saveArticleTranslation(server.db, id, { segments: [{ original: "Full words.", translated: "全文の訳。" }], method: "google", truncated: false, now: server.clock().toISOString() });
    }
    return { server, route: `/f/${feed.id}/${id}` };
  }
  /** True when every part of the content is above the names. */
  const below = () => {
    const bodies = [...article().querySelectorAll(".article-body")];
    return bodies.length > 0 && bodies.every((body) => body.compareDocumentPosition(names()!) & Node.DOCUMENT_POSITION_FOLLOWING);
  };

  it("stay below the content of a feed article, whether the full content or what the feed delivered is shown", async () => {
    const { server, route } = feedArticle(false);
    const { user } = renderApp({ server, route });
    await openArticle("Bank news");

    await within(article()).findByText("Full words.");
    await waitFor(() => expect(below()).toBe(true));
    await user.click(within(article()).getByRole("button", { name: "配信された内容を表示" }));
    await within(article()).findByText("Delivered words.");
    expect(below()).toBe(true);
  });

  it("stay below the translation and the original of a translated feed article", async () => {
    const { server, route } = feedArticle(true);
    renderApp({ server, route });

    await within(await screen.findByRole("article", { name: "記事" })).findByText("全文の訳。");
    await waitFor(() => expect(below()).toBe(true));
    expect(article().querySelector(".segment-original")!.compareDocumentPosition(names()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the list of a name", () => {
  it("opens in the middle pane when a name is chosen, with the name on top and the article kept open", async () => {
    const { server, slug, ids } = seeded();
    const { user, path } = renderApp({ server, route: `/c/${slug}/${ids.x}` });
    await openArticle("利上げの記事");

    await user.click(within(await waitFor(() => names()!)).getByRole("link", { name: "日本銀行" }));

    await screen.findByRole("heading", { level: 1, name: "「日本銀行」を含む記事" });
    expect(path()).toBe(`/mentions/${ids.x}?${n("日本銀行")}`);
    // Generated and feed articles alike, read ones too, newest first.
    await waitFor(() => expect(rowTitles()).toEqual(["利上げの記事", "Feed on the bank", "古い金融の話"]));
    expect(within(article()).getByRole("heading", { name: "利上げの記事" })).toBeInTheDocument();
    // No entry of the left pane is current.
    expect(within(nav()).queryAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page")).toEqual([]);
  });

  it("keeps the list while another article of it is chosen", async () => {
    const { server, ids } = seeded();
    const { user, path } = renderApp({ server, route: `/mentions/${ids.x}?${n("日本銀行")}` });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));

    await user.click(within(list()).getByRole("link", { name: /Feed on the bank/ }));

    await openArticle("Feed on the bank");
    expect(path()).toBe(`/mentions/${ids.feed}?${n("日本銀行")}`);
    expect(rowTitles()).toEqual(["利上げの記事", "Feed on the bank", "古い金融の話"]);
  });

  it("offers neither marking all read, nor read ones, nor importance 4 and above, nor the order, and Shift+A marks nothing", async () => {
    const { server, ids } = seeded();
    const { user } = renderApp({ server, route: `/mentions?${n("日本銀行")}` });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));

    expect(within(list()).queryByRole("button", { name: "すべて既読にする" })).toBeNull();
    expect(within(list()).queryByRole("checkbox", { name: "既読も表示" })).toBeNull();
    expect(within(list()).queryByRole("checkbox", { name: "重要度4以上だけ" })).toBeNull();
    expect(within(list()).queryByRole("button", { name: /^並び順/ })).toBeNull();

    await user.keyboard("{Shift>}A{/Shift}");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect([getArticle(server.db, ids.x!).isRead, getArticle(server.db, ids.old!).isRead]).toEqual([false, false]);
  });

  it("marks nothing read when scrolled, even with the setting to mark read what the list is scrolled past", async () => {
    window.localStorage.setItem("smarternews.scrollRead", "on");
    const { server, ids } = seeded();
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const item = this.closest("[data-list-scroll] li");
      const index = item?.parentElement ? [...item.parentElement.children].indexOf(item) : -1;
      const top = index === -1 ? 0 : index * 50 - (item?.closest<HTMLElement>("[data-list-scroll]")?.scrollTop ?? 0);
      const height = index === -1 ? 100 : 50;
      return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) };
    });
    onTestFinished(() => rect.mockRestore());
    renderApp({ server, route: `/mentions?${n("日本銀行")}` });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));
    const pane = list().querySelector<HTMLElement>("[data-list-scroll]")!;

    for (const top of [0, 150]) {
      pane.scrollTop = top;
      fireEvent.scroll(pane);
      await act(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect([getArticle(server.db, ids.x!).isRead, getArticle(server.db, ids.old!).isRead]).toEqual([false, false]);
    expect(pane.querySelector("[data-scroll-read-room]")).toBeNull();
  });

  it("says that no article has the name, once the only one is gone", async () => {
    const { server, ids } = seeded();
    for (const id of [ids.x!, ids.old!, ids.feed!]) server.db.prepare("DELETE FROM articles WHERE id = ?").run(id);
    renderApp({ server, route: `/mentions?${n("日本銀行")}` });
    expect(await within(list()).findByText("「日本銀行」を含む記事はありません。")).toBeInTheDocument();
  });

  it("loads more rows, and moves through them with j and k", async () => {
    const server = makeServer();
    const category = server.category();
    for (let index = 0; index < 55; index += 1) {
      replaceMentions(server.db, server.article(category.id, { title: `記事${index}` }), [BOJ]);
      server.clock.advance(MINUTE);
    }
    const { user, path } = renderApp({ server, route: `/mentions?${n("日本銀行")}` });
    await waitFor(() => expect(rowTitles()).toHaveLength(50));

    await user.click(within(list()).getByRole("button", { name: "さらに読み込む" }));
    await waitFor(() => expect(rowTitles()).toHaveLength(55));

    await user.keyboard("j");
    await openArticle("記事54");
    await user.keyboard("j");
    await openArticle("記事53");
    await user.keyboard("k");
    await openArticle("記事54");
    expect(path()).toMatch(new RegExp(`^/mentions/\\d+\\?${n("日本銀行")}$`));
  });
});

/** The browser's back. jsdom goes through its history after a task. */
async function back(): Promise<void> {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the URL of the list of a name", () => {
  it("opens the list and the article again on a reload", async () => {
    const { server, ids } = seeded();
    renderApp({ server, route: `/mentions/${ids.feed}?${n("日本銀行")}` });
    await screen.findByRole("heading", { level: 1, name: "「日本銀行」を含む記事" });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));
    await openArticle("Feed on the bank");
  });

  it("goes back to the list and the article the name was chosen in, with the browser's back", async () => {
    const { server, slug, ids } = seeded();
    window.history.replaceState(null, "", `/c/${slug}/${ids.x}`);
    window.localStorage.setItem("smarternews.token", API_TOKEN);
    const user = userEvent.setup();
    const view = render(<App fetchImpl={(input, init) => server.app.request(input, init)} now={() => server.clock()} />);
    onTestFinished(() => view.unmount());
    await screen.findByRole("heading", { level: 1, name: "Alpha" });
    await openArticle("利上げの記事");

    await user.click(within(await waitFor(() => names()!)).getByRole("link", { name: "日本銀行" }));
    await screen.findByRole("heading", { level: 1, name: "「日本銀行」を含む記事" });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));
    // An article opened from the list, and another name chosen in it.
    await user.click(within(list()).getByRole("link", { name: /Feed on the bank/ }));
    await openArticle("Feed on the bank");
    await user.click(within(await waitFor(() => names()!)).getByRole("link", { name: "植田和男" }));
    await screen.findByRole("heading", { level: 1, name: "「植田和男」を含む記事" });

    await back();
    await screen.findByRole("heading", { level: 1, name: "「日本銀行」を含む記事" });
    await openArticle("Feed on the bank");
    expect(window.location.pathname + window.location.search).toBe(`/mentions/${ids.feed}?${n("日本銀行")}`);

    await back();
    await openArticle("利上げの記事");
    expect(window.location.pathname + window.location.search).toBe(`/mentions/${ids.x}?${n("日本銀行")}`);
    await back();
    await screen.findByRole("heading", { level: 1, name: "Alpha" });
    await openArticle("利上げの記事");
    expect(window.location.pathname).toBe(`/c/${slug}/${ids.x}`);
  }, 20_000);
});

describe("the names and the keyboard", () => {
  it("are reached with Tab and opened with Enter, and the list of keys is as it was", async () => {
    const { server, slug, ids } = seeded();
    const { user } = renderApp({ server, route: `/c/${slug}/${ids.x}` });
    await openArticle("利上げの記事");
    const link = within(await waitFor(() => names()!)).getByRole("link", { name: "日本銀行" });

    // Tab from the name before it.
    within(names()!).getByRole("link", { name: "植田和男" }).focus();
    await user.tab();
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");

    await screen.findByRole("heading", { level: 1, name: "「日本銀行」を含む記事" });
    await waitFor(() => expect(rowTitles()).toHaveLength(3));

    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: "キー操作" });
    const keys = within(dialog).getAllByRole("term").map((term) => term.textContent);
    expect(keys).toEqual(["j", "k", "s", "m", "o", "w", "h", "Space", "Shift+Space", "Shift+A", "r", "u", "Shift+J", "Shift+K", "g a", "g s", "g e", "g r", "Shift+F10", "/", "?"]);
    expect(dialog.textContent).not.toContain("名前");
  });
});

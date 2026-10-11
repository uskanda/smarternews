import { createStopWord, getFeed, getSettings, insertFeed, listFeeds, listStopWords, recordFetchFailure, recordFetchSuccess, updateFeed } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const section = (name: string) => screen.findByRole("region", { name });
const FEED = "https://blog.example.org/feed.xml";

function rss(title: string, keys: string[]): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${keys
    .map((key) => `<item><title>${key}</title><guid>${key}</guid><link>https://blog.example.org/${key}</link><pubDate>Sun, 01 Mar 2026 11:00:00 GMT</pubDate></item>`)
    .join("")}</channel></rss>`;
}
const page = (links: string) => () => new Response(`<html><head>${links}</head></html>`, { headers: { "content-type": "text/html" } });

function feedOf(server: TestServer, title: string, categoryId: number | null = null) {
  return insertFeed(server.db, { url: `https://${title.toLowerCase()}.example.org/feed.xml`, title, categoryId }, server.clock);
}
const rowOf = async (name: string) => (await within(await section("購読フィードの一覧")).findByText(name)).closest("li")!;

describe("the way to the pages", () => {
  it("leads from the settings to the feeds and the stop words", async () => {
    const { user, path } = renderApp({ route: "/settings" });
    await user.click(await screen.findByRole("link", { name: "購読フィードを設定する" }));
    expect(await screen.findByRole("heading", { level: 1, name: "購読フィード" })).toBeInTheDocument();
    expect(path()).toBe("/settings/feeds");

    await user.click(screen.getByRole("link", { name: "設定へ戻る" }));
    await user.click(await screen.findByRole("link", { name: "ストップワードを設定する" }));
    expect(await screen.findByRole("heading", { level: 1, name: "ストップワード" })).toBeInTheDocument();
  });
});

describe("the list of subscribed feeds", () => {
  it("shows each feed with its category, interval and when it last worked", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    const blog = feedOf(server, "Blog", tools.id);
    recordFetchSuccess(server.db, blog.id, { now: "2026-03-01T11:30:00.000Z" });
    updateFeed(server.db, feedOf(server, "Slow").id, { intervalMinutes: 120 });
    renderApp({ server, route: "/settings/feeds" });

    const first = await rowOf("Blog");
    expect(first).toHaveTextContent("Tools");
    expect(first).toHaveTextContent("基本の取得周期（30分）");
    expect(first).toHaveTextContent("最後の成功 3月1日 11:30");
    const second = await rowOf("Slow");
    expect(second).toHaveTextContent("未分類");
    expect(second).toHaveTextContent("120分ごと");
    expect(second).toHaveTextContent("まだ取得していません");
  });

  it("says in words that a feed is failing, since when, and why", async () => {
    const server = makeServer();
    const blog = feedOf(server, "Blog");
    recordFetchSuccess(server.db, blog.id, { now: "2026-03-01T09:00:00.000Z" });
    recordFetchFailure(server.db, blog.id, { now: "2026-03-01T11:00:00.000Z", error: "HTTP status 503: https://blog.example.org/feed.xml" });
    renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    expect(row).toHaveTextContent("取得に失敗");
    expect(row).toHaveTextContent("最後の成功 3月1日 09:00");
    expect(row).toHaveTextContent("理由: サイトがエラーを返しました（HTTP 503）");
  });

  it("says that a paused feed is paused", async () => {
    const server = makeServer();
    updateFeed(server.db, feedOf(server, "Blog").id, { enabled: false });
    renderApp({ server, route: "/settings/feeds" });
    expect(await rowOf("Blog")).toHaveTextContent("一時停止中");
  });

  it("says that there are none yet", async () => {
    renderApp({ route: "/settings/feeds" });
    expect(await within(await section("購読フィードの一覧")).findByText("購読フィードはまだありません。")).toBeInTheDocument();
  });
});

describe("adding a feed", () => {
  it("subscribes to the feed at the URL, in the chosen category, under the feed's title", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    server.site.set(FEED, rss("Example Blog", ["a", "b"]));
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const form = await section("購読フィードの追加");
    await user.type(within(form).getByLabelText("フィードまたはサイトのURL"), FEED);
    await user.selectOptions(within(form).getByLabelText("カテゴリ"), "Tools");
    await user.click(within(form).getByRole("button", { name: "フィードを追加" }));

    const row = await rowOf("Example Blog");
    expect(row).toHaveTextContent("Tools");
    expect(listFeeds(server.db)).toMatchObject([{ url: FEED, categoryId: tools.id, articleCount: 2 }]);
    expect(within(form).getByLabelText("フィードまたはサイトのURL")).toHaveValue("");
  });

  it("offers only news categories and none", async () => {
    const server = makeServer();
    server.category("Tools");
    server.category("Events", "event");
    renderApp({ server, route: "/settings/feeds" });
    const select = within(await section("購読フィードの追加")).getByLabelText("カテゴリ");
    await within(select).findByRole("option", { name: "Tools" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["なし（未分類）", "Tools"]);
  });

  it("finds the feed of a page and subscribes to it", async () => {
    const server = makeServer();
    server.site.set("https://blog.example.org/", page('<link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml">'));
    server.site.set(FEED, rss("Example Blog", ["a"]));
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const form = await section("購読フィードの追加");
    await user.type(within(form).getByLabelText("フィードまたはサイトのURL"), "https://blog.example.org/");
    await user.click(within(form).getByRole("button", { name: "フィードを追加" }));

    await rowOf("Example Blog");
    expect(listFeeds(server.db).map((feed) => feed.url)).toEqual([FEED]);
  });

  it("lets the user choose when the page points to several feeds, and subscribes to that one only", async () => {
    const server = makeServer();
    server.site.set(
      "https://blog.example.org/",
      page('<link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml"><link rel="alternate" type="application/atom+xml" title="Comments" href="/comments.xml">'),
    );
    server.site.set("https://blog.example.org/comments.xml", rss("Comments Feed", ["c"]));
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const form = await section("購読フィードの追加");
    await user.type(within(form).getByLabelText("フィードまたはサイトのURL"), "https://blog.example.org/");
    await user.click(within(form).getByRole("button", { name: "フィードを追加" }));

    const choices = await within(form).findByRole("group", { name: /フィードが2つ見つかりました/ });
    expect(within(choices).getAllByRole("radio")).toHaveLength(2);
    expect(within(choices).getAllByRole("radio")[0]).toHaveFocus();
    expect(choices).toHaveTextContent("https://blog.example.org/feed.xml");
    expect(listFeeds(server.db)).toEqual([]);

    await user.click(within(choices).getByRole("radio", { name: /Comments/ }));
    await user.click(within(form).getByRole("button", { name: "選んだフィードを追加" }));

    await rowOf("Comments Feed");
    expect(listFeeds(server.db).map((feed) => feed.url)).toEqual(["https://blog.example.org/comments.xml"]);
  });

  it("says that no feed was found and that a feed URL can be entered", async () => {
    const server = makeServer();
    server.site.set("https://blog.example.org/", page("<title>Blog</title>"));
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const form = await section("購読フィードの追加");
    await user.type(within(form).getByLabelText("フィードまたはサイトのURL"), "https://blog.example.org/");
    await user.click(within(form).getByRole("button", { name: "フィードを追加" }));

    expect(await within(form).findByText("このページにフィードは見つかりませんでした。フィードのURLが分かるときは、それを直接入力してください。")).toBeInTheDocument();
    expect(listFeeds(server.db)).toEqual([]);
  });

  it("says that the feed is already subscribed", async () => {
    const server = makeServer();
    server.site.set(FEED, rss("Example Blog", ["a"]));
    insertFeed(server.db, { url: FEED, title: "Example Blog" }, server.clock);
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const form = await section("購読フィードの追加");
    await user.type(within(form).getByLabelText("フィードまたはサイトのURL"), FEED);
    await user.click(within(form).getByRole("button", { name: "フィードを追加" }));

    expect(await within(form).findByText("このフィードはすでに購読しています。")).toBeInTheDocument();
  });

  it("says that the URL could not be fetched, with the reason", async () => {
    const { user } = renderApp({ route: "/settings/feeds" });
    const form = await section("購読フィードの追加");
    await user.type(within(form).getByLabelText("フィードまたはサイトのURL"), "https://gone.example.org/");
    await user.click(within(form).getByRole("button", { name: "フィードを追加" }));
    expect(await within(form).findByText(/このURLを取得できませんでした。.*404/)).toBeInTheDocument();
  });
});

describe("the focus in the list of feeds", () => {
  it("goes into the form that opens, and back to the button when it closes", async () => {
    const server = makeServer();
    feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    expect(within(row).getByLabelText("名前")).toHaveFocus();

    await user.click(within(row).getByRole("button", { name: "やめる" }));
    expect(within(row).getByRole("button", { name: "Blogを編集" })).toHaveFocus();
  });

  it("starts on the safe choice of the delete question, and returns to the button after backing out", async () => {
    const server = makeServer();
    feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    await user.click(within(await rowOf("Blog")).getByRole("button", { name: "Blogを削除" }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "やめる" })).toHaveFocus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(listFeeds(server.db)).toHaveLength(1);
    await waitFor(async () => expect(within(await rowOf("Blog")).getByRole("button", { name: "Blogを削除" })).toHaveFocus());
  });
});

describe("editing a feed", () => {
  it("saves the name, the category, the interval and the pause", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    const feed = feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    const name = within(row).getByLabelText("名前");
    await user.clear(name);
    await user.type(name, "My blog");
    await user.selectOptions(within(row).getByLabelText("カテゴリ"), "Tools");
    await user.click(within(row).getByRole("radio", { name: "このフィードだけの周期にする" }));
    await user.type(within(row).getByLabelText("取得周期（分）"), "120");
    await user.click(within(row).getByRole("checkbox", { name: "取得を一時停止する" }));
    await user.click(within(row).getByRole("button", { name: "保存する" }));

    expect(await screen.findByText("購読フィードを保存しました")).toBeInTheDocument();
    expect(getFeed(server.db, feed.id)).toMatchObject({ title: "My blog", categoryId: tools.id, intervalMinutes: 120, enabled: false });
    expect(await rowOf("My blog")).toHaveTextContent("一時停止中");
  });

  it("goes back to the base interval, and says so", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Blog");
    updateFeed(server.db, feed.id, { intervalMinutes: 120 });
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    expect(row).toHaveTextContent("120分ごと");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    await user.click(within(row).getByRole("radio", { name: "基本の取得周期を使う" }));
    await user.click(within(row).getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(getFeed(server.db, feed.id).intervalMinutes).toBeNull());
    expect(await rowOf("Blog")).toHaveTextContent("基本の取得周期（30分）");
  });

  it("does not save an interval outside five minutes to one day, and says what is allowed", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    await user.click(within(row).getByRole("radio", { name: "このフィードだけの周期にする" }));
    await user.type(within(row).getByLabelText("取得周期（分）"), "2");
    await user.click(within(row).getByRole("button", { name: "保存する" }));

    expect(await within(row).findByText("5分から1440分（24時間）の範囲で入力してください。")).toBeInTheDocument();
    expect(getFeed(server.db, feed.id).intervalMinutes).toBeNull();
  });
});

describe("deleting a feed", () => {
  it("asks first, naming how many articles go and how many of them are starred", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Blog");
    for (let index = 0; index < 40; index += 1) seedFeedArticle(server.db, feed.id, { starred: index < 2 });
    const { user } = renderApp({ server, route: "/settings/feeds" });

    await user.click(within(await rowOf("Blog")).getByRole("button", { name: "Blogを削除" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("配信記事40件が消えます");
    expect(dialog).toHaveTextContent("うち2件にはスターが付いています");
    expect(listFeeds(server.db)).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "削除する" }));

    expect(await screen.findByText("購読フィードを削除しました")).toBeInTheDocument();
    expect(listFeeds(server.db)).toEqual([]);
  });

  it("keeps the feed when the user backs out", async () => {
    const server = makeServer();
    feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });
    await user.click(within(await rowOf("Blog")).getByRole("button", { name: "Blogを削除" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "やめる" }));
    expect(listFeeds(server.db)).toHaveLength(1);
  });
});

describe("fetching a feed now", () => {
  it("fetches it and shows the new state without a reload", async () => {
    const server = makeServer();
    server.site.set("https://blog.example.org/feed.xml", rss("Blog", ["a", "b"]));
    feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    expect(row).toHaveTextContent("まだ取得していません");
    await user.click(within(row).getByRole("button", { name: "Blogをいま取得" }));

    expect(await screen.findByText("新しい記事を2件取得しました")).toBeInTheDocument();
    expect(await rowOf("Blog")).toHaveTextContent("最後の成功 3月1日 12:00");
  });

  it("says why when the fetch fails", async () => {
    const server = makeServer();
    feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    await user.click(within(await rowOf("Blog")).getByRole("button", { name: "Blogをいま取得" }));

    expect(await screen.findByText("取得できませんでした。理由は一覧に表示しています。")).toBeInTheDocument();
    expect(await rowOf("Blog")).toHaveTextContent("取得に失敗");
  });
});

describe("the base interval", () => {
  it("is saved to the settings", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings/feeds" });
    const form = await section("取得周期");
    const field = await within(form).findByLabelText("基本の取得周期（分）");
    expect(field).toHaveValue(30);
    await user.clear(field);
    await user.type(field, "60");
    await user.click(within(form).getByRole("button", { name: "取得周期を保存" }));
    expect(await screen.findByText("取得周期を保存しました")).toBeInTheDocument();
    expect(getSettings(server.db).feedIntervalMinutes).toBe(60);
  });

  it("is not saved outside five minutes to one day, and the field says what is allowed", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings/feeds" });
    const form = await section("取得周期");
    const field = await within(form).findByLabelText("基本の取得周期（分）");
    await user.clear(field);
    await user.type(field, "3");
    await user.click(within(form).getByRole("button", { name: "取得周期を保存" }));
    expect(await within(form).findByText("5分から1440分（24時間）の範囲で入力してください。")).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription(/5分から1440分/);
    expect(getSettings(server.db).feedIntervalMinutes).toBe(30);
  });
});

describe("OPML", () => {
  const OPML = (body: string) => `<?xml version="1.0"?><opml version="2.0"><body>${body}</body></opml>`;
  const outline = (name: string) => `<outline type="rss" text="${name}" xmlUrl="https://${name.toLowerCase()}.example.org/feed.xml"/>`;

  it("explains, beside the import, that folders become categories and that nothing is removed", async () => {
    renderApp({ route: "/settings/feeds" });
    const opml = await section("OPML");
    expect(opml).toHaveTextContent("フォルダーは、同じ名前のカテゴリになります");
    expect(opml).toHaveTextContent("いま購読しているフィードは消えません");
  });

  it("loads a file and says how many feeds were registered and skipped, and how many categories were made", async () => {
    const server = makeServer();
    feedOf(server, "Old1");
    feedOf(server, "Old2");
    const { user } = renderApp({ server, route: "/settings/feeds" });
    const file = new File(
      [OPML(`<outline text="Tech">${["A", "B", "C"].map(outline).join("")}</outline>${["D", "E", "Old1", "Old2"].map(outline).join("")}`)],
      "feeds.opml",
    );

    const opml = await section("OPML");
    await user.upload(within(opml).getByLabelText("読み込むOPMLファイル"), file);
    await user.click(within(opml).getByRole("button", { name: "読み込む" }));

    await waitFor(() => expect(within(opml).getByRole("status")).toHaveTextContent("5件を登録し、2件を飛ばしました。カテゴリを1件作りました。"));
    expect(await rowOf("A")).toHaveTextContent("Tech");
    expect(listFeeds(server.db)).toHaveLength(7);
  });

  it("says that a file is not OPML, and changes nothing", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings/feeds" });
    const opml = await section("OPML");
    await user.upload(within(opml).getByLabelText("読み込むOPMLファイル"), new File(["<html></html>"], "bad.opml"));
    await user.click(within(opml).getByRole("button", { name: "読み込む" }));
    expect(await within(opml).findByRole("alert")).toHaveTextContent("OPMLとして読めなかったため、何も変更していません。");
    expect(listFeeds(server.db)).toEqual([]);
  });

  it("hands every subscribed feed to the browser as an OPML file", async () => {
    const server = makeServer();
    feedOf(server, "Blog", server.category("Tools").id);
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:opml";
    });
    URL.revokeObjectURL = vi.fn();
    const { user } = renderApp({ server, route: "/settings/feeds" });

    await user.click(within(await section("OPML")).getByRole("button", { name: "書き出す" }));

    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(await blobs[0]!.text()).toContain('xmlUrl="https://blog.example.org/feed.xml"');
  });
});

describe("stop words", () => {
  function withArticles() {
    const server = makeServer();
    const feed = feedOf(server, "Shop");
    for (const title of ["春の特売", "夏の特売", "特売の予告", "新製品"]) seedFeedArticle(server.db, feed.id, { title });
    return server;
  }
  const wordRow = async (text: string) => (await within(await section("ストップワードの一覧")).findByText(text)).closest("li")!;

  it("explains, beside the form, what is hidden and what never is", async () => {
    renderApp({ route: "/settings/stop-words" });
    const form = await section("ストップワードの追加");
    expect(form).toHaveTextContent("配信記事だけを隠します");
    expect(form).toHaveTextContent("スターのある記事は隠しません");
  });

  it("adds a word and says how many stored articles it hides", async () => {
    const server = withArticles();
    const { user } = renderApp({ server, route: "/settings/stop-words" });

    const form = await section("ストップワードの追加");
    await user.type(within(form).getByLabelText("隠す語"), "特売");
    await user.click(within(form).getByRole("button", { name: "ストップワードを追加" }));

    expect(await screen.findByText("「特売」を追加しました。3件を隠しています。")).toBeInTheDocument();
    const row = await wordRow("特売");
    expect(row).toHaveTextContent("3件を隠しています");
    expect(row).toHaveTextContent("タイトルだけ");
    expect(listStopWords(server.db)).toMatchObject([{ text: "特売", scope: "title" }]);
    expect(within(form).getByLabelText("隠す語")).toHaveValue("");
  });

  it("adds a word that covers the content too", async () => {
    const server = withArticles();
    const { user } = renderApp({ server, route: "/settings/stop-words" });
    const form = await section("ストップワードの追加");
    await user.type(within(form).getByLabelText("隠す語"), "提供");
    await user.click(within(form).getByRole("radio", { name: "タイトルと内容" }));
    await user.click(within(form).getByRole("button", { name: "ストップワードを追加" }));
    await waitFor(() => expect(listStopWords(server.db)).toMatchObject([{ text: "提供", scope: "title_and_content" }]));
  });

  it("lists every word with what it covers and how many articles it hides", async () => {
    const server = withArticles();
    createStopWord(server.db, { text: "特売" }, server.clock);
    createStopWord(server.db, { text: "広告", scope: "title_and_content" }, server.clock);
    renderApp({ server, route: "/settings/stop-words" });
    expect(await wordRow("特売")).toHaveTextContent("3件を隠しています");
    const second = await wordRow("広告");
    expect(second).toHaveTextContent("タイトルと内容");
    expect(second).toHaveTextContent("隠している記事はありません");
  });

  it("says that the word is already there", async () => {
    const server = withArticles();
    createStopWord(server.db, { text: "特売" }, server.clock);
    const { user } = renderApp({ server, route: "/settings/stop-words" });
    const form = await section("ストップワードの追加");
    await user.type(within(form).getByLabelText("隠す語"), "特売");
    await user.click(within(form).getByRole("button", { name: "ストップワードを追加" }));
    expect(await within(form).findByText("この語はすでに登録しています。")).toBeInTheDocument();
  });

  it("removes a word and says how many articles came back", async () => {
    const server = withArticles();
    createStopWord(server.db, { text: "特売" }, server.clock);
    const { user } = renderApp({ server, route: "/settings/stop-words" });

    await user.click(within(await wordRow("特売")).getByRole("button", { name: "特売を削除" }));

    expect(await screen.findByText("「特売」を削除しました。3件が一覧に戻りました。")).toBeInTheDocument();
    expect(listStopWords(server.db)).toEqual([]);
    expect(await within(await section("ストップワードの一覧")).findByText("ストップワードはまだありません。")).toBeInTheDocument();
  });
});

describe("deleting a category that has feeds", () => {
  it("says in the question that its feeds stay and move to 未分類", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    feedOf(server, "Blog", tools.id);
    feedOf(server, "Releases", tools.id);
    const { user } = renderApp({ server, route: `/settings/categories/${tools.id}` });

    await user.click(await screen.findByRole("button", { name: "カテゴリを削除" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent("購読フィード2件は消えず、「未分類」へ移ります。");
  });

  it("counts only the generated articles as going", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    server.article(tools.id);
    const feed = feedOf(server, "Blog", tools.id);
    seedFeedArticle(server.db, feed.id);
    seedFeedArticle(server.db, feed.id);
    const { user } = renderApp({ server, route: `/settings/categories/${tools.id}` });
    await user.click(await screen.findByRole("button", { name: "カテゴリを削除" }));
    await waitFor(async () => expect(await screen.findByRole("alertdialog")).toHaveTextContent("記事1件が消えます"));
  });

  it("does not mention feeds when the category has none", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    const { user } = renderApp({ server, route: `/settings/categories/${tools.id}` });
    await user.click(await screen.findByRole("button", { name: "カテゴリを削除" }));
    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("購読フィード");
  });
});

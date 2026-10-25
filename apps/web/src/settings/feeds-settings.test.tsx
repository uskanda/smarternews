import { addHighlight, getFeed, getSettings, saveArticleNote, insertFeed, listFeeds, recordFetchFailure, recordFetchSuccess, reserveTranslationChars, updateFeed } from "@smarternews/core";
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
  it("leads from the settings to the feeds and the filters", async () => {
    const { user, path } = renderApp({ route: "/settings" });
    await user.click(await screen.findByRole("link", { name: "購読フィードを設定する" }));
    expect(await screen.findByRole("heading", { level: 1, name: "購読フィード" })).toBeInTheDocument();
    expect(path()).toBe("/settings/feeds");

    await user.click(screen.getByRole("link", { name: "設定へ戻る" }));
    await user.click(await screen.findByRole("link", { name: "フィルターを設定する" }));
    expect(await screen.findByRole("heading", { level: 1, name: "フィルター" })).toBeInTheDocument();
    expect(path()).toBe("/settings/filters");
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

    expect(await within(form).findByText(`このフィードはすでに購読しています（${FEED}）。`)).toBeInTheDocument();
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
    expect(dialog).not.toHaveTextContent("注釈");
    expect(listFeeds(server.db)).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "削除する" }));

    expect(await screen.findByText("購読フィードを削除しました")).toBeInTheDocument();
    expect(listFeeds(server.db)).toEqual([]);
  });

  it("names how many articles with annotations go with their annotations", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Blog");
    const ids = Array.from({ length: 40 }, () => seedFeedArticle(server.db, feed.id));
    const now = server.clock().toISOString();
    for (const id of ids.slice(0, 3)) addHighlight(server.db, id, { quote: "Content", prefix: "", suffix: "", position: 0, note: null }, now);
    saveArticleNote(server.db, ids[0]!, "メモ", now);
    const { user } = renderApp({ server, route: "/settings/feeds" });

    await user.click(within(await rowOf("Blog")).getByRole("button", { name: "Blogを削除" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("「Blog」と、その配信記事40件が消えます。注釈のある3件も、注釈とともに消えます。元に戻せません。");
    expect(listFeeds(server.db)).toHaveLength(1);
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

describe("summaries of a feed", () => {
  const HINT = "要約にはLLMを使います。これから届く記事だけを要約します。";

  it("are switched on in the edit form, and the list then marks the feed", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    expect(row).not.toHaveTextContent("自動で要約");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    const choice = within(row).getByRole("checkbox", { name: "自動で要約する" });
    expect(choice).not.toBeChecked();
    await user.click(choice);
    await user.click(within(row).getByRole("button", { name: "保存する" }));

    expect(await screen.findByText("購読フィードを保存しました")).toBeInTheDocument();
    expect(getFeed(server.db, feed.id).autoSummarize).toBe(true);
    await waitFor(async () => expect(within(await rowOf("Blog")).getByText("自動で要約")).toBeInTheDocument());
  });

  it("are switched off again, and the mark goes", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Blog");
    updateFeed(server.db, feed.id, { autoSummarize: true }, server.clock);
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    expect(within(row).getByText("自動で要約")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    const choice = within(row).getByRole("checkbox", { name: "自動で要約する" });
    expect(choice).toBeChecked();
    await user.click(choice);
    await user.click(within(row).getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(getFeed(server.db, feed.id).autoSummarize).toBe(false));
    await waitFor(async () => expect(await rowOf("Blog")).not.toHaveTextContent("自動で要約"));
  });

  it("say beside the switch that a model is used and that only coming articles are covered", async () => {
    const server = makeServer();
    feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    expect(within(row).getByRole("checkbox", { name: "自動で要約する" })).toHaveAccessibleDescription(HINT);

    const form = await section("購読フィードの追加");
    expect(within(form).getByRole("checkbox", { name: "自動で要約する" })).toHaveAccessibleDescription(HINT);
  });

  it("can be switched on while a feed is added, and are off unless chosen", async () => {
    const server = makeServer();
    server.site.set(FEED, rss("Example Blog", ["a"]));
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const form = await section("購読フィードの追加");
    const choice = within(form).getByRole("checkbox", { name: "自動で要約する" });
    expect(choice).not.toBeChecked();
    await user.type(within(form).getByLabelText("フィードまたはサイトのURL"), FEED);
    await user.click(choice);
    await user.click(within(form).getByRole("button", { name: "フィードを追加" }));

    expect(within(await rowOf("Example Blog")).getByText("自動で要約")).toBeInTheDocument();
    expect(listFeeds(server.db)).toMatchObject([{ url: FEED, autoSummarize: true }]);
    expect(choice).not.toBeChecked();
  });
});

describe("translation of a feed", () => {
  const HINT = "記事のタイトルと本文を、翻訳のためにGoogleまたは設定したLLMのサービスへ送ります。";

  it("is switched on in the edit form, and the list then marks the feed", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    expect(within(row).queryByText("翻訳")).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    const choice = within(row).getByRole("checkbox", { name: "翻訳する" });
    expect(choice).not.toBeChecked();
    expect(choice).toHaveAccessibleDescription(HINT);
    await user.click(choice);
    await user.click(within(row).getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(getFeed(server.db, feed.id).translate).toBe(true));
    await waitFor(async () => expect(within(await rowOf("Blog")).getByText("翻訳")).toBeInTheDocument());
    expect(server.google!.calls).toEqual([]);
  });

  it("can be switched on while a feed is added, with the same words beside the switch, and is off unless chosen", async () => {
    const server = makeServer();
    server.site.set(FEED, rss("Example Blog", ["a"]));
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const form = await section("購読フィードの追加");
    const choice = within(form).getByRole("checkbox", { name: "翻訳する" });
    expect(choice).not.toBeChecked();
    expect(choice).toHaveAccessibleDescription(HINT);
    await user.type(within(form).getByLabelText("フィードまたはサイトのURL"), FEED);
    await user.click(choice);
    await user.click(within(form).getByRole("button", { name: "フィードを追加" }));

    expect(within(await rowOf("Example Blog")).getByText("翻訳")).toBeInTheDocument();
    expect(listFeeds(server.db)).toMatchObject([{ url: FEED, translate: true }]);
    expect(choice).not.toBeChecked();
  });

  it("shows how many characters went to the translation API this month, and the limit", async () => {
    const server = makeServer();
    reserveTranslationChars(server.db, "2026-03", 12_000, 450_000);
    renderApp({ server, route: "/settings/feeds" });
    const usage = await section("翻訳の利用状況");
    await waitFor(() => expect(usage).toHaveTextContent("12,000文字"));
    expect(usage).toHaveTextContent("450,000文字");
    expect(usage).not.toHaveTextContent("LLMだけ");
  });

  it("says that only the model translates when no key is set", async () => {
    const server = makeServer(undefined, { google: null });
    renderApp({ server, route: "/settings/feeds" });
    const usage = await section("翻訳の利用状況");
    await waitFor(() => expect(usage).toHaveTextContent("翻訳のAPIキーが設定されていないため、LLMだけで翻訳します。"));
    expect(usage).not.toHaveTextContent("450,000");
  });
});

describe("full content of a feed", () => {
  const HINT = "記事ごとに元のページを取得して、本文を保存します。これから届く記事だけが対象です。";

  it("is switched on in the edit form, and the list then marks the feed", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    expect(row).not.toHaveTextContent("全文を取得");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    const choice = within(row).getByRole("checkbox", { name: "全文を取得する" });
    expect(choice).not.toBeChecked();
    expect(choice).toHaveAccessibleDescription(HINT);
    await user.click(choice);
    await user.click(within(row).getByRole("button", { name: "保存する" }));

    expect(await screen.findByText("購読フィードを保存しました")).toBeInTheDocument();
    expect(getFeed(server.db, feed.id).fetchFullContent).toBe(true);
    await waitFor(async () => expect(within(await rowOf("Blog")).getByText("全文を取得")).toBeInTheDocument());
  });

  it("can be switched on while a feed is added, with the same words beside it", async () => {
    const server = makeServer();
    server.site.set(FEED, rss("Example Blog", ["a"]));
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const form = await section("購読フィードの追加");
    const choice = within(form).getByRole("checkbox", { name: "全文を取得する" });
    expect(choice).not.toBeChecked();
    expect(choice).toHaveAccessibleDescription(HINT);
    await user.type(within(form).getByLabelText("フィードまたはサイトのURL"), FEED);
    await user.click(choice);
    await user.click(within(form).getByRole("button", { name: "フィードを追加" }));

    expect(within(await rowOf("Example Blog")).getByText("全文を取得")).toBeInTheDocument();
    expect(listFeeds(server.db)).toMatchObject([{ url: FEED, fetchFullContent: true }]);
  });
});

describe("stale feeds and the numbers of a feed", () => {
  const DAY = 86_400_000;
  const daysAgo = (server: TestServer, days: number) => new Date(server.clock().getTime() - days * DAY).toISOString();
  /** Makes the feed subscribed 400 days ago, with its last new item the given days ago, or none. */
  function age(server: TestServer, id: number, lastNewDays: number | null) {
    server.db
      .prepare("UPDATE feeds SET created_at = ?, last_new_item_at = ? WHERE id = ?")
      .run(daysAgo(server, 400), lastNewDays === null ? null : daysAgo(server, lastNewDays), id);
  }
  const nav = () => screen.getByRole("navigation", { name: "項目" });
  const navFeeds = (names: string[]) =>
    within(nav())
      .getAllByRole("link")
      .map((link) => link.textContent!.replace(/\s+/g, " ").trim())
      .filter((text) => names.some((name) => text.startsWith(name)))
      .map((text) => names.find((name) => text.startsWith(name)));
  const listOrder = async () =>
    within(await section("購読フィードの一覧"))
      .getAllByRole("listitem")
      .map((item) => item.querySelector(".type-label-md")?.textContent);

  it("marks a feed stale in words, and not a paused one", async () => {
    const server = makeServer();
    age(server, feedOf(server, "Old").id, 61);
    const paused = feedOf(server, "Paused");
    age(server, paused.id, 100);
    updateFeed(server.db, paused.id, { enabled: false });
    age(server, feedOf(server, "Fresh").id, 59);
    renderApp({ server, route: "/settings/feeds" });

    expect(await rowOf("Old")).toHaveTextContent("更新が止まっています");
    const pausedRow = await rowOf("Paused");
    expect(pausedRow).toHaveTextContent("一時停止中");
    expect(pausedRow).not.toHaveTextContent("更新が止まっています");
    expect(await rowOf("Fresh")).not.toHaveTextContent("更新が止まっています");
  });

  it("shows the articles of the last 30 days and when the last new item came, and no other numbers", async () => {
    const server = makeServer();
    const blog = feedOf(server, "Blog");
    for (let index = 0; index < 12; index += 1) seedFeedArticle(server.db, blog.id, { storedAt: daysAgo(server, 1), starred: index === 0 });
    seedFeedArticle(server.db, blog.id, { storedAt: daysAgo(server, 40) });
    server.db.prepare("UPDATE feeds SET last_new_item_at = ? WHERE id = ?").run("2026-02-28T09:00:00.000Z", blog.id);
    feedOf(server, "Empty");
    renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    expect(row).toHaveTextContent("直近30日に12件");
    expect(row).toHaveTextContent("最後の新着 2月28日 09:00");
    expect(row).not.toHaveTextContent("開いた");
    expect(row).not.toHaveTextContent("スター");
    const empty = await rowOf("Empty");
    expect(empty).toHaveTextContent("直近30日に0件");
    expect(empty).toHaveTextContent("新着はまだありません");
  });

  it("puts stale and failing feeds first while the switch is on, in the order of the left pane, and forgets the switch", async () => {
    const server = makeServer();
    const [a, b, c, d] = ["Alpha", "Bravo", "Charlie", "Delta"].map((name) => feedOf(server, name));
    for (const feed of [a!, c!, d!]) age(server, feed.id, 1);
    age(server, b!.id, 61);
    recordFetchFailure(server.db, d!.id, { now: server.clock().toISOString(), error: "HTTP status 500: x" });
    const { user } = renderApp({ server, route: "/settings/feeds" });
    await rowOf("Alpha");
    const names = ["Alpha", "Bravo", "Charlie", "Delta"];

    const toggle = screen.getByRole("checkbox", { name: "問題のある購読フィードを先頭に並べる" });
    expect(toggle).not.toBeChecked();
    expect(await listOrder()).toEqual(names);
    await user.click(toggle);
    expect(await listOrder()).toEqual(["Bravo", "Delta", "Alpha", "Charlie"]);
    expect(navFeeds(names)).toEqual(names);
    await user.click(toggle);
    expect(await listOrder()).toEqual(names);

    await user.click(toggle);
    await user.click(screen.getByRole("link", { name: "設定へ戻る" }));
    await user.click(await screen.findByRole("link", { name: "購読フィードを設定する" }));
    await rowOf("Alpha");
    expect(screen.getByRole("checkbox", { name: "問題のある購読フィードを先頭に並べる" })).not.toBeChecked();
    expect(await listOrder()).toEqual(names);
  });

  it("shows the stats of the last 30 days in the edit form, with the share opened and starred", async () => {
    const server = makeServer();
    const blog = feedOf(server, "Blog");
    const other = feedOf(server, "Other");
    const kept = seedFeedArticle(server.db, other.id, { storedAt: daysAgo(server, 2) });
    const ids = Array.from({ length: 10 }, (_unused, index) =>
      seedFeedArticle(server.db, blog.id, { title: index < 2 ? `PR ${index}` : `News ${index}`, storedAt: daysAgo(server, 1), starred: index === 9, duplicateOf: index === 8 ? kept : undefined }),
    );
    for (const id of ids.slice(4, 8)) server.db.prepare("UPDATE articles SET opened_at = ? WHERE id = ?").run(server.clock().toISOString(), id);
    await server.post("/api/v1/filters", { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "PR" }] });
    server.db.prepare("UPDATE feeds SET last_new_item_at = ? WHERE id = ?").run("2026-03-01T09:00:00.000Z", blog.id);
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    const stats = await within(row).findByRole("region", { name: "直近30日の統計" });
    const value = async (term: string) => (await within(stats).findByText(term)).nextElementSibling!.textContent;
    expect(await value("届いた記事")).toBe("10件");
    expect(await value("開いた記事")).toBe("4件（40%）");
    expect(await value("スターを付けた記事")).toBe("1件（10%）");
    expect(await value("フィルターで隠した記事")).toBe("2件");
    expect(await value("重複として隠した記事")).toBe("1件");
    expect(await value("最後の新着")).toBe("3月1日 09:00");
  });

  it("rounds the share, and says that nothing came instead of a share", async () => {
    const server = makeServer();
    const blog = feedOf(server, "Blog");
    const ids = [0, 1, 2].map(() => seedFeedArticle(server.db, blog.id, { storedAt: daysAgo(server, 1) }));
    server.db.prepare("UPDATE articles SET opened_at = ? WHERE id = ?").run(server.clock().toISOString(), ids[0]!);
    feedOf(server, "Empty");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Blog");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    const stats = await within(row).findByRole("region", { name: "直近30日の統計" });
    expect((await within(stats).findByText("開いた記事")).nextElementSibling).toHaveTextContent("1件（33%）");

    const empty = await rowOf("Empty");
    await user.click(within(empty).getByRole("button", { name: "Emptyを編集" }));
    const none = await within(empty).findByRole("region", { name: "直近30日の統計" });
    expect(await within(none).findByText("直近30日に届いた記事はありません。")).toBeInTheDocument();
    expect(none).not.toHaveTextContent("%");
  });

  it("counts again after the feed is fetched now", async () => {
    const server = makeServer();
    server.site.set("https://blog.example.org/feed.xml", rss("Blog", ["a", "b"]));
    feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });

    let row = await rowOf("Blog");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    let stats = await within(row).findByRole("region", { name: "直近30日の統計" });
    expect((await within(stats).findByText("届いた記事")).nextElementSibling).toHaveTextContent("0件");
    await user.click(within(row).getByRole("button", { name: "やめる" }));
    await user.click(within(row).getByRole("button", { name: "Blogをいま取得" }));
    expect(await screen.findByText("新しい記事を2件取得しました")).toBeInTheDocument();

    row = await rowOf("Blog");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    stats = await within(row).findByRole("region", { name: "直近30日の統計" });
    await waitFor(() => expect(within(stats).getByText("届いた記事").nextElementSibling).toHaveTextContent("2件"));
    expect(row).toHaveTextContent("直近30日に2件");
  });
});

describe("subscribing to a page without a feed", () => {
  const PAGE = "https://town.example.org/news";
  const listing = (keys: string[], extra = "") =>
    () =>
      new Response(
        `<html><head><title>Town News</title></head><body><ul class="posts">${keys
          .map((key) => `<li class="post"><a href="/news/${key}">Story ${key}</a>${key === "a" ? '<time datetime="2026-03-01T09:00:00Z">1 March</time>' : ""}</li>`)
          .join("")}</ul>${extra}</body></html>`,
        { headers: { "content-type": "text/html" } },
      );
  const twoCandidates = () => ({
    candidates: [
      { item: "ul.posts > li.post", title: null, link: null, date: "time" },
      { item: "li.post", title: null, link: null, date: null },
    ],
  });
  const NOTE = /LLMを使わずにページの作りから候補を推定しました/;

  async function offerPage(server: TestServer) {
    const view = renderApp({ server, route: "/settings/feeds" });
    const form = await section("購読フィードの追加");
    await view.user.type(within(form).getByLabelText("フィードまたはサイトのURL"), PAGE);
    await view.user.click(within(form).getByRole("button", { name: "フィードを追加" }));
    await within(form).findByRole("button", { name: "このページを購読する" });
    return { ...view, form };
  }

  it("offers the page only after no feed was found, asks for nothing until it is chosen, and subscribes with the second candidate", async () => {
    const server = makeServer(undefined, { proposeSelectors: twoCandidates });
    server.category("Town");
    server.site.set(PAGE, listing(["a", "b", "c"]));
    const { user, form, requests } = await offerPage(server);
    expect(requests.some((request) => request.includes("/feeds/page/candidates"))).toBe(false);
    expect(server.llmRequests.proposeSelectors).toHaveLength(0);

    await user.click(within(form).getByRole("button", { name: "このページを購読する" }));
    const choices = await within(form).findByRole("group", { name: /候補が2つあります/ });
    expect(within(form).queryByText(NOTE)).not.toBeInTheDocument();
    expect(within(choices).getAllByText("3件の記事を抜き出せます")).toHaveLength(2);
    expect(within(choices).getAllByText("Story a")).toHaveLength(2);
    expect(within(choices).getAllByText(/日時なし/).length).toBeGreaterThan(0);
    // The full content switch starts on, and says why beside it.
    expect(within(form).getByRole("checkbox", { name: "全文を取得する" })).toBeChecked();
    expect(within(form).getByText(/本文は、全文の取得で得ます/)).toBeInTheDocument();

    await user.selectOptions(within(form).getByLabelText("カテゴリ"), "Town");
    await user.click(within(choices).getByRole("radio", { name: /候補2/ }));
    await user.click(within(form).getByRole("button", { name: "このページを追加" }));

    await rowOf("Town News");
    expect(listFeeds(server.db)).toMatchObject([{ url: PAGE, format: "page", selectors: { item: "li.post" }, fetchFullContent: true, articleCount: 3 }]);
    expect(server.llmRequests.proposeSelectors).toHaveLength(1);
  });

  it("says in one sentence, not as an error, that the model was not used on a day that reached the limit", async () => {
    const server = makeServer(undefined, { proposeSelectors: twoCandidates, selectorProposalsPerDay: 0 });
    server.site.set(PAGE, listing(["a", "b", "c"]));
    const { user, form } = await offerPage(server);
    await user.click(within(form).getByRole("button", { name: "このページを購読する" }));

    const note = await within(form).findByText(NOTE);
    expect(note).toHaveTextContent("今日のLLMの呼び出しが上限に達したため");
    expect(note).not.toHaveClass("text-error");
    expect(note.closest("[role=alert]")).toBeNull();
    expect(await within(form).findByRole("group", { name: /候補が1つあります/ })).toBeInTheDocument();
    expect(server.llmRequests.proposeSelectors).toHaveLength(0);
  });

  it("offers fields when there is no candidate, and subscribes once a preview took articles out", async () => {
    const server = makeServer(undefined, { selectorProposalsPerDay: 0 });
    server.site.set(PAGE, () => new Response('<html><head><title>Town News</title></head><body><p><a href="/news/a">Story a</a></p></body></html>', { headers: { "content-type": "text/html" } }));
    const { user, form } = await offerPage(server);
    await user.click(within(form).getByRole("button", { name: "このページを購読する" }));
    expect(await within(form).findByText(/候補は見つかりませんでした/)).toBeInTheDocument();
    const add = within(form).getByRole("button", { name: "このページを追加" });
    expect(add).toBeDisabled();

    // Selectors that find nothing: the preview says so, and adding stays unavailable.
    await user.type(within(form).getByLabelText("項目のセレクター"), "li.none");
    await user.click(within(form).getByRole("button", { name: "見本を見る" }));
    expect(await within(form).findByText("このセレクターでは記事を抜き出せませんでした。")).toBeInTheDocument();
    expect(add).toBeDisabled();

    await user.clear(within(form).getByLabelText("項目のセレクター"));
    await user.type(within(form).getByLabelText("項目のセレクター"), "p");
    await user.click(within(form).getByRole("button", { name: "見本を見る" }));
    expect(await within(form).findByText("1件の記事を抜き出せます")).toBeInTheDocument();
    await user.click(add);

    await rowOf("Town News");
    expect(listFeeds(server.db)).toMatchObject([{ url: PAGE, format: "page", selectors: { item: "p" } }]);
  });

  it("does not offer the page when a feed was found", async () => {
    const server = makeServer();
    server.site.set("https://blog.example.org/", page('<link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml">'));
    server.site.set(FEED, rss("Example Blog", ["a"]));
    const { user } = renderApp({ server, route: "/settings/feeds" });
    const form = await section("購読フィードの追加");
    await user.type(within(form).getByLabelText("フィードまたはサイトのURL"), "https://blog.example.org/");
    await user.click(within(form).getByRole("button", { name: "フィードを追加" }));
    await rowOf("Example Blog");
    expect(within(form).queryByRole("button", { name: "このページを購読する" })).not.toBeInTheDocument();
  });
});

describe("editing a web feed", () => {
  const PAGE = "https://town.example.org/news";
  const answer = (body: string) => () => new Response(`<html><head><title>Town News</title></head><body>${body}</body></html>`, { headers: { "content-type": "text/html" } });

  it("asks for candidates again, and saves the one chosen", async () => {
    const server = makeServer(undefined, {
      proposeSelectors: () => ({ candidates: [{ item: "div.cards > a.card", title: null, link: null, date: null }] }),
    });
    const feed = insertFeed(server.db, { url: PAGE, title: "Town News", format: "page", selectors: { item: "li.post" } }, server.clock);
    recordFetchFailure(server.db, feed.id, { now: "2026-03-01T11:00:00.000Z", error: "no element matches the item selector" });
    server.site.set(PAGE, answer('<div class="cards"><a class="card" href="/news/x">Story x</a><a class="card" href="/news/y">Story y</a></div>'));
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Town News");
    expect(row).toHaveTextContent("理由: ページに記事が見つかりませんでした");
    await user.click(within(row).getByRole("button", { name: "Town Newsを編集" }));
    await user.click(within(row).getByRole("button", { name: "候補を出し直す" }));
    const choices = await within(row).findByRole("group", { name: /候補が1つあります/ });
    expect(within(choices).getByText("2件の記事を抜き出せます")).toBeInTheDocument();
    await user.click(within(choices).getByRole("radio", { name: /候補1/ }));
    expect(within(row).getByLabelText("項目のセレクター")).toHaveValue("div.cards > a.card");
    await user.click(within(row).getByRole("button", { name: "保存する" }));

    expect(await screen.findByText("購読フィードを保存しました")).toBeInTheDocument();
    expect(getFeed(server.db, feed.id).selectors).toEqual({ item: "div.cards > a.card" });
  });

  it("adds a date selector after trying it on the page", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: PAGE, title: "Town News", format: "page", selectors: { item: "li.post" } }, server.clock);
    server.site.set(PAGE, answer('<ul><li class="post"><a href="/news/a">Story a</a><time datetime="2026-03-01T09:00:00Z">x</time></li></ul>'));
    const { user } = renderApp({ server, route: "/settings/feeds" });

    const row = await rowOf("Town News");
    await user.click(within(row).getByRole("button", { name: "Town Newsを編集" }));
    expect(within(row).getByLabelText("項目のセレクター")).toHaveValue("li.post");
    await user.type(within(row).getByLabelText("日時のセレクター"), "time");
    await user.click(within(row).getByRole("button", { name: "見本を見る" }));
    expect(await within(row).findByText("1件の記事を抜き出せます")).toBeInTheDocument();
    expect(within(row).getByText(/3月1日 09:00/)).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "保存する" }));

    expect(await screen.findByText("購読フィードを保存しました")).toBeInTheDocument();
    expect(getFeed(server.db, feed.id).selectors).toEqual({ item: "li.post", date: "time" });
  });

  it("shows neither the selectors nor the candidates for an Atom feed", async () => {
    const server = makeServer();
    feedOf(server, "Blog");
    const { user } = renderApp({ server, route: "/settings/feeds" });
    const row = await rowOf("Blog");
    await user.click(within(row).getByRole("button", { name: "Blogを編集" }));
    await within(row).findByLabelText("名前");
    expect(within(row).queryByLabelText("項目のセレクター")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "見本を見る" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "候補を出し直す" })).not.toBeInTheDocument();
  });
});

import { applyInterpretation, createTopic, getCategory, getSettings, getTopic, insertFeed, listCategories, listTopics, updateCategory } from "@smarternews/core";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildConnectLink } from "@smarternews/client";
import { API_TOKEN } from "@smarternews/server/testing";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";
import { resetScrollReadState } from "../lib/scroll-read.ts";
import { resetThemeState } from "../lib/theme.ts";
import { qrPath } from "./ConnectCode.tsx";

const section = (name: string) => screen.findByRole("region", { name });

function topic(server: TestServer, categoryId: number, text: string, interpreted = false) {
  const created = createTopic(server.db, categoryId, { text }, server.clock);
  if (interpreted) {
    applyInterpretation(server.db, created.id, {
      queries: [`${text} query`],
      criteria: `only ${text}`,
      suggestedSources: { newsSearch: true, llmSearch: false },
    });
  }
  return created;
}

describe("the list of categories", () => {
  it("shows every category with its kind, schedule and number of topics, and marks the disabled ones", async () => {
    const server = makeServer();
    const security = server.category("Security");
    server.category("Events", "event");
    const off = server.category("Paused");
    updateCategory(server.db, off.id, { enabled: false });
    topic(server, security.id, "one");
    topic(server, security.id, "two");
    renderApp({ server, route: "/settings" });

    const categories = await section("カテゴリ");
    const row = (name: string) => within(categories).getByRole("link", { name }).closest("li")!;
    await waitFor(() => expect(row("Security")).toHaveTextContent("トピック 2"));
    expect(row("Security")).toHaveTextContent("ニュース");
    expect(row("Security")).toHaveTextContent("05:00");
    expect(row("Events")).toHaveTextContent("イベント");
    expect(row("Paused")).toHaveTextContent("無効");
    expect(row("Security")).not.toHaveTextContent("無効");
  });

  it("creates a category with the defaults and opens it for editing", async () => {
    const server = makeServer();
    const { user, path } = renderApp({ server, route: "/settings" });

    await user.type(await screen.findByLabelText("カテゴリの名前"), "Security");
    await user.click(screen.getByRole("radio", { name: "ニュース" }));
    await user.click(screen.getByRole("button", { name: "カテゴリを追加" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Security" })).toBeInTheDocument();
    expect(path()).toBe(`/settings/categories/${listCategories(server.db)[0]!.id}`);
    expect(screen.getByLabelText("実行時刻")).toHaveValue("05:00");
    expect(screen.getByLabelText("最低重要度")).toHaveValue(3);
    expect(screen.getByLabelText("件数上限")).toHaveValue(5);
    expect(screen.getByLabelText("対象期間（時間）")).toHaveValue(24);
  });
});

describe("editing a category", () => {
  it("shows the kind without a way to change it", async () => {
    const server = makeServer();
    const category = server.category("Security");
    renderApp({ server, route: `/settings/categories/${category.id}` });

    await screen.findByRole("heading", { level: 1, name: "Security" });
    expect(screen.getByText("種別")).toBeInTheDocument();
    expect(screen.getByText("ニュース")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /種別/ })).not.toBeInTheDocument();
  });

  it("saves the schedule and shows it again after a reload", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const first = renderApp({ server, route: `/settings/categories/${category.id}` });

    const schedule = await screen.findByLabelText("実行時刻");
    await first.user.clear(schedule);
    await first.user.type(schedule, "05:00, 12:00, 18:00");
    await first.user.click(screen.getByRole("button", { name: "保存する" }));

    expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
    expect(getCategory(server.db, category.id).schedule).toEqual(["05:00", "12:00", "18:00"]);
    first.unmount();
    renderApp({ server, route: `/settings/categories/${category.id}` });
    expect(await screen.findByLabelText("実行時刻")).toHaveValue("05:00, 12:00, 18:00");
  });

  it("asks for the window of an event category in days", async () => {
    const server = makeServer();
    const category = server.category("Events", "event");
    renderApp({ server, route: `/settings/categories/${category.id}` });

    expect(await screen.findByLabelText("対象期間（今後の日数）")).toHaveValue(7);
    expect(screen.queryByLabelText("対象期間（時間）")).not.toBeInTheDocument();
  });

  it("shows the reason next to a field whose value the server refused, and keeps what was stored", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    const field = await screen.findByLabelText("最低重要度");
    await user.clear(field);
    await user.type(field, "9");
    await user.click(screen.getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(field).toHaveAccessibleDescription(/5/));
    expect(field).toBeInvalid();
    expect(getCategory(server.db, category.id).minImportance).toBe(3);
  });

  it("asks before leaving with unsaved changes, and stays when the user says so", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const { user, path } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.type(await screen.findByLabelText("名前"), " and more");
    await user.click(within(screen.getByRole("navigation", { name: "項目" })).getByRole("link", { name: /^未読/ }));

    const dialog = await screen.findByRole("alertdialog", { name: "保存していない変更があります" });
    await user.click(within(dialog).getByRole("button", { name: "編集を続ける" }));

    expect(path()).toBe(`/settings/categories/${category.id}`);
    expect(screen.getByLabelText("名前")).toHaveValue("Security and more");
  });

  it("leaves when the user chooses to discard the changes", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const { user, path } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.type(await screen.findByLabelText("名前"), " and more");
    await user.click(within(screen.getByRole("navigation", { name: "項目" })).getByRole("link", { name: /^未読/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "破棄して移動" }));

    await waitFor(() => expect(path()).toBe("/unread"));
    expect(getCategory(server.db, category.id).name).toBe("Security");
  });
});

describe("deleting a category", () => {
  function seeded() {
    const server = makeServer();
    const category = server.category("Security");
    for (const text of ["one", "two", "three"]) topic(server, category.id, text);
    for (let index = 0; index < 40; index += 1) server.article(category.id);
    return { server, category };
  }

  it("says how many topics and articles go with it, offers disabling instead, and waits for confirmation", async () => {
    const { server, category } = seeded();
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.click(await screen.findByRole("button", { name: "カテゴリを削除" }));

    const dialog = await screen.findByRole("alertdialog", { name: "カテゴリを削除しますか" });
    await waitFor(() => expect(dialog).toHaveTextContent("トピック3件と記事40件"));
    expect(within(dialog).getByRole("button", { name: "無効にする" })).toBeInTheDocument();
    expect(listCategories(server.db)).toHaveLength(1);
  });

  it("deletes after confirmation and returns to the settings", async () => {
    const { server, category } = seeded();
    const { user, path } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.click(await screen.findByRole("button", { name: "カテゴリを削除" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(listCategories(server.db)).toEqual([]));
    await waitFor(() => expect(path()).toBe("/settings"));
  });

  it("disables instead when the user chooses that", async () => {
    const { server, category } = seeded();
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.click(await screen.findByRole("button", { name: "カテゴリを削除" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "無効にする" }));

    await waitFor(() => expect(getCategory(server.db, category.id).enabled).toBe(false));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("topics", () => {
  it("shows the search queries and criteria of an interpreted topic, and says when one is still waiting", async () => {
    const server = makeServer();
    const category = server.category("Security");
    topic(server, category.id, "exploited flaws", true);
    topic(server, category.id, "ransomware");
    renderApp({ server, route: `/settings/categories/${category.id}` });

    const topics = await section("トピック");
    const item = (text: string) => within(topics).getByText(text).closest("li")!;
    await within(topics).findByText("ransomware");
    expect(item("exploited flaws")).toHaveTextContent("exploited flaws query");
    expect(item("exploited flaws")).toHaveTextContent("only exploited flaws");
    expect(item("ransomware")).toHaveTextContent("次の実行で解釈されます");
  });

  it("adds a topic, says when it will be interpreted, offers to run now, and starts no run by itself", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const { user, requests } = renderApp({ server, route: `/settings/categories/${category.id}` });

    for (const text of ["first topic", "second topic", "third topic"]) {
      await user.type(await screen.findByLabelText("新しいトピック"), text);
      await user.click(screen.getByRole("button", { name: "トピックを追加" }));
      await within(await section("トピック")).findByText(text);
    }

    expect(listTopics(server.db, category.id).map((entry) => entry.text)).toEqual(["first topic", "second topic", "third topic"]);
    expect(await screen.findByRole("status")).toHaveTextContent("次の実行で解釈されます");
    expect(screen.getByRole("button", { name: "いますぐ実行" })).toBeEnabled();
    expect(requests.filter((request) => request.startsWith("POST") && request.endsWith("/runs"))).toEqual([]);
  });

  it("saves a feed added to a topic", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const created = topic(server, category.id, "exploited flaws", true);
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.click(await screen.findByRole("button", { name: "exploited flaws を編集" }));
    await user.type(screen.getByLabelText("フィードのURL"), "https://example.org/feed.xml");
    await user.click(screen.getByRole("button", { name: "トピックを保存" }));

    await waitFor(() => expect(getTopic(server.db, created.id).sources.feeds).toEqual(["https://example.org/feed.xml"]));
    expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
  });

  it("shows a topic as waiting for interpretation again after its text is changed", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const created = topic(server, category.id, "exploited flaws", true);
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.click(await screen.findByRole("button", { name: "exploited flaws を編集" }));
    const text = screen.getByLabelText("トピックの文章");
    await user.clear(text);
    await user.type(text, "exploited flaws in routers");
    await user.click(screen.getByRole("button", { name: "トピックを保存" }));

    await waitFor(() => expect(getTopic(server.db, created.id).interpreted).toBe(false));
    const item = (await within(await section("トピック")).findByText("exploited flaws in routers")).closest("li")!;
    await waitFor(() => expect(item).toHaveTextContent("次の実行で解釈されます"));
  });

  it("saves edited search queries and the search market of a topic", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const created = topic(server, category.id, "exploited flaws", true);
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.click(await screen.findByRole("button", { name: "exploited flaws を編集" }));
    const queries = screen.getByLabelText("検索語");
    await user.clear(queries);
    await user.type(queries, "zero day{Enter}kev catalog");
    await user.type(screen.getByLabelText("検索の言語"), "en");
    await user.type(screen.getByLabelText("検索の地域"), "US");
    await user.click(screen.getByRole("button", { name: "トピックを保存" }));

    await waitFor(() => expect(getTopic(server.db, created.id).queries).toEqual(["zero day", "kev catalog"]));
    expect(getTopic(server.db, created.id).search).toEqual({ language: "en", region: "US" });
  });

  it("warns next to the model search choice when the provider cannot search", async () => {
    const server = makeServer(undefined, { webSearch: false });
    const category = server.category("Security");
    topic(server, category.id, "local events", true);
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.click(await screen.findByRole("button", { name: "local events を編集" }));

    const choice = screen.getByRole("checkbox", { name: "LLM検索" });
    await waitFor(() => expect(choice).toHaveAccessibleDescription(/いまの設定では使われません/));
  });

  it("gives no such warning when the provider can search", async () => {
    const server = makeServer();
    const category = server.category("Security");
    topic(server, category.id, "local events", true);
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.click(await screen.findByRole("button", { name: "local events を編集" }));
    await screen.findByRole("region", { name: "トピック" });

    expect(screen.getByRole("checkbox", { name: "LLM検索" })).not.toHaveAccessibleDescription(/使われません/);
  });

  it("deletes a topic after confirmation and keeps the articles", async () => {
    const server = makeServer();
    const category = server.category("Security");
    topic(server, category.id, "exploited flaws", true);
    server.article(category.id, { title: "Written earlier" });
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    await user.click(await screen.findByRole("button", { name: "exploited flaws を編集" }));
    await user.click(screen.getByRole("button", { name: "トピックを削除" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(listTopics(server.db, category.id)).toEqual([]));
    expect(server.db.prepare("SELECT count(*) AS n FROM articles").get()).toEqual({ n: 1 });
  });
});

describe("reader information and global settings", () => {
  it("saves the reader information and says when it takes effect", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings" });

    const reader = await section("読み手情報");
    await user.type(within(reader).getByLabelText("読み手情報"), "Maintains web services.");
    await user.click(within(reader).getByRole("button", { name: "読み手情報を保存" }));

    await waitFor(() => expect(getSettings(server.db).readerInfo).toBe("Maintains web services."));
    expect(reader).toHaveTextContent("次の実行から");
    expect(await screen.findByRole("status")).toHaveTextContent("保存しました");
  });

  it("shows the reason next to an unknown time zone and keeps the stored one", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings" });

    const global = await section("全体設定");
    const field = within(global).getByLabelText("タイムゾーン");
    await waitFor(() => expect(field).toHaveValue("UTC"));
    await user.clear(field);
    await user.type(field, "Mars/Olympus");
    await user.click(within(global).getByRole("button", { name: "全体設定を保存" }));

    await waitFor(() => expect(field).toBeInvalid());
    expect(field).toHaveAccessibleDescription(/IANA/);
    expect(getSettings(server.db).timeZone).toBe("UTC");
  });

  it("saves the output language and the default search market", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings" });

    const global = await section("全体設定");
    const language = within(global).getByLabelText("出力言語");
    await waitFor(() => expect(language).toHaveValue("ja"));
    await user.clear(language);
    await user.type(language, "en");
    await user.click(within(global).getByRole("button", { name: "全体設定を保存" }));

    await waitFor(() => expect(getSettings(server.db).outputLanguage).toBe("en"));
  });
});

describe("moving on after marking all as read", () => {
  it("is a switch in the global settings that is saved with them", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings" });

    const global = await section("全体設定");
    const box = within(global).getByRole("checkbox", { name: "「すべて既読にする」のあと、未読のある次の項目へ移る" });
    expect(box).not.toBeChecked();
    await user.click(box);
    await user.click(within(global).getByRole("button", { name: "全体設定を保存" }));

    await waitFor(() => expect(getSettings(server.db).advanceAfterMarkAll).toBe(true));
  });
});

describe("duplicate removal", () => {
  const label = "ほかの購読フィードが先に配信した記事を、全体とカテゴリの一覧に出さない";

  it("is switched on in the global settings of a server that never changed it", async () => {
    const server = makeServer();
    renderApp({ server, route: "/settings" });
    const global = await section("全体設定");
    expect(within(global).getByRole("checkbox", { name: label })).toBeChecked();
    expect(within(global).getByText(/購読フィードの一覧には出ます/)).toBeInTheDocument();
  });

  it("can be switched off and saved", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings" });
    const global = await section("全体設定");
    await user.click(within(global).getByRole("checkbox", { name: label }));
    await user.click(within(global).getByRole("button", { name: "全体設定を保存" }));
    await waitFor(() => expect(getSettings(server.db).removeDuplicates).toBe(false));
  });
});

describe("the settings file", () => {
  it("hands the settings file to the browser for saving", async () => {
    const server = makeServer();
    server.category("Security");
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:settings";
    });
    URL.revokeObjectURL = vi.fn();
    const { user } = renderApp({ server, route: "/settings" });

    await user.click(within(await section("設定ファイル")).getByRole("button", { name: "書き出す" }));

    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(await blobs[0]!.text()).toContain("slug: security");
  });

  it("loads a settings file and says what was created", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings" });
    const file = new File(
      ["version: 1\ncategories:\n  - slug: cars\n    name: Cars\n    kind: news\n    topics:\n      - text: New models\n  - slug: bikes\n    name: Bikes\n    kind: news\n"],
      "settings.yaml",
      { type: "application/yaml" },
    );

    const settingsFile = await section("設定ファイル");
    await user.upload(within(settingsFile).getByLabelText("読み込む設定ファイル"), file);
    await user.click(within(settingsFile).getByRole("button", { name: "読み込む" }));

    await waitFor(() => expect(settingsFile).toHaveTextContent("カテゴリを2件作成"));
    expect(settingsFile).toHaveTextContent("トピックを1件作成");
    expect(await within(await section("カテゴリ")).findByRole("link", { name: "Cars" })).toBeInTheDocument();
  });

  it("names the bad entry of a file that does not fit, and changes nothing", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings" });
    const file = new File(["version: 1\ncategories:\n  - slug: a\n    name: A\n    kind: weather\n"], "bad.yaml");

    const settingsFile = await section("設定ファイル");
    await user.upload(within(settingsFile).getByLabelText("読み込む設定ファイル"), file);
    await user.click(within(settingsFile).getByRole("button", { name: "読み込む" }));

    expect(await within(settingsFile).findByRole("alert")).toHaveTextContent("categories.0.kind");
    expect(listCategories(server.db)).toEqual([]);
  });

  it("explains that loading updates, creates and never deletes", async () => {
    renderApp({ route: "/settings" });
    const settingsFile = await section("設定ファイル");
    expect(settingsFile).toHaveTextContent("ファイルに書かれていないカテゴリとトピックは消えません");
    expect(settingsFile).toHaveTextContent("カテゴリと購読フィードは、ファイルに書かれた順に並びます");
  });
});

describe("connecting the Android app", () => {
  it("shows no connection code until the user asks for it, and says that the code holds the token", async () => {
    renderApp({ route: "/settings" });

    expect(await screen.findByRole("button", { name: "アプリ接続用のQRコードを表示する" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "接続用のQRコード" })).not.toBeInTheDocument();
    expect(screen.getByText(/QRコードにはトークンが含まれます/)).toBeInTheDocument();
  });

  it("shows a code that holds the address of the server the browser is on, and the stored token", async () => {
    const { user } = renderApp({ route: "/settings" });

    await user.click(await screen.findByRole("button", { name: "アプリ接続用のQRコードを表示する" }));

    const code = await screen.findByRole("img", { name: "接続用のQRコード" });
    const expected = qrPath(buildConnectLink(window.location.origin, API_TOKEN));
    expect(code.querySelector("path")?.getAttribute("d")).toBe(expected.d);
    expect(expected.d.length).toBeGreaterThan(100);
  });

  it("draws the code black on white in the dark scheme too", async () => {
    const { user } = renderApp({ route: "/settings" });
    await user.click(within(await screen.findByRole("radiogroup", { name: "配色" })).getByRole("radio", { name: "ダーク" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await user.click(screen.getByRole("button", { name: "アプリ接続用のQRコードを表示する" }));

    // Fixed values, not colour tokens: a token would follow the scheme.
    const code = await screen.findByRole("img", { name: "接続用のQRコード" });
    expect(code).toHaveClass("bg-[#FFFFFF]");
    expect(code.querySelector("path")).toHaveAttribute("fill", "#000000");
  });

  it("takes the code away again when the dialog is closed", async () => {
    const { user } = renderApp({ route: "/settings" });
    await user.click(await screen.findByRole("button", { name: "アプリ接続用のQRコードを表示する" }));
    await screen.findByRole("img", { name: "接続用のQRコード" });

    await user.click(screen.getByRole("button", { name: "閉じる" }));

    await waitFor(() => expect(screen.queryByRole("img", { name: "接続用のQRコード" })).not.toBeInTheDocument());
  });
});

describe("qrPath", () => {
  it("draws the three corner squares every QR code has, inside a quiet border", () => {
    const { size, d } = qrPath("smarternews://connect?v=1&url=http%3A%2F%2Fnews.example&token=t");
    const border = 4;
    // The top-left finder pattern starts right after the border with a run of seven dark modules.
    expect(d.startsWith(`M${border} ${border}h7v1h-7z`)).toBe(true);
    expect(size).toBeGreaterThanOrEqual(21 + border * 2);
  });

  it("draws a different code for a different link", () => {
    expect(qrPath("smarternews://connect?v=1&url=a&token=1").d).not.toBe(qrPath("smarternews://connect?v=1&url=a&token=2").d);
  });
});

describe("the stored token", () => {
  it("is removed on request, and the app asks for it again", async () => {
    const { user } = renderApp({ route: "/settings" });

    await user.click(await screen.findByRole("button", { name: "このブラウザーからトークンを消す" }));

    expect(await screen.findByLabelText("APIのトークン")).toBeInTheDocument();
    expect(window.localStorage.getItem("smarternews.token")).toBeNull();
  });
});

describe("the colour scheme", () => {
  const choice = async (name: string) => within(await screen.findByRole("radiogroup", { name: "配色" })).getByRole("radio", { name });

  it("offers following the device and the three schemes, and follows the device until the user chooses", async () => {
    renderApp({ route: "/settings" });

    const group = await screen.findByRole("radiogroup", { name: "配色" });
    expect(within(group).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent)).toEqual([
      "端末に従う",
      "ライト",
      "ダーク",
      "ダークブルー",
    ]);
    expect(await choice("端末に従う")).toBeChecked();
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("shows the page in the chosen scheme at once, without a save", async () => {
    const { user, requests } = renderApp({ route: "/settings" });

    await user.click(await choice("ダークブルー"));

    expect(document.documentElement).toHaveAttribute("data-theme", "darkblue");
    expect(await choice("ダークブルー")).toBeChecked();
    expect(requests.filter((request) => !request.startsWith("GET"))).toEqual([]);
  });

  it("goes back to following the device", async () => {
    const { user } = renderApp({ route: "/settings" });

    await user.click(await choice("ダーク"));
    await user.click(await choice("端末に従う"));

    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(await choice("端末に従う")).toBeChecked();
  });

  it("keeps the choice over a reload", async () => {
    const first = renderApp({ route: "/settings" });
    await first.user.click(await choice("ダーク"));
    first.unmount();
    resetThemeState();

    renderApp({ route: "/settings", server: first.server });

    expect(await choice("ダーク")).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("is chosen with the arrow keys", async () => {
    const { user } = renderApp({ route: "/settings" });
    (await choice("端末に従う")).focus();

    await user.keyboard("{ArrowDown}");

    expect(await choice("ライト")).toBeChecked();
    expect(await choice("ライト")).toHaveFocus();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("says that the choice is kept in this browser only", async () => {
    renderApp({ route: "/settings" });

    expect(await section("この端末の設定")).toHaveTextContent("このブラウザーだけに保存");
    expect(await screen.findByRole("radiogroup", { name: "配色" })).toHaveAccessibleDescription(/このブラウザーだけに保存/);
  });
});

describe("the settings of this device", () => {
  const toggle = () => screen.findByRole("checkbox", { name: "スクロールした記事を既読にする" });

  it("holds the colour scheme and the switch to mark read what is scrolled past, and says the server gets neither", async () => {
    renderApp({ route: "/settings" });

    const region = await section("この端末の設定");
    expect(within(region).getByRole("radiogroup", { name: "配色" })).toBeInTheDocument();
    expect(within(region).getByRole("checkbox", { name: "スクロールした記事を既読にする" })).toBeInTheDocument();
    expect(region).toHaveTextContent("このブラウザーだけに保存し、サーバーには送りません");
    expect(screen.queryByRole("region", { name: "配色" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("radiogroup", { name: "配色" })).toHaveLength(1);
  });

  it("shows the switch off until it is chosen, and says what it does", async () => {
    renderApp({ route: "/settings" });

    expect(await toggle()).not.toBeChecked();
    expect(await toggle()).toHaveAccessibleDescription(/一覧の上端を越えた記事を既読にします/);
  });

  it("is turned on with the Space key, at once and without a save, and stays on over a reload", async () => {
    const first = renderApp({ route: "/settings" });
    (await toggle()).focus();

    await first.user.keyboard(" ");

    expect(await toggle()).toBeChecked();
    expect(window.localStorage.getItem("smarternews.scrollRead")).toBe("on");
    expect(first.requests.filter((request) => !request.startsWith("GET"))).toEqual([]);
    first.unmount();
    resetScrollReadState();

    renderApp({ route: "/settings", server: first.server });
    expect(await toggle()).toBeChecked();
  });
});

describe("the days after which a feed counts as stale", () => {
  const label = "更新が止まったとみなす日数";

  it("shows 60 on a server that never changed it", async () => {
    renderApp({ server: makeServer(), route: "/settings" });
    const global = await section("全体設定");
    expect(within(global).getByLabelText(label)).toHaveValue(60);
  });

  it("is saved, and the list of feeds then drops the mark of a feed without new items for 61 days", async () => {
    const server = makeServer();
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog" }, server.clock);
    server.db
      .prepare("UPDATE feeds SET created_at = ?, last_new_item_at = ? WHERE id = ?")
      .run("2025-01-01T00:00:00.000Z", new Date(server.clock().getTime() - 61 * 86_400_000).toISOString(), feed.id);
    const { user } = renderApp({ server, route: "/settings/feeds" });
    const row = async () => (await within(await section("購読フィードの一覧")).findByText("Blog")).closest("li")!;
    expect(await row()).toHaveTextContent("更新が止まっています");

    await user.click(screen.getByRole("link", { name: "設定へ戻る" }));
    const global = await section("全体設定");
    const field = within(global).getByLabelText(label);
    await user.clear(field);
    await user.type(field, "90");
    await user.click(within(global).getByRole("button", { name: "全体設定を保存" }));
    await waitFor(() => expect(getSettings(server.db).staleFeedDays).toBe(90));

    await user.click(await screen.findByRole("link", { name: "購読フィードを設定する" }));
    await waitFor(async () => expect(await row()).not.toHaveTextContent("更新が止まっています"));
  });

  it("is not saved outside 1 to 365, and the field says what is allowed", async () => {
    const server = makeServer();
    const { user } = renderApp({ server, route: "/settings" });
    const global = await section("全体設定");
    const field = within(global).getByLabelText(label);
    await user.clear(field);
    await user.type(field, "0");
    await user.click(within(global).getByRole("button", { name: "全体設定を保存" }));
    expect(await within(global).findByText("1から365までの日数を入れてください。")).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription(/1から365までの日数/);
    expect(getSettings(server.db).staleFeedDays).toBe(60);
  });
});

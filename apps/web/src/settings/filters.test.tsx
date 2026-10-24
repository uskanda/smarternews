import { createFilter, insertFeed, listFilters, updateFilter, type FilterCondition, type FilterCreate } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const section = (name: string) => screen.findByRole("region", { name });
const title = (value: string): FilterCondition => ({ fields: ["title"], match: "contains", value });
const hide = (value: string): FilterCreate => ({ action: "hide", scope: { type: "all" }, conditions: [title(value)] });

function feedOf(server: TestServer, name: string, categoryId: number | null = null) {
  return insertFeed(server.db, { url: `https://${name.toLowerCase()}.example.org/feed.xml`, title: name, categoryId }, server.clock);
}

/** A feed "Shop" with three sale articles and one other. */
function withArticles() {
  const server = makeServer();
  const feed = feedOf(server, "Shop");
  const at = (hour: number) => `2026-03-01T0${hour}:00:00.000Z`;
  seedFeedArticle(server.db, feed.id, { title: "春の特売", at: at(1) });
  seedFeedArticle(server.db, feed.id, { title: "夏の特売", at: at(2) });
  seedFeedArticle(server.db, feed.id, { title: "特売の予告", at: at(3) });
  seedFeedArticle(server.db, feed.id, { title: "新製品", at: at(4), author: "広報部" });
  return { server, feed };
}

const rowOf = async (text: string) => {
  const list = await section("フィルターの一覧");
  return (await within(list).findByText(text)).closest("li")!;
};

describe("the filter page", () => {
  it("explains, beside the form, what is hidden and what never is", async () => {
    renderApp({ route: "/settings/filters" });
    const form = await section("フィルターの追加");
    expect(form).toHaveTextContent("購読フィードの配信記事だけを隠します");
    expect(form).toHaveTextContent("スターのある記事は隠しません");
    expect(form).toHaveTextContent("隠すフィルターと残すフィルターの両方に当たる記事は隠します");
  });

  it("lists each filter with its kind, scope, conditions and how many articles it hides", async () => {
    const { server, feed } = withArticles();
    createFilter(server.db, hide("特売"), server.clock);
    createFilter(server.db, { action: "keep", scope: { type: "feed", feedId: feed.id }, conditions: [{ fields: ["title", "content"], match: "regex", value: "^新" }] }, server.clock);
    renderApp({ server, route: "/settings/filters" });

    const first = await rowOf("タイトルに「特売」を含む");
    expect(first).toHaveTextContent("隠すフィルター（全体）");
    expect(first).toHaveTextContent("3件を隠しています");
    const second = await rowOf("タイトルか内容が正規表現「^新」に合う");
    expect(second).toHaveTextContent("残すフィルター（購読フィード「Shop」）");
    expect(second).toHaveTextContent("3件を隠しています");
  });

  it("says that there are none yet", async () => {
    renderApp({ route: "/settings/filters" });
    expect(await within(await section("フィルターの一覧")).findByText("フィルターはまだありません。")).toBeInTheDocument();
  });
});

describe("adding a filter", () => {
  it("adds a hide filter of two conditions for one feed, and shows how many it hides", async () => {
    const server = makeServer();
    const feed = feedOf(server, "Shop");
    seedFeedArticle(server.db, feed.id, { title: "夏のセール", author: "広報部" });
    seedFeedArticle(server.db, feed.id, { title: "冬のセール", author: "営業部" });
    const { user } = renderApp({ server, route: "/settings/filters" });
    const form = await section("フィルターの追加");

    await user.selectOptions(within(form).getByLabelText("範囲"), await within(form).findByRole("option", { name: "Shop" }));
    await user.type(within(form).getByLabelText("条件1の値"), "セール");
    await user.click(within(form).getByRole("button", { name: "条件を足す" }));
    const second = within(form).getByRole("group", { name: "条件2の欄" });
    await user.click(within(second).getByRole("checkbox", { name: "タイトル" }));
    await user.click(within(second).getByRole("checkbox", { name: "著者" }));
    await user.type(within(form).getByLabelText("条件2の値"), "広報");
    await user.click(within(form).getByRole("button", { name: "フィルターを追加" }));

    expect(await screen.findByText("フィルターを追加しました。1件を隠しています。")).toBeInTheDocument();
    const row = await rowOf("タイトルに「セール」を含む、かつ著者に「広報」を含む");
    expect(row).toHaveTextContent("隠すフィルター（購読フィード「Shop」）");
    expect(row).toHaveTextContent("1件を隠しています");
    expect(listFilters(server.db)).toMatchObject([
      { action: "hide", scope: { type: "feed", feedId: feed.id }, conditions: [title("セール"), { fields: ["author"], match: "contains", value: "広報" }] },
    ]);
    expect(within(form).getByLabelText("条件1の値")).toHaveValue("");
  });

  it("offers no 全体 to a keep filter, and adds nothing until a scope is chosen", async () => {
    const { user } = renderApp({ server: withArticles().server, route: "/settings/filters" });
    const form = await section("フィルターの追加");
    const scope = within(form).getByLabelText("範囲");
    expect(scope).toHaveValue("all");

    await user.click(within(form).getByRole("radio", { name: "残すフィルター" }));
    await user.type(within(form).getByLabelText("条件1の値"), "新製品");

    expect(within(scope).queryByRole("option", { name: "全体" })).toBeNull();
    expect(within(form).getByRole("button", { name: "フィルターを追加" })).toBeDisabled();
    await user.selectOptions(scope, await within(form).findByRole("option", { name: "Shop" }));
    expect(within(form).getByRole("button", { name: "フィルターを追加" })).toBeEnabled();
  });

  it("counts what it would hide before saving, and leaves the list as it is", async () => {
    const { server } = withArticles();
    const { user } = renderApp({ server, route: "/settings/filters" });
    const form = await section("フィルターの追加");

    await user.type(within(form).getByLabelText("条件1の値"), "特売");
    await user.click(within(form).getByRole("button", { name: "隠れる件数を確かめる" }));

    expect(await within(form).findByRole("status")).toHaveTextContent("保存すると、3件が隠れます。");
    expect(listFilters(server.db)).toEqual([]);
    expect(await within(await section("フィルターの一覧")).findByText("フィルターはまだありません。")).toBeInTheDocument();
  });

  it("shows why a regular expression is refused next to its condition, and keeps what was typed", async () => {
    const { user } = renderApp({ server: withArticles().server, route: "/settings/filters" });
    const form = await section("フィルターの追加");

    await user.selectOptions(within(form).getByLabelText("条件1の方法"), "regex");
    fireEvent.change(within(form).getByLabelText("条件1の値"), { target: { value: "(sale" } });
    await user.click(within(form).getByRole("button", { name: "フィルターを追加" }));

    const condition = within(form).getByRole("group", { name: "条件1" });
    expect(await within(condition).findByText("正規表現として読めません。かっこや記号の対応を確かめてください。")).toBeInTheDocument();
    expect(within(form).getByLabelText("条件1の値")).toHaveValue("(sale");
    expect(within(form).getByLabelText("条件1の値")).toHaveAttribute("aria-invalid", "true");
  });

  it("says that the same filter is there already", async () => {
    const { server } = withArticles();
    createFilter(server.db, hide("特売"), server.clock);
    const { user } = renderApp({ server, route: "/settings/filters" });
    const form = await section("フィルターの追加");
    await user.type(within(form).getByLabelText("条件1の値"), "特売");
    await user.click(within(form).getByRole("button", { name: "フィルターを追加" }));
    expect(await within(form).findByText("同じフィルターがすでにあります。")).toBeInTheDocument();
  });
});

describe("the filter page by keyboard on a narrow screen", () => {
  it("adds a filter with the keyboard alone", async () => {
    const { server } = withArticles();
    const { user } = renderApp({ server, route: "/settings/filters", width: 390 });
    const form = await section("フィルターの追加");
    const value = within(form).getByLabelText("条件1の値");

    // From the scope, the keyboard reaches the fields of the condition, its method and its value.
    within(form).getByLabelText("範囲").focus();
    await user.tab();
    expect(within(form).getByRole("checkbox", { name: "タイトル" })).toHaveFocus();
    for (let step = 0; step < 4; step += 1) await user.tab();
    expect(within(form).getByLabelText("条件1の方法")).toHaveFocus();
    await user.tab();
    expect(value).toHaveFocus();
    await user.keyboard("特売{Enter}");

    expect(await screen.findByText("フィルターを追加しました。3件を隠しています。")).toBeInTheDocument();
    expect(listFilters(server.db)).toHaveLength(1);
  });
});

describe("changing a filter", () => {
  it("adds a condition and shows the new count", async () => {
    const { server } = withArticles();
    createFilter(server.db, hide("特売"), server.clock);
    const { user } = renderApp({ server, route: "/settings/filters" });
    const row = await rowOf("タイトルに「特売」を含む");

    await user.click(within(row).getByRole("button", { name: "隠すフィルター（全体）を編集" }));
    const form = within(row).getByRole("form", { name: "フィルターの編集" });
    await user.click(within(form).getByRole("button", { name: "隠れる件数を確かめる" }));
    expect(await within(form).findByRole("status")).toHaveTextContent("保存すると、3件が隠れます。");
    await user.click(within(form).getByRole("button", { name: "条件を足す" }));
    await user.type(within(form).getByLabelText("条件2の値"), "春");
    await user.click(within(form).getByRole("button", { name: "隠れる件数を確かめる" }));
    expect(await within(form).findByRole("status")).toHaveTextContent("保存すると、1件が隠れます。");
    expect(listFilters(server.db)[0]!.conditions).toHaveLength(1);

    await user.click(within(form).getByRole("button", { name: "保存" }));

    const changed = await rowOf("タイトルに「特売」を含む、かつタイトルに「春」を含む");
    expect(changed).toHaveTextContent("1件を隠しています");
  });

  it("switches a filter off, says how many came back, and on again", async () => {
    const { server } = withArticles();
    createFilter(server.db, hide("特売"), server.clock);
    const { user } = renderApp({ server, route: "/settings/filters" });

    await user.click(await screen.findByRole("button", { name: "隠すフィルター（全体）を無効にする" }));

    expect(await screen.findByText("フィルターを無効にしました。3件が一覧に戻りました。")).toBeInTheDocument();
    const row = await rowOf("タイトルに「特売」を含む");
    await waitFor(() => expect(row).toHaveTextContent("無効"));
    expect(row).toHaveTextContent("いまは隠していません");

    await user.click(within(row).getByRole("button", { name: "隠すフィルター（全体）を有効にする" }));
    await waitFor(() => expect(row).toHaveTextContent("3件を隠しています"));
  });

  it("removes a filter and says how many articles came back", async () => {
    const { server } = withArticles();
    createFilter(server.db, hide("特売"), server.clock);
    const { user } = renderApp({ server, route: "/settings/filters" });

    await user.click(await screen.findByRole("button", { name: "隠すフィルター（全体）を削除" }));

    expect(await screen.findByText("フィルターを削除しました。3件が一覧に戻りました。")).toBeInTheDocument();
    expect(listFilters(server.db)).toEqual([]);
    expect(await within(await section("フィルターの一覧")).findByText("フィルターはまだありません。")).toBeInTheDocument();
  });
});

describe("the articles a filter hides", () => {
  it("lists them newest first with their feed and time, and opens one", async () => {
    const { server, feed } = withArticles();
    createFilter(server.db, { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "regex", value: "特売$|^特売" }] }, server.clock);
    const { user, path } = renderApp({ server, route: "/settings/filters" });

    await user.click(await screen.findByRole("button", { name: "隠すフィルター（全体）が隠している記事" }));

    const hidden = await section("隠している記事");
    const links = await within(hidden).findAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["特売の予告", "夏の特売", "春の特売"]);
    expect(hidden).toHaveTextContent("Shop");
    expect(hidden).toHaveTextContent("3月1日");

    await user.click(links[1]!);

    expect(path()).toMatch(new RegExp(`^/f/${feed.id}/\\d+$`));
    const article = await screen.findByRole("article", { name: "記事" });
    expect(await within(article).findByRole("heading", { name: "夏の特売" })).toBeInTheDocument();
  });
});

describe("deleting what filters apply to", () => {
  function scoped() {
    const server = makeServer();
    const tools = server.category("Tools");
    const shop = feedOf(server, "Shop", tools.id);
    const plain = feedOf(server, "Plain", tools.id);
    createFilter(server.db, { action: "hide", scope: { type: "feed", feedId: shop.id }, conditions: [title("特売")] }, server.clock);
    const off = createFilter(server.db, { action: "keep", scope: { type: "feed", feedId: shop.id }, conditions: [title("新製品")] }, server.clock);
    createFilter(server.db, { action: "keep", scope: { type: "category", categoryId: tools.id }, conditions: [title("発表")] }, server.clock);
    // A filter that is switched off goes too, and is counted.
    updateFilter(server.db, off.id, { enabled: false });
    return { server, tools, shop, plain };
  }

  it("says in the feed's question that its two filters go with it", async () => {
    const { server } = scoped();
    const { user } = renderApp({ server, route: "/settings/feeds" });
    await user.click(await screen.findByRole("button", { name: "Shopを削除" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("この購読フィードを範囲とするフィルター2件も一緒に削除されます。");
  });

  it("says nothing of filters for a feed without any", async () => {
    const { server } = scoped();
    const { user } = renderApp({ server, route: "/settings/feeds" });
    await user.click(await screen.findByRole("button", { name: "Plainを削除" }));
    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("フィルター");
  });

  it("says in the category's question that its one filter goes with it", async () => {
    const { server, tools } = scoped();
    const { user } = renderApp({ server, route: `/settings/categories/${tools.id}` });
    await user.click(await screen.findByRole("button", { name: "カテゴリを削除" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("このカテゴリを範囲とするフィルター1件も一緒に削除されます。");
  });

  it("says it in the question of the menu too", async () => {
    const { server } = scoped();
    const { user } = renderApp({ server, route: "/all" });
    const nav = await screen.findByRole("navigation", { name: "項目" });
    fireEvent.contextMenu(await within(nav).findByRole("link", { name: /^Shop\s*\d*$/ }));
    await user.click(await screen.findByRole("menuitem", { name: "登録を解除" }));
    expect(await screen.findByRole("alertdialog", { name: "購読フィードを削除しますか" })).toHaveTextContent(
      "この購読フィードを範囲とするフィルター2件も一緒に削除されます。",
    );
  });
});


